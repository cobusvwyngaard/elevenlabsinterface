import { VALID_ENTITY_DETECTION, VALID_MODELS, VALID_TIMESTAMPS } from "./constants";
import { AUDIO_TYPE_PRESETS, presetFor } from "./presets";
import type { EffectiveSettings, TranscriptionSubmission } from "./types";

export class SubmissionError extends Error {}

export interface SubmissionPayload {
  source_mode?: string;
  cloud_storage_url?: string;
  model_id?: string;
  language_code?: string;
  audio_type?: string;
  timestamps_granularity?: string;
  diarize?: string;
  tag_audio_events?: string;
  use_multi_channel?: string;
  no_verbatim?: string;
  zero_retention?: string;
  num_speakers?: string;
  diarization_threshold?: string;
  keyterms?: string;
  entity_detection?: string[];
  entity_detection_custom?: string;
}

export interface SubmissionFile {
  fileName: string | null;
  fileBytes: number | null;
  fileContentType: string | null;
}

const CHECKBOX_TRUE = new Set(["1", "true", "on", "yes"]);

function parseCheckbox(value: string | undefined): boolean | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return CHECKBOX_TRUE.has(value.trim().toLowerCase());
}

function parseTerms(value: string | undefined): string[] {
  return String(value ?? "")
    .replaceAll("\r", "\n")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildSubmission(payload: SubmissionPayload, file: SubmissionFile): TranscriptionSubmission {
  const sourceMode = (payload.source_mode || "upload").trim();
  if (sourceMode !== "upload" && sourceMode !== "url") {
    throw new SubmissionError("Choose either a local file upload or an HTTPS URL.");
  }

  const modelId = (payload.model_id || "scribe_v2").trim();
  if (!VALID_MODELS.has(modelId)) {
    throw new SubmissionError("Choose a supported transcription model.");
  }

  const audioType = (payload.audio_type || "meeting").trim();
  if (!(audioType in AUDIO_TYPE_PRESETS)) {
    throw new SubmissionError("Choose a supported audio type.");
  }

  const cloudStorageUrl = (payload.cloud_storage_url || "").trim();
  const hasFile = Boolean(file.fileBytes && file.fileName);

  if (sourceMode === "upload") {
    if (!hasFile) {
      throw new SubmissionError("Choose a local file to upload.");
    }
    if (cloudStorageUrl) {
      throw new SubmissionError("Choose either a local file or an HTTPS URL, not both.");
    }
  } else {
    if (!cloudStorageUrl) {
      throw new SubmissionError("Enter an HTTPS URL to transcribe.");
    }
    if (hasFile) {
      throw new SubmissionError("Choose either a local file or an HTTPS URL, not both.");
    }
    let parsed: URL;
    try {
      parsed = new URL(cloudStorageUrl);
    } catch {
      throw new SubmissionError("Cloud storage URL must be a valid HTTPS URL.");
    }
    if (parsed.protocol !== "https:" || !parsed.host) {
      throw new SubmissionError("Cloud storage URL must be a valid HTTPS URL.");
    }
  }

  const preset = presetFor(audioType);

  const diarizeInput = parseCheckbox(payload.diarize);
  const tagAudioEventsInput = parseCheckbox(payload.tag_audio_events);
  const noVerbatimInput = parseCheckbox(payload.no_verbatim);
  const useMultiChannel = parseCheckbox(payload.use_multi_channel) ?? false;
  const zeroRetention = parseCheckbox(payload.zero_retention) ?? false;

  let diarize = diarizeInput ?? preset.diarize ?? false;
  let tagAudioEvents = tagAudioEventsInput ?? preset.tag_audio_events ?? false;
  let noVerbatim = noVerbatimInput ?? preset.no_verbatim ?? false;

  const timestamps = (payload.timestamps_granularity || preset.timestamps_granularity || "word").trim();
  if (!VALID_TIMESTAMPS.has(timestamps)) {
    throw new SubmissionError("Choose a supported timestamp granularity.");
  }

  const rawSpeakers = (payload.num_speakers || "").trim();
  let numSpeakers: number | null = rawSpeakers ? Number(rawSpeakers) : (preset.num_speakers ?? null);
  if (numSpeakers !== null) {
    if (!Number.isInteger(numSpeakers) || numSpeakers < 1 || numSpeakers > 32) {
      throw new SubmissionError("Speaker count must be a whole number between 1 and 32.");
    }
  }

  const rawThreshold = (payload.diarization_threshold || "").trim();
  let diarizationThreshold: number | null = rawThreshold ? Number(rawThreshold) : null;
  if (diarizationThreshold !== null) {
    if (!Number.isFinite(diarizationThreshold) || diarizationThreshold < 0 || diarizationThreshold > 1) {
      throw new SubmissionError("Diarization threshold must be between 0 and 1.");
    }
    if (!diarize) {
      throw new SubmissionError("Turn on diarization before setting a diarization threshold.");
    }
    if (rawSpeakers) {
      throw new SubmissionError("Leave the speaker count blank when using a diarization threshold.");
    }
  }

  if (useMultiChannel) {
    diarize = false;
    numSpeakers = null;
    diarizationThreshold = null;
  }

  const isV2 = modelId === "scribe_v2";

  let keyterms = parseTerms(payload.keyterms);
  const seen = new Set<string>();
  keyterms = keyterms.filter((term) => {
    const key = term.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  if (keyterms.length > 100) {
    throw new SubmissionError("Keyterms are limited to 100 entries.");
  }

  let entityDetection = [
    ...(payload.entity_detection ?? []),
    ...parseTerms(payload.entity_detection_custom),
  ]
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  entityDetection = [...new Set(entityDetection)];
  if (entityDetection.includes("all")) {
    entityDetection = ["all"];
  } else {
    for (const value of entityDetection) {
      if (!VALID_ENTITY_DETECTION.has(value) && !/^[a-z0-9_]+$/.test(value)) {
        throw new SubmissionError(`Unsupported entity type: ${value}`);
      }
    }
  }

  if (!isV2) {
    // Only an explicit request is an error; a preset-supplied default is just dropped,
    // otherwise scribe_v1 could never run with a preset that turns no_verbatim on.
    if (noVerbatimInput === true) {
      throw new SubmissionError("Reduced verbatim filler is only available on Scribe v2.");
    }
    if (keyterms.length > 0) {
      throw new SubmissionError("Keyterms are only available on Scribe v2.");
    }
    if (entityDetection.length > 0) {
      throw new SubmissionError("Entity detection is only available on Scribe v2.");
    }
    noVerbatim = false;
    keyterms = [];
    entityDetection = [];
  }

  const languageCode = (payload.language_code || "").trim() || null;
  const sourceLabel = sourceMode === "upload" ? (file.fileName ?? "Uploaded file") : cloudStorageUrl;

  return {
    source_mode: sourceMode,
    model_id: modelId,
    language_code: languageCode,
    audio_type: audioType,
    diarize,
    num_speakers: numSpeakers,
    diarization_threshold: diarizationThreshold,
    tag_audio_events: tagAudioEvents,
    timestamps_granularity: timestamps,
    use_multi_channel: useMultiChannel,
    no_verbatim: noVerbatim,
    keyterms,
    entity_detection: entityDetection,
    enable_logging: !zeroRetention,
    source_label: sourceLabel,
    cloud_storage_url: sourceMode === "url" ? cloudStorageUrl : null,
    file_name: sourceMode === "upload" ? file.fileName : null,
    file_content_type: sourceMode === "upload" ? file.fileContentType : null,
  };
}

export function buildApiFields(submission: TranscriptionSubmission): [string, string][] {
  const fields: [string, string][] = [
    ["model_id", submission.model_id],
    ["diarize", String(submission.diarize)],
    ["tag_audio_events", String(submission.tag_audio_events)],
    ["timestamps_granularity", submission.timestamps_granularity],
    ["use_multi_channel", String(submission.use_multi_channel)],
  ];

  if (submission.language_code) {
    fields.push(["language_code", submission.language_code]);
  }
  if (submission.cloud_storage_url) {
    fields.push(["cloud_storage_url", submission.cloud_storage_url]);
  }
  if (submission.num_speakers !== null) {
    fields.push(["num_speakers", String(submission.num_speakers)]);
  }
  if (submission.diarization_threshold !== null) {
    fields.push(["diarization_threshold", String(submission.diarization_threshold)]);
  }

  if (submission.model_id === "scribe_v2") {
    fields.push(["no_verbatim", String(submission.no_verbatim)]);
    for (const term of submission.keyterms) {
      fields.push(["keyterms", term]);
    }
    for (const entity of submission.entity_detection) {
      fields.push(["entity_detection", entity]);
    }
  }

  return fields;
}

export function submissionDefaults(submission: TranscriptionSubmission): Record<string, unknown> {
  return {
    source_mode: submission.source_mode,
    model_id: submission.model_id,
    language_code: submission.language_code ?? "",
    audio_type: submission.audio_type,
    timestamps_granularity: submission.timestamps_granularity,
    diarize: submission.diarize,
    tag_audio_events: submission.tag_audio_events,
    use_multi_channel: submission.use_multi_channel,
    no_verbatim: submission.no_verbatim,
    zero_retention: !submission.enable_logging,
    num_speakers: submission.num_speakers,
    diarization_threshold: submission.diarization_threshold,
    keyterms: submission.keyterms.join("\n"),
    entity_detection: submission.entity_detection,
    entity_detection_custom: "",
    cloud_storage_url: submission.cloud_storage_url ?? "",
  };
}

export function effectiveSettings(submission: TranscriptionSubmission): EffectiveSettings {
  return {
    source_mode: submission.source_mode,
    model_id: submission.model_id,
    language_code: submission.language_code,
    audio_type: submission.audio_type,
    diarize: submission.diarize,
    num_speakers: submission.num_speakers,
    diarization_threshold: submission.diarization_threshold,
    tag_audio_events: submission.tag_audio_events,
    timestamps_granularity: submission.timestamps_granularity,
    use_multi_channel: submission.use_multi_channel,
    no_verbatim: submission.no_verbatim,
    keyterms: submission.keyterms,
    entity_detection: submission.entity_detection,
    enable_logging: submission.enable_logging,
    source_label: submission.source_label,
    cloud_storage_url: submission.cloud_storage_url,
  };
}
