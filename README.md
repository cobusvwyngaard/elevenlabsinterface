# ElevenLabs Transcription Workbench — Cloudflare edition

A web app for running ElevenLabs speech-to-text jobs: pick audio files or HTTPS URLs, choose
transcription options, and get back a transcript plus exports in six formats. Job history and
transcripts are stored on Cloudflare.

This is a rewrite of the Windows desktop app described in
[`reference/REBUILD_SPEC.md`](reference/REBUILD_SPEC.md), targeting Cloudflare Workers instead.
The feature set is preserved; the platform mechanics are not, because they could not be — see
[What changed from the spec](#what-changed-from-the-spec).

**It runs on the Cloudflare free plan.** That constraint shaped the architecture: see
[Why the Worker does so little](#why-the-worker-does-so-little).

## Architecture

| Concern | Implementation |
| --- | --- |
| HTTP layer | Cloudflare Workers + [Hono](https://hono.dev) (`src/routes/`) |
| Frontend | Static assets in `public/`, served by the Workers Assets binding |
| Job history | Cloudflare D1 (`jobs`, `app_meta` — `migrations/0001_init.sql`) |
| Transcripts | Cloudflare R2, stored as the untouched ElevenLabs response |
| Background execution | Cloudflare Queues — the API enqueues, a consumer runs the job |
| Transcript shaping | The browser (`public/transcript-utils.js`) |
| Exports (all six formats) | The browser (`public/exporters.js`), DOCX/PDF via vendored `docx` and `pdf-lib` |
| API key storage | D1 (`app_meta`), behind Cloudflare Access |

Request flow: `POST /api/transcriptions` validates the form, stores the upload in R2, writes a
`queued` row to D1, and enqueues a message. The Queue consumer calls ElevenLabs and copies the
response bytes straight into R2 without parsing them. The browser polls `GET /api/jobs/{id}`
for status, and once a job succeeds it fetches the stored transcript **once** and derives
everything locally — transcript text, timeline, audio events, entities, speaker profiles, and
every export.

## Why the Worker does so little

The Workers **Free** plan allows **10 ms of CPU per invocation**. Waiting on ElevenLabs costs
no CPU (that is I/O), but touching the transcript does. Measured on representative transcripts,
the original server-side design cost:

| Audio length | Queue consumer | Poll endpoint (every 2s) |
| --- | --- | --- |
| ~7 min | 17 ms | 9 ms |
| ~35 min | 54 ms | 48 ms |
| ~1 hour | 62 ms | 48 ms |
| ~2 hours | 133 ms | 83 ms |

Two things were expensive: `JSON.parse` of a multi-megabyte response, and re-deriving the
transcript on every single poll. Moving all of it into the browser leaves the Worker with a
bounded 256 KB prefix scan (`src/responseScan.ts`) that extracts just the transcription id,
detected language, and preview text:

| Audio length | Queue consumer | Poll endpoint |
| --- | --- | --- |
| ~5 min | 0.25 ms | no transcript work |
| ~1 hour | 0.20 ms | no transcript work |
| ~3.5 hours | 0.18 ms | no transcript work |

Flat, because the scan never reads more than its prefix. These figures come from Node/V8 on a
dev machine rather than workerd on Cloudflare hardware, so treat them as a proxy — but the
margin is three orders of magnitude, not a few percent.

## First-time setup

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

Free-plan allowances this app sits well inside: 100k requests/day, 10k queue operations/day,
5 GB D1 storage, 10 GB R2 storage.

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

## Local development

```sh
npx wrangler d1 migrations apply workbench --local
npx wrangler dev --local
```

`--local` simulates D1, R2, and Queues on disk under `.wrangler/`, so nothing touches your
Cloudflare account or your ElevenLabs credits. To point the app at a fake ElevenLabs, create
`.dev.vars` (gitignored):

```
ELEVENLABS_API_URL=http://127.0.0.1:9999/v1/speech-to-text
```

## What changed from the spec

`reference/REBUILD_SPEC.md` targets "a folder you copy to any Windows PC and run by
double-clicking one batch file." Cloudflare Workers is a stateless serverless runtime, so the
decisions in spec §2 were necessarily re-made:

| Spec decision | Why it could not carry over | Replacement |
| --- | --- | --- |
| Bundled embedded Python 3.12 + FastAPI + uvicorn | No persistent process, no CPython. Python Workers is an open beta on Pyodide, and `reportlab`, `python-docx`, `lxml`, `Pillow` and `keyring` are compiled-extension packages Cloudflare does not document as supported there. | TypeScript on Workers with Hono |
| Windows Credential Manager for the API key | Windows-only API. | Key in D1, app behind Cloudflare Access |
| `data\app.db` SQLite file | No writable local filesystem. | D1 |
| `data\jobs\<id>\` export folders | Same. | R2, holding only the raw response |
| `asyncio.create_task` background job, waited on indefinitely | No background process survives a request; Queue consumer invocations cap at 15 minutes. | Queues, with a ~13 minute per-job ceiling |
| Server-side exporters (`python-docx`, `reportlab`) | Too expensive for the free CPU budget. | Browser-side, all six formats |
| Pre-selecting output formats on the submit form | Exports are now generated on demand, so choosing formats up front serves no purpose. | Every format is a download button in the Transcript Viewer |
| Embedded runtime, `.bat` launchers, `Diagnose.bat`, `package_for_transfer.ps1` | These solve "no Python on a Windows PC." | Dropped |
| Jinja2 templating of `index.html` | Static assets are served without a render step. | Option lists baked into `public/index.html`; keep in sync with `src/constants.ts` and `src/presets.ts` |

Behavioural differences worth knowing:

- **No indefinite waiting.** Spec §6 allowed "wait forever"; a job here gives up after about
  13 minutes. Very long audio may need to be split.
- **Interrupted jobs are detected on read.** There is no lifespan hook, so a job still
  non-terminal 20 minutes after starting is marked `error` the next time `GET /api/jobs` runs.
- **Cancellation is checked, not signalled.** The API request and the Queue consumer run in
  separate isolates, so cancel writes `cancelled` to D1 and the consumer discards its result at
  the next checkpoint. A call already in flight still completes and still costs credits.
- **`transcription_id` comes from a bounded prefix scan.** If ElevenLabs ever returned it
  beyond the first 256 KB of the response, it would be missed, and the remote verify/delete
  features would report the job as having no stored id.
- **Spec §19's defect does not apply.** R2 keys are relative by construction.

## Verification

| Check | Expected |
| --- | --- |
| `GET /healthz` | `{"status":"ok"}` |
| `GET /api/jobs` | `{"jobs":[],"hidden_count":0,"include_hidden":false}` |
| `GET /api/settings` | 200 with option lists and key state |
| Submit a job | Reaches `success`; viewer offers all six export buttons |
| Word / PDF buttons | Produce a valid Word 2007+ file and a valid PDF |

`npm run typecheck` must pass and `npx wrangler deploy --dry-run` must bundle cleanly.
