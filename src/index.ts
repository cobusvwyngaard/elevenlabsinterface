import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { JobRepository } from "./db";
import { JobService } from "./jobs";
import { KeyStore } from "./keyStore";
import { downloadRoutes } from "./routes/downloads";
import { jobRoutes } from "./routes/jobs";
import { settingsRoutes } from "./routes/settings";
import { transcriptionRoutes } from "./routes/transcriptions";
import type { AppContext } from "./routes/deps";
import type { Env, JobMessage } from "./types";

const app = new Hono<AppContext>();

app.get("/healthz", (c) => c.json({ status: "ok" }));

app.route("/", settingsRoutes);
app.route("/", transcriptionRoutes);
app.route("/", jobRoutes);
app.route("/", downloadRoutes);

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
      if (!apiKey) {
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
      } catch (error) {
        console.error(`Job ${jobId} crashed`, error);
      }
      // Always ack: runJob records its own failure, and a retry would re-spend credits.
      message.ack();
    }
  },
} satisfies ExportedHandler<Env, JobMessage>;
