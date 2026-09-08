import { TERMINAL_JOB_STATUSES } from "./constants";
import type { JobRecord } from "./types";

const PROMOTED_KEYS = [
  "batch_id",
  "batch_index",
  "batch_count",
  "hidden_at",
  "hidden_reason",
  "hidden_message",
  "hidden_by_job_id",
  "remote_deleted_at",
  "remote_delete_status",
  "remote_presence_status",
  "remote_presence_message",
  "remote_presence_checked_at",
  "last_known_transcription_id",
] as const;

export function isTerminal(record: JobRecord): boolean {
  return TERMINAL_JOB_STATUSES.has(record.status);
}

export function isHidden(record: JobRecord): boolean {
  return Boolean(record.effective_settings?.hidden_at);
}

function promoted(record: JobRecord): Record<string, unknown> {
  const settings = record.effective_settings ?? {};
  const result: Record<string, unknown> = {};
  for (const key of PROMOTED_KEYS) {
    result[key] = settings[key] ?? null;
  }
  return result;
}

export function serializeSummary(record: JobRecord): Record<string, unknown> {
  return {
    job_id: record.job_id,
    transcription_id: record.transcription_id,
    created_at: record.created_at,
    source_type: record.source_type,
    source_label: record.source_label,
    model: record.model,
    audio_type: record.audio_type,
    status: record.status,
    status_detail: record.status_detail,
    started_at: record.started_at,
    completed_at: record.completed_at,
    is_terminal: isTerminal(record),
    error_message: record.error_message,
    transcript_preview: record.transcript_preview,
    detected_language: record.detected_language,
    is_hidden: isHidden(record),
    ...promoted(record),
  };
}

/**
 * Detail carries a pointer to the stored transcript rather than anything derived from it.
 * The browser fetches that once per job and produces the transcript text, timeline, speaker
 * profiles and every export locally — none of which the Worker could afford to compute.
 */
export function serializeDetail(
  record: JobRecord,
  speakerNames: Record<string, string>,
  exportMetadata: Record<string, unknown>
): Record<string, unknown> {
  const available = record.status === "success" && Boolean(record.response_json_path);

  return {
    ...serializeSummary(record),
    language: record.language,
    effective_settings: record.effective_settings,
    speaker_name_map: speakerNames,
    export_metadata: exportMetadata,
    transcript_url: available ? `/downloads/${record.job_id}/json` : null,
    outputs: available
      ? [{ format: "json", label: "Raw JSON", download_url: `/downloads/${record.job_id}/json` }]
      : [],
  };
}
