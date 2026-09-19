-- Append-only diagnostic trail.
--
-- Written as each step happens rather than with the job record, so that if a consumer is
-- killed outright (CPU limit, memory, an eviction) the trail still ends at the last step that
-- completed. A job record alone cannot show that: it is only saved at checkpoints, so a hard
-- kill leaves it stuck on whatever it said last, with no indication of where it stopped.

CREATE TABLE IF NOT EXISTS job_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT,
    at TEXT NOT NULL,
    level TEXT NOT NULL,
    event TEXT NOT NULL,
    detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_events_id ON job_events (id DESC);
CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events (job_id, id);
