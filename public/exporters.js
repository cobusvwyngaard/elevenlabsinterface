// Every export format is produced here, in the browser. The Worker only stores and serves the
// raw ElevenLabs response; rendering it server-side would exceed the Workers Free CPU budget.

(function (global) {
  "use strict";

  const T = global.TranscriptUtils;
  const EMPTY_TRANSCRIPT = "Transcript unavailable.";

  const CONTENT_TYPES = {
    txt: "text/plain;charset=utf-8",
    srt: "application/x-subrip",
    vtt: "text/vtt;charset=utf-8",
    html: "text/html;charset=utf-8",
  };

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

  async function download(format, response, speakerNames, metadata, stem) {
    const filename = `${stem}.${format}`;

    if (format === "docx") {
      saveBlob(await buildDocx(response, speakerNames, metadata), filename);
      return;
    }
    if (format === "pdf") {
      saveBlob(await buildPdf(response, speakerNames, metadata), filename);
      return;
    }

    const builders = { txt: buildTxt, srt: buildSrt, vtt: buildVtt };
    const text =
      format === "html"
        ? buildHtml(response, speakerNames, metadata)
        : builders[format](response, speakerNames);
    saveBlob(new Blob([text], { type: CONTENT_TYPES[format] }), filename);
  }

  global.Exporters = { FORMATS, download };
})(window);
