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
 * curl of 150 MB to the same endpoint from elsewhere succeeds, so the limit is on this side. This
 * drives the real client code with a deliberately invalid key: the upload is exercised in full,
 * the upstream answers 400 for the key without transcribing anything, and no credits are spent.
 *
 * Delete once the threshold is known.
 */
diagnosticRoutes.post("/api/diagnostics/streamtest", async (c) => {
  type Probe = { bytes?: number; source?: string; key?: string };
  const body = await c.req.json<Probe>().catch(() => ({}) as Probe);
  const size = Math.min(Math.max(Number(body.bytes) || 8 * 1024 * 1024, 1024), 400 * 1024 * 1024);

  let stream: ReadableStream;
  let actual = size;
  let label: string;

  if (body.source === "r2" && body.key) {
    const object = await c.env.TRANSCRIPTS.get(body.key);
    if (!object) {
      return c.json({ error: "No such object." }, 404);
    }
    stream = object.body;
    actual = object.size;
    label = `r2:${body.key}`;
  } else {
    // A fixed-length stream of zeros, filled by the runtime rather than by JavaScript, so the
    // test measures the transfer and not the cost of generating the bytes.
    const fixed = new FixedLengthStream(size);
    const chunk = new Uint8Array(1024 * 1024);
    void (async () => {
      const writer = fixed.writable.getWriter();
      for (let sent = 0; sent < size; sent += chunk.byteLength) {
        await writer.write(chunk.subarray(0, Math.min(chunk.byteLength, size - sent)));
      }
      await writer.close();
    })();
    stream = fixed.readable;
    label = "synthetic";
  }

  const client = new ElevenLabsClient(c.env.ELEVENLABS_API_URL);
  const startedAt = Date.now();
  let status: number | null = null;
  let outcome: string;

  try {
    await client.transcribe("x".repeat(51), [["model_id", "scribe_v1"]], {
      enableLogging: false,
      file: { name: "probe.m4a", type: "audio/mp4", size: actual, body: stream },
      onResponseHeaders: (value) => {
        status = value;
      },
    });
    outcome = "accepted";
  } catch (error) {
    outcome = error instanceof Error ? error.message : String(error);
  }

  const result = {
    source: label,
    bytes: actual,
    upstream_status: status,
    outcome,
    elapsed_ms: Date.now() - startedAt,
  };
  await recordEvent(c.env.DB, null, "info", "diagnostics.streamtest", result);
  return c.json(result);
});
