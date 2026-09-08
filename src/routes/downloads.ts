import { Hono } from "hono";
import { httpError, requireJob, services, type AppContext } from "./deps";

export const downloadRoutes = new Hono<AppContext>();

/**
 * Only the stored ElevenLabs response is served. Every other format is generated in the
 * browser, so the Worker never renders a transcript.
 */
downloadRoutes.get("/downloads/:job_id/json", async (c) => {
  const { repository } = services(c);
  const record = await requireJob(repository, c.req.param("job_id"));

  if (!record.response_json_path) {
    throw httpError(404, "Requested export is not available for this job.");
  }

  const object = await c.env.TRANSCRIPTS.get(record.response_json_path);
  if (!object) {
    throw httpError(404, "Requested export is not available for this job.");
  }

  return new Response(object.body, {
    headers: {
      "content-type": "application/json",
      "content-length": String(object.size),
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
});
