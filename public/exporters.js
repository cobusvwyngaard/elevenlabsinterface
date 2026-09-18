// Every export format is produced here, in the browser. The Worker only stores and serves the
// raw ElevenLabs response; rendering it server-side would exceed the Workers Free CPU budget.

(function (global) {
  "use strict";

  const T = global.TranscriptUtils;
  const EMPTY_TRANSCRIPT = "Transcript unavailable.";

  const CONTENT_TYPES = {
    json: "application/json",
    txt: "text/plain;charset=utf-8",
    srt: "application/x-subrip",
    vtt: "text/vtt;charset=utf-8",
    html: "text/html;charset=utf-8",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pdf: "application/pdf",
  };

  const FORMAT_DESCRIPTIONS = {
    json: "Raw transcript JSON",
    txt: "Plain text",
    srt: "SubRip subtitles",
    vtt: "WebVTT subtitles",
    html: "HTML document",
    docx: "Word document",
    pdf: "PDF document",
  };

  const SAVE_CANCELLED = Symbol("save cancelled");

  const loadedScripts = new Map();

  function loadScriptOnce(src) {
    if (!loadedScripts.has(src)) {
      loadedScripts.set(
        src,
        new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = src;
          script.onload = resolve;
          script.onerror = () => reject(new Error(`Could not load ${src}`));
          document.head.appendChild(script);
        })
      );
    }
    return loadedScripts.get(src);
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  /**
   * Opens a Save As dialog so the folder can be chosen.
   *
   * Must be called before the file contents are built: the picker needs the click's transient
   * user activation, and awaiting a DOCX or PDF build first would spend it. Returns null where
   * the API is unavailable (Firefox and Safari), leaving the plain download as the fallback.
   */
  async function pickSaveLocation(filename, format) {
    if (typeof window.showSaveFilePicker !== "function") {
      return null;
    }

    const mime = CONTENT_TYPES[format] || "application/octet-stream";
    const startedAt = Date.now();
    try {
      return await window.showSaveFilePicker({
        suggestedName: filename,
        // A stable id makes Chromium reopen the folder used last time.
        id: "workbench_transcripts",
        types: [
          {
            description: FORMAT_DESCRIPTIONS[format] || "File",
            accept: { [mime]: [`.${format}`] },
          },
        ],
      });
    } catch (error) {
      if (error && error.name === "AbortError") {
        // An AbortError this fast means no dialog was ever shown — the picker is blocked by
        // policy or unavailable in this context. Nobody can dismiss a dialog in a few
        // milliseconds, and treating that as a cancellation would leave a dead button.
        if (Date.now() - startedAt < 250) {
          return null;
        }
        return SAVE_CANCELLED;
      }
      // Any other picker failure falls back rather than losing the export.
      return null;
    }
  }

  async function writeTo(handle, blob) {
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function metadataLines(metadata, speakerNames) {
    const lines = [];
    for (const [key, value] of Object.entries(metadata || {})) {
      if (value === null || value === undefined || value === "") {
        continue;
      }
      if (Array.isArray(value)) {
        if (value.length) {
          lines.push([key, value.join(", ")]);
        }
        continue;
      }
      lines.push([key, String(value)]);
    }
    if (speakerNames && Object.keys(speakerNames).length) {
      lines.push([
        "Speaker names",
        Object.entries(speakerNames)
          .map(([key, value]) => `${key} -> ${value}`)
          .join(", "),
      ]);
    }
    return lines;
  }

  function cueTextWithSpeaker(cue) {
    return cue.speaker ? `${T.humanizeSpeakerLabel(cue.speaker)}: ${cue.text}` : cue.text;
  }

  function srtTimecode(seconds) {
    return T.formatTranscriptTimestamp(seconds).replace(".", ",");
  }

  function buildTxt(response, speakerNames) {
    return `${T.formatTranscriptText(response, speakerNames) || EMPTY_TRANSCRIPT}\n`;
  }

  function buildSrt(response, speakerNames) {
    const cues = T.buildCues(response, 86, 1.25, speakerNames);
    return (
      cues
        .map(
          (cue, index) =>
            `${index + 1}\n${srtTimecode(cue.start)} --> ${srtTimecode(cue.end)}\n${cueTextWithSpeaker(cue)}\n`
        )
        .join("\n") + "\n"
    );
  }

  function buildVtt(response, speakerNames) {
    const cues = T.buildCues(response, 86, 1.25, speakerNames);
    const body = cues
      .map(
        (cue) =>
          `${T.formatTranscriptTimestamp(cue.start)} --> ${T.formatTranscriptTimestamp(cue.end)}\n${cueTextWithSpeaker(cue)}\n`
      )
      .join("\n");
    return `WEBVTT\n\n${body}\n`;
  }

  function buildHtml(response, speakerNames, metadata) {
    const paragraphs = T.buildTranscriptParagraphs(response, 420, 2.5, speakerNames);
    const items = metadataLines(metadata, speakerNames)
      .map(([key, value]) => `      <li><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value)}</li>`)
      .join("\n");
    const body = paragraphs.length
      ? paragraphs.map((p) => `    <p>${escapeHtml(T.renderTranscriptParagraph(p))}</p>`).join("\n")
      : `    <p>${escapeHtml(EMPTY_TRANSCRIPT)}</p>`;

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
${items}
    </ul>
${body}
  </body>
</html>
`;
  }

  async function buildDocx(response, speakerNames, metadata) {
    await loadScriptOnce("/vendor/docx.iife.js");
    const { Document, Packer, Paragraph, HeadingLevel } = global.docx;
    const paragraphs = T.buildTranscriptParagraphs(response, 420, 2.5, speakerNames);

    const children = [
      new Paragraph({ text: "Transcript Export", heading: HeadingLevel.HEADING_1 }),
      ...metadataLines(metadata, speakerNames).map(([key, value]) => new Paragraph({ text: `${key}: ${value}` })),
      new Paragraph({ text: "" }),
      ...(paragraphs.length
        ? paragraphs.map((p) => new Paragraph({ text: T.renderTranscriptParagraph(p) }))
        : [new Paragraph({ text: EMPTY_TRANSCRIPT })]),
    ];

    return Packer.toBlob(new Document({ sections: [{ children }] }));
  }

  function wrapLine(line, width) {
    if (line.length <= width) {
      return [line];
    }
    const wrapped = [];
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

  async function buildPdf(response, speakerNames, metadata) {
    await loadScriptOnce("/vendor/pdf-lib.min.js");
    const { PDFDocument, StandardFonts } = global.PDFLib;
    const paragraphs = T.buildTranscriptParagraphs(response, 420, 2.5, speakerNames);

    const pdf = await PDFDocument.create();
    const body = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    let page = pdf.addPage([612, 792]);
    let y = 720;
    page.drawText("Transcript Export", { x: 72, y, size: 16, font: bold });
    y -= 28;

    const lines = [
      ...metadataLines(metadata, speakerNames).map(([key, value]) => `${key}: ${value}`),
      "",
      ...(paragraphs.length ? paragraphs.map(T.renderTranscriptParagraph) : [EMPTY_TRANSCRIPT]),
    ];

    for (const line of lines) {
      for (const wrapped of wrapLine(line, 100)) {
        if (y < 72) {
          page = pdf.addPage([612, 792]);
          y = 720;
        }
        // Standard fonts use WinAnsi, which rejects characters outside its range.
        page.drawText(wrapped.replace(/[^\x20-\xFF]/g, "?"), { x: 72, y, size: 11, font: body });
        y -= 15;
      }
    }

    return new Blob([await pdf.save()], { type: "application/pdf" });
  }

  const FORMATS = [
    { format: "txt", label: "Plain text", extension: "txt" },
    { format: "srt", label: "SRT subtitles", extension: "srt" },
    { format: "vtt", label: "WebVTT subtitles", extension: "vtt" },
    { format: "html", label: "HTML", extension: "html" },
    { format: "docx", label: "Word document", extension: "docx" },
    { format: "pdf", label: "PDF", extension: "pdf" },
  ];

  async function buildBlob(format, response, speakerNames, metadata) {
    if (format === "docx") {
      return buildDocx(response, speakerNames, metadata);
    }
    if (format === "pdf") {
      return buildPdf(response, speakerNames, metadata);
    }

    const builders = { txt: buildTxt, srt: buildSrt, vtt: buildVtt };
    const text =
      format === "html"
        ? buildHtml(response, speakerNames, metadata)
        : builders[format](response, speakerNames);
    return new Blob([text], { type: CONTENT_TYPES[format] });
  }

  async function download(format, response, speakerNames, metadata, stem) {
    const filename = `${stem}.${format}`;

    const target = await pickSaveLocation(filename, format);
    if (target === SAVE_CANCELLED) {
      return;
    }

    const blob = await buildBlob(format, response, speakerNames, metadata);
    if (target) {
      await writeTo(target, blob);
      return;
    }
    saveBlob(blob, filename);
  }

  /** Saves the stored ElevenLabs response byte for byte, rather than a re-serialised copy. */
  async function downloadRaw(url, filename) {
    const target = await pickSaveLocation(filename, "json");
    if (target === SAVE_CANCELLED) {
      return;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Could not load the stored transcript.");
    }
    const blob = await response.blob();

    if (target) {
      await writeTo(target, blob);
      return;
    }
    saveBlob(blob, filename);
  }

  global.Exporters = { FORMATS, download, downloadRaw };
})(window);
