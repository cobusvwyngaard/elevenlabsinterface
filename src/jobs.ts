import {
  AUDIO_TYPE_LABELS,
  CANCELLED_JOB_MESSAGE,
  INTERRUPTED_JOB_MESSAGE,
  MODEL_LABELS,
  TERMINAL_JOB_STATUSES,
} from "./constants";
import type { JobRepository } from "./db";
import { ElevenLabsAPIError, ElevenLabsClient } from "./elevenlabsClient";
import { scanTranscriptMetadata } from "./responseScan";
import { isHidden, isTerminal, serializeDetail } from "./serialization";
import { deleteJobObjects, deleteSpeakerNames, readSpeakerNames, uploadKey as makeUploadKey } from "./storage";
import { buildApiFields, effectiveSettings, submissionDefaults } from "./transcription";
import type { Env, JobRecord, TranscriptionSubmission } from "./types";

/** A job still non-terminal past this is unrecoverable: no consumer invocation lives that long. */
const STALE_JOB_MINUTES = 20;

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
    fileBody: ArrayBuffer | null,
    batch: BatchInfo = {}
  ): Promise<JobRecord> {
    const jobId = crypto.randomUUID();
    const settings = effectiveSettings(submission);

    if (batch.batchId) {
      settings.batch_id = batch.batchId;
      settings.batch_index = batch.batchIndex;
      settings.batch_count = batch.batchCount;
    }

    let uploadKey: string | undefined;
    if (submission.source_mode === "upload" && fileBody) {
      uploadKey = makeUploadKey(jobId, submission.file_name ?? "audio");
      await this.env.TRANSCRIPTS.put(uploadKey, fileBody, {
        httpMetadata: { contentType: submission.file_content_type ?? "application/octet-stream" },
      });
      settings.upload_key = uploadKey;
      settings.upload_bytes = fileBody.byteLength;
    }

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
      addStage(record, "audio_stored", `${(fileBody!.byteLength / 1024 / 1024).toFixed(1)} MB received`);
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
    record.status = "running";
    record.started_at = nowIso();
    record.status_detail = "Picked up by a worker.";
    addStage(record, "picked_up");
    await this.repository.saveJob(record);

    try {
      const fields = buildApiFields(this.submissionFromSettings(record));

      let file: { name: string; type: string; body: ArrayBuffer } | undefined;
      if (record.source_type === "upload" && settings.upload_key) {
        const object = await this.env.TRANSCRIPTS.get(settings.upload_key);
        if (!object) {
          throw new Error("The uploaded audio is no longer available. Start the job again.");
        }
        file = {
          name: settings.upload_key.split("/").pop() ?? "audio",
          type: object.httpMetadata?.contentType ?? "application/octet-stream",
          body: await object.arrayBuffer(),
        };
        addStage(record, "audio_loaded", `${(file.body.byteLength / 1024 / 1024).toFixed(1)} MB`);
      }

      record.status_detail =
        "Sent to ElevenLabs. Waiting for the transcript — this job waits up to about 13 minutes.";
      addStage(record, "sent_to_elevenlabs");
      await this.repository.saveJob(record);

      const bytes = await this.client.transcribe(apiKey, fields, {
        enableLogging: settings.enable_logging !== false,
        file,
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
      const current = (await this.repository.getJob(jobId)) ?? record;
      current.effective_settings = record.effective_settings;
      addStage(current, "failed");
      current.status = "error";
      current.completed_at = nowIso();
      current.error_message =
        error instanceof ElevenLabsAPIError
          ? error.message
          : error instanceof Error
            ? error.message || error.name
            : String(error);
      current.status_detail = "The transcription failed.";
      await this.repository.saveJob(current);
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
    const cutoff = Date.now() - STALE_JOB_MINUTES * 60 * 1000;

    for (const record of records) {
      if (TERMINAL_JOB_STATUSES.has(record.status)) {
        continue;
      }
      const anchor = Date.parse(record.started_at ?? record.created_at);
      if (Number.isFinite(anchor) && anchor < cutoff) {
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
