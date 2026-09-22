const bootstrap = window.WORKBENCH_BOOTSTRAP;

const state = {
  activeJobId: null,
  jobs: [],
  pollTimer: null,
  pollInFlight: false,
  elapsedTimer: null,
  elapsedAnchor: null,
  usageTimer: null,
  keytermPresets: [],
  showHidden: false,
  hiddenJobCount: 0,
  transcriptCache: new Map(),
};

const elements = {
  apiKeyForm: document.getElementById("apiKeyForm"),
  apiKeyInput: document.getElementById("apiKeyInput"),
  savedKeyStatus: document.getElementById("savedKeyStatus"),
  removeKeyButton: document.getElementById("removeKeyButton"),
  transcriptionForm: document.getElementById("transcriptionForm"),
  sourceModeInputs: [...document.querySelectorAll("input[name='source_mode']")],
  uploadPanel: document.getElementById("uploadPanel"),
  urlPanel: document.getElementById("urlPanel"),
  fileInput: document.getElementById("fileInput"),
  urlInput: document.getElementById("urlInput"),
  modelSelect: document.getElementById("modelSelect"),
  languageInput: document.getElementById("languageInput"),
  audioTypeSelect: document.getElementById("audioTypeSelect"),
  timestampsSelect: document.getElementById("timestampsSelect"),
  diarizeInput: document.getElementById("diarizeInput"),
  tagAudioEventsInput: document.getElementById("tagAudioEventsInput"),
  multiChannelInput: document.getElementById("multiChannelInput"),
  noVerbatimInput: document.getElementById("noVerbatimInput"),
  zeroRetentionInput: document.getElementById("zeroRetentionInput"),
  numSpeakersInput: document.getElementById("numSpeakersInput"),
  diarizationThresholdInput: document.getElementById("diarizationThresholdInput"),
  keytermsInput: document.getElementById("keytermsInput"),
  keytermPresetSelect: document.getElementById("keytermPresetSelect"),
  loadKeytermPresetButton: document.getElementById("loadKeytermPresetButton"),
  saveKeytermPresetButton: document.getElementById("saveKeytermPresetButton"),
  deleteKeytermPresetButton: document.getElementById("deleteKeytermPresetButton"),
  entityDetectionInputs: [...document.querySelectorAll("input[name='entity_detection']")],
  entityDetectionCustomInput: document.getElementById("entityDetectionCustomInput"),
  formStatus: document.getElementById("formStatus"),
  transcribeButton: document.getElementById("transcribeButton"),
  compressionMode: document.getElementById("compressionMode"),
  compressionBitrate: document.getElementById("compressionBitrate"),
  compressionHint: document.getElementById("compressionHint"),
  cancelJobButton: document.getElementById("cancelJobButton"),
  historyList: document.getElementById("historyList"),
  refreshHistoryButton: document.getElementById("refreshHistoryButton"),
  showHiddenButton: document.getElementById("showHiddenButton"),
  auditRemoteButton: document.getElementById("auditRemoteButton"),
  resultsPanel: document.getElementById("resultsPanel"),
  resultsEmptyState: document.getElementById("resultsEmptyState"),
  resultsEmptyTitle: document.getElementById("resultsEmptyTitle"),
  resultsEmptyBody: document.getElementById("resultsEmptyBody"),
  resultMeta: document.getElementById("resultMeta"),
  deletePanel: document.getElementById("deletePanel"),
  deleteHelpText: document.getElementById("deleteHelpText"),
  verifyRemoteButton: document.getElementById("verifyRemoteButton"),
  hideJobButton: document.getElementById("hideJobButton"),
  deleteLocalButton: document.getElementById("deleteLocalButton"),
  deleteRemoteButton: document.getElementById("deleteRemoteButton"),
  deleteBothButton: document.getElementById("deleteBothButton"),
  downloads: document.getElementById("downloads"),
  namedDownloads: document.getElementById("namedDownloads"),
  metadataGrid: document.getElementById("metadataGrid"),
  transcriptText: document.getElementById("transcriptText"),
  namedTranscriptPanel: document.getElementById("namedTranscriptPanel"),
  namedTranscriptText: document.getElementById("namedTranscriptText"),
  timelineEntries: document.getElementById("timelineEntries"),
  audioEvents: document.getElementById("audioEvents"),
  speakerNamingState: document.getElementById("speakerNamingState"),
  speakerProfiles: document.getElementById("speakerProfiles"),
  speakerActions: document.getElementById("speakerActions"),
  saveSpeakerNamesButton: document.getElementById("saveSpeakerNamesButton"),
  clearSpeakerNamesButton: document.getElementById("clearSpeakerNamesButton"),
  entitiesList: document.getElementById("entitiesList"),
  activityPanel: document.getElementById("activityPanel"),
  activityBadge: document.getElementById("activityBadge"),
  activityElapsed: document.getElementById("activityElapsed"),
  activityDetail: document.getElementById("activityDetail"),
  tracePanel: document.getElementById("tracePanel"),
  traceList: document.getElementById("traceList"),
  traceSummary: document.getElementById("traceSummary"),
  usagePanel: document.getElementById("usagePanel"),
  usageStatus: document.getElementById("usageStatus"),
  refreshUsageButton: document.getElementById("refreshUsageButton"),
  usageRemaining: document.getElementById("usageRemaining"),
  usageUsed: document.getElementById("usageUsed"),
  usageLimit: document.getElementById("usageLimit"),
  usageReset: document.getElementById("usageReset"),
  usageTier: document.getElementById("usageTier"),
  usageUpdated: document.getElementById("usageUpdated"),
  usageChartTotal: document.getElementById("usageChartTotal"),
  usageChart: document.getElementById("usageChart"),
};

function setStatus(element, message, tone = "") {
  element.textContent = message || "";
  element.classList.remove("success", "error");
  if (tone) {
    element.classList.add(tone);
  }
}

function activeSourceMode() {
  return elements.sourceModeInputs.find((input) => input.checked)?.value || "upload";
}

function formatTimestamp(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  const millis = Math.round((total - Math.floor(total)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function formatElapsed(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function formatNumber(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value);
  }
  return new Intl.NumberFormat().format(numeric);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseTerms(value) {
  return String(value || "")
    .replaceAll("\r", "\n")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function updateSourcePanels() {
  const mode = activeSourceMode();
  elements.uploadPanel.classList.toggle("hidden", mode !== "upload");
  elements.urlPanel.classList.toggle("hidden", mode !== "url");
}

function selectedEntityDetection() {
  return elements.entityDetectionInputs.filter((input) => input.checked).map((input) => input.value);
}

function populateKeytermPresets() {
  const selected = elements.keytermPresetSelect.value;
  elements.keytermPresetSelect.innerHTML = '<option value="">Select a preset</option>';
  state.keytermPresets.forEach((preset) => {
    const option = document.createElement("option");
    option.value = preset.name;
    option.textContent = preset.name;
    elements.keytermPresetSelect.appendChild(option);
  });
  if (state.keytermPresets.some((preset) => preset.name === selected)) {
    elements.keytermPresetSelect.value = selected;
  }
}

function applyPreset(audioType) {
  const preset = bootstrap.presets[audioType] || {};
  elements.diarizeInput.checked = Boolean(preset.diarize);
  elements.tagAudioEventsInput.checked = Boolean(preset.tag_audio_events);
  elements.timestampsSelect.value = preset.timestamps_granularity || "word";
  elements.noVerbatimInput.checked = Boolean(preset.no_verbatim);
  elements.numSpeakersInput.value = preset.num_speakers ?? "";
  if (!preset.diarize) {
    elements.diarizationThresholdInput.value = "";
  }
  syncControls();
}

function applyDefaults(defaults) {
  if (!defaults || Object.keys(defaults).length === 0) {
    elements.audioTypeSelect.value = "meeting";
    applyPreset("meeting");
    return;
  }

  const sourceMode = defaults.source_mode || "upload";
  elements.sourceModeInputs.forEach((input) => {
    input.checked = input.value === sourceMode;
  });
  elements.modelSelect.value = defaults.model_id || "scribe_v2";
  elements.languageInput.value = defaults.language_code || "";
  elements.audioTypeSelect.value = defaults.audio_type || "meeting";
  elements.timestampsSelect.value = defaults.timestamps_granularity || "word";
  elements.diarizeInput.checked = Boolean(defaults.diarize);
  elements.tagAudioEventsInput.checked = Boolean(defaults.tag_audio_events);
  elements.multiChannelInput.checked = Boolean(defaults.use_multi_channel);
  elements.noVerbatimInput.checked = Boolean(defaults.no_verbatim);
  elements.zeroRetentionInput.checked = Boolean(defaults.zero_retention);
  elements.numSpeakersInput.value = defaults.num_speakers ?? "";
  elements.diarizationThresholdInput.value = defaults.diarization_threshold ?? "";
  elements.keytermsInput.value = defaults.keyterms || "";
  elements.urlInput.value = defaults.cloud_storage_url || "";
  elements.entityDetectionCustomInput.value = defaults.entity_detection_custom || "";

  elements.entityDetectionInputs.forEach((input) => {
    input.checked = (defaults.entity_detection || []).includes(input.value);
  });

  updateSourcePanels();
  syncControls();
}

function syncControls() {
  const isV2 = elements.modelSelect.value === "scribe_v2";
  const multiChannel = elements.multiChannelInput.checked;
  const diarize = elements.diarizeInput.checked && !multiChannel;
  const hasSpeakerCount = Boolean(elements.numSpeakersInput.value.trim());

  if (!isV2) {
    elements.noVerbatimInput.checked = false;
    elements.entityDetectionInputs.forEach((input) => {
      input.checked = false;
    });
    elements.entityDetectionCustomInput.value = "";
  }

  elements.noVerbatimInput.disabled = !isV2;
  elements.keytermsInput.disabled = !isV2;
  elements.keytermPresetSelect.disabled = !isV2;
  elements.loadKeytermPresetButton.disabled = !isV2;
  elements.saveKeytermPresetButton.disabled = !isV2;
  elements.deleteKeytermPresetButton.disabled = !isV2;
  elements.entityDetectionCustomInput.disabled = !isV2;
  elements.entityDetectionInputs.forEach((input) => {
    input.disabled = !isV2;
  });

  if (multiChannel) {
    elements.diarizeInput.checked = false;
    elements.numSpeakersInput.value = "";
    elements.diarizationThresholdInput.value = "";
  }

  elements.diarizeInput.disabled = multiChannel;
  elements.numSpeakersInput.disabled = multiChannel;
  elements.diarizationThresholdInput.disabled = multiChannel || !diarize || hasSpeakerCount;
}

// Cloudflare rejects any single request body over 100 MB, so audio goes to R2 in parts well
// under that. ElevenLabs caps a URL-fetched file at 2 GB, which is the real ceiling now.
const PART_SIZE = 20 * 1024 * 1024;
// How large a file this deployment can actually handle, which the server decides and reports.
//
// When it can sign an R2 download URL, ElevenLabs fetches the audio itself and the ceiling is
// their 2 GB. When it cannot, the audio has to travel through the Worker, and Cloudflare caps an
// outgoing request body at 100 MiB on this plan: measured against the live Worker, 103,809,024
// bytes is forwarded and answered, and 105,906,176 bytes comes back 413 before any of it is sent.
// Either way the check happens here, so an oversize file is refused at the file picker rather than
// after a long upload. The conservative figure holds until settings load.
let maxUploadBytes = 100 * 1024 * 1024 - 8 * 1024;
const PART_RETRIES = 3;
const STALL_AFTER_MS = 20000;

// Ordered pipeline. Client stages are observed in the browser; server stages arrive on the
// job record. Without this, a slow upload and a dead connection look identical.
const TRACE_STEPS = [
  { key: "compressing", label: "Compressing on this computer", side: "client" },
  { key: "compression_done", label: "Compressed", side: "client" },
  { key: "uploading", label: "Uploading to Cloudflare", side: "client" },
  { key: "accepted", label: "Accepted by Cloudflare", side: "client" },
  { key: "audio_stored", label: "Audio saved to storage", side: "server" },
  { key: "queued", label: "Queued for processing", side: "server" },
  { key: "picked_up", label: "Picked up by a worker", side: "server" },
  { key: "audio_streaming", label: "Streaming audio to ElevenLabs", side: "server" },
  { key: "sent_to_elevenlabs", label: "Sent to ElevenLabs", side: "server" },
  { key: "accepted_by_elevenlabs", label: "Accepted — transcribing", side: "server" },
  { key: "transcript_received", label: "Transcript received", side: "server" },
  { key: "done", label: "Complete", side: "server" },
];

const trace = {
  active: false,
  startedAt: null,
  totalBytes: 0,
  fileCount: 0,
  uploadedBytes: 0,
  lastProgressAt: null,
  uploadStartedAt: null,
  stalled: false,
  compressing: false,
  clientStages: [],
  serverStages: [],
  retries: [],
  failure: null,
  ticker: null,
};

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024 * 1024) {
    return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }
  if (value >= 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(0)} KB`;
  }
  return `${value} B`;
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function beginTrace(totalBytes, fileCount, { compressing = false } = {}) {
  trace.active = true;
  trace.startedAt = Date.now();
  trace.totalBytes = totalBytes;
  trace.fileCount = fileCount;
  trace.uploadedBytes = 0;
  trace.lastProgressAt = Date.now();
  trace.stalled = false;
  trace.compressing = compressing;
  // Compression runs first, so the upload has not started when it is the leading step.
  trace.clientStages = [
    { stage: compressing ? "compressing" : "uploading", at: new Date().toISOString() },
  ];
  trace.serverStages = [];
  trace.retries = [];
  trace.failure = null;

  // Reset the header and status line too, or they keep showing the previous job's outcome
  // while this one is still uploading.
  trace.uploadStartedAt = compressing ? null : Date.now();

  const phase = compressing ? "compressing" : totalBytes > 0 ? "uploading" : "submitting";
  setStatus(
    elements.formStatus,
    {
      compressing: "Compressing on this computer...",
      uploading: "Uploading to Cloudflare...",
      submitting: "Submitting the job...",
    }[phase]
  );
  elements.activityPanel.classList.remove("hidden");
  elements.activityBadge.textContent = phase.toUpperCase();
  elements.activityBadge.classList.remove("success", "error", "pending");
  elements.activityBadge.classList.add("pending");
  elements.activityDetail.textContent = {
    compressing: `Re-encoding ${fileCount} file${fileCount === 1 ? "" : "s"} before anything is sent. Nothing leaves this computer yet.`,
    uploading: `Sending ${fileCount} file${fileCount === 1 ? "" : "s"} (${formatBytes(totalBytes)}) to Cloudflare.`,
    submitting: "Submitting the job.",
  }[phase];
  elements.cancelJobButton.classList.add("hidden");
  stopElapsedTimer();
  state.elapsedAnchor = trace.startedAt;
  updateElapsedDisplay();
  state.elapsedTimer = window.setInterval(updateElapsedDisplay, 1000);

  clearInterval(trace.ticker);
  trace.ticker = window.setInterval(renderTrace, 1000);
  renderTrace();
}

function markRetry(partNumber, attempt, message) {
  trace.retries.push({ partNumber, attempt, message, at: Date.now() });
  renderTrace();
}

/** Says what will happen to the chosen files before the button is pressed. */
function refreshCompressionHint() {
  if (!elements.compressionHint) {
    return;
  }
  const files = [...(elements.fileInput?.files ?? [])];
  const quality = elements.compressionQualityField ?? document.getElementById("compressionQualityField");
  const mode = elements.compressionMode?.value ?? "auto";
  if (quality) {
    quality.classList.toggle("hidden", mode === "off");
  }

  if (!files.length) {
    setStatus(
      elements.compressionHint,
      window.AudioCompressor?.isSupported?.()
        ? "Re-encodes speech to mono Opus on this computer. Nothing is sent while it runs."
        : "This browser cannot re-encode audio. Chrome or Edge can."
    );
    return;
  }

  const planned = files.filter((file) => compressionPlanFor(file, maxUploadBytes).compress);
  if (!planned.length) {
    const over = files.filter((file) => file.size > maxUploadBytes);
    setStatus(
      elements.compressionHint,
      over.length
        ? `${over[0].name} is over the ${formatBytes(maxUploadBytes)} limit and will not be compressed with this setting.`
        : `Uploading as is — ${formatBytes(files.reduce((sum, f) => sum + f.size, 0))}.`,
      over.length ? "error" : ""
    );
    return;
  }

  // A constant bitrate makes the output size a function of duration alone, which is not known
  // until the file is decoded, so this is quoted per hour rather than as a total.
  const bitrate = Number(elements.compressionBitrate?.value) || 48000;
  const mbPerHour = ((bitrate / 8) * 3600) / 1e6;
  setStatus(
    elements.compressionHint,
    `${planned.length} file${planned.length === 1 ? "" : "s"} will be re-encoded to mono Opus at ` +
      `${bitrate / 1000} kbps first: about ${mbPerHour.toFixed(0)} MB per hour of audio, and ` +
      `roughly a minute of processing per 90 minutes of recording.`
  );
}

/** Explains which limit an oversize file hit, and that compressing is the way under it. */
function oversizeMessage(file) {
  if (maxUploadBytes > 1024 * 1024 * 1024) {
    return `${file.name} is ${formatBytes(file.size)}. ElevenLabs accepts up to ${formatBytes(maxUploadBytes)} per file.`;
  }
  return (
    `${file.name} is ${formatBytes(file.size)}. This app cannot forward more than ` +
    `${formatBytes(maxUploadBytes)} to ElevenLabs in one request, so the upload would finish ` +
    `and then be rejected. ElevenLabs itself would accept the file; the limit is on the way ` +
    `through. Set "Compress before uploading" to compress it down to size.`
  );
}

/** Whether this file should be re-encoded before upload, given the chosen mode. */
function compressionPlanFor(file, limitBytes) {
  const mode = elements.compressionMode?.value ?? "auto";
  if (mode === "off") {
    return { compress: false };
  }
  if (mode === "auto" && file.size <= limitBytes) {
    return { compress: false };
  }
  const support = window.AudioCompressor?.canCompress?.(file);
  if (!support?.ok) {
    // In "auto" this file was already too big, so the reason has to reach the user either way.
    return { compress: false, unavailable: support?.reason ?? "Compression is not available here." };
  }
  return { compress: true, bitrate: Number(elements.compressionBitrate?.value) || 48000 };
}

/** Re-encodes the selected files, reporting progress against the whole set rather than each one. */
async function compressFiles(files, limitBytes) {
  const results = [];
  let index = 0;

  for (const file of files) {
    const plan = compressionPlanFor(file, limitBytes);
    if (!plan.compress) {
      if (plan.unavailable && file.size > limitBytes) {
        throw new Error(`${file.name} is ${formatBytes(file.size)} and cannot be compressed here. ${plan.unavailable}`);
      }
      results.push(file);
      index++;
      continue;
    }

    const position = index;
    const outcome = await window.AudioCompressor.compress(file, {
      bitrate: plan.bitrate,
      onProgress: (fraction) => {
        const overall = (position + fraction) / files.length;
        updateClientStage(
          "compressing",
          `${Math.round(overall * 100)}% of ${files.length} file${files.length === 1 ? "" : "s"}`
        );
      },
    });

    results.push(outcome.file);
    setStatus(
      elements.compressionHint,
      `${file.name}: ${formatBytes(outcome.originalBytes)} to ${formatBytes(outcome.compressedBytes)} ` +
        `in ${Math.round(outcome.elapsedMs / 1000)}s.`
    );
    index++;
  }

  return results;
}

/** Updates the detail on a stage already in the trace, instead of appending another copy. */
function updateClientStage(stage, detail) {
  const existing = trace.clientStages.find((entry) => entry.stage === stage);
  if (existing) {
    existing.detail = detail;
  } else {
    trace.clientStages.push({ stage, at: new Date().toISOString(), detail });
  }
  renderTrace();
}

function markClientStage(stage, detail) {
  trace.clientStages.push({ stage, at: new Date().toISOString(), detail });
  renderTrace();
}

function failClientStage(message) {
  trace.failure = message;
  // Only Cloudflare's response proves the body arrived. The browser fires upload "load" once it
  // has flushed to its own socket buffer, so a failed request invalidates any completion claim.
  if (!trace.clientStages.some((entry) => entry.stage === "accepted")) {
    trace.clientStages = trace.clientStages.filter((entry) => entry.stage !== "upload_complete");
  }
  clearInterval(trace.ticker);
  trace.ticker = null;
  renderTrace();
}

function endTrace() {
  clearInterval(trace.ticker);
  trace.ticker = null;
}

/**
 * Uploads one part of a file to R2 through the Worker.
 *
 * fetch() cannot report upload progress, so this goes through XHR: on a slow connection that
 * is the difference between a visible transfer and an unexplained wait. `baseBytes` is what
 * earlier parts already sent, so progress reads as one continuous transfer.
 */
function uploadPart(url, blob, baseBytes) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);

    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) {
        return;
      }
      trace.uploadedBytes = baseBytes + event.loaded;
      trace.lastProgressAt = Date.now();
      renderTrace();
    });

    request.addEventListener("load", () => {
      let payload = {};
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        /* fall through to the status check */
      }
      if (request.status >= 200 && request.status < 300) {
        trace.uploadedBytes = baseBytes + blob.size;
        resolve(payload);
        return;
      }
      reject(new Error(payload.detail || `Upload failed with status ${request.status}.`));
    });

    request.addEventListener("error", () =>
      reject(new Error("The connection dropped during upload."))
    );
    request.addEventListener("abort", () => reject(new Error("Upload cancelled.")));
    request.addEventListener("timeout", () => reject(new Error("The upload timed out.")));

    request.send(blob);
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends a file to R2 in parts, retrying an individual part rather than the whole transfer.
 * On a slow or flaky link, losing 20 MB to a blip is recoverable; losing an hour is not.
 */
async function uploadFileInParts(file) {
  const created = await fetchJson("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, content_type: file.type }),
  });

  const partSize = created.part_size || PART_SIZE;
  const parts = [];
  let uploaded = 0;

  try {
    for (let offset = 0, number = 1; offset < file.size; offset += partSize, number += 1) {
      const blob = file.slice(offset, Math.min(offset + partSize, file.size));
      const query = new URLSearchParams({
        key: created.key,
        upload_id: created.upload_id,
        part_number: String(number),
      });

      let lastError = null;
      for (let attempt = 1; attempt <= PART_RETRIES; attempt += 1) {
        try {
          const result = await uploadPart(`/api/uploads/part?${query}`, blob, uploaded);
          parts.push({ part_number: result.part_number, etag: result.etag });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          trace.uploadedBytes = uploaded;
          if (attempt < PART_RETRIES) {
            markRetry(number, attempt, error.message);
            await wait(1000 * attempt);
          }
        }
      }
      if (lastError) {
        throw lastError;
      }

      uploaded += blob.size;
      trace.uploadedBytes = uploaded;
      renderTrace();
    }

    const completed = await fetchJson("/api/uploads/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: created.key, upload_id: created.upload_id, parts }),
    });

    return {
      key: created.key,
      filename: file.name,
      content_type: file.type || "application/octet-stream",
      size: completed.size ?? file.size,
    };
  } catch (error) {
    // Leaving a half-assembled upload behind would bill for storage nobody can reach.
    await fetch("/api/uploads/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: created.key, upload_id: created.upload_id }),
    }).catch(() => undefined);
    throw error;
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || "Request failed.");
  }
  return payload;
}

function renderKeyState(settings) {
  if (settings.api_key_saved) {
    setStatus(elements.savedKeyStatus, `Saved key: ${settings.api_key_masked}`, "success");
  } else {
    setStatus(elements.savedKeyStatus, "No saved key");
  }
  state.keytermPresets = settings.keyterm_presets || [];
  populateKeytermPresets();
}

function isTerminalStatus(status) {
  return status === "success" || status === "error" || status === "cancelled";
}

function nextPendingJob(excludedJobId = null) {
  return state.jobs.find((job) => !job.is_terminal && job.job_id !== excludedJobId) || null;
}

function toneForStatus(status) {
  if (status === "success") {
    return "success";
  }
  if (status === "error" || status === "cancelled") {
    return "error";
  }
  return "pending";
}

function remotePresenceMeta(job) {
  const status = job.remote_presence_status || "";
  if (status === "present") {
    return { label: "Remote present", tone: "success" };
  }
  if (status === "missing") {
    return { label: "Remote missing", tone: "error" };
  }
  if (status === "not_available") {
    return { label: "Remote n/a", tone: "pending" };
  }
  if (status === "unknown") {
    return { label: "Remote unknown", tone: "pending" };
  }
  return null;
}

function hiddenMeta(job) {
  if (!job.is_hidden) {
    return null;
  }
  if (job.hidden_reason === "superseded_success") {
    return { label: "Superseded", tone: "pending" };
  }
  return { label: "Hidden", tone: "pending" };
}

function updateShowHiddenButton() {
  if (!elements.showHiddenButton) {
    return;
  }
  if (state.showHidden) {
    elements.showHiddenButton.textContent = "Hide hidden";
    elements.showHiddenButton.disabled = false;
    return;
  }
  const hiddenCount = Number(state.hiddenJobCount || 0);
  elements.showHiddenButton.textContent = hiddenCount > 0 ? `Show hidden (${hiddenCount})` : "Show hidden";
  elements.showHiddenButton.disabled = hiddenCount === 0;
}

function stopElapsedTimer() {
  if (state.elapsedTimer) {
    clearInterval(state.elapsedTimer);
    state.elapsedTimer = null;
  }
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
  state.pollInFlight = false;
}

function stopUsageRefresh() {
  if (state.usageTimer) {
    clearInterval(state.usageTimer);
    state.usageTimer = null;
  }
}

function startUsageRefresh() {
  stopUsageRefresh();
  state.usageTimer = window.setInterval(() => {
    loadUsage({ silent: true });
  }, 30000);
}

function updateElapsedDisplay() {
  if (!state.elapsedAnchor) {
    elements.activityElapsed.textContent = "00:00";
    return;
  }
  const elapsed = Date.now() - state.elapsedAnchor;
  elements.activityElapsed.textContent = formatElapsed(elapsed);
}

function syncActivityClock(job) {
  const anchorValue = job.started_at || job.created_at;
  const parsed = anchorValue ? new Date(anchorValue).getTime() : null;
  state.elapsedAnchor = Number.isFinite(parsed) ? parsed : null;

  stopElapsedTimer();
  updateElapsedDisplay();

  if (!job.is_terminal && state.elapsedAnchor) {
    state.elapsedTimer = window.setInterval(updateElapsedDisplay, 1000);
  }
}

function uploadSummary() {
  const { uploadedBytes, totalBytes } = trace;
  if (!totalBytes) {
    return "No file to upload";
  }
  // Nothing useful to report until the upload is the thing that is actually happening. The size
  // is deliberately not quoted while compressing, because the figure to hand is the one before
  // compression and is not what will be sent.
  if (!trace.uploadStartedAt) {
    return trace.compressing ? "Waiting for compression to finish" : `Waiting for ${formatBytes(totalBytes)}`;
  }

  const percent = Math.min(100, Math.round((uploadedBytes / totalBytes) * 100));
  const elapsed = Math.max(1, (Date.now() - trace.uploadStartedAt) / 1000);
  const rate = uploadedBytes / elapsed;
  const parts = [`${percent}%`, `${formatBytes(uploadedBytes)} of ${formatBytes(totalBytes)}`];

  if (rate > 0 && uploadedBytes < totalBytes) {
    parts.push(`${formatBytes(rate)}/s`);
    parts.push(`~${formatDuration(((totalBytes - uploadedBytes) / rate) * 1000)} left`);
  }
  return parts.join(" · ");
}

/** Merges the browser-observed stages with the server's into one ordered, timestamped list. */
function renderTrace() {
  if (!trace.active) {
    elements.tracePanel.classList.add("hidden");
    return;
  }
  elements.tracePanel.classList.remove("hidden");

  const seen = new Map();
  for (const entry of [...trace.clientStages, ...trace.serverStages]) {
    if (!seen.has(entry.stage)) {
      seen.set(entry.stage, entry);
    }
  }

  // Only meaningful once bytes are meant to be moving. Compression can run for minutes without
  // sending anything, and warning about a dropped connection then is simply wrong.
  const uploadStalled =
    Boolean(trace.uploadStartedAt) &&
    !seen.has("upload_complete") &&
    trace.lastProgressAt &&
    Date.now() - trace.lastProgressAt > STALL_AFTER_MS;

  const steps = TRACE_STEPS.filter(
    (step) => step.key !== "audio_stored" || trace.totalBytes > 0
  )
    .filter((step) => step.key !== "audio_streaming" || trace.totalBytes > 0)
    .filter((step) => !step.key.startsWith("compress") || trace.compressing);

  const failed = Boolean(trace.failure) || seen.has("failed");

  // "uploading" is recorded when the transfer starts, so only upload_complete proves it finished.
  const isComplete = (key) => (key === "uploading" ? seen.has("upload_complete") : seen.has(key));
  const lastComplete = steps.reduce((last, step, index) => (isComplete(step.key) ? index : last), -1);
  const currentIndex = lastComplete + 1;

  elements.traceList.innerHTML = steps
    .map((step, index) => {
      const entry = seen.get(step.key);
      let state = "pending";
      let note = "";

      if (isComplete(step.key)) {
        state = "done";
        const at = new Date(entry.at);
        note = Number.isNaN(at.getTime()) ? "" : at.toLocaleTimeString();
        if (entry?.detail) {
          note = note ? `${note} · ${entry.detail}` : entry.detail;
        }
      } else if (index === currentIndex) {
        state = failed ? "failed" : "active";
        note = failed ? trace.failure || "Failed" : "";
      } else if (index === currentIndex + 1 && !failed) {
        state = "next";
      }

      if (step.key === "uploading") {
        if (isComplete("uploading")) {
          // Keep what the transfer actually cost: the point of a trace is finding the slow step.
          const took =
            new Date(seen.get("upload_complete").at).getTime() -
            (trace.uploadStartedAt ?? trace.startedAt);
          if (trace.totalBytes > 0 && Number.isFinite(took)) {
            const rate = trace.totalBytes / Math.max(1, took / 1000);
            note = `${formatBytes(trace.totalBytes)} in ${formatDuration(took)} (${formatBytes(rate)}/s)`;
          }
        } else if (failed) {
          note = trace.failure || "Failed";
        } else {
          state = uploadStalled ? "stalled" : "active";
          const recentRetry = trace.retries[trace.retries.length - 1];
          const retryNote =
            recentRetry && Date.now() - recentRetry.at < 15000
              ? ` · retrying part ${recentRetry.partNumber} (attempt ${recentRetry.attempt + 1})`
              : "";
          note = uploadStalled
            ? `No data sent for ${formatDuration(Date.now() - trace.lastProgressAt)} — the connection may have dropped`
            : uploadSummary() + retryNote;
        }
      }

      return `
        <li class="trace-step trace-${state}">
          <span class="trace-marker"></span>
          <span class="trace-label">${escapeHtml(step.label)}</span>
          <span class="trace-note">${escapeHtml(note)}</span>
        </li>
      `;
    })
    .join("");

  const total = formatDuration(Date.now() - trace.startedAt);
  elements.traceSummary.textContent = failed
    ? `Stopped after ${total}`
    : seen.has("done")
      ? `Finished in ${total}`
      : `Running for ${total}`;
}

function renderActivity(job) {
  if (!job) {
    elements.activityPanel.classList.add("hidden");
    elements.cancelJobButton.classList.add("hidden");
    stopElapsedTimer();
    return;
  }

  elements.activityPanel.classList.remove("hidden");
  elements.activityBadge.textContent = job.status.toUpperCase();
  elements.activityBadge.classList.remove("success", "error", "pending");
  elements.activityBadge.classList.add(toneForStatus(job.status));
  elements.activityDetail.textContent = job.status_detail || "Waiting for an update.";
  elements.cancelJobButton.classList.toggle("hidden", job.is_terminal);
  syncActivityClock(job);
}

function renderUsageChart(history) {
  const points = history?.points || [];
  if (!points.length) {
    elements.usageChart.innerHTML = '<p class="empty-note">No recent credit usage was returned.</p>';
    return;
  }

  const maxValue = Math.max(...points.map((point) => Number(point.value || 0)), 0);
  elements.usageChart.innerHTML = points
    .map((point) => {
      const width = maxValue > 0 ? `${Math.max((Number(point.value || 0) / maxValue) * 100, 2)}%` : "0%";
      const label = point.timestamp_iso ? new Date(point.timestamp_iso).toLocaleDateString() : "Recent";
      return `
        <div class="usage-row">
          <span class="usage-row-label">${escapeHtml(label)}</span>
          <div class="usage-bar-track">
            <div class="usage-bar-fill" style="width: ${escapeHtml(width)}"></div>
          </div>
          <span class="usage-row-value">${escapeHtml(formatNumber(point.value))}</span>
        </div>
      `;
    })
    .join("");
}

function renderUsage(payload) {
  const subscription = payload.subscription || {};
  const history = payload.history || {};
  elements.usagePanel.classList.remove("hidden");
  setStatus(
    elements.usageStatus,
    "Account-level credits from ElevenLabs. Active job costs may appear here after processing completes."
  );
  elements.usageRemaining.textContent = formatNumber(subscription.credits_remaining);
  elements.usageUsed.textContent = formatNumber(subscription.credits_used);
  elements.usageLimit.textContent = formatNumber(subscription.credits_limit);
  elements.usageReset.textContent = formatDateTime(subscription.next_reset_at);
  elements.usageTier.textContent = `Tier: ${subscription.tier || "Unknown"}`;
  elements.usageUpdated.textContent = `Updated: ${formatDateTime(payload.fetched_at)}`;
  elements.usageChartTotal.textContent = `7-day total: ${formatNumber(history.total)}`;
  renderUsageChart(history);
}

function resetUsagePanel(message, tone = "") {
  elements.usagePanel.classList.add("hidden");
  elements.usageChart.innerHTML = "";
  elements.usageChartTotal.textContent = "-";
  elements.usageRemaining.textContent = "-";
  elements.usageUsed.textContent = "-";
  elements.usageLimit.textContent = "-";
  elements.usageReset.textContent = "-";
  elements.usageTier.textContent = "Tier: -";
  elements.usageUpdated.textContent = "Updated: -";
  setStatus(elements.usageStatus, message, tone);
}

// The Worker stores the ElevenLabs response untouched, so everything shown below -- the
// transcript, timeline, speaker profiles, and every export -- is derived here in the browser.

async function loadTranscriptResponse(job) {
  if (state.transcriptCache.has(job.job_id)) {
    return state.transcriptCache.get(job.job_id);
  }
  const response = await fetch(job.transcript_url);
  if (!response.ok) {
    throw new Error("Could not load the stored transcript.");
  }
  const parsed = await response.json();
  state.transcriptCache.set(job.job_id, parsed);
  return parsed;
}

async function attachTranscriptData(job) {
  if (job.status !== "success" || !job.transcript_url) {
    job.transcript_response = null;
    job.transcript_text = null;
    job.named_transcript_text = null;
    job.timeline_entries = [];
    job.audio_events = [];
    job.entities = [];
    job.speaker_profiles = [];
    return job;
  }

  const response = await loadTranscriptResponse(job);
  const names = job.speaker_name_map || {};
  const hasNames = Object.keys(names).length > 0;
  const T = window.TranscriptUtils;

  job.transcript_response = response;
  job.transcript_text = T.formatTranscriptText(response);
  job.named_transcript_text = hasNames ? T.formatTranscriptText(response, names) : null;
  job.timeline_entries = T.buildTimelineEntries(response, 200, hasNames ? names : null);
  job.audio_events = T.extractAudioEvents(response);
  job.entities = T.extractEntities(response);
  job.speaker_profiles = T.buildSpeakerProfiles(response, names);
  return job;
}

function renderExportControls(target, job, named) {
  target.innerHTML = "";
  if (!job.transcript_response) {
    return;
  }

  const speakerNames = named ? job.speaker_name_map || {} : null;
  const stem = named ? "named-transcript" : "transcript";

  // Every control is a button so the save location can be chosen; a plain link would go
  // straight to the download folder.
  const definitions = [
    ...(named
      ? []
      : [{ label: "Raw JSON", run: () => window.Exporters.downloadRaw(job.transcript_url, `${stem}.json`) }]),
    ...window.Exporters.FORMATS.map((definition) => ({
      label: named ? `Named ${definition.label}` : definition.label,
      run: () =>
        window.Exporters.download(
          definition.format,
          job.transcript_response,
          speakerNames,
          job.export_metadata || {},
          stem
        ),
    })),
  ];

  for (const definition of definitions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "download-link";
    button.textContent = definition.label;
    button.addEventListener("click", async () => {
      const original = button.textContent;
      button.disabled = true;
      button.textContent = "Saving...";
      try {
        await definition.run();
      } catch (error) {
        setStatus(elements.formStatus, error.message || "Could not build that export.", "error");
      } finally {
        button.textContent = original;
        button.disabled = false;
      }
    });
    target.appendChild(button);
  }
}

function renderTimeline(entries, target, emptyMessage) {
  target.innerHTML = "";
  if (entries && entries.length) {
    entries.forEach((entry) => {
      const article = document.createElement("article");
      article.className = "timeline-entry";
      article.innerHTML = `
        <header>
          <span>${escapeHtml(entry.speaker || "Transcript")}</span>
          <span>${escapeHtml(formatTimestamp(entry.start))} - ${escapeHtml(formatTimestamp(entry.end))}</span>
        </header>
        <div>${escapeHtml(entry.text)}</div>
      `;
      target.appendChild(article);
    });
    return;
  }
  target.innerHTML = `<p class="empty-note">${escapeHtml(emptyMessage)}</p>`;
}

function renderEntities(entities) {
  if (!entities || !entities.length) {
    elements.entitiesList.innerHTML = '<p class="empty-note">No entity data was returned for this job.</p>';
    return;
  }

  elements.entitiesList.innerHTML = entities
    .map((entity) => {
      const hasRange = entity.start !== null && entity.start !== undefined && entity.end !== null && entity.end !== undefined;
      const range = hasRange ? `${entity.start} - ${entity.end}` : "Range unavailable";
      return `
        <article class="entity-item">
          <span class="entity-meta">${escapeHtml(entity.label || "Entity")} | ${escapeHtml(range)}</span>
          <div>${escapeHtml(entity.text)}</div>
        </article>
      `;
    })
    .join("");
}

function renderSpeakerProfiles(job) {
  const profiles = job.speaker_profiles || [];
  elements.speakerProfiles.innerHTML = "";

  if (!profiles.length) {
    elements.speakerNamingState.textContent = job.status === "success"
      ? "No diarized speakers were returned for this job."
      : "Speaker naming will appear once a diarized transcript is available.";
    elements.speakerNamingState.classList.remove("hidden");
    elements.speakerActions.classList.add("hidden");
    return;
  }

  elements.speakerNamingState.classList.add("hidden");
  profiles.forEach((profile) => {
    const article = document.createElement("article");
    article.className = "speaker-profile";
    article.innerHTML = `
      <div class="speaker-profile-header">
        <strong>${escapeHtml(profile.speaker_label)}</strong>
        <span class="pill">${escapeHtml(profile.assigned_name || "Unnamed")}</span>
      </div>
      <label class="field">
        <span>Name</span>
        <input type="text" data-speaker-key="${escapeHtml(profile.speaker_key)}" value="${escapeHtml(profile.assigned_name || "")}" placeholder="Enter a name for ${escapeHtml(profile.speaker_label)}">
      </label>
      <div class="quote-list">
        ${(profile.quotes || [])
          .map(
            (quote) => `
              <article class="quote-item">
                <time>${escapeHtml(formatTimestamp(quote.start))} - ${escapeHtml(formatTimestamp(quote.end))}</time>
                <div>${escapeHtml(quote.text)}</div>
              </article>
            `
          )
          .join("")}
      </div>
    `;
    elements.speakerProfiles.appendChild(article);
  });

  elements.speakerActions.classList.remove("hidden");
  elements.clearSpeakerNamesButton.disabled = !profiles.some((profile) => profile.assigned_name);
}

function currentSpeakerNameMap() {
  const mapping = {};
  elements.speakerProfiles.querySelectorAll("input[data-speaker-key]").forEach((input) => {
    const key = input.getAttribute("data-speaker-key");
    const value = input.value.trim();
    if (key && value) {
      mapping[key] = value;
    }
  });
  return mapping;
}

function renderHistory() {
  elements.historyList.innerHTML = "";
  if (state.jobs.length === 0) {
    elements.historyList.innerHTML = state.hiddenJobCount > 0 && !state.showHidden
      ? '<li class="empty-note">No visible jobs. Use "Show hidden" to review hidden or superseded entries.</li>'
      : '<li class="empty-note">No jobs yet.</li>';
    return;
  }

  state.jobs.forEach((job) => {
    const batchLabel = job.batch_count > 1 ? `Batch ${job.batch_index}/${job.batch_count}` : "";
    const remoteMeta = remotePresenceMeta(job);
    const hidden = hiddenMeta(job);
    const item = document.createElement("li");
    item.innerHTML = `
        <button class="history-item ${job.job_id === state.activeJobId ? "active" : ""}" type="button" data-job-id="${job.job_id}">
          <strong>${escapeHtml(job.source_label)}</strong>
          <div>${escapeHtml(formatDateTime(job.created_at))}</div>
          <div class="history-meta">
            <span class="pill ${toneForStatus(job.status)}">${escapeHtml(job.status)}</span>
            <span class="pill">${escapeHtml(job.audio_type)}</span>
            <span class="pill">${escapeHtml(job.model)}</span>
            ${batchLabel ? `<span class="pill">${escapeHtml(batchLabel)}</span>` : ""}
            ${remoteMeta ? `<span class="pill ${remoteMeta.tone}">${escapeHtml(remoteMeta.label)}</span>` : ""}
            ${hidden ? `<span class="pill ${hidden.tone}">${escapeHtml(hidden.label)}</span>` : ""}
          </div>
      </button>
    `;
    elements.historyList.appendChild(item);
  });

  elements.historyList.querySelectorAll("[data-job-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const jobId = button.getAttribute("data-job-id");
      await openJob(jobId);
    });
  });
}

function setResultsPlaceholder(title, body) {
  elements.resultsEmptyTitle.textContent = title;
  elements.resultsEmptyBody.textContent = body;
}

function clearResults({ title, body } = {}) {
  state.activeJobId = null;
  renderHistory();
  renderActivity(null);
  elements.resultsPanel.classList.add("hidden");
  elements.resultsEmptyState.classList.remove("hidden");
  setResultsPlaceholder(
    title ?? "No transcript loaded",
    body ?? "Run a transcription or reopen one from history to see the transcript, exports, and timecoded entries."
  );
  elements.resultMeta.textContent = "";
  elements.metadataGrid.innerHTML = "";
  elements.downloads.innerHTML = "";
  elements.namedDownloads.innerHTML = "";
  elements.transcriptText.textContent = "";
  elements.namedTranscriptText.textContent = "";
  elements.timelineEntries.innerHTML = "";
  elements.audioEvents.innerHTML = "";
  elements.entitiesList.innerHTML = '<p class="empty-note">No entity data was returned for this job.</p>';
  elements.speakerProfiles.innerHTML = "";
  elements.speakerNamingState.textContent = "Speaker naming will appear once a diarized transcript is available.";
  elements.speakerNamingState.classList.remove("hidden");
  elements.speakerActions.classList.add("hidden");
  elements.namedTranscriptPanel.classList.add("hidden");
  elements.deletePanel.classList.add("hidden");
  if (elements.hideJobButton) {
    elements.hideJobButton.textContent = "Hide from list";
    elements.hideJobButton.disabled = true;
  }
}

async function renderJob(job) {
  state.activeJobId = job.job_id;
  if (trace.active && Array.isArray(job.stages)) {
    trace.serverStages = job.stages;
    if (job.is_terminal) {
      endTrace();
    }
    renderTrace();
  }
  renderHistory();
  try {
    await attachTranscriptData(job);
  } catch (error) {
    setStatus(elements.formStatus, error.message, "error");
  }
  renderActivity(job);
  elements.resultsEmptyState.classList.add("hidden");
  elements.resultsPanel.classList.remove("hidden");

  const effective = job.effective_settings || {};
  const detectedLanguage = job.detected_language || "Unknown";
  elements.resultMeta.textContent = `${job.status.toUpperCase()} - ${job.source_label}`;
  const metadata = [
    ["Created", formatDateTime(job.created_at)],
    ["Started", formatDateTime(job.started_at)],
    ["Completed", formatDateTime(job.completed_at)],
    ["Model", job.model],
    ["Preset", job.audio_type],
    ["Requested language", job.language || "Auto detect"],
    ["Detected language", detectedLanguage],
    ["Source type", job.source_type],
    ["Entity detection", (effective.entity_detection || []).join(", ") || "Off"],
    ["Zero retention", effective.enable_logging === false ? "On" : "Off"],
  ];
  if (job.remote_deleted_at) {
    metadata.push(["Deleted from ElevenLabs", formatDateTime(job.remote_deleted_at)]);
  }
  if (job.remote_presence_status) {
    metadata.push(["Remote record", job.remote_presence_status]);
  }
  if (job.remote_presence_checked_at) {
    metadata.push(["Remote checked", formatDateTime(job.remote_presence_checked_at)]);
  }
  if (job.remote_presence_message) {
    metadata.push(["Remote note", job.remote_presence_message]);
  }
  if (job.is_hidden) {
    metadata.push(["Hidden from list", "Yes"]);
  }
  if (job.hidden_reason === "superseded_success") {
    metadata.push(["Hidden reason", "Superseded by a newer successful attempt"]);
  } else if (job.hidden_reason === "manual") {
    metadata.push(["Hidden reason", "Manually hidden"]);
  }
  if (job.hidden_at) {
    metadata.push(["Hidden at", formatDateTime(job.hidden_at)]);
  }
  if (job.hidden_message) {
    metadata.push(["Hidden note", job.hidden_message]);
  }
  if (job.batch_count > 1) {
    metadata.splice(4, 0, ["Batch", `${job.batch_index} of ${job.batch_count}`]);
  }
  for (let index = 0; index < metadata.length; index += 1) {
    const [label, value] = metadata[index];
    metadata[index] = [label, value || "-"];
  }
  elements.metadataGrid.innerHTML = metadata
    .map(
      ([label, value]) => `
        <div>
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(value || "-")}</dd>
        </div>
      `
    )
    .join("");

  elements.transcriptText.textContent = job.transcript_text || job.error_message || "Transcript unavailable.";
  if (job.status === "success") {
    elements.transcriptText.textContent = job.transcript_text || "Transcript unavailable.";
  } else if (job.status === "error" || job.status === "cancelled") {
    elements.transcriptText.textContent = job.error_message || job.status_detail || "The transcription failed.";
  } else {
    elements.transcriptText.textContent = `${job.status_detail || "The transcription is still in progress."}\n\nThis batch endpoint does not expose a true percent-complete value, so the app tracks job stages and elapsed time instead.`;
  }

  renderExportControls(elements.downloads, job, false);
  renderTimeline(
    job.timeline_entries,
    elements.timelineEntries,
    job.is_terminal
      ? "No timecoded entries were returned for this job."
      : "Timecoded entries will appear here after the transcript has been received."
  );
  renderTimeline(job.audio_events, elements.audioEvents, "No audio events were returned for this job.");
  renderEntities(job.entities);
  renderSpeakerProfiles(job);

  const remoteAvailable = Boolean(job.transcription_id);
  elements.deletePanel.classList.toggle("hidden", !job.is_terminal);
  elements.verifyRemoteButton.disabled = !job.is_terminal;
  elements.hideJobButton.disabled = !job.is_terminal;
  elements.hideJobButton.textContent = job.is_hidden ? "Show in list" : "Hide from list";
  elements.deleteLocalButton.disabled = !job.is_terminal;
  elements.deleteRemoteButton.disabled = !job.is_terminal || !remoteAvailable;
  elements.deleteBothButton.disabled = !job.is_terminal || !remoteAvailable;
  if (!job.is_terminal) {
    elements.deleteHelpText.textContent = "Finish or cancel the job before deleting any data.";
  } else if (job.is_hidden) {
    elements.deleteHelpText.textContent = "This job is currently hidden from Recent Jobs. You can show it again, verify the ElevenLabs copy, or delete stored data.";
  } else if (remoteAvailable) {
    elements.deleteHelpText.textContent = "You can hide this job from Recent Jobs, or choose whether to delete the local copy, the ElevenLabs transcript, or both.";
  } else {
    elements.deleteHelpText.textContent = "You can hide this job from Recent Jobs. This job no longer has a stored ElevenLabs transcript ID, so only local deletion is available.";
  }

  if (job.named_transcript_text) {
    elements.namedTranscriptPanel.classList.remove("hidden");
    elements.namedTranscriptText.textContent = job.named_transcript_text;
    renderExportControls(elements.namedDownloads, job, true);
  } else {
    elements.namedTranscriptPanel.classList.add("hidden");
    elements.namedTranscriptText.textContent = "";
    elements.namedDownloads.innerHTML = "";
  }
}

async function openJob(jobId) {
  if (trace.active && jobId !== state.activeJobId) {
    trace.active = false;
    endTrace();
    renderTrace();
  }
  const job = await fetchJson(`/api/jobs/${jobId}`);
  await renderJob(job);
  if (job.is_terminal) {
    stopPolling();
  } else {
    startPolling(jobId);
  }
}

async function loadSettings() {
  const settings = await fetchJson("/api/settings");
  if (Number.isFinite(settings.max_upload_bytes) && settings.max_upload_bytes > 0) {
    maxUploadBytes = settings.max_upload_bytes;
  }
  renderKeyState(settings);
  applyDefaults(settings.last_used_defaults);
  return settings;
}

async function loadUsage({ silent = false } = {}) {
  if (!silent) {
    setStatus(elements.usageStatus, "Loading usage...");
  }

  try {
    const payload = await fetchJson("/api/usage");
    renderUsage(payload);
    startUsageRefresh();
  } catch (error) {
    stopUsageRefresh();
    resetUsagePanel(
      error.message || "Could not load usage right now.",
      error.message?.includes("Save an ElevenLabs API key") ? "" : "error"
    );
  }
}

async function loadJobs(preferredJobId = state.activeJobId) {
  const payload = await fetchJson(`/api/jobs?include_hidden=${state.showHidden ? "true" : "false"}`);
  state.jobs = payload.jobs || [];
  state.hiddenJobCount = payload.hidden_count || 0;
  updateShowHiddenButton();
  if (preferredJobId && state.jobs.some((job) => job.job_id === preferredJobId)) {
    state.activeJobId = preferredJobId;
  } else {
    state.activeJobId = null;
  }
  renderHistory();
  if (state.jobs.length > 0 && !state.activeJobId) {
    await openJob(state.jobs[0].job_id);
  } else if (state.jobs.length === 0) {
    clearResults();
  }
}

async function deleteJobData(deleteLocal, deleteRemote) {
  if (!state.activeJobId) {
    return;
  }

  const actionLabel = deleteLocal && deleteRemote
    ? "delete the local copy and the ElevenLabs transcript"
    : deleteLocal
      ? "delete the local copy"
      : "delete the ElevenLabs transcript";
  const confirmed = window.confirm(
    `Are you sure you want to ${actionLabel} for this job? This cannot be undone.`
  );
  if (!confirmed) {
    return;
  }

  try {
    const payload = await fetchJson(`/api/jobs/${state.activeJobId}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delete_local: deleteLocal, delete_remote: deleteRemote }),
    });
    state.transcriptCache.delete(state.activeJobId);
    setStatus(elements.formStatus, payload.message || "Deletion completed.", "success");
    await loadJobs();
    if (payload.job_removed) {
      const nextJob = state.jobs[0] || null;
      if (nextJob) {
        await openJob(nextJob.job_id);
      } else {
        clearResults();
      }
      return;
    }
    if (payload.job) {
      renderJob(payload.job);
    }
  } catch (error) {
    setStatus(elements.formStatus, error.message, "error");
  }
}

async function setJobHidden(hidden) {
  if (!state.activeJobId) {
    return;
  }

  const confirmed = hidden
    ? window.confirm("Hide this job from Recent Jobs? The transcript will stay saved and you can still review it later by showing hidden jobs.")
    : window.confirm("Show this job in Recent Jobs again?");
  if (!confirmed) {
    return;
  }

  try {
    const payload = await fetchJson(`/api/jobs/${state.activeJobId}/visibility`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden }),
    });
    const updatedJob = payload.job;
    await loadJobs(hidden && !state.showHidden ? null : updatedJob.job_id);
    if (hidden && !state.showHidden) {
      if (state.jobs.length === 0) {
        clearResults();
      }
    } else if (updatedJob) {
      renderJob(updatedJob);
    }
    setStatus(elements.formStatus, payload.message || (hidden ? "Hidden from Recent Jobs." : "Restored to Recent Jobs."), "success");
  } catch (error) {
    setStatus(elements.formStatus, error.message, "error");
  }
}

async function verifyRemoteForActiveJob() {
  if (!state.activeJobId) {
    return;
  }
  try {
    setStatus(elements.formStatus, "Checking ElevenLabs for this transcript...");
    const job = await fetchJson(`/api/jobs/${state.activeJobId}/verify-remote`, {
      method: "POST",
    });
    renderJob(job);
    await loadJobs(job.job_id);
    setStatus(elements.formStatus, job.remote_presence_message || "Finished checking ElevenLabs.", "success");
  } catch (error) {
    setStatus(elements.formStatus, error.message, "error");
  }
}

async function auditRemoteJobs() {
  try {
    setStatus(elements.formStatus, "Checking locally known transcript IDs against ElevenLabs...");
    const payload = await fetchJson("/api/jobs/audit-remote", {
      method: "POST",
    });
    await loadJobs(state.activeJobId);
    if (state.activeJobId && state.jobs.some((job) => job.job_id === state.activeJobId)) {
      await openJob(state.activeJobId);
    }
    setStatus(elements.formStatus, payload.message || "Finished auditing ElevenLabs records.", "success");
  } catch (error) {
    setStatus(elements.formStatus, error.message, "error");
  }
}

function buildSubmission(uploads) {
  const mode = activeSourceMode();
  return {
    source_mode: mode,
    uploads: mode === "upload" ? uploads : [],
    cloud_storage_url: mode === "url" ? elements.urlInput.value.trim() : "",
    model_id: elements.modelSelect.value,
    language_code: elements.languageInput.value.trim(),
    audio_type: elements.audioTypeSelect.value,
    timestamps_granularity: elements.timestampsSelect.value,
    diarize: elements.diarizeInput.checked ? "true" : "false",
    tag_audio_events: elements.tagAudioEventsInput.checked ? "true" : "false",
    use_multi_channel: elements.multiChannelInput.checked ? "true" : "false",
    no_verbatim: elements.noVerbatimInput.checked ? "true" : "false",
    zero_retention: elements.zeroRetentionInput.checked ? "true" : "false",
    num_speakers: elements.numSpeakersInput.value.trim(),
    diarization_threshold: elements.diarizationThresholdInput.value.trim(),
    keyterms: elements.keytermsInput.value.trim(),
    entity_detection_custom: elements.entityDetectionCustomInput.value.trim(),
    entity_detection: selectedEntityDetection(),
  };
}

async function pollJobOnce(jobId) {
  if (state.pollInFlight) {
    return;
  }
  state.pollInFlight = true;
  try {
    const job = await fetchJson(`/api/jobs/${jobId}`);
    await renderJob(job);
    await loadJobs(jobId);
    if (job.is_terminal) {
      const pendingJob = nextPendingJob(jobId);
      await loadUsage({ silent: true });
      if (pendingJob && state.activeJobId === jobId) {
        setStatus(
          elements.formStatus,
          `${job.status.toUpperCase()}: ${job.status_detail || "Finished."} Continuing with ${pendingJob.source_label}.`
        );
        await openJob(pendingJob.job_id);
      } else {
        stopPolling();
        elements.transcribeButton.disabled = false;
        if (job.status === "success") {
          setStatus(elements.formStatus, "Transcription completed.", "success");
        } else {
          setStatus(elements.formStatus, job.error_message || job.status_detail || "Transcription ended.", "error");
        }
      }
    } else {
      setStatus(elements.formStatus, `${job.status.toUpperCase()}: ${job.status_detail || "Working..."}`);
    }
  } catch (error) {
    stopPolling();
    elements.transcribeButton.disabled = false;
    setStatus(elements.formStatus, error.message, "error");
  } finally {
    state.pollInFlight = false;
  }
}

function startPolling(jobId) {
  stopPolling();
  pollJobOnce(jobId);
  state.pollTimer = window.setInterval(() => {
    pollJobOnce(jobId);
  }, 2000);
}

elements.apiKeyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(elements.savedKeyStatus, "Saving key...");
  try {
    const payload = await fetchJson("/api/settings/api-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: elements.apiKeyInput.value.trim() }),
    });
    elements.apiKeyInput.value = "";
    setStatus(elements.savedKeyStatus, `Saved key: ${payload.masked}`, "success");
    await loadUsage();
  } catch (error) {
    setStatus(elements.savedKeyStatus, error.message, "error");
  }
});

elements.removeKeyButton.addEventListener("click", async () => {
  setStatus(elements.savedKeyStatus, "Removing key...");
  try {
    await fetchJson("/api/settings/api-key", { method: "DELETE" });
    setStatus(elements.savedKeyStatus, "No saved key");
    stopUsageRefresh();
    resetUsagePanel("Save an API key to load usage.");
  } catch (error) {
    setStatus(elements.savedKeyStatus, error.message, "error");
  }
});

elements.cancelJobButton.addEventListener("click", async () => {
  if (!state.activeJobId) {
    return;
  }
  try {
    const job = await fetchJson(`/api/jobs/${state.activeJobId}/cancel`, { method: "POST" });
    renderJob(job);
    stopPolling();
    elements.transcribeButton.disabled = false;
    setStatus(elements.formStatus, job.status_detail || "Job cancelled.", "error");
    await loadJobs(job.job_id);
  } catch (error) {
    setStatus(elements.formStatus, error.message, "error");
  }
});

elements.deleteLocalButton.addEventListener("click", async () => {
  await deleteJobData(true, false);
});

elements.verifyRemoteButton.addEventListener("click", async () => {
  await verifyRemoteForActiveJob();
});

elements.hideJobButton.addEventListener("click", async () => {
  const activeJob = state.jobs.find((job) => job.job_id === state.activeJobId);
  const shouldHide = !(activeJob && activeJob.is_hidden);
  await setJobHidden(shouldHide);
});

elements.deleteRemoteButton.addEventListener("click", async () => {
  await deleteJobData(false, true);
});

elements.deleteBothButton.addEventListener("click", async () => {
  await deleteJobData(true, true);
});

elements.loadKeytermPresetButton.addEventListener("click", () => {
  const preset = state.keytermPresets.find((item) => item.name === elements.keytermPresetSelect.value);
  if (!preset) {
    return;
  }
  elements.keytermsInput.value = (preset.terms || []).join("\n");
});

elements.saveKeytermPresetButton.addEventListener("click", async () => {
  const terms = parseTerms(elements.keytermsInput.value);
  const proposedName = elements.keytermPresetSelect.value || "";
  const name = window.prompt("Preset name", proposedName);
  if (!name) {
    return;
  }
  try {
    const payload = await fetchJson("/api/keyterm-presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, terms }),
    });
    state.keytermPresets = payload.presets || [];
    populateKeytermPresets();
    elements.keytermPresetSelect.value = name;
    setStatus(elements.formStatus, `Saved keyterm preset: ${name}`, "success");
  } catch (error) {
    setStatus(elements.formStatus, error.message, "error");
  }
});

elements.deleteKeytermPresetButton.addEventListener("click", async () => {
  const name = elements.keytermPresetSelect.value;
  if (!name) {
    return;
  }
  try {
    const payload = await fetchJson(`/api/keyterm-presets/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
    state.keytermPresets = payload.presets || [];
    populateKeytermPresets();
    setStatus(elements.formStatus, `Deleted keyterm preset: ${name}`, "success");
  } catch (error) {
    setStatus(elements.formStatus, error.message, "error");
  }
});

elements.saveSpeakerNamesButton.addEventListener("click", async () => {
  if (!state.activeJobId) {
    return;
  }
  try {
    const payload = await fetchJson(`/api/jobs/${state.activeJobId}/speaker-names`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speaker_names: currentSpeakerNameMap() }),
    });
    renderJob(payload);
    setStatus(elements.formStatus, "Saved speaker names and regenerated named transcript.", "success");
  } catch (error) {
    setStatus(elements.formStatus, error.message, "error");
  }
});

elements.clearSpeakerNamesButton.addEventListener("click", async () => {
  if (!state.activeJobId) {
    return;
  }
  try {
    const payload = await fetchJson(`/api/jobs/${state.activeJobId}/speaker-names`, {
      method: "DELETE",
    });
    renderJob(payload);
    setStatus(elements.formStatus, "Cleared saved speaker names.", "success");
  } catch (error) {
    setStatus(elements.formStatus, error.message, "error");
  }
});

elements.sourceModeInputs.forEach((input) => {
  input.addEventListener("change", updateSourcePanels);
});

elements.audioTypeSelect.addEventListener("change", () => {
  applyPreset(elements.audioTypeSelect.value);
});
elements.modelSelect.addEventListener("change", syncControls);
elements.multiChannelInput.addEventListener("change", syncControls);
elements.diarizeInput.addEventListener("change", syncControls);
elements.numSpeakersInput.addEventListener("input", syncControls);
elements.refreshHistoryButton.addEventListener("click", async () => {
  await loadJobs();
});
elements.showHiddenButton.addEventListener("click", async () => {
  if (!state.showHidden && state.hiddenJobCount === 0) {
    return;
  }
  state.showHidden = !state.showHidden;
  updateShowHiddenButton();
  await loadJobs();
});
elements.auditRemoteButton.addEventListener("click", async () => {
  await auditRemoteJobs();
});
elements.refreshUsageButton.addEventListener("click", async () => {
  await loadUsage();
});

elements.transcriptionForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const files = activeSourceMode() === "upload" ? [...elements.fileInput.files] : [];
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  // A tab left open across a deploy is still holding whatever limit applied when it loaded, and
  // the end of a long upload is the worst possible moment to discover that. One small request
  // first, so the file is measured against what the server enforces right now.
  if (files.length) {
    try {
      const fresh = await fetchJson("/api/settings");
      if (Number.isFinite(fresh.max_upload_bytes) && fresh.max_upload_bytes > 0) {
        maxUploadBytes = fresh.max_upload_bytes;
      }
    } catch {
      // Not worth refusing to start over: fall back to the limit we already have.
    }
  }

  // Whether anything will be re-encoded decides what the first progress step should say.
  const willCompress = files.some((file) => compressionPlanFor(file, maxUploadBytes).compress);

  // The size check happens after compression, since compressing is exactly how an oversize file
  // is meant to get under the limit. Only a file that is still too large afterwards is refused.
  if (!willCompress) {
    const oversized = files.find((file) => file.size > maxUploadBytes);
    if (oversized) {
      setStatus(elements.formStatus, oversizeMessage(oversized), "error");
      return;
    }
  }

  elements.transcribeButton.disabled = true;
  // Clear before the trace starts: clearResults hides the activity panel that beginTrace shows.
  clearResults({
    title: "Starting a new transcription",
    body: "The transcript will appear here once this job finishes. Progress is shown under the button above.",
  });
  beginTrace(totalBytes, files.length, { compressing: willCompress });

  // Held outside the try so the catch can throw away audio that no job will ever read.
  const uploads = [];

  try {
    let pending = files;
    if (willCompress) {
      pending = await compressFiles(files, maxUploadBytes);
      const stillTooBig = pending.find((file) => file.size > maxUploadBytes);
      if (stillTooBig) {
        throw new Error(
          `${stillTooBig.name} is still ${formatBytes(stillTooBig.size)} after compressing. ` +
            `Try a lower quality setting, or shorten the recording.`
        );
      }
      const before = files.reduce((sum, file) => sum + file.size, 0);
      const after = pending.reduce((sum, file) => sum + file.size, 0);
      markClientStage("compression_done", `${formatBytes(before)} to ${formatBytes(after)}`);
      // The upload bar measures the bytes actually going out, not what was picked, and its clock
      // and stall detector only start now that something is genuinely being sent.
      trace.totalBytes = after;
      trace.uploadStartedAt = Date.now();
      trace.lastProgressAt = Date.now();
      markClientStage("uploading");
      setStatus(elements.formStatus, "Uploading to Cloudflare...");
      elements.activityBadge.textContent = "UPLOADING";
      elements.activityDetail.textContent = `Sending ${formatBytes(after)} to Cloudflare.`;
    }

    // The audio goes to R2 first, in parts, so no single request carries the whole file.
    for (const file of pending) {
      uploads.push(await uploadFileInParts(file));
    }
    if (files.length) {
      markClientStage("upload_complete", "Stored on Cloudflare");
    }

    const payload = await fetchJson("/api/transcriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSubmission(uploads)),
    });
    markClientStage("accepted", "Cloudflare accepted the job");
    const queuedJobs = payload.jobs || [payload];
    const primaryJob = queuedJobs[0];
    renderJob(primaryJob);
    await loadJobs(primaryJob.job_id);
    await loadUsage({ silent: true });
    if (payload.batch_submitted) {
      setStatus(
        elements.formStatus,
        payload.status_detail || `Queued ${queuedJobs.length} transcription jobs.`
      );
    } else {
      setStatus(
        elements.formStatus,
        `${primaryJob.status.toUpperCase()}: ${primaryJob.status_detail || "Working..."}`
      );
    }
    if (primaryJob.is_terminal) {
      elements.transcribeButton.disabled = false;
    } else {
      startPolling(primaryJob.job_id);
    }
  } catch (error) {
    // The upload succeeds and the submission that would have claimed it fails: without this the
    // whole file stays in the bucket for good, with nothing left that refers to it.
    await Promise.all(
      uploads.map((upload) =>
        fetch("/api/uploads/abort", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: upload.key }),
        }).catch(() => undefined)
      )
    );
    elements.transcribeButton.disabled = false;
    failClientStage(error.message);
    setStatus(elements.formStatus, error.message, "error");
  }
});

window.addEventListener("DOMContentLoaded", async () => {
  updateSourcePanels();
  syncControls();
  elements.fileInput?.addEventListener("change", refreshCompressionHint);
  elements.compressionMode?.addEventListener("change", refreshCompressionHint);
  elements.compressionBitrate?.addEventListener("change", refreshCompressionHint);
  refreshCompressionHint();
  try {
    const settings = await loadSettings();
    if (settings.api_key_saved) {
      await loadUsage({ silent: true });
    } else {
      resetUsagePanel("Save an API key to load usage.");
    }
    await loadJobs();
    if (state.activeJobId && state.jobs.some((job) => job.job_id === state.activeJobId && !job.is_terminal)) {
      startPolling(state.activeJobId);
    }
  } catch (error) {
    setStatus(elements.formStatus, error.message, "error");
  }
});
