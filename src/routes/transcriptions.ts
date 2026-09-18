import { Hono } from "hono";
import { ElevenLabsClient } from "../elevenlabsClient";
import { serializeDetail } from "../serialization";
import { buildSubmission, SubmissionError, type SubmissionPayload } from "../transcription";
import { normalizeSubscription, normalizeUsageHistory } from "../usage";
import { httpError, requireApiKey, services, translateError, type AppContext } from "./deps";

export const transcriptionRoutes = new Hono<AppContext>();

interface UploadRef {
  key: string;
  filename: string;
  content_type?: string;
  size: number;
}

/**
 * The audio never arrives here. The browser uploads it to R2 in parts first and this request
 * only references the stored object, so job submission stays far below the 100 MB body limit.
 */
transcriptionRoutes.post("/api/transcriptions", async (c) => {
  const { keyStore, service } = services(c);
  await requireApiKey(keyStore, "starting a transcription");

  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) {
    throw httpError(400, "Could not read the submission.");
  }

  const text = (name: string): string | undefined => {
    const value = body[name];
    return typeof value === "string" ? value : undefined;
  };
  const list = (name: string): string[] => {
    const value = body[name];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  };

  const payload: SubmissionPayload = {
    source_mode: text("source_mode"),
    model_id: text("model_id"),
    language_code: text("language_code"),
    audio_type: text("audio_type"),
    timestamps_granularity: text("timestamps_granularity"),
    diarize: text("diarize"),
    tag_audio_events: text("tag_audio_events"),
    use_multi_channel: text("use_multi_channel"),
    no_verbatim: text("no_verbatim"),
    zero_retention: text("zero_retention"),
    num_speakers: text("num_speakers"),
    diarization_threshold: text("diarization_threshold"),
    keyterms: text("keyterms"),
    entity_detection: list("entity_detection"),
    entity_detection_custom: text("entity_detection_custom"),
  };

  const sourceMode = payload.source_mode === "url" ? "url" : "upload";
  const rawUrlField = text("cloud_storage_url") ?? "";
  const uploads = (Array.isArray(body.uploads) ? body.uploads : []).filter(
    (item): item is UploadRef =>
      Boolean(item) && typeof item === "object" && typeof (item as UploadRef).key === "string"
  );
  const urls = rawUrlField
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  // In upload mode the URL field is still passed through so "not both" validation can fire.
  const items: { upload?: UploadRef; url?: string }[] =
    sourceMode === "upload"
      ? uploads.map((upload) => ({ upload, url: rawUrlField.trim() || undefined }))
      : urls.map((url) => ({ url }));

  if (items.length === 0) {
    throw httpError(
      400,
      sourceMode === "upload" ? "Choose a local file to upload." : "Enter an HTTPS URL to transcribe."
    );
  }

  const batchId = items.length > 1 ? crypto.randomUUID() : undefined;
  const origin = new URL(c.req.url).origin;
  const details: Record<string, unknown>[] = [];

  for (const [index, item] of items.entries()) {
    let submission;
    try {
      submission = buildSubmission(
        { ...payload, source_mode: sourceMode, cloud_storage_url: item.url },
        {
          fileName: item.upload?.filename ?? null,
          fileBytes: item.upload?.size ?? null,
          fileContentType: item.upload?.content_type ?? null,
        }
      );
    } catch (error) {
      if (error instanceof SubmissionError) {
        throw httpError(400, error.message);
      }
      throw translateError(error);
    }

    const record = await service.queueSubmission(
      submission,
      item.upload ? { key: item.upload.key, size: item.upload.size } : null,
      origin,
      {
        batchId,
        batchIndex: batchId ? index + 1 : undefined,
        batchCount: batchId ? items.length : undefined,
      }
    );
    details.push(serializeDetail(record, {}, service.metadataFor(record)));
  }

  if (batchId) {
    return c.json(
      {
        batch_submitted: true,
        batch_id: batchId,
        count: details.length,
        status: "queued",
        status_detail: `Queued ${details.length} transcription jobs. They will start in parallel and appear in History as separate jobs.`,
        jobs: details,
      },
      202
    );
  }

  return c.json(details[0], 202);
});

transcriptionRoutes.get("/api/usage", async (c) => {
  const { keyStore } = services(c);
  const apiKey = await requireApiKey(keyStore, "loading usage");
  const client = new ElevenLabsClient(c.env.ELEVENLABS_API_URL);

  try {
    const now = new Date();
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - 6);

    const [subscription, history] = await Promise.all([
      client.getSubscription(apiKey),
      client.getUsageStats(apiKey, {
        startUnix: start.getTime(),
        endUnix: now.getTime(),
        aggregationInterval: "day",
        metric: "credits",
        breakdownType: "none",
      }),
    ]);

    return c.json({
      subscription: normalizeSubscription(subscription),
      history: normalizeUsageHistory(history),
      fetched_at: new Date().toISOString(),
    });
  } catch (error) {
    throw translateError(error);
  }
});
