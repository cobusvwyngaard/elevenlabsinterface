import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { JobRepository } from "./db";
import { JobService } from "./jobs";
import { KeyStore } from "./keyStore";
import { recordEvent } from "./log";
import { diagnosticRoutes } from "./routes/diagnostics";
import { downloadRoutes } from "./routes/downloads";
import { jobRoutes } from "./routes/jobs";
import { settingsRoutes } from "./routes/settings";
import { transcriptionRoutes } from "./routes/transcriptions";
import { uploadRoutes } from "./routes/uploads";
import type { AppContext } from "./routes/deps";
import type { Env, JobMessage } from "./types";

const app = new Hono<AppContext>();

app.get("/healthz", (c) => c.json({ status: "ok" }));

app.route("/", settingsRoutes);
app.route("/", uploadRoutes);
app.route("/", transcriptionRoutes);
app.route("/", jobRoutes);
app.route("/", downloadRoutes);
app.route("/", diagnosticRoutes);

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return error.getResponse();
  }
  console.error("Unhandled error", error);
  return c.json({ detail: error instanceof Error ? error.message : String(error) }, 500);
});

app.notFound((c) => c.json({ detail: "Not found." }, 404));

export default {
  fetch: app.fetch,

  async queue(batch: MessageBatch<JobMessage>, env: Env): Promise<void> {
    const repository = new JobRepository(env.DB);
    const keyStore = new KeyStore(repository);
    const service = new JobService(env, repository);
    const apiKey = await keyStore.getKey();

    for (const message of batch.messages) {
      const jobId = message.body.job_id;
      // Attempt number distinguishes a first run from a retry after a silent death.
      await recordEvent(env.DB, jobId, "info", "consumer.received", {
        attempt: message.attempts,
        has_api_key: Boolean(apiKey),
      });

      if (!apiKey) {
        await recordEvent(env.DB, jobId, "error", "consumer.no_api_key");
        const record = await repository.getJob(jobId);
        if (record) {
          record.status = "error";
          record.error_message = "Save an ElevenLabs API key before starting a transcription.";
          record.status_detail = "The transcription failed.";
          record.completed_at = new Date().toISOString();
          await repository.saveJob(record);
        }
        message.ack();
        continue;
      }

      try {
        await service.runJob(jobId, apiKey);
        await recordEvent(env.DB, jobId, "info", "consumer.finished");
      } catch (error) {
        // runJob records its own failures; reaching here means it threw past them.
        await recordEvent(env.DB, jobId, "error", "consumer.crashed", error);
      }
      // Always ack: runJob records its own failure, and a retry would re-spend credits.
      message.ack();
    }
  },
} satisfies ExportedHandler<Env, JobMessage>;
