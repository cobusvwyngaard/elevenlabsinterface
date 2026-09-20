import { Hono } from "hono";
import { ElevenLabsClient } from "../elevenlabsClient";
import { recordEvent } from "../log";
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

/**
 * TEMPORARY. Measures how much of a request body this Worker can actually push upstream.
 *
 * The 138 MB job dies about 450ms into the transfer with "Network connection lost", and a plain
 * curl of 150 MB to the same endpoint from elsewhere succeeds, so the limit is on this side. The
 * source is an R2 object, because that is what the real job streams, and the key is a deliberately
 * invalid one: the transfer is exercised in full and the upstream rejects the key without
 * transcribing anything, so no credits are spent.
 *
 * Delete once the threshold is known.
 */
diagnosticRoutes.post("/api/diagnostics/streamtest", async (c) => {
  type Probe = { key?: string };
  const body = await c.req.json<Probe>().catch(() => ({}) as Probe);
  if (!body.key || !body.key.startsWith("uploads/")) {
    return c.json({ error: "Pass the key of an object under uploads/." }, 400);
  }

  const object = await c.env.TRANSCRIPTS.get(body.key);
  if (!object) {
    return c.json({ error: "No such object." }, 404);
  }

  const client = new ElevenLabsClient(c.env.ELEVENLABS_API_URL);
  const startedAt = Date.now();
  let status: number | null = null;
  let outcome: string;

  try {
    await client.transcribe("x".repeat(51), [["model_id", "scribe_v1"]], {
      enableLogging: false,
      file: {
        name: "probe.m4a",
        type: object.httpMetadata?.contentType ?? "audio/mp4",
        size: object.size,
        body: object.body,
      },
      onResponseHeaders: (value) => {
        status = value;
      },
    });
    outcome = "accepted";
  } catch (error) {
    outcome = error instanceof Error ? error.message : String(error);
  }

  const result = {
    key: body.key,
    bytes: object.size,
    upstream_status: status,
    outcome,
    elapsed_ms: Date.now() - startedAt,
  };
  await recordEvent(c.env.DB, null, "info", "diagnostics.streamtest", result);
  return c.json(result);
});
