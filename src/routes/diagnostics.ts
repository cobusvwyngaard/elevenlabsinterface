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
  const { repository } = await services(c);
  const jobId = c.req.query("job");
  const limit = Math.min(Number(c.req.query("limit") ?? 100) || 100, 500);

  // Scoped through the caller's own jobs. The events table has no account of its own, so
  // restricting it any other way would hand one person another's trail.
  const records = await repository.listJobs();
  const ownedIds = new Set(records.map((record) => record.job_id));

  if (jobId && !ownedIds.has(jobId)) {
    return c.json({ now: new Date().toISOString(), jobs: [], events: [] });
  }

  const wanted = jobId ? [jobId] : records.slice(0, 15).map((record) => record.job_id);
  const events = wanted.length
    ? await c.env.DB.prepare(
        `SELECT * FROM job_events WHERE job_id IN (${wanted.map(() => "?").join(",")})
         ORDER BY id ${jobId ? "ASC" : "DESC"} LIMIT ?`
      )
        .bind(...wanted, limit)
        .all<EventRow>()
    : { results: [] as EventRow[] };

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
