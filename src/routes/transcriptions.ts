import { Hono } from "hono";
import { ElevenLabsClient } from "../elevenlabsClient";
import { serializeDetail } from "../serialization";
import { buildSubmission, SubmissionError, type SubmissionPayload } from "../transcription";
import { normalizeSubscription, normalizeUsageHistory } from "../usage";
import { httpError, requireApiKey, services, translateError, type AppContext } from "./deps";

export const transcriptionRoutes = new Hono<AppContext>();

function stringField(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
}

function stringList(form: FormData, name: string): string[] {
  return form.getAll(name).filter((value): value is string => typeof value === "string");
}

transcriptionRoutes.post("/api/transcriptions", async (c) => {
  const { keyStore, service } = services(c);
  await requireApiKey(keyStore, "starting a transcription");

  const form = await c.req.formData();
  const payload: SubmissionPayload = {
    source_mode: stringField(form, "source_mode"),
    model_id: stringField(form, "model_id"),
    language_code: stringField(form, "language_code"),
    audio_type: stringField(form, "audio_type"),
    timestamps_granularity: stringField(form, "timestamps_granularity"),
    output_formats: stringList(form, "output_formats"),
    diarize: stringField(form, "diarize"),
    tag_audio_events: stringField(form, "tag_audio_events"),
    use_multi_channel: stringField(form, "use_multi_channel"),
    no_verbatim: stringField(form, "no_verbatim"),
    zero_retention: stringField(form, "zero_retention"),
    num_speakers: stringField(form, "num_speakers"),
    diarization_threshold: stringField(form, "diarization_threshold"),
    keyterms: stringField(form, "keyterms"),
    entity_detection: stringList(form, "entity_detection"),
    entity_detection_custom: stringField(form, "entity_detection_custom"),
  };

  const sourceMode = payload.source_mode === "url" ? "url" : "upload";
  const rawUrlField = stringField(form, "cloud_storage_url") ?? "";
  const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
  const urls = rawUrlField
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  // In upload mode the URL field is still passed through so "not both" validation can fire.
  const items: { file?: File; url?: string }[] =
    sourceMode === "upload"
      ? files.map((file) => ({ file, url: rawUrlField.trim() || undefined }))
      : urls.map((url) => ({ url }));

  if (items.length === 0) {
    throw httpError(
      400,
      sourceMode === "upload" ? "Choose a local file to upload." : "Enter an HTTPS URL to transcribe."
    );
  }

  const batchId = items.length > 1 ? crypto.randomUUID() : undefined;
  const details: Record<string, unknown>[] = [];

  for (const [index, item] of items.entries()) {
    let submission;
    try {
      submission = buildSubmission(
        { ...payload, source_mode: sourceMode, cloud_storage_url: item.url },
        {
          fileName: item.file?.name ?? null,
          fileBytes: item.file?.size ?? null,
          fileContentType: item.file?.type ?? null,
        }
      );
    } catch (error) {
      if (error instanceof SubmissionError) {
        throw httpError(400, error.message);
      }
      throw translateError(error);
    }

    const body = item.file ? await item.file.arrayBuffer() : null;
    const record = await service.queueSubmission(submission, body, {
      batchId,
      batchIndex: batchId ? index + 1 : undefined,
      batchCount: batchId ? items.length : undefined,
    });
    details.push(serializeDetail(record, null, {}));
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
