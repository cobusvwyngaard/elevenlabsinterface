import { TERMINAL_JOB_STATUSES } from "./constants";
import {
  buildSpeakerProfiles,
  buildTimelineEntries,
  extractAudioEvents,
  extractEntities,
  formatTranscriptText,
} from "./transcriptUtils";
import type { ExportAsset, JobRecord, TranscriptResponse } from "./types";

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

function downloadUrl(jobId: string, format: string): string {
  return `/downloads/${jobId}/${format}`;
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
    outputs: (record.output_files ?? [])
      .filter((asset) => !asset.format.startsWith("named_"))
      .map((asset) => ({
        format: asset.format,
        label: asset.label,
        download_url: downloadUrl(record.job_id, asset.format),
      })),
  };
}

function serializeAssets(jobId: string, assets: ExportAsset[]) {
  return assets.map((asset) => ({
    format: asset.format,
    label: asset.label,
    filename: asset.filename,
    content_type: asset.content_type,
    size: asset.size,
    download_url: downloadUrl(jobId, asset.format),
  }));
}

export function serializeDetail(
  record: JobRecord,
  response: TranscriptResponse | null,
  speakerNames: Record<string, string> = {}
): Record<string, unknown> {
  const allAssets = record.output_files ?? [];
  const outputs = allAssets.filter((asset) => !asset.format.startsWith("named_"));
  const namedOutputs = allAssets.filter((asset) => asset.format.startsWith("named_"));
  const hasNames = Object.keys(speakerNames).length > 0;

  return {
    ...serializeSummary(record),
    language: record.language,
    effective_settings: record.effective_settings,
    transcript_text: response ? formatTranscriptText(response) : null,
    speaker_name_map: speakerNames,
    named_transcript_text: response && hasNames ? formatTranscriptText(response, speakerNames) : null,
    outputs: serializeAssets(record.job_id, outputs),
    named_outputs: serializeAssets(record.job_id, namedOutputs),
    timeline_entries: response ? buildTimelineEntries(response, 200, hasNames ? speakerNames : null) : [],
    speaker_profiles: response ? buildSpeakerProfiles(response, speakerNames) : [],
    audio_events: response ? extractAudioEvents(response) : [],
    entities: response ? extractEntities(response) : [],
    response,
  };
}
