import { Hono } from "hono";
import { services, type AppContext } from "./deps";

export const diagnosticRoutes = new Hono<AppContext>();

interface EventRow {
  id: number;
  job_id: string | null;
  at: string;
  level: string;
  event: string;
  detail: string | null;
}

/**
 * The event trail, readable over HTTP.
 *
 * Cloudflare's own Workers Logs capture more, including hard kills, but can only be read from
 * the dashboard. This endpoint exists so a failure can be diagnosed from the outside without
 * anyone having to go and copy logs out by hand.
 */
diagnosticRoutes.get("/api/diagnostics", async (c) => {
  const { repository } = services(c);
  const jobId = c.req.query("job");
  const limit = Math.min(Number(c.req.query("limit") ?? 100) || 100, 500);

  const events = jobId
    ? await c.env.DB.prepare(
        `SELECT * FROM job_events WHERE job_id = ? ORDER BY id ASC LIMIT ?`
      )
        .bind(jobId, limit)
        .all<EventRow>()
    : await c.env.DB.prepare(`SELECT * FROM job_events ORDER BY id DESC LIMIT ?`)
        .bind(limit)
        .all<EventRow>();

  const records = await repository.listJobs();
  const jobs = (jobId ? records.filter((record) => record.job_id === jobId) : records.slice(0, 15)).map(
    (record) => ({
      job_id: record.job_id,
      created_at: record.created_at,
      started_at: record.started_at,
      completed_at: record.completed_at,
      status: record.status,
      source_type: record.source_type,
      source_label: record.source_label,
      model: record.model,
      error_message: record.error_message,
      upload_bytes: record.effective_settings?.upload_bytes ?? null,
      stages: record.effective_settings?.stages ?? [],
    })
  );

  return c.json({
    now: new Date().toISOString(),
    jobs,
    events: (events.results ?? []).map((row) => ({
      ...row,
      detail: row.detail ? safeParse(row.detail) : null,
    })),
  });
});

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
