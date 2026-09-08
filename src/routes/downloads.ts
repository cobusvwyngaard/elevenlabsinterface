import { Hono } from "hono";
import { httpError, requireJob, services, type AppContext } from "./deps";

export const downloadRoutes = new Hono<AppContext>();

downloadRoutes.get("/downloads/:job_id/:format", async (c) => {
  const { repository, service } = services(c);
  let record = await requireJob(repository, c.req.param("job_id"));
  record = await service.refreshSavedOutputs(record);

  const format = c.req.param("format");
  const asset = (record.output_files ?? []).find((item) => item.format === format);
  if (!asset) {
    throw httpError(404, "Requested export is not available for this job.");
  }

  const object = await c.env.TRANSCRIPTS.get(asset.path);
  if (!object) {
    throw httpError(404, "Requested export is not available for this job.");
  }

  return new Response(object.body, {
    headers: {
      "content-type": asset.content_type,
      "content-disposition": `attachment; filename="${asset.filename}"`,
      "content-length": String(object.size),
    },
  });
});
