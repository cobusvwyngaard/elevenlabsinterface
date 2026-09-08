export interface Env {
  DB: D1Database;
  TRANSCRIPTS: R2Bucket;
  JOB_QUEUE: Queue<JobMessage>;
  ASSETS: Fetcher;
  ELEVENLABS_API_URL?: string;
}

export interface JobMessage {
  job_id: string;
  /** R2 key holding the uploaded audio, for upload-mode jobs. */
  upload_key?: string;
}

export interface TranscriptionSubmission {
  source_mode: "upload" | "url";
  model_id: string;
  language_code: string | null;
  audio_type: string;
  output_formats: string[];
  diarize: boolean;
  num_speakers: number | null;
  diarization_threshold: number | null;
  tag_audio_events: boolean;
  timestamps_granularity: string;
  use_multi_channel: boolean;
  no_verbatim: boolean;
  keyterms: string[];
  entity_detection: string[];
  enable_logging: boolean;
  source_label: string;
  cloud_storage_url: string | null;
  file_name: string | null;
  file_content_type: string | null;
}

export interface ExportAsset {
  format: string;
  filename: string;
  content_type: string;
  /** R2 key, relative to the bucket root: "<job_id>/<filename>". */
  path: string;
  label: string;
  size: number;
}

export interface EffectiveSettings {
  source_mode?: string;
  model_id?: string;
  language_code?: string | null;
  audio_type?: string;
  output_formats?: string[];
  diarize?: boolean;
  num_speakers?: number | null;
  diarization_threshold?: number | null;
  tag_audio_events?: boolean;
  timestamps_granularity?: string;
  use_multi_channel?: boolean;
  no_verbatim?: boolean;
  keyterms?: string[];
  entity_detection?: string[];
  enable_logging?: boolean;
  source_label?: string;

  batch_id?: string;
  batch_index?: number;
  batch_count?: number;
  hidden_at?: string | null;
  hidden_reason?: string | null;
  hidden_message?: string | null;
  hidden_by_job_id?: string | null;
  remote_deleted_at?: string | null;
  remote_delete_status?: string | null;
  remote_presence_status?: string | null;
  remote_presence_message?: string | null;
  remote_presence_checked_at?: string | null;
  last_known_transcription_id?: string | null;

  upload_key?: string;
  cloud_storage_url?: string | null;
  [key: string]: unknown;
}

export interface JobRecord {
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
  effective_settings: EffectiveSettings;
  transcript_preview: string | null;
  detected_language: string | null;
  response_json_path: string | null;
  output_files: ExportAsset[];
}

export interface KeytermPreset {
  name: string;
  terms: string[];
}

/** Raw ElevenLabs speech-to-text response. Shape varies by model and options. */
export interface TranscriptResponse {
  text?: string;
  language_code?: string;
  words?: TranscriptWord[];
  transcripts?: TranscriptChannel[];
  entities?: RawEntity[];
  [key: string]: unknown;
}

export interface TranscriptWord {
  text?: string;
  start?: number;
  end?: number;
  start_time?: number;
  end_time?: number;
  type?: string;
  speaker?: string | number;
  speaker_id?: string | number;
  speaker_label?: string | number;
  channel_index?: number;
  [key: string]: unknown;
}

export interface TranscriptChannel {
  text?: string;
  language_code?: string;
  channel_index?: number;
  speaker?: string;
  words?: TranscriptWord[];
  [key: string]: unknown;
}

export interface RawEntity {
  text?: string;
  entity_type?: string;
  type?: string;
  start?: number;
  end?: number;
  [key: string]: unknown;
}

export interface Cue {
  start: number;
  end: number;
  text: string;
  speaker: string | null;
  speaker_key: string | null;
}

export interface TimelineEntry {
  index: number;
  start: number;
  end: number;
  speaker: string | null;
  speaker_key: string | null;
  text: string;
}

export interface SpeakerProfile {
  speaker_key: string;
  speaker_label: string;
  assigned_name: string | null;
  quotes: { start: number; end: number; text: string }[];
}
