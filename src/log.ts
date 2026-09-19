/**
 * Records what a job did, step by step, somewhere that outlives the request.
 *
 * Two sinks, because they fail differently. `console` goes to Cloudflare's Workers Logs, which
 * captures uncaught exceptions and survives a hard kill but can only be read from the
 * dashboard. D1 rows can be read back through `/api/diagnostics`, but only if the write itself
 * got to run. Together they cover both "it threw" and "it vanished".
 */

export type LogLevel = "info" | "warn" | "error";

const MAX_DETAIL = 2000;

function describe(detail: unknown): string | null {
  if (detail === undefined || detail === null) {
    return null;
  }
  if (detail instanceof Error) {
    return JSON.stringify({
      name: detail.name,
      message: detail.message,
      stack: detail.stack?.slice(0, MAX_DETAIL),
    }).slice(0, MAX_DETAIL);
  }
  if (typeof detail === "string") {
    return detail.slice(0, MAX_DETAIL);
  }
  try {
    return JSON.stringify(detail).slice(0, MAX_DETAIL);
  } catch {
    return String(detail).slice(0, MAX_DETAIL);
  }
}

export async function recordEvent(
  db: D1Database,
  jobId: string | null,
  level: LogLevel,
  event: string,
  detail?: unknown
): Promise<void> {
  const described = describe(detail);

  // Structured so a Workers Logs search on a job id pulls the whole run together.
  const line = `[job] ${event} job=${jobId ?? "-"}${described ? ` detail=${described}` : ""}`;
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }

  try {
    await db
      .prepare(`INSERT INTO job_events (job_id, at, level, event, detail) VALUES (?, ?, ?, ?, ?)`)
      .bind(jobId, new Date().toISOString(), level, event, described)
      .run();
  } catch (error) {
    // Logging must never be the reason a job fails.
    console.error(`[job] event-write-failed job=${jobId ?? "-"} detail=${String(error)}`);
  }
}
