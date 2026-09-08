import type { JobRecord, KeytermPreset } from "./types";

interface JobRow {
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
  constructor(private readonly db: D1Database) {}

  async saveJob(record: JobRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO jobs (
          job_id, transcription_id, created_at, source_type, source_label, model, language,
          audio_type, status, status_detail, error_message, started_at, completed_at,
          effective_settings, transcript_preview, detected_language, response_json_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        record.response_json_path
      )
      .run();
  }

  async listJobs(): Promise<JobRecord[]> {
    const result = await this.db
      .prepare(`SELECT * FROM jobs ORDER BY datetime(created_at) DESC, rowid DESC`)
      .all<JobRow>();
    return (result.results ?? []).map(deserializeRow);
  }

  async getJob(jobId: string): Promise<JobRecord | null> {
    const row = await this.db.prepare(`SELECT * FROM jobs WHERE job_id = ?`).bind(jobId).first<JobRow>();
    return row ? deserializeRow(row) : null;
  }

  async deleteJob(jobId: string): Promise<void> {
    await this.db.prepare(`DELETE FROM jobs WHERE job_id = ?`).bind(jobId).run();
  }

  async getMetaJson<T>(key: string, fallback: T): Promise<T> {
    const row = await this.db
      .prepare(`SELECT value FROM app_meta WHERE key = ?`)
      .bind(key)
      .first<{ value: string }>();
    return row ? parseJson<T>(row.value, fallback) : fallback;
  }

  async setMetaJson(key: string, value: unknown): Promise<void> {
    await this.db
      .prepare(`INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)`)
      .bind(key, JSON.stringify(value))
      .run();
  }

  async deleteMeta(key: string): Promise<void> {
    await this.db.prepare(`DELETE FROM app_meta WHERE key = ?`).bind(key).run();
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
