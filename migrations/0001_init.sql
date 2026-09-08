-- Job history and app metadata.
-- Ports REBUILD_SPEC.md §7. Unlike the Windows build, response_json_path and
-- output_files[].path hold R2 keys relative to the job (e.g. "<job_id>/transcript.json"),
-- which is the §19 defect fix: nothing stores an absolute machine path.

CREATE TABLE IF NOT EXISTS jobs (
    job_id TEXT PRIMARY KEY,
    transcription_id TEXT,
    created_at TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_label TEXT NOT NULL,
    model TEXT NOT NULL,
    language TEXT,
    audio_type TEXT NOT NULL,
    status TEXT NOT NULL,
    status_detail TEXT,
    error_message TEXT,
    started_at TEXT,
    completed_at TEXT,
    effective_settings TEXT NOT NULL,
    transcript_preview TEXT,
    detected_language TEXT,
    response_json_path TEXT,
    output_files TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (created_at DESC);

CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
