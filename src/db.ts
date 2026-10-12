import type { JobRecord, KeytermPreset } from "./types";

interface JobRow {
  /** Declared so the spread in deserializeRow carries it with a type, not by accident. */
  account_id: string | null;
  job_id: string;
  transcription_id: string | null;
  created_at: string;
  source_type: string;
  source_label: string;
  model: string;
  language: string | null;
  audio_type: string;
  status: string;
  status_detail: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  effective_settings: string;
  transcript_preview: string | null;
  detected_language: string | null;
  response_json_path: string | null;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function deserializeRow(row: JobRow): JobRecord {
  return {
    ...row,
    effective_settings: parseJson(row.effective_settings, {}),
  };
}

export class JobRepository {
  /**
   * Scoped to one account, or to none.
   *
   * Every job query filters on `accountId` and every preference key is namespaced by it, so one
   * person cannot see or alter another's work. The filter lives here rather than at each call site
   * on purpose: a scope that has to be remembered is a scope that gets forgotten, and forgetting
   * it once would quietly show someone else's transcripts.
   *
   * `null` means unscoped, which only the queue consumer and the admin routes may use: the
   * consumer works from a job id and has no session to scope by.
   */
  constructor(
    private readonly db: D1Database,
    private readonly accountId: string | null = null
  ) {}

  /** Namespaces a preference key, so defaults and presets are per person. */
  private metaKey(key: string): string {
    return this.accountId ? `acct:${this.accountId}:${key}` : key;
  }

  async saveJob(record: JobRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO jobs (
          job_id, transcription_id, created_at, source_type, source_label, model, language,
          audio_type, status, status_detail, error_message, started_at, completed_at,
          effective_settings, transcript_preview, detected_language, response_json_path,
          account_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        record.job_id,
        record.transcription_id,
        record.created_at,
        record.source_type,
        record.source_label,
        record.model,
        record.language,
        record.audio_type,
        record.status,
        record.status_detail,
        record.error_message,
        record.started_at,
        record.completed_at,
        JSON.stringify(record.effective_settings ?? {}),
        record.transcript_preview,
        record.detected_language,
        record.response_json_path,
        // Preserved on update: an unscoped save from the consumer must not orphan the row.
        record.account_id ?? this.accountId ?? null
      )
      .run();
  }

  async listJobs(): Promise<JobRecord[]> {
    const result = this.accountId
      ? await this.db
          .prepare(
            `SELECT * FROM jobs WHERE account_id = ?
             ORDER BY datetime(created_at) DESC, rowid DESC`
          )
          .bind(this.accountId)
          .all<JobRow>()
      : await this.db
          .prepare(`SELECT * FROM jobs ORDER BY datetime(created_at) DESC, rowid DESC`)
          .all<JobRow>();
    return (result.results ?? []).map(deserializeRow);
  }

  /** Returns null for a job belonging to somebody else, which reads the same as not existing. */
  async getJob(jobId: string): Promise<JobRecord | null> {
    const row = this.accountId
      ? await this.db
          .prepare(`SELECT * FROM jobs WHERE job_id = ? AND account_id = ?`)
          .bind(jobId, this.accountId)
          .first<JobRow>()
      : await this.db.prepare(`SELECT * FROM jobs WHERE job_id = ?`).bind(jobId).first<JobRow>();
    return row ? deserializeRow(row) : null;
  }

  async deleteJob(jobId: string): Promise<void> {
    if (this.accountId) {
      await this.db
        .prepare(`DELETE FROM jobs WHERE job_id = ? AND account_id = ?`)
        .bind(jobId, this.accountId)
        .run();
      return;
    }
    await this.db.prepare(`DELETE FROM jobs WHERE job_id = ?`).bind(jobId).run();
  }

  async getMetaJson<T>(key: string, fallback: T): Promise<T> {
    const row = await this.db
      .prepare(`SELECT value FROM app_meta WHERE key = ?`)
      .bind(this.metaKey(key))
      .first<{ value: string }>();
    return row ? parseJson<T>(row.value, fallback) : fallback;
  }

  async setMetaJson(key: string, value: unknown): Promise<void> {
    await this.db
      .prepare(`INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)`)
      .bind(this.metaKey(key), JSON.stringify(value))
      .run();
  }

  async deleteMeta(key: string): Promise<void> {
    await this.db.prepare(`DELETE FROM app_meta WHERE key = ?`).bind(this.metaKey(key)).run();
  }

  getLastUsedDefaults(): Promise<Record<string, unknown>> {
    return this.getMetaJson<Record<string, unknown>>("last_used_defaults", {});
  }

  setLastUsedDefaults(defaults: Record<string, unknown>): Promise<void> {
    return this.setMetaJson("last_used_defaults", defaults);
  }

  getKeytermPresets(): Promise<KeytermPreset[]> {
    return this.getMetaJson<KeytermPreset[]>("keyterm_presets", []);
  }

  setKeytermPresets(presets: KeytermPreset[]): Promise<void> {
    return this.setMetaJson("keyterm_presets", presets);
  }
}
