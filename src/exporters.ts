import { Document, HeadingLevel, Packer, Paragraph } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { OUTPUT_CONTENT_TYPES, OUTPUT_LABELS } from "./constants";
import {
  buildCues,
  buildTranscriptParagraphs,
  extractDetectedLanguage,
  formatTranscriptText,
  formatTranscriptTimestamp,
  humanizeSpeakerLabel,
  renderTranscriptParagraph,
} from "./transcriptUtils";
import type { Cue, ExportAsset, TranscriptResponse } from "./types";

export interface ExportOptions {
  speakerNames?: Record<string, string> | null;
  filenameStem?: string;
  formatPrefix?: string;
  labelPrefix?: string;
  includeJson?: boolean;
}

const EMPTY_TRANSCRIPT = "Transcript unavailable.";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderMetadataLines(metadata: Record<string, unknown>): [string, string][] {
  const lines: [string, string][] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        continue;
      }
      lines.push([key, value.join(", ")]);
      continue;
    }
    if (typeof value === "object") {
      const pairs = Object.entries(value as Record<string, unknown>)
        .map(([name, assigned]) => `${name} -> ${String(assigned)}`)
        .join(", ");
      if (pairs) {
        lines.push([key, pairs]);
      }
      continue;
    }
    lines.push([key, String(value)]);
  }
  return lines;
}

function cueTextWithSpeaker(cue: Cue): string {
  if (cue.speaker) {
    return `${humanizeSpeakerLabel(cue.speaker)}: ${cue.text}`;
  }
  return cue.text;
}

function srtTimecode(seconds: number): string {
  return formatTranscriptTimestamp(seconds).replace(".", ",");
}

function buildSrt(cues: Cue[]): string {
  return (
    cues
      .map((cue, index) => {
        return `${index + 1}\n${srtTimecode(cue.start)} --> ${srtTimecode(cue.end)}\n${cueTextWithSpeaker(cue)}\n`;
      })
      .join("\n") + "\n"
  );
}

function buildVtt(cues: Cue[]): string {
  const body = cues
    .map((cue) => {
      return `${formatTranscriptTimestamp(cue.start)} --> ${formatTranscriptTimestamp(cue.end)}\n${cueTextWithSpeaker(cue)}\n`;
    })
    .join("\n");
  return `WEBVTT\n\n${body}\n`;
}

function buildHtml(paragraphs: Cue[], metadata: [string, string][], transcriptText: string): string {
  const metaItems = metadata
    .map(([key, value]) => `      <li><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value)}</li>`)
    .join("\n");
  const body = paragraphs.length
    ? paragraphs.map((p) => `    <p>${escapeHtml(renderTranscriptParagraph(p))}</p>`).join("\n")
    : `    <p>${escapeHtml(transcriptText || EMPTY_TRANSCRIPT)}</p>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Transcript Export</title>
    <style>
      body { font-family: Georgia, "Times New Roman", serif; margin: 40px auto; max-width: 44rem; line-height: 1.6; color: #1f2329; }
      h1 { font-size: 1.6rem; }
      ul { padding-left: 1.2rem; color: #5d645d; }
      p { margin: 0 0 1rem; }
    </style>
  </head>
  <body>
    <h1>Transcript Export</h1>
    <ul>
${metaItems}
    </ul>
${body}
  </body>
</html>
`;
}

async function buildDocx(paragraphs: Cue[], metadata: [string, string][], transcriptText: string): Promise<Uint8Array> {
  const children: Paragraph[] = [
    new Paragraph({ text: "Transcript Export", heading: HeadingLevel.HEADING_1 }),
    ...metadata.map(([key, value]) => new Paragraph({ text: `${key}: ${value}` })),
    new Paragraph({ text: "" }),
  ];

  if (paragraphs.length) {
    for (const paragraph of paragraphs) {
      children.push(new Paragraph({ text: renderTranscriptParagraph(paragraph) }));
    }
  } else {
    children.push(new Paragraph({ text: transcriptText || EMPTY_TRANSCRIPT }));
  }

  const document = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(document);
  return new Uint8Array(buffer);
}

function wrapLine(line: string, width: number): string[] {
  if (line.length <= width) {
    return [line];
  }
  const wrapped: string[] = [];
  let current = "";
  for (const word of line.split(" ")) {
    if (current && `${current} ${word}`.length > width) {
      wrapped.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) {
    wrapped.push(current);
  }
  return wrapped;
}

async function buildPdf(paragraphs: Cue[], metadata: [string, string][], transcriptText: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([612, 792]);
  let y = 720;

  page.drawText("Transcript Export", { x: 72, y, size: 16, font: bold });
  y -= 28;

  const lines: string[] = [
    ...metadata.map(([key, value]) => `${key}: ${value}`),
    "",
    ...(paragraphs.length
      ? paragraphs.map(renderTranscriptParagraph)
      : [transcriptText || EMPTY_TRANSCRIPT]),
  ];

  for (const line of lines) {
    for (const wrapped of wrapLine(line, 100)) {
      if (y < 72) {
        page = pdf.addPage([612, 792]);
        y = 720;
      }
      // WinAnsi (the standard-font encoding) rejects characters outside its range.
      page.drawText(wrapped.replace(/[^\x20-\xFF]/g, "?"), { x: 72, y, size: 11, font: body });
      y -= 15;
    }
  }

  return pdf.save();
}

/**
 * Writes the selected exports to R2 under `<jobId>/` and returns their descriptors.
 * Keys are relative to the bucket, never absolute paths (REBUILD_SPEC.md §19).
 */
export async function createExports(
  bucket: R2Bucket,
  jobId: string,
  response: TranscriptResponse,
  selectedFormats: string[],
  metadata: Record<string, unknown>,
  options: ExportOptions = {}
): Promise<ExportAsset[]> {
  const {
    speakerNames = null,
    filenameStem = "transcript",
    formatPrefix = "",
    labelPrefix = "",
    includeJson = true,
  } = options;

  const enrichedMetadata = { ...metadata };
  if (!("Detected language" in enrichedMetadata)) {
    enrichedMetadata["Detected language"] = extractDetectedLanguage(response);
  }
  const metadataLines = renderMetadataLines(enrichedMetadata);

  const transcriptText = formatTranscriptText(response, speakerNames) || EMPTY_TRANSCRIPT;
  const paragraphs = buildTranscriptParagraphs(response, 420, 2.5, speakerNames);
  const cues = buildCues(response, 86, 1.25, speakerNames);

  const assets: ExportAsset[] = [];

  const put = async (format: string, filename: string, body: string | Uint8Array) => {
    const key = `${jobId}/${filename}`;
    const contentType = OUTPUT_CONTENT_TYPES[format] ?? "application/octet-stream";
    const payload = typeof body === "string" ? new TextEncoder().encode(body) : body;
    await bucket.put(key, payload, { httpMetadata: { contentType } });
    assets.push({
      format: `${formatPrefix}${format}`,
      filename,
      content_type: contentType,
      path: key,
      label: `${labelPrefix}${OUTPUT_LABELS[format] ?? format.toUpperCase()}`,
      size: payload.byteLength,
    });
  };

  if (includeJson) {
    await put("json", `${filenameStem}.json`, JSON.stringify(response, null, 2));
  }

  for (const format of selectedFormats) {
    switch (format) {
      case "txt":
        await put("txt", `${filenameStem}.txt`, `${transcriptText}\n`);
        break;
      case "html":
        await put("html", `${filenameStem}.html`, buildHtml(paragraphs, metadataLines, transcriptText));
        break;
      case "srt":
        await put("srt", `${filenameStem}.srt`, buildSrt(cues));
        break;
      case "vtt":
        await put("vtt", `${filenameStem}.vtt`, buildVtt(cues));
        break;
      case "docx":
        await put("docx", `${filenameStem}.docx`, await buildDocx(paragraphs, metadataLines, transcriptText));
        break;
      case "pdf":
        await put("pdf", `${filenameStem}.pdf`, await buildPdf(paragraphs, metadataLines, transcriptText));
        break;
      default:
        break;
    }
  }

  return assets;
}
