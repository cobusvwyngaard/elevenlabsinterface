# ElevenLabs Transcription Workbench — Cloudflare edition

A web app for running ElevenLabs speech-to-text jobs: pick audio files or HTTPS URLs, choose
transcription options, get back a transcript plus exports in seven formats. Job history,
transcripts, and exports are stored on Cloudflare.

This is a rewrite of the Windows desktop app described in
[`reference/REBUILD_SPEC.md`](reference/REBUILD_SPEC.md), targeting Cloudflare Workers instead.
The feature set and the HTTP API contract (spec §8) are preserved; the platform mechanics are not,
because they could not be — see [What changed from the spec](#what-changed-from-the-spec).

## Architecture

| Concern | Implementation |
| --- | --- |
| HTTP layer | Cloudflare Workers + [Hono](https://hono.dev) (`src/routes/`) |
| Frontend | Static assets in `public/`, served by the Workers Assets binding |
| Job history | Cloudflare D1 (`jobs`, `app_meta` tables — `migrations/0001_init.sql`) |
| Transcripts & exports | Cloudflare R2, keyed `<job_id>/<filename>` |
| Background execution | Cloudflare Queues — the API enqueues, a consumer runs the job |
| DOCX / PDF generation | `docx` and `pdf-lib` npm packages, running inside the Worker |
| API key storage | D1 (`app_meta`), behind Cloudflare Access |

Request flow: `POST /api/transcriptions` validates the form, writes a `queued` job row to D1,
stores the upload in R2, and enqueues a message. The Queue consumer calls ElevenLabs, writes
exports to R2, and moves the job through `running → finalizing → success`. The browser polls
`GET /api/jobs/{id}` every 2 seconds, exactly as it did in the desktop build.

## First-time setup

You need a Cloudflare account with Workers Paid (Queues and the >30s CPU limit both require it).

```sh
npm install

# 1. Create the D1 database, then paste the returned database_id into wrangler.jsonc
npx wrangler d1 create workbench

# 2. Create the R2 bucket
npx wrangler r2 bucket create workbench-transcripts

# 3. Create the queues
npx wrangler queues create transcription-jobs
npx wrangler queues create transcription-jobs-dlq

# 4. Apply the schema to the remote database
npx wrangler d1 migrations apply workbench --remote

# 5. Deploy
npx wrangler deploy
```

`wrangler.jsonc` ships with `"database_id": "REPLACE_WITH_D1_DATABASE_ID"`. Deployment will fail
until you replace it with the id printed by step 1.

### Restrict access (do this before saving an API key)

The Worker URL is public by default, and the app stores your ElevenLabs API key server-side —
so anyone who finds the URL could spend your credits. Put Cloudflare Access in front of it:

1. Cloudflare dashboard → **Zero Trust** → **Access** → **Applications** → **Add an application**
   → **Self-hosted**.
2. Set the application domain to your Worker's hostname.
3. Add a policy: action **Allow**, rule **Emails** → your own email address.
4. Save, then confirm that opening the app in a private window prompts for authentication.

This replaces the Windows Credential Manager decision in spec §2. There is no per-device
encrypted secret store on Cloudflare; the protection is the Access gate, not the storage layer.

### Add your API key

Open the app and paste your ElevenLabs key into the Credentials card. It is stored in D1 and
shown masked (`••••••••` + last 4). "Remove key" deletes it.

## Local development

```sh
npx wrangler d1 migrations apply workbench --local
npx wrangler dev --local
```

`--local` simulates D1, R2, and Queues on disk under `.wrangler/`, so nothing touches your
Cloudflare account or your ElevenLabs credits.

To point the app at a fake ElevenLabs during development, create `.dev.vars` (gitignored):

```
ELEVENLABS_API_URL=http://127.0.0.1:9999/v1/speech-to-text
```

## What changed from the spec

`reference/REBUILD_SPEC.md` targets "a folder you copy to any Windows PC and run by
double-clicking one batch file." Cloudflare Workers is a stateless serverless runtime, so the
following decisions from spec §2 were necessarily re-made:

| Spec decision | Why it could not carry over | Replacement |
| --- | --- | --- |
| Bundled embedded Python 3.12 + FastAPI + uvicorn | Workers has no persistent process and no CPython. Python Workers is an open beta on Pyodide, and `reportlab`, `python-docx`, `lxml`, `Pillow`, and `keyring` are compiled-extension packages Cloudflare does not document as supported there. | TypeScript on Workers with Hono |
| Windows Credential Manager for the API key | Windows-only API; no equivalent exists on Cloudflare. | Key in D1, app behind Cloudflare Access |
| `data\app.db` SQLite file | No writable local filesystem. | D1 (SQLite-compatible) |
| `data\jobs\<id>\` export folders | Same. | R2 objects under `<job_id>/` |
| `asyncio.create_task` background job, waited on indefinitely | No background process survives a request; Queue consumer invocations are capped at 15 minutes wall-time. | Queues, with a ~13 minute per-job ceiling |
| `python-docx` / `reportlab` | Not available. | `docx` / `pdf-lib` npm packages |
| Embedded runtime, `.bat` launchers, `Diagnose.bat`, `package_for_transfer.ps1`, `verify_runtime.py`, `manifest.txt` | These exist to solve "no Python on a Windows PC." | Dropped entirely |
| Jinja2 server-side templating of `index.html` | Static assets are served without a render step. | Option lists baked into `public/index.html`; keep in sync with `src/constants.ts` and `src/presets.ts` |

Behavioural differences worth knowing:

- **No indefinite waiting.** Spec §6 allowed `READ_TIMEOUT_SECONDS` unset to mean "wait forever."
  A job here gives up after about 13 minutes. Very long audio may need to be split.
- **Interrupted jobs are detected on read, not at startup.** There is no lifespan hook, so a job
  still non-terminal 20 minutes after it started is marked `error` the next time `GET /api/jobs`
  runs (spec §14's `mark_incomplete_jobs_as_interrupted`).
- **Cancellation is checked, not signalled.** The API request and the Queue consumer run in
  separate isolates, so cancel writes `cancelled` to D1 and the consumer discards its result at
  the next checkpoint. An ElevenLabs call already in flight still completes and still costs
  credits — the same caveat the desktop build carried.
- **Spec §19's defect does not apply.** Absolute paths were the bug; R2 keys are relative to the
  bucket by construction, so moving or redeploying cannot break stored references.

## Verification

Adapted from spec §20. Against a local `wrangler dev`:

| Check | Expected |
| --- | --- |
| `GET /healthz` | `{"status":"ok"}` |
| `GET /` | HTML, ~23 KB |
| `GET /api/jobs` | `{"jobs":[],"hidden_count":0,"include_hidden":false}` |
| `GET /api/settings` | 200 with option lists and key state |
| `GET /styles.css` | 200 |
| Submit a job | Reaches `success`; `outputs` lists json + each selected format |
| `GET /downloads/{job}/docx` | A valid Word 2007+ file |
| `GET /downloads/{job}/pdf` | A valid PDF |

`npm run typecheck` must pass, and `npx wrangler deploy --dry-run` must bundle cleanly.
