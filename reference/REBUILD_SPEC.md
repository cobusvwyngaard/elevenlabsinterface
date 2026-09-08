# ElevenLabs Transcription Workbench — Rebuild Specification

Everything needed to recreate this project from scratch in a fresh Claude Code session.
Written to be handed to an agent as the sole source of truth: it states the goal, the
decisions already made and why, the exact build steps, the full behavioural contract of
every module, and the traps that cost time the first time round.

**Target platform: 64-bit Windows only.** The deliverable is a folder you copy to any
Windows PC and run by double-clicking one batch file, with no Python installed.

---

## 1. What the app is

A local-first FastAPI web app that runs ElevenLabs speech-to-text jobs through a browser
UI on `127.0.0.1`. The user picks audio files (or HTTPS URLs), chooses transcription
options, and gets back a transcript plus exports in seven formats. Job history, saved
transcripts, and exports live on disk. The ElevenLabs API key lives in Windows
Credential Manager.

It is not a service, not multi-user, and never binds to a public interface.

### Feature list (all must exist in the rebuild)

- Save / remove the ElevenLabs API key in Windows Credential Manager; UI shows a masked
  form (`••••••••` + last 4 characters).
- Transcribe from **multiple local file uploads** or **multiple HTTPS URLs** (one per
  line). Each file/URL becomes its own job; multi-item submissions are tagged as a batch.
- Options: model, language (or auto-detect), audio-type preset, timestamp granularity,
  output formats, diarization (+ speaker count or threshold), audio-event tagging,
  multi-channel mode, no-verbatim cleanup, entity detection (+ custom labels), keyterms,
  zero-retention.
- Named keyterm presets, saved locally and reusable.
- Exports: JSON (always) + any of TXT, DOCX, PDF, SRT, VTT, HTML.
- Post-hoc **speaker naming**: assign real names to diarized speaker labels and
  regenerate a parallel set of "Named …" exports, without spending more credits.
- History sidebar with live status polling, cancel, hide/unhide, delete (local and/or
  remote), and a "verify this still exists on ElevenLabs" check per job and in bulk.
- Credits and 7-day usage chart pulled from the ElevenLabs account.

---

## 2. Decisions already made — do not re-litigate

These were settled with the user. Rebuild to match.

| Decision | Choice | Why |
| --- | --- | --- |
| Runtime delivery | **Bundle an embedded Python inside the folder** | Target machines have no usable Python. No install step, no internet needed at run time. |
| API key storage | **Windows Credential Manager, per device** | Key never sits in a file that could be synced, zipped, or emailed. User re-enters it once per machine. |
| Job history storage | **`<project>\data\` inside the folder** | History travels with the folder. Overridable via env var. The original app used `%LOCALAPPDATA%`, which did not travel — this was the main portability defect. |
| Folder location | **Outside OneDrive**, e.g. `C:\Users\<user>\ElevenLabsWorkbench` | See §3; syncing the runtime is what broke the first transfer. |
| Scope | Port all existing behaviour, improve structure and robustness | Not a feature redesign. |
| Transfer method | **Single zip file**, produced by a script | See §11. |

---

## 3. Environment facts about the target machine

Verified, and they shape the whole design:

- Windows 11 Home Single Language, 10.0.26200, AMD64.
- **No usable system Python.** `python` / `python3` on PATH are the Microsoft Store
  alias stubs that print "Python was not found". The only real interpreter is Anaconda
  **3.8.8** at `C:\Users\cobus\anaconda3\python.exe`, and its `_ssl` module fails to load
  (`ImportError: DLL load failed while importing _ssl`). It is also far too old — the
  codebase uses PEP 604 `str | None`, which needs 3.10+.
  → **Never assume a system Python exists. Everything runs through the bundled runtime.**
- `C:` is ~99% full (≈3.7 GB free). The bundled runtime is ~98 MB; the transfer zip is
  ~31 MB. Keep both out of OneDrive so the local cache is not duplicated.
- PowerShell is **5.1** (`powershell.exe`). No `&&`/`||` chaining, no ternary, and
  `Set-Content -Encoding utf8` writes a **BOM** (see §12).
- The original project is at `C:\Users\cobus\OneDrive\Codex root\api interface`. It
  contains a `.venv` created by a *different* Windows user (`vwynggj`) and a `.deps`
  folder of foreign wheels — both are dead weight. **Do not copy `.venv`, `.deps`,
  `__pycache__`, `.pytest_cache`, or the old `data/`.**

---

## 4. Target folder layout

```
ElevenLabsWorkbench\
├── Start Workbench.bat          # the single command the user runs
├── Diagnose.bat                 # troubleshooting entry point
├── run.py                       # launcher: port, preflight, uvicorn, browser
├── conftest.py                  # puts project root on sys.path for pytest
├── pytest.ini
├── requirements.txt             # runtime deps
├── requirements-dev.txt         # -r requirements.txt + pytest
├── README.md
├── .gitignore                   # ignores runtime/ and data/
├── app\
│   ├── __init__.py
│   ├── server.py                # create_app() — wiring only
│   ├── config.py                # AppConfig dataclass, env overrides
│   ├── constants.py             # option lists, labels, status constants
│   ├── presets.py               # audio-type preset defaults
│   ├── models.py                # TranscriptionSubmission, ExportAsset
│   ├── database.py              # JobRepository (SQLite)
│   ├── storage.py               # per-job folder helpers
│   ├── serialization.py         # record -> JSON for the UI
│   ├── jobs.py                  # JobService: all state mutation
│   ├── key_store.py             # Credential Manager wrapper
│   ├── elevenlabs_client.py     # HTTP client
│   ├── transcription.py         # form validation -> submission
│   ├── transcript_utils.py      # transcript shaping
│   ├── exporters.py             # file writers
│   └── routes\
│       ├── __init__.py          # ALL_ROUTERS tuple
│       ├── deps.py              # shared dependencies + error translation
│       ├── pages.py             # GET / and /healthz
│       ├── settings.py          # /api/settings, /api/keyterm-presets
│       ├── transcriptions.py    # POST /api/transcriptions, GET /api/usage
│       ├── jobs.py              # /api/jobs/*
│       └── downloads.py         # /downloads/{job_id}/{format}
├── static\
│   ├── app.js                   # ~1,243 lines vanilla JS, no framework
│   └── styles.css               # ~710 lines, CSS custom properties
├── templates\
│   └── index.html               # ~409 lines Jinja2
├── tests\
│   ├── test_app.py              # ~962 lines, endpoint-level via TestClient
│   ├── test_elevenlabs_client.py
│   ├── test_transcription.py
│   └── test_transcript_utils.py
├── tools\
│   ├── build_runtime.ps1        # downloads + builds runtime\
│   ├── package_for_transfer.ps1 # produces the transfer zip
│   ├── verify_runtime.py        # manifest integrity check
│   └── diagnose.py              # full machine diagnostics
├── runtime\                     # bundled Python (generated, ~98 MB, gitignored)
│   └── manifest.txt             # every runtime file, for integrity checking
└── data\                        # job history (generated, gitignored)
    ├── app.db
    └── jobs\<job_id>\...
```

### Recommended build order

1. `requirements.txt` → `tools\build_runtime.ps1` → run it (slowest step; start it early
   and write code while it downloads).
2. `app\` modules bottom-up: `constants`, `presets`, `models`, `config`, `database`,
   `key_store`, `transcript_utils`, `exporters`, `transcription`, `elevenlabs_client`,
   `storage`, `serialization`, `jobs`, `routes\*`, `server`.
3. `static\`, `templates\` (see §9 — carry over or rebuild against the contract).
4. `run.py`, `Start Workbench.bat`, `conftest.py`, `pytest.ini`.
5. `tests\`, then run them.
6. `tools\verify_runtime.py`, `tools\diagnose.py`, `Diagnose.bat`,
   `tools\package_for_transfer.ps1`.
7. `README.md`.

---

## 5. The bundled runtime

`tools\build_runtime.ps1`, parameters `-PythonVersion` (default `3.12.10`), `-Force`,
`-Dev`. Steps:

1. `[Net.ServicePointManager]::SecurityProtocol = Tls12`.
2. Download `https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip`
   into `$env:TEMP`, cache it there.
3. `Expand-Archive` into `runtime\`.
4. **Patch `runtime\python312._pth`** — the embeddable distribution ships an isolated
   path file. Replace `#import site` with `import site` and append a `Lib\site-packages`
   line. Final content:
   ```
   python312.zip
   .

   # Uncomment to run site.main() automatically
   import site
   Lib\site-packages
   ```
5. Download `https://bootstrap.pypa.io/get-pip.py`, run `runtime\python.exe get-pip.py
   --no-warn-script-location`.
6. `runtime\python.exe -m pip install --no-warn-script-location --disable-pip-version-check
   -r requirements.txt` (or `requirements-dev.txt` with `-Dev`).
7. Verify: `runtime\python.exe -c "import fastapi, uvicorn, httpx, jinja2, keyring, docx,
   reportlab, multipart, sqlite3, ssl; print('runtime ok')"`.
8. **Write `runtime\manifest.txt`**: every file under `runtime\` relative to it,
   excluding `__pycache__` and `manifest.txt` itself. ≈2,334 entries.
9. Print the total size.

Notes:
- Because pip is invoked *by the embedded interpreter*, it resolves cp312 win_amd64
  wheels automatically. `pydantic-core`, `lxml`, `pillow`, and `reportlab` all have them;
  nothing compiles.
- The embeddable zip already contains `vcruntime140.dll` and `vcruntime140_1.dll`, and no
  bundled binary references `MSVCP140.dll`. **No VC++ redistributable is required** — this
  was checked, don't re-investigate it.
- `sqlite3.dll`, `libssl-3.dll`, `libcrypto-3.dll`, `libffi-8.dll` ship in the zip, so
  SQLite and TLS work out of the box.
- Result: ~98 MB, ~4,051 files including `__pycache__`.

### requirements.txt

```
fastapi==0.116.1
uvicorn==0.35.0
httpx==0.28.1
jinja2==3.1.6
python-multipart==0.0.20
keyring==25.6.0
python-docx==1.2.0
reportlab==4.4.4
```

`requirements-dev.txt` is `-r requirements.txt` plus `pytest==8.4.2`.

Full resolved set actually installed (for reproducibility): MarkupSafe 3.0.3,
annotated-types 0.8.0, anyio 4.14.2, certifi 2026.7.22, charset-normalizer 3.4.9,
click 8.4.2, colorama 0.4.6, fastapi 0.116.1, h11 0.16.0, httpcore 1.0.9, httpx 0.28.1,
idna 3.18, iniconfig 2.3.0, jaraco.classes 3.4.0, jaraco.context 6.1.2,
jaraco.functools 4.6.0, jinja2 3.1.6, keyring 25.6.0, lxml 6.1.1, more-itertools 11.1.0,
packaging 26.2, pillow 12.3.0, pluggy 1.6.0, pydantic 2.13.4, pydantic-core 2.46.4,
pygments 2.20.0, pytest 8.4.2, python-docx 1.2.0, python-multipart 0.0.20,
**pywin32-ctypes 0.2.3** (pulled in by keyring; required for the Windows backend),
reportlab 4.4.4, starlette 0.47.3, typing-extensions 4.16.0, typing-inspection 0.4.2,
uvicorn 0.35.0.

---

## 6. Configuration

`AppConfig` is a frozen dataclass built by `AppConfig.from_base_dir(base_dir, data_dir=None)`.

Fields: `base_dir`, `data_dir`, `jobs_dir` (= `data_dir/jobs`), `db_path`
(= `data_dir/app.db`), `templates_dir`, `static_dir`, `keyring_service`
(`"elevenlabs-transcription-workbench"`), `keyring_username` (`"default"`), `api_url`
(`"https://api.elevenlabs.io/v1/speech-to-text"`), `request_timeout_seconds`
(default `None` = wait indefinitely), `connect_timeout_seconds` (30),
`write_timeout_seconds` (300), `pool_timeout_seconds` (30).

`ensure_directories()` creates `data_dir` and `jobs_dir`.

All env vars share the prefix `ELEVENLABS_WORKBENCH_`:

| Variable | Default | Effect |
| --- | --- | --- |
| `DATA_DIR` | `<project>\data` | History + transcript location |
| `HOST` | `127.0.0.1` | Bind address (launcher) |
| `PORT` | `8000` | Preferred port (launcher) |
| `READ_TIMEOUT_SECONDS` | unset → no limit | Transcript wait; values ≤0 mean no limit |
| `CONNECT_TIMEOUT_SECONDS` | 30 | |
| `WRITE_TIMEOUT_SECONDS` | 300 | |
| `POOL_TIMEOUT_SECONDS` | 30 | |
| `RELOAD` | off | `1/true/yes/on` enables uvicorn auto-reload |

---

## 7. Data model

### SQLite schema (`app/database.py`, class `JobRepository`)

```sql
CREATE TABLE IF NOT EXISTS jobs (
    job_id TEXT PRIMARY KEY,
    transcription_id TEXT,
    created_at TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_label TEXT NOT NULL,
    model TEXT NOT NULL,
    language TEXT,
    audio_type TEXT NOT NULL,
    status TEXT NOT NULL,
    status_detail TEXT,
    error_message TEXT,
    started_at TEXT,
    completed_at TEXT,
    effective_settings TEXT NOT NULL,   -- JSON
    transcript_preview TEXT,
    detected_language TEXT,
    response_json_path TEXT,
    output_files TEXT NOT NULL          -- JSON list
);

CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL                 -- JSON
);
```

`init_db()` also runs an idempotent `_ensure_column` for `status_detail`, `started_at`,
`completed_at` (migration path from an older schema — keep it).

Methods: `init_db`, `save_job` (INSERT OR REPLACE), `list_jobs` (ordered
`datetime(created_at) DESC, rowid DESC`), `get_job`, `delete_job`,
`set_last_used_defaults` / `get_last_used_defaults`, `set_meta_json` / `get_meta_json`.
`_deserialize_row` JSON-decodes `effective_settings` and `output_files`.

`app_meta` keys in use: `last_used_defaults`, `keyterm_presets`.

### Job record (the dict passed around in Python)

`job_id, transcription_id, created_at, source_type, source_label, model, language,
audio_type, status, status_detail, error_message, started_at, completed_at,
effective_settings, transcript_preview, detected_language, response_json_path,
output_files`.

### Statuses

`queued → running → finalizing → success`, or `error`, or `cancelled`.
`TERMINAL_JOB_STATUSES = {"success", "error", "cancelled"}`.

### `effective_settings` JSON blob

Base keys mirror the submission: `source_mode, model_id, language_code, audio_type,
output_formats, diarize, num_speakers, diarization_threshold, tag_audio_events,
timestamps_granularity, use_multi_channel, no_verbatim, keyterms, entity_detection,
enable_logging, source_label`.

Keys added later by the service, all promoted to top-level fields in the API responses:
`batch_id, batch_index, batch_count, hidden_at, hidden_reason, hidden_message,
hidden_by_job_id, remote_deleted_at, remote_delete_status, remote_presence_status,
remote_presence_message, remote_presence_checked_at, last_known_transcription_id`.

`remote_presence_status` ∈ `present | missing | not_available | unknown`.
`hidden_reason` ∈ `manual | superseded_success`.

### On-disk job folder — `data\jobs\<job_id>\`

```
transcript.json           # canonical API response, always written on success
transcript.txt|docx|pdf|srt|vtt|html    # per selected output format
speaker-names.json        # {speaker_key: assigned_name}, only when names are saved
named-transcript.*        # parallel exports with names substituted
```

---

## 8. HTTP API contract

The frontend depends on this exactly. Keep paths, methods, and payload shapes identical
if you carry `static/app.js` over.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/` | Renders `index.html` |
| GET | `/healthz` | `{"status":"ok"}` — used by the launcher to detect readiness |
| GET | `/api/settings` | Key state, `last_used_defaults`, all option lists, keyterm presets |
| POST | `/api/settings/api-key` | `{"api_key": "..."}` → `{saved, masked}` |
| DELETE | `/api/settings/api-key` | → `{saved:false, masked:null}` |
| GET | `/api/keyterm-presets` | `{presets:[{name,terms[]}]}` |
| POST | `/api/keyterm-presets` | `{name, terms}`; `terms` may be a list or newline string |
| DELETE | `/api/keyterm-presets/{name}` | Case-insensitive |
| POST | `/api/transcriptions` | multipart form; **202**; single job detail, or a batch envelope |
| GET | `/api/usage` | `{subscription, history, fetched_at}` |
| GET | `/api/jobs?include_hidden=bool` | `{jobs[], hidden_count, include_hidden}` |
| GET | `/api/jobs/{id}` | Full job detail; refreshes exports on disk as a side effect |
| POST | `/api/jobs/audit-remote` | `{counts, message, jobs[]}` — must be declared before `/{id}` routes |
| POST | `/api/jobs/{id}/verify-remote` | Job detail |
| POST | `/api/jobs/{id}/visibility` | `{hidden:bool}` → `{message, job}`; 409 if not terminal |
| POST | `/api/jobs/{id}/cancel` | Job detail; no-op if already terminal |
| POST | `/api/jobs/{id}/delete` | `{delete_local, delete_remote}`; 409 if not terminal |
| POST | `/api/jobs/{id}/speaker-names` | `{speaker_names:{key:name}}` → detail + named outputs |
| DELETE | `/api/jobs/{id}/speaker-names` | Clears names and named exports |
| GET | `/downloads/{job_id}/{format}` | `FileResponse`; format may be `json`, a format id, or `named_<format>` |

### Error contract

FastAPI's default `{"detail": "..."}`. Messages are user-facing and appear verbatim in
the UI — keep the wording:

- Missing key: `Save an ElevenLabs API key before {purpose}.` where purpose ∈
  `starting a transcription`, `loading usage`, `verifying remote data`,
  `auditing remote data`, `deleting transcript data from ElevenLabs`.
- `Enter an ElevenLabs API key.` (empty POST body)
- `Transcript job not found.` (404)
- `Wait for the job to finish or cancel it before deleting.` (409)
- `Finish or cancel the job before hiding it from Recent Jobs.` (409)
- `Choose local data, ElevenLabs data, or both.` (400)
- `This job does not have a saved ElevenLabs transcript ID to delete.` (400)
- `Requested export is not available for this job.` (404)

### Batch envelope (multi-file / multi-URL submission)

```json
{"batch_submitted": true, "batch_id": "...", "count": 3, "status": "queued",
 "status_detail": "Queued 3 transcription jobs. They will start in parallel and appear in History as separate jobs.",
 "jobs": [ ...job details... ]}
```

### Job summary vs detail

Both share: `job_id, transcription_id, created_at, source_type, source_label, model,
audio_type, status, status_detail, started_at, completed_at, is_terminal, error_message,
transcript_preview, detected_language, is_hidden`, plus the promoted settings keys
(`batch_*`, `remote_*`, `hidden_*`).

Summary adds `outputs[]` as `{format,label,download_url}`.

Detail adds: `language, effective_settings, transcript_text, speaker_name_map,
named_transcript_text, outputs[]` (with `filename, content_type, size`),
`named_outputs[], timeline_entries[], speaker_profiles[], audio_events[], entities[],
response` (the raw ElevenLabs JSON).

---

## 9. Frontend

`static/app.js` (~1,243 lines), `static/styles.css` (~710 lines), `templates/index.html`
(~409 lines). All vanilla — no framework, no build step, no external requests.

**Recommendation: copy these three files verbatim from the existing project.** They are
mature and the backend contract above was designed to keep them working unchanged.
Rebuilding them from scratch is the single largest piece of work here and buys nothing.
If you do rebuild, honour the contract below.

### Template contract

`index.html` receives:
- `bootstrap` — dict serialised into `window.WORKBENCH_BOOTSTRAP` via `{{ bootstrap | tojson }}`,
  with keys `audioTypes, models, outputFormats, timestamps, entityDetection, languages,
  presets`. Jinja loops render the `<select>`/checkbox options server-side; JS reads the
  same data for preset logic.
- `asset_versions` — `{styles_css, app_js}`, integer mtimes appended as `?v=` to the
  stylesheet and script URLs for cache busting.
- Static URLs via `url_for('static', path='...')`, so `/static` must be mounted.

### Page structure

Header hero; two-column layout of a history sidebar (`#historyList`) and a main column of
four cards: **Credentials**, **Usage** (4 stat tiles + a bar chart built from `<div>`s),
**New Job** (the form, with an `#activityPanel` showing a status pill, elapsed clock, and
cancel button), and **Transcript Viewer** (downloads, delete panel, metadata grid,
transcript + named transcript, timed entries, audio events, speaker naming, entities).

### Element IDs the JS binds to

Forms: `apiKeyForm, apiKeyInput, savedKeyStatus, removeKeyButton, transcriptionForm,
uploadPanel, urlPanel, fileInput, urlInput, modelSelect, languageInput, audioTypeSelect,
timestampsSelect, diarizeInput, tagAudioEventsInput, multiChannelInput, noVerbatimInput,
zeroRetentionInput, numSpeakersInput, diarizationThresholdInput, keytermsInput,
entityDetectionCustomInput, transcribeButton, formStatus`.
Keyterm presets: `keytermPresetSelect, loadKeytermPresetButton, saveKeytermPresetButton,
deleteKeytermPresetButton`.
Activity: `activityPanel, activityBadge, activityElapsed, activityDetail, cancelJobButton`.
History: `historyList, refreshHistoryButton, showHiddenButton, auditRemoteButton`.
Usage: `usageStatus, usagePanel, usageRemaining, usageUsed, usageLimit, usageReset,
usageTier, usageUpdated, usageChart, usageChartTotal, refreshUsageButton`.
Results: `resultsPanel, resultsEmptyState, resultMeta, downloads, deletePanel,
deleteHelpText, verifyRemoteButton, hideJobButton, deleteLocalButton, deleteRemoteButton,
deleteBothButton, metadataGrid, transcriptText, namedTranscriptPanel, namedDownloads,
namedTranscriptText, timelineEntries, audioEvents, speakerNamingState, speakerProfiles,
speakerActions, saveSpeakerNamesButton, clearSpeakerNamesButton, entitiesList`.

Form field `name` attributes must match §10 exactly: `source_mode, cloud_storage_url,
files, model_id, language_code, audio_type, timestamps_granularity, output_formats,
diarize, tag_audio_events, use_multi_channel, no_verbatim, zero_retention, num_speakers,
diarization_threshold, entity_detection, entity_detection_custom, keyterms`.

### Client behaviour

- `state = {activeJobId, jobs, pollTimer, pollInFlight, elapsedTimer, elapsedAnchor,
  usageTimer, keytermPresets, showHidden, hiddenJobCount}`.
- Job polling: `GET /api/jobs/{id}` every **2000 ms** while the active job is non-terminal;
  `pollInFlight` guards overlap.
- Usage auto-refresh every **30000 ms** (silent).
- Elapsed clock ticks every 1000 ms from `started_at`.
- Selecting an audio-type preset applies `bootstrap.presets[audioType]` to the advanced
  controls; `last_used_defaults` from `/api/settings` repopulates the form on load.
- Multi-channel mode disables the diarization controls (mirrors server validation).
- All fetches go through one `fetchJson` helper that surfaces `detail` from error bodies.

### Styling

CSS custom properties on `:root` — warm paper palette: `--bg #f3ede2`, `--bg-deep #d8c9ad`,
`--card rgba(255,251,245,0.86)`, `--border rgba(58,54,47,0.14)`, `--ink #1f2329`,
`--muted #5d645d`, `--accent #9b4d2f`, `--accent-dark #6d2f19`, `--success #2f6f54`,
`--danger #9f3a32`, `--shadow 0 18px 40px rgba(38,26,17,0.12)`, `--radius 22px`.

---

## 10. Validation rules (`app/transcription.py`)

`build_submission(payload, *, file_name, file_bytes, file_content_type)` returns a
`TranscriptionSubmission` or raises `SubmissionError` (→ HTTP 400). Rules:

- `source_mode` ∈ `{upload, url}`, default `upload`; anything else → error.
- `model_id` default `scribe_v2`; must be in `{scribe_v2, scribe_v1}`.
- `audio_type` default `meeting`; must be a known preset key.
- At least one output format; each must be in `{txt,docx,pdf,srt,vtt,html}`.
- Upload mode: file bytes + name required (`Choose a local file to upload.`); a URL as
  well → `Choose either a local file or an HTTPS URL, not both.`
- URL mode: URL required, must parse as `https` with a netloc
  (`Cloud storage URL must be a valid HTTPS URL.`); file bytes as well → the same
  "not both" error.
- Preset defaults fill unset `diarize`, `tag_audio_events`, `timestamps_granularity`,
  `num_speakers`, `no_verbatim`.
- `use_multi_channel` forces `diarize=False`, `num_speakers=None`,
  `diarization_threshold=None`.
- `num_speakers` must be 1–32.
- `diarization_threshold` requires diarization on, requires `num_speakers` blank, and must
  be 0–1.
- `no_verbatim`, `keyterms`, and `entity_detection` are **scribe_v2 only**.
- Keyterms: split on newlines and commas, de-duplicated case-insensitively, max 100.
- Entity detection: lowercase; `all` short-circuits to `["all"]`; unknown values must match
  `[a-z0-9_]+` or are rejected.
- `zero_retention` checked → `enable_logging = False`.
- Checkbox parsing accepts `1/true/on/yes`.

`build_api_fields(submission)` → list of `(key, value)` form pairs: always `model_id`,
`diarize`, `tag_audio_events`, `timestamps_granularity`, `use_multi_channel`; optionally
`language_code`, `cloud_storage_url`, `num_speakers`, `diarization_threshold`; and for
scribe_v2 only `no_verbatim` plus repeated `keyterms` and `entity_detection` entries.

`submission_defaults()` produces the form-repopulation dict stored as
`last_used_defaults`. `effective_settings()` produces the audit blob stored on the job.

### Audio-type presets (`app/presets.py`)

| Preset | diarize | num_speakers | tag_audio_events | timestamps | no_verbatim |
| --- | --- | --- | --- | --- | --- |
| lecture | false | — | true | word | true |
| meeting | true | — | false | word | true |
| focus_group | true | 6 | true | word | false |
| interview | true | 2 | false | word | true |
| podcast | true | — | true | word | true |
| dictation | false | — | false | word | true |
| custom | *(empty — no defaults applied)* | | | | |

### Option lists (`app/constants.py`)

- Audio types: lecture, meeting, focus_group, interview, podcast, dictation, custom.
- Models: `scribe_v2` (Scribe v2), `scribe_v1` (Scribe v1).
- Output formats: txt, docx, pdf, srt, vtt, html.
- Timestamps: none, word, character.
- Entity detection: all, pii, phi, pci, other, offensive_language.
- Languages: `""` (Auto detect) plus en, af, ar, de, es, fr, he, hi, it, ja, ko, nl, pl,
  pt, ru, sv, tr, uk, vi, zh.
- `OUTPUT_CONTENT_TYPES`: json→`application/json`, txt→`text/plain; charset=utf-8`,
  docx→`application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
  pdf→`application/pdf`, srt→`application/x-subrip`, vtt→`text/vtt; charset=utf-8`,
  html→`text/html; charset=utf-8`.
- Derived label maps: `AUDIO_TYPE_LABELS`, `MODEL_LABELS`, `OUTPUT_LABELS`,
  `ENTITY_DETECTION_LABELS`.

---

## 11. ElevenLabs integration (`app/elevenlabs_client.py`)

Header `xi-api-key` on every request, plus `accept: application/json`. All calls are sync
`httpx` wrapped in `asyncio.to_thread` so the event loop stays free.

| Method | Request |
| --- | --- |
| `transcribe` | `POST {api_url}` (`/v1/speech-to-text`), query `enable_logging=<bool>`, multipart: form fields from `build_api_fields` + `file` part when uploading |
| `get_subscription` | `GET {root}/v1/user/subscription` |
| `get_usage_stats` | `GET {root}/v1/usage/character-stats` with `start_unix, end_unix, aggregation_interval, metric, breakdown_type` |
| `get_transcript` | `GET {root}/v1/speech-to-text/transcripts/{id}` |
| `delete_transcript` | `DELETE {root}/v1/speech-to-text/transcripts/{id}` |

`_api_root()` derives the root by partitioning `api_url` on `"/v1/"`.

Timeouts via `httpx.Timeout(connect=, read=, write=, pool=)` where `read` is
`request_timeout_seconds` (`None` = unlimited).

`ElevenLabsAPIError(status_code, message, details)` is raised for everything. Each
`httpx` timeout class maps to **504** with a phase-specific message built by
`_timeout_message(phase, elapsed_seconds, note=None)` →
`"Timed out after about {n} seconds while {phase}."` Phases: `connecting to ElevenLabs`,
`uploading the file to ElevenLabs`, `waiting for ElevenLabs to return the completed
transcript` (plus a note warning against blind retries because credits may already have
been spent), `waiting for an available HTTP connection`, `communicating with ElevenLabs`.
Other `httpx.HTTPError` → **502** `Could not reach ElevenLabs: {exc}`. Non-JSON success
body → 502. HTTP ≥400 → the upstream status with a message dug out of `detail`/`message`/
`error` recursively, falling back to `ElevenLabs rejected the transcription request.`

Repeated form keys (`keyterms`, `entity_detection`) are coalesced into lists by
`_coalesce_form_fields` before being handed to httpx.

### Usage normalisation (`app/usage.py`)

`normalize_subscription` → `{tier, credits_used, credits_limit, credits_remaining,
next_reset_unix, next_reset_at, billing_period, can_extend_character_limit}` from
`character_count`, `character_limit`, `next_character_count_reset_unix`.
`normalize_usage_history` → `{metric, series_label, points:[{timestamp, timestamp_iso,
value}], total}`; handles `usage` arriving as either a dict of series or a flat list.
Timestamps >10^10 are treated as milliseconds.

The usage route queries a 7-day window (`now - 6 days` … `now`), `aggregation_interval=day`,
`metric=credits`, `breakdown_type=none`, times ×1000.

---

## 12. Transcript shaping (`app/transcript_utils.py`)

Pure functions over the raw ElevenLabs response. This is the subtlest module — port it
faithfully.

- `extract_words()` — handles both the flat `words[]` shape and the multi-channel
  `transcripts[]` shape; enriches each word with `channel_index` and an inherited
  `speaker`; sorts by `(start, channel_index)`; tolerates `start_time`/`end_time` aliases.
- `extract_text()` — prefers top-level `text`; else joins per-channel blocks titled by
  speaker or `Channel N`; else concatenates word tokens.
- `extract_detected_language()` — top-level `language_code`, else the sorted unique set
  across `transcripts[]`, comma-joined.
- `humanize_speaker_label()` — `speaker_0`/`speaker-0` → `Speaker 1` (zero-based → one-based),
  `channel_0` → `Channel 1`, `speaker 3` → `Speaker 3` (already one-based, left alone).
- `canonical_speaker_label(word)` — checks `speaker`, `speaker_id`, `speaker_label`
  (int values become `Speaker n+1`), falls back to `Channel n+1` from `channel_index`.
- `resolve_speaker_name(key, names)` — user-assigned name, else the key itself.
- `build_cues(response, max_chars=86, max_gap=1.25, speaker_names=None)` — subtitle cues.
  Breaks on speaker change (only when the token `type` is `word`), on a gap >`max_gap`, or
  when the chunk exceeds `max_chars` **and** ends in `.`/`?`/`!`. Cue `end` is forced to at
  least `start + 0.2`. No words at all → one fallback cue 0–5 s with the text or
  `Transcript unavailable.`
- `build_transcript_paragraphs(response, max_chars=420, max_gap=2.5, speaker_names=None)` —
  merges cues while the speaker is unchanged, the gap ≤2.5 s, and the total stays ≤420 chars.
- `render_transcript_paragraph(p)` → `"[HH:MM:SS.mmm] Speaker: text"`, or without the
  speaker prefix when unknown. `format_transcript_timestamp` carries milliseconds and
  handles the 999.5 ms rounding cascade.
- `format_transcript_text()` — paragraphs joined by blank lines.
- `build_timeline_entries(limit=200)` → `{index,start,end,speaker,speaker_key,text}`.
- `extract_audio_events(limit=200)` — words whose `type` is `audio_event` or whose text
  contains brackets.
- `extract_entities(limit=200)` → `{text,label,start,end}` from `response["entities"]`,
  label from `entity_type`/`type` else `"Entity"`.
- `build_speaker_profiles(quotes_per_speaker=3)` → `{speaker_key, speaker_label,
  assigned_name, quotes[{start,end,text}]}`. Note it calls `build_cues` **without**
  `speaker_names` so grouping stays keyed on the raw labels.

---

## 13. Exporters (`app/exporters.py`)

`create_exports(job_dir, response_data, selected_formats, metadata, *, speaker_names=None,
filename_stem="transcript", format_prefix="", label_prefix="", include_json=True)
-> list[ExportAsset]`.

- Writes `<stem>.json` (pretty, `ensure_ascii=False`) when `include_json`.
- `metadata` gets `Detected language` added if absent. Falsy values (`None`, `""`, `[]`)
  are skipped when rendering.
- TXT: `format_transcript_text` + trailing newline.
- HTML: self-contained document, Georgia serif, metadata `<ul>`, escaped paragraphs.
- SRT / VTT: from `build_cues`; VTT prefixed `WEBVTT`; timecodes `HH:MM:SS,mmm` (SRT) vs
  `HH:MM:SS.mmm` (VTT); speaker prefixed as `Speaker: text`.
- DOCX (`python-docx`): "Transcript Export" heading, `Key: value` metadata lines, blank
  line, one paragraph per transcript paragraph.
- PDF (`reportlab`): letter page, Helvetica-Bold 16 title, Helvetica 11 body, wrapped at
  100 characters, new page when `y < 72`, resets to `y = 720`.
- Empty transcript → `Transcript unavailable.`

The named variants reuse the same function with `filename_stem="named-transcript"`,
`format_prefix="named_"`, `label_prefix="Named "`, `include_json=False`, and a
`Speaker names` metadata line rendered as `key -> value` pairs.

`ExportAsset` is a slotted dataclass `{format, filename, content_type, path, label}` with
a `size` property that stats the file.

---

## 14. Service layer (`app/jobs.py`, class `JobService`)

Constructed with `config, repository, key_store, elevenlabs_client`. Holds
`background_tasks: set[asyncio.Task]` and `cancelled_jobs: set[str]`.

- `mark_incomplete_jobs_as_interrupted()` — run from the lifespan hook. Any non-terminal
  job becomes `error` with `INTERRUPTED_JOB_MESSAGE`, because an in-flight HTTP request
  cannot be resumed after a restart.
- `queue_submission(submission, api_key, batch_id=None, batch_index=None, batch_count=None)`
  — generates a uuid4 job id, saves a `queued` record, spawns
  `asyncio.create_task(self._run_job(...))`, tags the task with `job_id`, registers a
  done-callback that discards the task and the cancelled flag and logs crashes. Returns
  the serialised detail.
- `_run_job()` — creates the job folder, saves `running`, calls the client, saves
  `finalizing`, writes exports, saves `success`. Checks `job_id in cancelled_jobs` before
  starting, after the response, and in both exception handlers, discarding late results
  silently. `ElevenLabsAPIError` → `error` with the API message; any other exception →
  `error` with `str(exc)` or the class name.
- Status-detail text for `running` depends on whether a read timeout is configured
  ("will wait up to about N minutes" vs "will keep waiting … until it arrives or you
  cancel locally").
- `transcript_preview` is the first **800** characters of the formatted transcript.
- `cancel_job(record)` — adds to `cancelled_jobs`, marks `cancelled` with
  `CANCELLED_JOB_MESSAGE`.
- `refresh_saved_outputs(record)` — for successful jobs, regenerates exports from the
  stored `transcript.json` so a deleted file is rebuilt on demand; updates preview and
  detected language; `OSError` is logged and swallowed.
- `refresh_named_outputs(record, response_data=None, speaker_names=None)` — same for the
  named variants; returns `[]` when no names are saved.
- `delete_local_job_data(record)` — `shutil.rmtree` the job folder, then delete the row.
- `save_hidden_state(record, hidden=..., reason=..., message=..., hidden_by_job_id=...)`.
- `reconcile_superseded_jobs()` — runs on every `GET /api/jobs`. Groups jobs by
  `"{source_type}:{casefolded, whitespace-collapsed source_label}"`. For each group it
  finds the newest successful job; older `error`/`cancelled` jobs in the same group are
  hidden with reason `superseded_success`. A manual hide always wins. Success rows that
  were auto-hidden get un-hidden. Returns the number of changes.
- `save_remote_presence_state(...)` and `verify_remote_record(record, api_key)` — 404 from
  the API means `missing` and the local `transcription_id` is cleared into
  `last_known_transcription_id`; other errors mean `unknown`; no stored id means
  `not_available` (or `missing` if it was already deleted).

---

## 15. Launcher (`run.py`) and batch files

`run.py`:
1. Insert its own directory at `sys.path[0]` — **required**, because the embedded
   distribution's `._pth` prevents Python from adding the script directory.
2. Args `--host` (env `…_HOST`, default `127.0.0.1`), `--port` (env `…_PORT`, default
   8000), `--no-browser`.
3. `health_check()` — GET `/healthz` and check `status == "ok"`. If the app is already
   running on the target port, open the browser and exit 0 instead of starting a rival
   server.
4. If the port is occupied by something else, bind port 0 to find a free one and announce
   the switch.
5. `check_runtime()` — import every module in `REQUIRED_MODULES` up front:
   `fastapi, starlette, uvicorn, uvicorn.protocols.http.auto,
   uvicorn.protocols.websockets.auto, uvicorn.lifespan.on, h11, httpx, jinja2, keyring,
   docx, reportlab, multipart`. On failure, print each failing module with its exception,
   then run `tools/verify_runtime.py`'s manifest check and print the remedy. Return 1.
   **The three `uvicorn.*` submodules matter specifically** — uvicorn resolves them lazily
   during startup, and a partial runtime otherwise surfaces as an unexplained error.
6. Print a banner (address, data directory, how to stop) and warn when running from a UNC
   path or from inside OneDrive.
7. Start a daemon thread that polls `/healthz` for up to 60 s and then opens the browser.
8. `uvicorn.run(create_app(), host, port)`, or the `"app.server:create_app"` factory string
   when `ELEVENLABS_WORKBENCH_RELOAD` is set. Catch `KeyboardInterrupt` and print
   `"Stopped."`.

`Start Workbench.bat`:
- `pushd "%~dp0"` — **not** `cd /d`, which cannot use a UNC path as a working directory.
  `popd` before exiting.
- If `runtime\python.exe` is absent, explain that the transfer was incomplete and point at
  `package_for_transfer.ps1` / `build_runtime.ps1`, then `pause`.
- Run `"runtime\python.exe" run.py %*`, capture `%ERRORLEVEL%`, and on non-zero print the
  code, point at `Diagnose.bat`, and `pause` so the window stays readable.
- Escape literal parentheses inside `echo` as `^(` `^)`.

`Diagnose.bat` prints a pure-batch inventory first (so it still helps when the runtime is
missing), then hands off to `runtime\python.exe tools\diagnose.py`.

---

## 16. Diagnostics and packaging

`tools/verify_runtime.py` — reads `runtime\manifest.txt`, reports missing files and
zero-byte binaries, and prints a remedy block. Falls back to a hard-coded `CRITICAL_FILES`
list when the manifest is absent. Exposes `verify() -> RuntimeReport` and `REMEDY` for
`run.py` to reuse.

`tools/diagnose.py` — sections: Machine (OS, arch, interpreter, bitness), Location (UNC?
`GetDriveTypeW` for removable/network/read-only, OneDrive warning), Files (required paths),
Runtime integrity (manifest), Windows file blocking (`:Zone.Identifier` alternate data
streams → `Unblock-File`), Write access (create the data dir, write a probe file, open
SQLite), Dependencies (import each), Credential Manager (backend + a read), Network (is
the port free), Application startup (`create_app()` with a full traceback on failure), then
a summary. Exit 1 when anything failed.

`tools/package_for_transfer.ps1` — verifies the runtime first and **refuses to package an
already-incomplete one**, copies everything except `__pycache__`, `.pytest_cache`, and
(unless `-IncludeHistory`) `data\` into a staging folder, creates an empty `data\`, and
`Compress-Archive`s it to `<parent>\ElevenLabsWorkbench.zip` (~31 MB).

---

## 17. Tests

35 tests, all passing, run with `runtime\python.exe -m pytest`.

- `conftest.py` at the project root puts the root on `sys.path` (again, the `._pth`
  isolation). `pytest.ini` sets `testpaths = tests` and `addopts = -q`.
- `tests/test_app.py` (~962 lines) drives the API through `fastapi.testclient.TestClient`
  with a `MemoryKeyStore` and a `FakeElevenLabsClient` (configurable failures, delays,
  missing-transcript ids, response factory). It builds the app with
  `create_app(config=..., key_store=..., elevenlabs_client=...)` — **keep that keyword
  signature**, it is the only seam the tests use.
- `tests/test_elevenlabs_client.py` — request shaping and error mapping via `httpx`
  transports.
- `tests/test_transcription.py` — validation rules and `build_api_fields`.
- `tests/test_transcript_utils.py` — paragraph building and export round-trips
  (reads a generated DOCX back).

---

## 18. Pitfalls — every one of these was hit for real

1. **`cd /d` fails on UNC paths.** Use `pushd`/`popd` in every batch file.
2. **The embeddable `._pth` does not add the script directory to `sys.path`.** Both
   `run.py` and `conftest.py` must insert the project root themselves.
3. **PowerShell 5.1 `Set-Content -Encoding utf8` writes a BOM.** The manifest reader must
   use `encoding="utf-8-sig"`, or the first filename silently gains a `\ufeff` and is
   reported missing.
4. **Empty `__init__.py` files are legitimate.** Only size-check `.dll`, `.pyd`, `.exe`;
   flagging empty `.py` produced 39 false positives.
5. **Uvicorn's `import_from_string` error wording is diagnostic.** `Could not import module
   "X"` means module *X itself* is missing; a missing dependency of X re-raises under the
   dependency's own name. That distinction identified a partially copied runtime.
6. **Syncing the folder breaks it.** `runtime\` is ~4,000 small files; OneDrive and network
   shares deliver most but not all, and the app then dies on whichever file is absent.
   Always transfer as one zip, and extract to a local drive.
7. **`keyring` needs `pywin32-ctypes` on Windows.** It is pulled in automatically; verify
   `keyring.get_keyring()` resolves to `keyring.backends.Windows.WinVaultKeyring`.
8. **Never copy `.venv` or `.deps` between machines.** The original `.venv` pointed at
   another user's home directory and was inert.
9. **`StaticFiles(directory=...)` raises at construction if the directory is missing**, so
   an incomplete copy fails inside `create_app()` rather than at request time.
10. **PowerShell 5.1 wraps native stderr in `NativeCommandError`** and sets `$?` false even
    on exit 0. Do not redirect `2>&1` when checking exit codes.
11. **Route ordering:** declare `POST /api/jobs/audit-remote` before the `/{job_id}` routes.
12. **`Compress-Archive` on a directory nests it**, so the zip expands to
    `<dest>\ElevenLabsWorkbench\` — which is what the instructions assume.

---

## 19. Known defect to fix in the rebuild

**`response_json_path` and `output_files[].path` are stored as absolute paths.**

`_run_job` saves `str(job_dir / "transcript.json")`, and `serialize_asset` stores
`str(asset.path)`. If the folder is moved — a different drive, a different Windows
username, a USB stick — every pre-existing job's stored paths point somewhere that no
longer exists. `load_response_json` then returns `None` (transcript and exports quietly
vanish from the UI) and `/downloads/...` hands `FileResponse` a missing path, which raises.

This directly undercuts the "history travels with the folder" goal, and only bites once
there is history to carry.

**Fix:** store paths **relative to `jobs_dir`** (e.g. `<job_id>/transcript.json`) and
resolve them against the live `config.jobs_dir` on read. Add a migration in `init_db()`
that rewrites existing absolute paths whose prefix no longer matches. Keep
`job_dir_from_record()` as the single place that turns a record into a folder.

---

## 20. Verification checklist

Do all of these before calling the rebuild done:

1. `runtime\python.exe -m pytest` → 35 passed.
2. `runtime\python.exe tools\diagnose.py` → "No problems found."
3. Start via `Start Workbench.bat`, then confirm:
   `GET /healthz` → `{"status":"ok"}`; `GET /` → HTML ≈24 KB;
   `GET /api/jobs` → `{"jobs":[],"hidden_count":0,"include_hidden":false}`;
   `GET /api/settings` → 200 (proves Credential Manager is readable);
   `GET /static/styles.css` → 200.
4. Load the page in a browser: all four cards render, no console errors.
5. Launch a second instance on the same port → it must report "already running" and open
   the browser instead of starting another server.
6. Rename `runtime\Lib\site-packages\uvicorn\protocols\http\auto.py` and launch → the
   error must name that exact file, not produce a uvicorn stack trace. Restore it.
7. `tools\package_for_transfer.ps1`, extract the zip somewhere else, and boot it from
   there.
8. Confirm `data\` is created inside the project folder, not under `%LOCALAPPDATA%`.

---

## 21. Prompt to open the new session with

> Build a portable, self-contained Windows app called ElevenLabs Transcription Workbench,
> following `REBUILD_SPEC.md` in full. It is a local FastAPI + vanilla-JS web app for
> running ElevenLabs speech-to-text jobs, bundling its own embedded Python runtime so it
> runs from one batch file on any 64-bit Windows PC with nothing installed.
>
> Start by reading the spec end to end. Kick off `tools\build_runtime.ps1` early — it is
> the slow step — and write the application code while it downloads. Carry `static\app.js`,
> `static\styles.css`, and `templates\index.html` over unchanged from the existing project
> at `C:\Users\cobus\ElevenLabsWorkbench`, and keep the HTTP API byte-compatible with §8 so
> they keep working. Fix the defect in §19 as part of the build. Finish with the
> verification checklist in §20 and report the results.
