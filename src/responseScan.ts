/**
 * Pulls the few fields the server needs out of an ElevenLabs response without parsing it.
 *
 * A full JSON.parse of a one-hour transcript costs roughly 8ms, which alone would nearly
 * exhaust the 10ms CPU budget of a Workers Free invocation. Scanning a bounded prefix costs
 * about a millisecond regardless of how long the audio was.
 */

const SCAN_LIMIT_BYTES = 256 * 1024;
const PREVIEW_LIMIT = 800;

export interface ScannedMetadata {
  transcriptionId: string | null;
  languageCode: string | null;
  preview: string | null;
}

function unescapeJsonString(value: string): string {
  return value
    .replaceAll('\\"', '"')
    .replaceAll("\\n", "\n")
    .replaceAll("\\t", "\t")
    .replaceAll("\\r", "")
    .replaceAll("\\/", "/")
    .replaceAll("\\\\", "\\");
}

function matchString(prefix: string, key: string): string | null {
  const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
  const found = prefix.match(pattern);
  return found ? unescapeJsonString(found[1]) : null;
}

export function scanTranscriptMetadata(bytes: ArrayBuffer): ScannedMetadata {
  const slice = bytes.byteLength > SCAN_LIMIT_BYTES ? bytes.slice(0, SCAN_LIMIT_BYTES) : bytes;
  const prefix = new TextDecoder().decode(slice);

  // The text field can be very long, so it is captured with an explicit bound.
  const textMatch = prefix.match(
    new RegExp(`"text"\\s*:\\s*"((?:[^"\\\\]|\\\\.){0,${PREVIEW_LIMIT * 2}})`)
  );

  return {
    transcriptionId: matchString(prefix, "transcription_id") ?? matchString(prefix, "request_id"),
    languageCode: matchString(prefix, "language_code"),
    preview: textMatch ? unescapeJsonString(textMatch[1]).slice(0, PREVIEW_LIMIT) : null,
  };
}
