import type {
  Cue,
  RawEntity,
  SpeakerProfile,
  TimelineEntry,
  TranscriptResponse,
  TranscriptWord,
} from "./types";

type SpeakerNames = Record<string, string> | null | undefined;

function wordStart(word: TranscriptWord): number {
  const value = word.start ?? word.start_time ?? 0;
  return Number(value) || 0;
}

function wordEnd(word: TranscriptWord): number {
  const value = word.end ?? word.end_time ?? word.start ?? word.start_time ?? 0;
  return Number(value) || 0;
}

/**
 * Flattens either the `words[]` shape or the multi-channel `transcripts[]` shape into
 * one ordered list, carrying `channel_index` and inheriting the channel's speaker.
 */
export function extractWords(response: TranscriptResponse): TranscriptWord[] {
  const collected: TranscriptWord[] = [];

  const pushWords = (words: TranscriptWord[] | undefined, channelIndex: number, inheritedSpeaker?: string) => {
    for (const word of words ?? []) {
      collected.push({
        ...word,
        channel_index: word.channel_index ?? channelIndex,
        speaker: word.speaker ?? inheritedSpeaker,
      });
    }
  };

  if (Array.isArray(response.transcripts) && response.transcripts.length > 0) {
    response.transcripts.forEach((channel, index) => {
      pushWords(channel.words, channel.channel_index ?? index, channel.speaker);
    });
  } else {
    pushWords(response.words, 0);
  }

  return collected.sort((left, right) => {
    const startDelta = wordStart(left) - wordStart(right);
    if (startDelta !== 0) {
      return startDelta;
    }
    return (left.channel_index ?? 0) - (right.channel_index ?? 0);
  });
}

export function extractText(response: TranscriptResponse): string {
  if (typeof response.text === "string" && response.text.trim()) {
    return response.text.trim();
  }

  if (Array.isArray(response.transcripts) && response.transcripts.length > 0) {
    const blocks = response.transcripts
      .map((channel, index) => {
        const title = channel.speaker || `Channel ${(channel.channel_index ?? index) + 1}`;
        const body =
          typeof channel.text === "string" && channel.text.trim()
            ? channel.text.trim()
            : (channel.words ?? []).map((word) => word.text ?? "").join("").trim();
        return body ? `${title}:\n${body}` : "";
      })
      .filter(Boolean);
    if (blocks.length > 0) {
      return blocks.join("\n\n");
    }
  }

  return extractWords(response)
    .map((word) => word.text ?? "")
    .join("")
    .trim();
}

export function extractDetectedLanguage(response: TranscriptResponse): string | null {
  if (typeof response.language_code === "string" && response.language_code.trim()) {
    return response.language_code.trim();
  }

  const languages = new Set<string>();
  for (const channel of response.transcripts ?? []) {
    if (typeof channel.language_code === "string" && channel.language_code.trim()) {
      languages.add(channel.language_code.trim());
    }
  }
  if (languages.size === 0) {
    return null;
  }
  return [...languages].sort().join(", ");
}

/**
 * `speaker_0` -> `Speaker 1` (the API is zero-based), but `speaker 3` is left as
 * `Speaker 3` because a space-separated label is already one-based.
 */
export function humanizeSpeakerLabel(label: string): string {
  const raw = String(label ?? "").trim();
  if (!raw) {
    return raw;
  }

  const zeroBased = raw.match(/^(speaker|channel)[_-](\d+)$/i);
  if (zeroBased) {
    const word = zeroBased[1].toLowerCase() === "speaker" ? "Speaker" : "Channel";
    return `${word} ${Number(zeroBased[2]) + 1}`;
  }

  const oneBased = raw.match(/^(speaker|channel)\s+(\d+)$/i);
  if (oneBased) {
    const word = oneBased[1].toLowerCase() === "speaker" ? "Speaker" : "Channel";
    return `${word} ${Number(oneBased[2])}`;
  }

  return raw;
}

export function canonicalSpeakerLabel(word: TranscriptWord): string | null {
  for (const key of ["speaker", "speaker_id", "speaker_label"] as const) {
    const value = word[key];
    if (value === null || value === undefined || value === "") {
      continue;
    }
    if (typeof value === "number") {
      return `Speaker ${value + 1}`;
    }
    return String(value);
  }

  if (typeof word.channel_index === "number") {
    return `Channel ${word.channel_index + 1}`;
  }
  return null;
}

export function resolveSpeakerName(key: string | null, names: SpeakerNames): string | null {
  if (!key) {
    return null;
  }
  const assigned = names?.[key];
  return assigned && assigned.trim() ? assigned.trim() : key;
}

export function formatTranscriptTimestamp(seconds: number): string {
  const total = Math.max(0, Number(seconds) || 0);
  let whole = Math.floor(total);
  let millis = Math.round((total - whole) * 1000);
  if (millis >= 1000) {
    // 999.5ms rounds up to a full second; carry rather than emitting ".1000".
    millis -= 1000;
    whole += 1;
  }
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}.${pad(millis, 3)}`;
}

export function buildCues(
  response: TranscriptResponse,
  maxChars = 86,
  maxGap = 1.25,
  speakerNames?: SpeakerNames
): Cue[] {
  const words = extractWords(response);

  if (words.length === 0) {
    const text = extractText(response) || "Transcript unavailable.";
    return [{ start: 0, end: 5, text, speaker: null, speaker_key: null }];
  }

  const cues: Cue[] = [];
  let buffer: TranscriptWord[] = [];
  let bufferKey: string | null = null;

  const flush = () => {
    if (buffer.length === 0) {
      return;
    }
    const text = buffer
      .map((word) => word.text ?? "")
      .join("")
      .trim();
    if (text) {
      const start = wordStart(buffer[0]);
      const end = Math.max(wordEnd(buffer[buffer.length - 1]), start + 0.2);
      cues.push({
        start,
        end,
        text,
        speaker: resolveSpeakerName(bufferKey, speakerNames),
        speaker_key: bufferKey,
      });
    }
    buffer = [];
    bufferKey = null;
  };

  for (const word of words) {
    const key = canonicalSpeakerLabel(word);
    const isWordToken = (word.type ?? "word") === "word";

    if (buffer.length > 0) {
      const speakerChanged = isWordToken && key !== bufferKey;
      const gap = wordStart(word) - wordEnd(buffer[buffer.length - 1]);
      const pending = buffer
        .map((item) => item.text ?? "")
        .join("")
        .trim();
      const longEnough = pending.length >= maxChars && /[.?!]$/.test(pending);

      if (speakerChanged || gap > maxGap || longEnough) {
        flush();
      }
    }

    if (buffer.length === 0) {
      bufferKey = key;
    }
    buffer.push(word);
  }

  flush();

  if (cues.length === 0) {
    const text = extractText(response) || "Transcript unavailable.";
    return [{ start: 0, end: 5, text, speaker: null, speaker_key: null }];
  }
  return cues;
}

export function buildTranscriptParagraphs(
  response: TranscriptResponse,
  maxChars = 420,
  maxGap = 2.5,
  speakerNames?: SpeakerNames
): Cue[] {
  const cues = buildCues(response, 86, 1.25, speakerNames);
  const paragraphs: Cue[] = [];

  for (const cue of cues) {
    const current = paragraphs[paragraphs.length - 1];
    const mergeable =
      current &&
      current.speaker_key === cue.speaker_key &&
      cue.start - current.end <= maxGap &&
      current.text.length + cue.text.length + 1 <= maxChars;

    if (mergeable) {
      current.text = `${current.text} ${cue.text}`.trim();
      current.end = cue.end;
    } else {
      paragraphs.push({ ...cue });
    }
  }

  return paragraphs;
}

export function renderTranscriptParagraph(paragraph: Cue): string {
  const stamp = `[${formatTranscriptTimestamp(paragraph.start)}]`;
  if (paragraph.speaker) {
    return `${stamp} ${humanizeSpeakerLabel(paragraph.speaker)}: ${paragraph.text}`;
  }
  return `${stamp} ${paragraph.text}`;
}

export function formatTranscriptText(response: TranscriptResponse, speakerNames?: SpeakerNames): string {
  return buildTranscriptParagraphs(response, 420, 2.5, speakerNames)
    .map(renderTranscriptParagraph)
    .join("\n\n");
}

export function buildTimelineEntries(
  response: TranscriptResponse,
  limit = 200,
  speakerNames?: SpeakerNames
): TimelineEntry[] {
  return buildCues(response, 86, 1.25, speakerNames)
    .slice(0, limit)
    .map((cue, index) => ({
      index,
      start: cue.start,
      end: cue.end,
      speaker: cue.speaker ? humanizeSpeakerLabel(cue.speaker) : null,
      speaker_key: cue.speaker_key,
      text: cue.text,
    }));
}

export function extractAudioEvents(response: TranscriptResponse, limit = 200): TimelineEntry[] {
  const events: TimelineEntry[] = [];
  for (const word of extractWords(response)) {
    const text = (word.text ?? "").trim();
    const isEvent = word.type === "audio_event" || (text.includes("[") && text.includes("]"));
    if (!isEvent || !text) {
      continue;
    }
    events.push({
      index: events.length,
      start: wordStart(word),
      end: wordEnd(word),
      speaker: null,
      speaker_key: null,
      text,
    });
    if (events.length >= limit) {
      break;
    }
  }
  return events;
}

export function extractEntities(response: TranscriptResponse, limit = 200) {
  const entities: RawEntity[] = Array.isArray(response.entities) ? response.entities : [];
  return entities.slice(0, limit).map((entity) => ({
    text: entity.text ?? "",
    label: entity.entity_type ?? entity.type ?? "Entity",
    start: entity.start ?? null,
    end: entity.end ?? null,
  }));
}

export function buildSpeakerProfiles(
  response: TranscriptResponse,
  speakerNames?: SpeakerNames,
  quotesPerSpeaker = 3
): SpeakerProfile[] {
  // Grouped on raw labels, so assigned names never change the grouping key.
  const cues = buildCues(response, 86, 1.25, null);
  const profiles = new Map<string, SpeakerProfile>();

  for (const cue of cues) {
    if (!cue.speaker_key) {
      continue;
    }
    let profile = profiles.get(cue.speaker_key);
    if (!profile) {
      profile = {
        speaker_key: cue.speaker_key,
        speaker_label: humanizeSpeakerLabel(cue.speaker_key),
        assigned_name: speakerNames?.[cue.speaker_key] ?? null,
        quotes: [],
      };
      profiles.set(cue.speaker_key, profile);
    }
    if (profile.quotes.length < quotesPerSpeaker) {
      profile.quotes.push({ start: cue.start, end: cue.end, text: cue.text });
    }
  }

  return [...profiles.values()];
}
