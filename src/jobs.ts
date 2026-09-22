import {
  AUDIO_TYPE_LABELS,
  CANCELLED_JOB_MESSAGE,
  INTERRUPTED_JOB_MESSAGE,
  MAX_DIRECT_UPLOAD_BYTES,
  MODEL_LABELS,
  TERMINAL_JOB_STATUSES,
} from "./constants";
import type { JobRepository } from "./db";
import { ElevenLabsAPIError, ElevenLabsClient } from "./elevenlabsClient";
import { recordEvent } from "./log";
import { presignAudioUrl, presignConfigured } from "./presign";
import { scanTranscriptMetadata } from "./responseScan";
import { isHidden, isTerminal, serializeDetail } from "./serialization";
import { deleteJobObjects, deleteSpeakerNames, readSpeakerNames } from "./storage";
import {
  buildApiFields,
  effectiveSettings,
  oversizeMessage,
  submissionDefaults,
} from "./transcription";
import type { Env, JobRecord, TranscriptionSubmission } from "./types";

/** A job still non-terminal past this is unrecoverable: no consumer invocation lives that long. */
const STALE_JOB_MINUTES = 20;

/** How long to wait before first asking whether an accepted transcription has finished. */
const FIRST_POLL_DELAY_SECONDS = 20;
/** Gap between later checks, and how many to make before giving up (20 x 30s plus the first). */
const POLL_INTERVAL_SECONDS = 30;
const MAX_POLL_ATTEMPTS = 60;
/**
 * How long a job that ElevenLabs has accepted may sit before it is given up on.
 *
 * Comfortably past the polling deadline above, so the sweep only ever catches a job whose polling
 * has actually stopped rather than one still waiting its turn.
 */
const STALE_POLLING_JOB_MINUTES = 45;

export interface BatchInfo {
  batchId?: string;
  batchIndex?: number;
  batchCount?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Appends a stage marker. The browser renders these as a traceable timeline, which is the
 * only way to tell a slow upload apart from a stalled one.
 */
function addStage(record: JobRecord, stage: string, detail?: string): void {
  const settings = record.effective_settings ?? {};
  const stages = settings.stages ?? [];
  stages.push({ stage, at: nowIso(), ...(detail ? { detail } : {}) });
  settings.stages = stages;
  record.effective_settings = settings;
}

export class JobService {
  private readonly client: ElevenLabsClient;

  constructor(
    private readonly env: Env,
    private readonly repository: JobRepository,
    client?: ElevenLabsClient
  ) {
    this.client = client ?? new ElevenLabsClient(env.ELEVENLABS_API_URL);
  }

  async queueSubmission(
    submission: TranscriptionSubmission,
    upload: { key: string; size: number } | null,
    origin: string,
    batch: BatchInfo = {}
  ): Promise<JobRecord> {
    const jobId = crypto.randomUUID();
    const settings = effectiveSettings(submission);

    if (batch.batchId) {
      settings.batch_id = batch.batchId;
      settings.batch_index = batch.batchIndex;
      settings.batch_count = batch.batchCount;
    }

    // The audio is already in R2: the browser put it there in parts, because it cannot fit in
    // a single request and must never be held in the Worker's memory.
    let uploadKey: string | undefined;
    if (submission.source_mode === "upload" && upload) {
      uploadKey = upload.key;
      settings.upload_key = uploadKey;
      settings.upload_bytes = upload.size;
    }
    settings.origin = origin;

    const record: JobRecord = {
      job_id: jobId,
      transcription_id: null,
      created_at: nowIso(),
      source_type: submission.source_mode,
      source_label: submission.source_label,
      model: submission.model_id,
      language: submission.language_code,
      audio_type: submission.audio_type,
      status: "queued",
      status_detail: "Queued. The job will start as soon as a worker picks it up.",
      error_message: null,
      started_at: null,
      completed_at: null,
      effective_settings: settings,
      transcript_preview: null,
      detected_language: null,
      response_json_path: null,
    };

    if (uploadKey) {
      addStage(record, "audio_stored", `${(upload!.size / 1024 / 1024).toFixed(1)} MB received`);
    }
    addStage(record, "queued");

    await this.repository.saveJob(record);
    await this.repository.setLastUsedDefaults(submissionDefaults(submission));
    await this.env.JOB_QUEUE.send({ job_id: jobId, upload_key: uploadKey });

    return record;
  }

  /**
   * Runs inside the Queue consumer. The transcript is moved from ElevenLabs to R2 as opaque
   * bytes; every derived view of it is produced in the browser instead.
   */
  async runJob(jobId: string, apiKey: string): Promise<void> {
    const record = await this.repository.getJob(jobId);
    if (!record || isTerminal(record)) {
      return;
    }

    const settings = record.effective_settings ?? {};
    const startedAt = Date.now();
    record.status = "running";
    record.started_at = nowIso();
    record.status_detail = "Picked up by a worker.";
    addStage(record, "picked_up");
    await this.repository.saveJob(record);
    await recordEvent(this.env.DB, jobId, "info", "run.started", {
      source: record.source_type,
      model: record.model,
      upload_bytes: settings.upload_bytes ?? null,
    });

    try {
      const fields = buildApiFields(this.submissionFromSettings(record));

      let file: { name: string; type: string; size: number; body: ReadableStream } | undefined;

      if (record.source_type === "upload") {
        if (!settings.upload_key) {
          throw new Error("The uploaded audio is no longer available. Start the job again.");
        }
        const object = await this.env.TRANSCRIPTS.head(settings.upload_key);
        if (!object) {
          throw new Error("The uploaded audio is no longer available. Start the job again.");
        }

        const contentType = object.httpMetadata?.contentType ?? "audio/mpeg";
        const megabytes = `${(object.size / 1024 / 1024).toFixed(1)} MB`;

        if (presignConfigured(this.env)) {
          // Preferred path: ElevenLabs downloads the audio from R2 itself, so the bytes never pass
          // through this Worker and Cloudflare's 100 MiB cap on an outgoing body never applies.
          const url = await presignAudioUrl(this.env, settings.upload_key);
          fields.push(["source_url", url]);
          addStage(record, "audio_linked", `${megabytes} as ${contentType}`);
          await recordEvent(this.env.DB, jobId, "info", "audio.linked", {
            bytes: object.size,
            content_type: contentType,
            // The signature is a credential for as long as it lives, so only the shape is logged.
            url_host: new URL(url).host,
          });
        } else {
          // Fallback while signing is unconfigured. Cloudflare refuses an outgoing body over
          // 100 MiB with a 413, so anything larger cannot be pushed from here at all.
          if (object.size > MAX_DIRECT_UPLOAD_BYTES) {
            throw new Error(oversizeMessage(object.size));
          }
          const body = await this.env.TRANSCRIPTS.get(settings.upload_key);
          if (!body) {
            throw new Error("The uploaded audio is no longer available. Start the job again.");
          }
          file = {
            name: settings.upload_key.split("/").pop() ?? "audio",
            type: contentType,
            size: object.size,
            body: body.body,
          };
          addStage(record, "audio_streaming", `${megabytes} as ${contentType}`);
          await recordEvent(this.env.DB, jobId, "info", "audio.opened", {
            bytes: object.size,
            content_type: contentType,
            name: file.name,
          });
        }
      }

      record.status_detail = file
        ? "Streaming the audio to ElevenLabs and waiting for the transcript."
        : "Sent to ElevenLabs. Waiting for the transcript — this job waits up to about 13 minutes.";
      addStage(record, "sent_to_elevenlabs");
      await this.repository.saveJob(record);

      // Last thing written before a potentially long transfer. If the trail stops here, the
      // consumer died during the upload rather than being rejected by ElevenLabs.
      await recordEvent(this.env.DB, jobId, "info", "elevenlabs.request.start", {
        streaming: Boolean(file),
        bytes: file?.size ?? null,
        elapsed_ms: Date.now() - startedAt,
      });

      const onResponseHeaders = (status: number) => {
        // Written without awaiting: the upload is still in flight, and if it dies from here on
        // the trail should still show that the upstream had already answered, and with what.
        void recordEvent(this.env.DB, jobId, "info", "elevenlabs.response.headers", {
          status,
          elapsed_ms: Date.now() - startedAt,
        });
      };

      // Asynchronous first. Cloudflare cuts a Worker's outgoing request off after 120 seconds,
      // which anything longer than a short recording cannot be transcribed inside, and the
      // credits are spent whether or not the answer arrives before the cut.
      if (settings.force_sync !== true) {
        try {
          const accepted = await this.client.submitAsync(apiKey, fields, {
            enableLogging: settings.enable_logging !== false,
            file,
            onResponseHeaders,
          });
          if (accepted.transcriptionId) {
            await recordEvent(this.env.DB, jobId, "info", "elevenlabs.accepted", {
              transcription_id: accepted.transcriptionId,
              elapsed_ms: Date.now() - startedAt,
            });
            const current = (await this.repository.getJob(jobId)) ?? record;
            current.effective_settings = record.effective_settings;
            addStage(current, "accepted_by_elevenlabs", "Transcribing; the result is collected when ready");
            current.transcription_id = accepted.transcriptionId;
            current.status_detail = "ElevenLabs is transcribing. This is checked every 20 seconds.";
            await this.repository.saveJob(current);

            await this.env.JOB_QUEUE.send(
              { job_id: jobId, kind: "poll", transcription_id: accepted.transcriptionId, poll_attempt: 1 },
              { delaySeconds: FIRST_POLL_DELAY_SECONDS }
            );

            if (settings.upload_key) {
              // ElevenLabs has the audio now; nothing here needs it again.
              await this.env.TRANSCRIPTS.delete(settings.upload_key).catch(() => undefined);
            }
            return;
          }
          // Accepted, but with no id there is nothing to collect later. Deliberately not retried
          // on the synchronous path: ElevenLabs has the audio and is charging for it, and sending
          // it again would pay for the same recording twice.
          await recordEvent(this.env.DB, jobId, "error", "elevenlabs.async_without_id", {
            payload: accepted.payload,
          });
          throw new Error(
            "ElevenLabs accepted the audio but returned no transcription id, so the result cannot " +
              "be collected. It was not sent again, because that would be charged twice. The " +
              "transcript may appear in your ElevenLabs history."
          );
        } catch (error) {
          // Falling back is only safe before the audio has been accepted; once it has, retrying
          // would submit and pay for the same recording twice.
          const status = error instanceof ElevenLabsAPIError ? error.statusCode : null;
          await recordEvent(this.env.DB, jobId, "warn", "elevenlabs.async_unavailable", {
            status,
            error: error instanceof Error ? error.message : String(error),
          });
          if (status === 524 || status === null || status >= 500) {
            throw error;
          }
          // The body was consumed by the attempt that just failed, so the retry needs its own.
          // Without this the fallback would send an empty file and blame ElevenLabs for it.
          if (file) {
            if (!settings.upload_key) {
              throw error;
            }
            const reopened = await this.env.TRANSCRIPTS.get(settings.upload_key);
            if (!reopened) {
              throw error;
            }
            file = { ...file, body: reopened.body };
          }
          // A 4xx means the request was understood and refused, so the synchronous path is worth
          // trying: it is the one that works when this deployment cannot use webhooks.
        }
      }

      const bytes = await this.client.transcribe(apiKey, fields, {
        enableLogging: settings.enable_logging !== false,
        file,
        onResponseHeaders,
      });

      await recordEvent(this.env.DB, jobId, "info", "elevenlabs.request.done", {
        transcript_bytes: bytes.byteLength,
        elapsed_ms: Date.now() - startedAt,
      });

      // Cancelled while the request was in flight: discard the result quietly.
      if (await this.isCancelled(jobId)) {
        return;
      }

      const transcriptKey = `${jobId}/transcript.json`;
      await this.env.TRANSCRIPTS.put(transcriptKey, bytes, {
        httpMetadata: { contentType: "application/json" },
      });

      const scanned = scanTranscriptMetadata(bytes);

      const current = (await this.repository.getJob(jobId)) ?? record;
      current.effective_settings = record.effective_settings;
      addStage(
        current,
        "transcript_received",
        `${(bytes.byteLength / 1024).toFixed(0)} KB of transcript JSON`
      );
      addStage(current, "done");
      await recordEvent(this.env.DB, jobId, "info", "run.succeeded", {
        elapsed_ms: Date.now() - startedAt,
      });
      current.status = "success";
      current.status_detail = "Transcription completed.";
      current.completed_at = nowIso();
      current.response_json_path = transcriptKey;
      current.transcription_id = scanned.transcriptionId;
      current.detected_language = scanned.languageCode;
      current.transcript_preview = scanned.preview;
      await this.repository.saveJob(current);

      if (settings.upload_key) {
        await this.env.TRANSCRIPTS.delete(settings.upload_key);
      }
    } catch (error) {
      if (await this.isCancelled(jobId)) {
        return;
      }
      await recordEvent(this.env.DB, jobId, "error", "run.failed", {
        error: error instanceof Error ? error.message : String(error),
        status: error instanceof ElevenLabsAPIError ? error.statusCode : null,
        details: error instanceof ElevenLabsAPIError ? error.details : null,
        stack: error instanceof Error ? error.stack?.slice(0, 1200) : null,
        elapsed_ms: Date.now() - startedAt,
      });
      const current = (await this.repository.getJob(jobId)) ?? record;
      current.effective_settings = record.effective_settings;
      addStage(current, "failed");
      current.status = "error";
      current.completed_at = nowIso();
      current.error_message =
        error instanceof ElevenLabsAPIError
          ? `${error.message}${error.details ? ` [${JSON.stringify(error.details).slice(0, 400)}]` : ""}`
          : error instanceof Error
            ? error.message || error.name
            : String(error);
      current.status_detail = "The transcription failed.";
      await this.repository.saveJob(current);

      if (settings.upload_key) {
        await this.env.TRANSCRIPTS.delete(settings.upload_key).catch(() => undefined);
      }
    }
  }

  /**
   * Collects a transcript that ElevenLabs accepted earlier.
   *
   * Each check is its own short-lived queue message rather than a connection held open, because
   * the 120 second ceiling that made the synchronous path fail applies just as much to waiting.
   */
  async pollJob(jobId: string, transcriptionId: string, attempt: number, apiKey: string): Promise<void> {
    const record = await this.repository.getJob(jobId);
    if (!record || isTerminal(record)) {
      return;
    }

    let outcome;
    try {
      outcome = await this.client.fetchTranscriptIfReady(apiKey, transcriptionId);
    } catch (error) {
      await recordEvent(this.env.DB, jobId, "error", "poll.failed", {
        attempt,
        transcription_id: transcriptionId,
        error: error instanceof Error ? error.message : String(error),
        status: error instanceof ElevenLabsAPIError ? error.statusCode : null,
      });
      await this.failJob(jobId, record, error);
      return;
    }

    if (!outcome.ready) {
      await recordEvent(this.env.DB, jobId, "info", "poll.not_ready", {
        attempt,
        status: outcome.status,
      });

      if (attempt >= MAX_POLL_ATTEMPTS) {
        await this.failJob(
          jobId,
          record,
          new Error(
            "ElevenLabs accepted the audio but the transcript did not arrive within half an hour. " +
              `It may still appear in your ElevenLabs history under id ${transcriptionId}.`
          )
        );
        return;
      }

      record.status_detail = `ElevenLabs is still transcribing (checked ${attempt} time${attempt === 1 ? "" : "s"}).`;
      await this.repository.saveJob(record);
      await this.env.JOB_QUEUE.send(
        { job_id: jobId, kind: "poll", transcription_id: transcriptionId, poll_attempt: attempt + 1 },
        { delaySeconds: POLL_INTERVAL_SECONDS }
      );
      return;
    }

    const bytes = outcome.bytes!;
    await recordEvent(this.env.DB, jobId, "info", "poll.ready", {
      attempt,
      transcript_bytes: bytes.byteLength,
    });

    if (await this.isCancelled(jobId)) {
      return;
    }

    const transcriptKey = `${jobId}/transcript.json`;
    await this.env.TRANSCRIPTS.put(transcriptKey, bytes, {
      httpMetadata: { contentType: "application/json" },
    });

    const scanned = scanTranscriptMetadata(bytes);
    const current = (await this.repository.getJob(jobId)) ?? record;
    addStage(current, "transcript_received", `${(bytes.byteLength / 1024).toFixed(0)} KB of transcript JSON`);
    addStage(current, "done");
    current.status = "success";
    current.status_detail = "Transcription completed.";
    current.completed_at = nowIso();
    current.response_json_path = transcriptKey;
    current.transcription_id = scanned.transcriptionId ?? transcriptionId;
    current.detected_language = scanned.languageCode;
    current.transcript_preview = scanned.preview;
    await this.repository.saveJob(current);
    await recordEvent(this.env.DB, jobId, "info", "run.succeeded", { via: "poll", attempt });

    const uploadKey = current.effective_settings?.upload_key;
    if (uploadKey) {
      await this.env.TRANSCRIPTS.delete(uploadKey).catch(() => undefined);
    }
  }

  /** Shared failure path, so a job that dies while polling records what a failed run would. */
  private async failJob(jobId: string, fallback: JobRecord, error: unknown): Promise<void> {
    if (await this.isCancelled(jobId)) {
      return;
    }
    const current = (await this.repository.getJob(jobId)) ?? fallback;
    addStage(current, "failed");
    current.status = "error";
    current.completed_at = nowIso();
    current.error_message =
      error instanceof ElevenLabsAPIError
        ? `${error.message}${error.details ? ` [${JSON.stringify(error.details).slice(0, 400)}]` : ""}`
        : error instanceof Error
          ? error.message || error.name
          : String(error);
    current.status_detail = "The transcription failed.";
    await this.repository.saveJob(current);

    const uploadKey = current.effective_settings?.upload_key;
    if (uploadKey) {
      await this.env.TRANSCRIPTS.delete(uploadKey).catch(() => undefined);
    }
  }

  private async isCancelled(jobId: string): Promise<boolean> {
    const current = await this.repository.getJob(jobId);
    return !current || current.status === "cancelled";
  }

  private submissionFromSettings(record: JobRecord): TranscriptionSubmission {
    const settings = record.effective_settings ?? {};
    return {
      source_mode: (settings.source_mode as "upload" | "url") ?? "upload",
      model_id: settings.model_id ?? record.model,
      language_code: settings.language_code ?? null,
      audio_type: settings.audio_type ?? record.audio_type,
      diarize: settings.diarize ?? false,
      num_speakers: settings.num_speakers ?? null,
      diarization_threshold: settings.diarization_threshold ?? null,
      tag_audio_events: settings.tag_audio_events ?? false,
      timestamps_granularity: settings.timestamps_granularity ?? "word",
      use_multi_channel: settings.use_multi_channel ?? false,
      no_verbatim: settings.no_verbatim ?? false,
      keyterms: settings.keyterms ?? [],
      entity_detection: settings.entity_detection ?? [],
      enable_logging: settings.enable_logging !== false,
      source_label: record.source_label,
      cloud_storage_url: settings.cloud_storage_url ?? null,
      file_name: null,
      file_content_type: null,
    };
  }

  /** Metadata the browser stamps onto generated exports. */
  metadataFor(record: JobRecord): Record<string, unknown> {
    const settings = record.effective_settings ?? {};
    return {
      Source: record.source_label,
      Model: MODEL_LABELS[record.model] ?? record.model,
      Preset: AUDIO_TYPE_LABELS[record.audio_type] ?? record.audio_type,
      "Requested language": record.language ?? "Auto detect",
      "Detected language": record.detected_language,
      Created: record.created_at,
      "Entity detection": settings.entity_detection ?? [],
    };
  }

  async cancelJob(record: JobRecord): Promise<JobRecord> {
    if (isTerminal(record)) {
      return record;
    }
    record.status = "cancelled";
    addStage(record, "cancelled");
    record.status_detail = CANCELLED_JOB_MESSAGE;
    record.completed_at = nowIso();
    await this.repository.saveJob(record);
    return record;
  }

  async deleteLocalJobData(record: JobRecord): Promise<void> {
    await deleteJobObjects(this.env.TRANSCRIPTS, record.job_id);
    // The uploaded audio sits under its own key, so the job-prefixed sweep would miss it.
    const uploadKey = record.effective_settings?.upload_key;
    if (uploadKey) {
      await this.env.TRANSCRIPTS.delete(uploadKey).catch(() => undefined);
    }
    await this.repository.deleteJob(record.job_id);
  }

  async clearSpeakerNames(record: JobRecord): Promise<JobRecord> {
    await deleteSpeakerNames(this.env.TRANSCRIPTS, record.job_id);
    return record;
  }

  async saveHiddenState(
    record: JobRecord,
    options: { hidden: boolean; reason?: string; message?: string; hiddenByJobId?: string }
  ): Promise<JobRecord> {
    const settings = record.effective_settings ?? {};
    if (options.hidden) {
      settings.hidden_at = nowIso();
      settings.hidden_reason = options.reason ?? "manual";
      settings.hidden_message = options.message ?? null;
      settings.hidden_by_job_id = options.hiddenByJobId ?? null;
    } else {
      settings.hidden_at = null;
      settings.hidden_reason = null;
      settings.hidden_message = null;
      settings.hidden_by_job_id = null;
    }
    record.effective_settings = settings;
    await this.repository.saveJob(record);
    return record;
  }

  /** Auto-hides failed attempts that a later successful run of the same source replaced. */
  async reconcileSupersededJobs(records: JobRecord[]): Promise<number> {
    const groups = new Map<string, JobRecord[]>();
    for (const record of records) {
      const key = `${record.source_type}:${record.source_label.replace(/\s+/g, " ").trim().toLowerCase()}`;
      const group = groups.get(key) ?? [];
      group.push(record);
      groups.set(key, group);
    }

    let changes = 0;
    for (const group of groups.values()) {
      const newestSuccess = group
        .filter((record) => record.status === "success")
        .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];

      for (const record of group) {
        const settings = record.effective_settings ?? {};
        const autoHidden = settings.hidden_reason === "superseded_success";

        if (record.status === "success" && autoHidden) {
          await this.saveHiddenState(record, { hidden: false });
          changes += 1;
          continue;
        }

        if (!newestSuccess || record.job_id === newestSuccess.job_id) {
          continue;
        }
        const supersedable = record.status === "error" || record.status === "cancelled";
        const manuallyHidden = Boolean(settings.hidden_at) && settings.hidden_reason === "manual";

        if (supersedable && !manuallyHidden && !autoHidden && record.created_at < newestSuccess.created_at) {
          await this.saveHiddenState(record, {
            hidden: true,
            reason: "superseded_success",
            message: "A later attempt for the same source finished successfully.",
            hiddenByJobId: newestSuccess.job_id,
          });
          changes += 1;
        }
      }
    }
    return changes;
  }

  /** No process survives a restart on Workers, so stalled jobs are failed on read. */
  async markStaleJobsAsInterrupted(records: JobRecord[]): Promise<JobRecord[]> {
    for (const record of records) {
      if (TERMINAL_JOB_STATUSES.has(record.status)) {
        continue;
      }
      // A job ElevenLabs has accepted is legitimately alive for as long as it is being polled for,
      // which is longer than a job that never got that far should ever sit. Judging both by the
      // same clock would declare a transcription still in progress dead and stop collecting it.
      const minutes = record.transcription_id ? STALE_POLLING_JOB_MINUTES : STALE_JOB_MINUTES;
      const cutoff = Date.now() - minutes * 60 * 1000;
      const anchor = Date.parse(record.started_at ?? record.created_at);
      if (Number.isFinite(anchor) && anchor < cutoff) {
        await recordEvent(this.env.DB, record.job_id, "error", "job.marked_interrupted", {
          last_status: record.status,
          stages: (record.effective_settings?.stages ?? []).map((stage) => stage.stage),
          minutes_since_start: Math.round((Date.now() - anchor) / 60000),
        });
        record.status = "error";
        record.error_message = INTERRUPTED_JOB_MESSAGE;
        record.status_detail = "Interrupted.";
        record.completed_at = nowIso();
        await this.repository.saveJob(record);
      }
    }
    return records;
  }

  async saveRemotePresenceState(record: JobRecord, status: string, message: string | null): Promise<JobRecord> {
    const settings = record.effective_settings ?? {};
    settings.remote_presence_status = status;
    settings.remote_presence_message = message;
    settings.remote_presence_checked_at = nowIso();
    record.effective_settings = settings;
    await this.repository.saveJob(record);
    return record;
  }

  async verifyRemoteRecord(record: JobRecord, apiKey: string): Promise<JobRecord> {
    const settings = record.effective_settings ?? {};

    if (!record.transcription_id) {
      const alreadyDeleted = Boolean(settings.remote_deleted_at);
      return this.saveRemotePresenceState(
        record,
        alreadyDeleted ? "missing" : "not_available",
        alreadyDeleted
          ? "The ElevenLabs copy was deleted from this app."
          : "This job has no stored ElevenLabs transcript ID to check."
      );
    }

    try {
      await this.client.getTranscript(apiKey, record.transcription_id);
      return this.saveRemotePresenceState(record, "present", "ElevenLabs still has this transcript.");
    } catch (error) {
      if (error instanceof ElevenLabsAPIError && error.statusCode === 404) {
        settings.last_known_transcription_id = record.transcription_id;
        record.transcription_id = null;
        record.effective_settings = settings;
        return this.saveRemotePresenceState(record, "missing", "ElevenLabs no longer has this transcript.");
      }
      const message = error instanceof Error ? error.message : String(error);
      return this.saveRemotePresenceState(record, "unknown", `Could not confirm: ${message}`);
    }
  }

  async detailFor(record: JobRecord): Promise<Record<string, unknown>> {
    const speakerNames = await readSpeakerNames(this.env.TRANSCRIPTS, record.job_id);
    return serializeDetail(record, speakerNames, this.metadataFor(record));
  }

  hidden(record: JobRecord): boolean {
    return isHidden(record);
  }
}
