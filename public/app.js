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
  cancelJobButton: document.getElementById("cancelJobButton"),
  historyList: document.getElementById("historyList"),
  refreshHistoryButton: document.getElementById("refreshHistoryButton"),
  showHiddenButton: document.getElementById("showHiddenButton"),
  auditRemoteButton: document.getElementById("auditRemoteButton"),
  resultsPanel: document.getElementById("resultsPanel"),
  resultsEmptyState: document.getElementById("resultsEmptyState"),
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

// Cloudflare returns 413 above this, whatever the plan's other limits are.
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const STALL_AFTER_MS = 20000;

// Ordered pipeline. Client stages are observed in the browser; server stages arrive on the
// job record. Without this, a slow upload and a dead connection look identical.
const TRACE_STEPS = [
  { key: "uploading", label: "Uploading to Cloudflare", side: "client" },
  { key: "accepted", label: "Accepted by Cloudflare", side: "client" },
  { key: "audio_stored", label: "Audio saved to storage", side: "server" },
  { key: "queued", label: "Queued for processing", side: "server" },
  { key: "picked_up", label: "Picked up by a worker", side: "server" },
  { key: "audio_loaded", label: "Audio loaded from storage", side: "server" },
  { key: "sent_to_elevenlabs", label: "Sent to ElevenLabs", side: "server" },
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
  stalled: false,
  clientStages: [],
  serverStages: [],
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

function beginTrace(totalBytes, fileCount) {
  trace.active = true;
  trace.startedAt = Date.now();
  trace.totalBytes = totalBytes;
  trace.fileCount = fileCount;
  trace.uploadedBytes = 0;
  trace.lastProgressAt = Date.now();
  trace.stalled = false;
  trace.clientStages = [{ stage: "uploading", at: new Date().toISOString() }];
  trace.serverStages = [];
  trace.failure = null;

  // Reset the header too, or it keeps showing the previous job's outcome mid-upload.
  elements.activityPanel.classList.remove("hidden");
  elements.activityBadge.textContent = totalBytes > 0 ? "UPLOADING" : "SUBMITTING";
  elements.activityBadge.classList.remove("success", "error", "pending");
  elements.activityBadge.classList.add("pending");
  elements.activityDetail.textContent =
    totalBytes > 0
      ? `Sending ${fileCount} file${fileCount === 1 ? "" : "s"} (${formatBytes(totalBytes)}) to Cloudflare.`
      : "Submitting the job.";
  elements.cancelJobButton.classList.add("hidden");
  stopElapsedTimer();
  state.elapsedAnchor = trace.startedAt;
  updateElapsedDisplay();
  state.elapsedTimer = window.setInterval(updateElapsedDisplay, 1000);

  clearInterval(trace.ticker);
  trace.ticker = window.setInterval(renderTrace, 1000);
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
 * fetch() cannot report upload progress, so submissions go through XHR. On a slow connection
 * this is the difference between a visible transfer and an unexplained wait.
 */
function uploadWithProgress(url, formData, totalBytes) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);

    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) {
        return;
      }
      trace.uploadedBytes = event.loaded;
      trace.lastProgressAt = Date.now();
      trace.stalled = false;
      renderTrace();
    });

    // Completion comes from this event alone. A dropped socket makes Chromium emit a final
    // progress event claiming loaded === total, so byte counts cannot prove the body arrived.
    request.upload.addEventListener("load", () => {
      trace.uploadedBytes = totalBytes;
      trace.clientStages.push({
        stage: "upload_complete",
        at: new Date().toISOString(),
        detail: "Waiting for Cloudflare to respond",
      });
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
        resolve(payload);
        return;
      }
      if (request.status === 413) {
        reject(new Error(`Cloudflare rejected the upload as too large (over ${formatBytes(MAX_UPLOAD_BYTES)}).`));
        return;
      }
      reject(new Error(payload.detail || `Upload failed with status ${request.status}.`));
    });

    request.addEventListener("error", () =>
      reject(new Error("The connection dropped during upload. Nothing was charged; try again."))
    );
    request.addEventListener("abort", () => reject(new Error("Upload cancelled.")));
    request.addEventListener("timeout", () => reject(new Error("The upload timed out.")));

    if (totalBytes === 0) {
      trace.clientStages.push({ stage: "upload_complete", at: new Date().toISOString() });
    }
    request.send(formData);
  });
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
  const { uploadedBytes, totalBytes, startedAt } = trace;
  if (!totalBytes) {
    return "No file to upload";
  }

  const percent = Math.min(100, Math.round((uploadedBytes / totalBytes) * 100));
  const elapsed = Math.max(1, (Date.now() - startedAt) / 1000);
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

  const uploadStalled =
    !seen.has("upload_complete") &&
    trace.lastProgressAt &&
    Date.now() - trace.lastProgressAt > STALL_AFTER_MS;

  const steps = TRACE_STEPS.filter(
    (step) => step.key !== "audio_stored" || trace.totalBytes > 0
  ).filter((step) => step.key !== "audio_loaded" || trace.totalBytes > 0);

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
          const took = new Date(seen.get("upload_complete").at).getTime() - trace.startedAt;
          if (trace.totalBytes > 0 && Number.isFinite(took)) {
            const rate = trace.totalBytes / Math.max(1, took / 1000);
            note = `${formatBytes(trace.totalBytes)} in ${formatDuration(took)} (${formatBytes(rate)}/s)`;
          }
        } else if (failed) {
          note = trace.failure || "Failed";
        } else {
          state = uploadStalled ? "stalled" : "active";
          note = uploadStalled
            ? `No data sent for ${formatDuration(Date.now() - trace.lastProgressAt)} — the connection may have dropped`
            : uploadSummary();
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

  if (!named) {
    const raw = document.createElement("a");
    raw.className = "download-link";
    raw.href = job.transcript_url;
    raw.textContent = "Raw JSON";
    target.appendChild(raw);
  }

  const speakerNames = named ? job.speaker_name_map || {} : null;
  const stem = named ? "named-transcript" : "transcript";

  for (const definition of window.Exporters.FORMATS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "download-link";
    button.textContent = named ? `Named ${definition.label}` : definition.label;
    button.addEventListener("click", async () => {
      const original = button.textContent;
      button.disabled = true;
      button.textContent = "Building...";
      try {
        await window.Exporters.download(
          definition.format,
          job.transcript_response,
          speakerNames,
          job.export_metadata || {},
          stem
        );
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

function clearResults() {
  state.activeJobId = null;
  renderHistory();
  renderActivity(null);
  elements.resultsPanel.classList.add("hidden");
  elements.resultsEmptyState.classList.remove("hidden");
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

function buildFormData() {
  const data = new FormData();
  const mode = activeSourceMode();
  data.append("source_mode", mode);
  if (mode === "upload" && elements.fileInput.files.length) {
    [...elements.fileInput.files].forEach((file) => {
      data.append("files", file);
    });
  }
  if (mode === "url") {
    data.append("cloud_storage_url", elements.urlInput.value.trim());
  }
  data.append("model_id", elements.modelSelect.value);
  data.append("language_code", elements.languageInput.value.trim());
  data.append("audio_type", elements.audioTypeSelect.value);
  data.append("timestamps_granularity", elements.timestampsSelect.value);
  data.append("diarize", elements.diarizeInput.checked ? "true" : "false");
  data.append("tag_audio_events", elements.tagAudioEventsInput.checked ? "true" : "false");
  data.append("use_multi_channel", elements.multiChannelInput.checked ? "true" : "false");
  data.append("no_verbatim", elements.noVerbatimInput.checked ? "true" : "false");
  data.append("zero_retention", elements.zeroRetentionInput.checked ? "true" : "false");
  data.append("num_speakers", elements.numSpeakersInput.value.trim());
  data.append("diarization_threshold", elements.diarizationThresholdInput.value.trim());
  data.append("keyterms", elements.keytermsInput.value.trim());
  data.append("entity_detection_custom", elements.entityDetectionCustomInput.value.trim());
  selectedEntityDetection().forEach((value) => data.append("entity_detection", value));
  return data;
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

  // Cloudflare rejects request bodies over 100 MB, so catch it before a long upload.
  if (totalBytes > MAX_UPLOAD_BYTES) {
    setStatus(
      elements.formStatus,
      `That is ${formatBytes(totalBytes)}, over the ${formatBytes(MAX_UPLOAD_BYTES)} limit Cloudflare accepts in one request. Upload fewer files at a time, or use an HTTPS URL instead.`,
      "error"
    );
    return;
  }

  elements.transcribeButton.disabled = true;
  beginTrace(totalBytes, files.length);

  try {
    const payload = await uploadWithProgress("/api/transcriptions", buildFormData(), totalBytes);
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
    elements.transcribeButton.disabled = false;
    failClientStage(error.message);
    setStatus(elements.formStatus, error.message, "error");
  }
});

window.addEventListener("DOMContentLoaded", async () => {
  updateSourcePanels();
  syncControls();
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
