export interface Option {
  value: string;
  label: string;
}

export const AUDIO_TYPES: Option[] = [
  { value: "lecture", label: "Lecture" },
  { value: "meeting", label: "Meeting" },
  { value: "focus_group", label: "Focus group" },
  { value: "interview", label: "Interview" },
  { value: "podcast", label: "Podcast" },
  { value: "dictation", label: "Dictation" },
  { value: "custom", label: "Custom" },
];

export const MODELS: Option[] = [
  { value: "scribe_v2", label: "Scribe v2" },
  { value: "scribe_v1", label: "Scribe v1" },
];

export const TIMESTAMP_GRANULARITIES: Option[] = [
  { value: "none", label: "None" },
  { value: "word", label: "Word" },
  { value: "character", label: "Character" },
];

export const ENTITY_DETECTION_OPTIONS: Option[] = [
  { value: "all", label: "All" },
  { value: "pii", label: "PII" },
  { value: "phi", label: "PHI" },
  { value: "pci", label: "PCI" },
  { value: "other", label: "Other" },
  { value: "offensive_language", label: "Offensive language" },
];

export const LANGUAGES: Option[] = [
  { value: "", label: "Auto detect" },
  { value: "en", label: "English" },
  { value: "af", label: "Afrikaans" },
  { value: "ar", label: "Arabic" },
  { value: "de", label: "German" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "he", label: "Hebrew" },
  { value: "hi", label: "Hindi" },
  { value: "it", label: "Italian" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "nl", label: "Dutch" },
  { value: "pl", label: "Polish" },
  { value: "pt", label: "Portuguese" },
  { value: "ru", label: "Russian" },
  { value: "sv", label: "Swedish" },
  { value: "tr", label: "Turkish" },
  { value: "uk", label: "Ukrainian" },
  { value: "vi", label: "Vietnamese" },
  { value: "zh", label: "Chinese" },
];

function labelMap(options: Option[]): Record<string, string> {
  return Object.fromEntries(options.map((option) => [option.value, option.label]));
}

export const AUDIO_TYPE_LABELS = labelMap(AUDIO_TYPES);
export const MODEL_LABELS = labelMap(MODELS);
export const ENTITY_DETECTION_LABELS = labelMap(ENTITY_DETECTION_OPTIONS);

export const VALID_MODELS = new Set(MODELS.map((option) => option.value));
export const VALID_TIMESTAMPS = new Set(TIMESTAMP_GRANULARITIES.map((option) => option.value));
export const VALID_ENTITY_DETECTION = new Set(ENTITY_DETECTION_OPTIONS.map((option) => option.value));

export const TERMINAL_JOB_STATUSES = new Set(["success", "error", "cancelled"]);

export const INTERRUPTED_JOB_MESSAGE =
  "This job was interrupted before it finished and cannot be resumed. Start it again if you still need the transcript.";
export const CANCELLED_JOB_MESSAGE =
  "Cancelled locally. ElevenLabs may still finish processing and charge credits for work already started.";

export const TRANSCRIPT_PREVIEW_LIMIT = 800;
