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
| Audio uploads | Cloudflare R2 via multipart upload, straight from the browser in 20 MB parts |
| Background execution | Cloudflare Queues — the API enqueues, a consumer runs the job |
| Transcript shaping | The browser (`public/transcript-utils.js`) |
| Exports (all six formats) | The browser (`public/exporters.js`), DOCX/PDF via vendored `docx` and `pdf-lib` |
| API key storage | D1 (`app_meta`), behind Cloudflare Access |

Request flow: the browser uploads the audio to R2 first, in parts, then `POST
/api/transcriptions` submits JSON referencing the stored object — the audio never travels with
the job. The Queue consumer streams that object from R2 straight into the ElevenLabs request
and copies the response bytes back into R2 without parsing them. The browser
polls `GET /api/jobs/{id}` for status, and once a job succeeds it fetches the stored transcript
**once** and derives everything locally — transcript text, timeline, audio events, entities,
speaker profiles, and every export.

## Why the audio never passes through the Worker

Cloudflare rejects any request body over **100 MiB**, and a Worker isolate has only **128 MB of
memory**. A one-hour recording breaks both: it cannot arrive in a single request, and it cannot
be held in memory to forward on. So the audio is kept out of the Worker's hands entirely:

1. The browser slices the file into 20 MB parts and sends each to `PUT /api/uploads/part`,
   which streams it into an R2 multipart upload. Each request is far below the body limit, and
   a part that fails is retried on its own rather than restarting the whole transfer.
2. Job submission references the finished object by key, so it carries no audio at all.
3. The consumer signs a short-lived R2 download URL and passes it to ElevenLabs as `source_url`.
   ElevenLabs downloads the audio straight from the bucket. The bytes never enter the Worker.

### The 100 MiB limit applies to what the Worker sends, too

This is the part that is easy to get wrong, and this project got it wrong for several days.
Cloudflare's request body limit is not only about traffic arriving at the Worker — it also
applies to a subrequest the Worker makes. Pushing a large file to ElevenLabs from inside a
Worker is refused by Cloudflare with a **413 before any of it is sent**.

Measured against the deployed Worker, driving the real client with a deliberately invalid API
key so nothing was transcribed:

| Body | Result |
| --- | --- |
| 4 MB | forwarded, upstream answered `401 Invalid API key` |
| 64 MB | forwarded, answered in 1.6 s |
| 103,809,024 bytes (99 MiB) | forwarded, answered in 3.3 s |
| 105,906,176 bytes (101 MiB) | **413 in 30 ms** |
| 144,703,488 bytes (138 MB) | **413 in 74 ms** |

The cutoff is exactly 104,857,600 bytes. ElevenLabs is not the constraint: the same 138 MB
upload sent by `curl` from outside Cloudflare is accepted and answered normally, and their
documented ceiling is 5 GB. Nor is it the Workers plan — this limit follows the zone, so paying
for Workers would not move it.

Before the signed URL was in place, this surfaced as `Network connection lost` roughly 450 ms
into the transfer, because the upstream's answer was being discarded in favour of the
disconnect that answer caused. `transcribe()` now reads the response before blaming the body.

### Compressing before upload

A recording can also be made to fit rather than routed around the limit. The browser re-encodes
it to mono Opus before anything is uploaded, chosen with **Compress before uploading**:

| Mode | Behaviour |
| --- | --- |
| Only when the file is too large | The default. Small audio files are uploaded untouched; **video is always converted**, whatever its size. |
| Always | Re-encodes everything, which also shortens the upload. |
| Never | Uploads the original, and refuses anything over the limit. |

Measured on a 2.5 hour, 139.1 MB AAC recording: **52.6 MB out, in 100 seconds** — about 90x
realtime, and roughly 22 MB per hour of audio at the default 48 kbps. The fixture was pink and
brown noise, which is close to the worst case for Opus; speech compresses further.

A video is converted even when it would have fitted. Only the audio track is transcribed, so the
video is bytes uploaded and waited on that nothing will ever read: an MP4 fixture of 2.2 MB comes
out at 359 KB with a single Opus stream and no video in it. MP4, MOV and M4V are read a piece at a
time, so length is no obstacle; WebM, MKV and the rest go through the browser's whole-file decoder
instead, which is refused above 25 minutes because the memory it needs follows duration rather than
file size — 64 MB of 32 kbps mono is over four hours, and several gigabytes of PCM.

When a conversion cannot be done but the file already fits, it is uploaded unconverted and the
reason is shown, rather than failing. Converting video is a saving, not a requirement, and it must
not turn a job that would have worked into one that does not.

On quality: the published work on Opus and speech recognition puts word error rate a percentage
point above clean speech at 6 kbps and converging on it well below 32 kbps, so 48 kbps mono is
comfortably inside the range where transcription is unaffected. That evidence is about word
accuracy and not about **diarization**, which leans on spectral detail that a low bitrate discards
first. If speaker separation matters more than the last fraction of a percent of word accuracy,
compare a short excerpt at 64 kbps against the original before trusting a long recording to it.

The browser's own codecs do the work, through WebCodecs. ffmpeg.wasm would have been less code,
but its core is 30.7 MB and Cloudflare caps a single static asset at 25 MiB, so it could not be
served from here at all. Chrome and Edge can decode AAC; Firefox and Safari may not, and the
option reports that rather than failing late.

Output is Opus in Ogg, muxed in `public/ogg-opus.js`. The container is written by hand because
WebCodecs hands back bare packets. Its CRC is checked against an independent implementation, and
the muxed output is verified by decoding it with ffmpeg: a fixture stepping through six
frequencies comes back with the right tone in the right ten-second window, which is what proves
the pipeline neither drifts nor drops time.

### What happens without R2 signing credentials

If `R2_ACCESS_KEY_ID` and friends are not set, the consumer falls back to streaming the audio
through the Worker, and the 100 MiB ceiling applies. The limit is enforced in three places —
in the browser before a byte is uploaded, at submission, and in the consumer against the real
size of the object in the bucket rather than the size the browser claimed. `GET /api/settings`
reports the effective limit as `max_upload_bytes`, so the browser always matches the server.

With signing configured, the ceiling becomes ElevenLabs' **2 GB** limit for a fetched URL.

One workerd detail worth knowing if the direct-push path is ever touched: a streaming body does
not survive the Request being re-created. Passing an init as `fetch`'s second argument, or
wrapping an existing Request, silently sends zero bytes. `send()` therefore builds the Request
once, with the abort signal already in it, and hands it to `fetch` untouched.

## The 120 second ceiling on waiting

Cloudflare cuts a Worker's outgoing request off after a fixed **120 second proxy read timeout**,
which cannot be raised below an Enterprise plan. A long recording cannot be transcribed inside one
synchronous request from here: the 2.5 hour job that produced this section came back **524 after
126.9 seconds**, with the credits spent either way.

ElevenLabs is not the one timing out. Its API sits behind Google (`via: 1.1 google`,
`x-region: us-central1`) and 524 is a Cloudflare status, so the cut came from this side.

So the audio is submitted with `webhook=true`, which returns an id immediately, and the transcript
is collected afterwards by polling `GET /v1/speech-to-text/transcripts/{id}`. **The webhook itself
is never received** — nothing here has to be publicly reachable, which matters once Access is on.
Each check is its own short queue message rather than a connection held open, because the same
120 second ceiling applies to waiting as to transcribing: 20 seconds after submission, then every
30 seconds, giving up just short of half an hour.

If ElevenLabs refuses the asynchronous request with a 4xx — for instance if a deployment cannot
use webhooks at all — the job falls back to the synchronous path, which still works for anything
short. That fallback re-opens the audio from R2 first: a streamed body can only be sent once, and
without doing so the retry would send an empty file and blame ElevenLabs for it.

Two cases deliberately do **not** fall back. A 5xx or a 524 means the audio may already have been
accepted, and a 202 carrying no transcription id means it certainly was. Sending it again would be
charged twice, so the job fails and says where the transcript might still be found.

A job ElevenLabs has accepted is given 45 minutes before the stale sweep gives up on it, rather
than the 20 a job that never got that far gets. Judged by the same clock, the sweep would declare
a transcription still in progress dead and stop collecting it.

## Choosing files, and naming what comes out

Files can be dropped onto the upload area as well as chosen from it. A drop assigns the files to
the file input rather than keeping its own copy, so submission, the compression hint and the size
guard all keep reading one source of truth, and a `change` event is dispatched by hand because
assigning `files` does not fire one. `dragover` and `drop` are cancelled page-wide outside the
zone as well: a file dropped slightly wide of it would otherwise replace the whole app.

Exports are named from a **Saved file name** box, seeded with the recording's own name without its
extension. It is only reseeded while it still holds what was put there, so an edit survives the
panel re-rendering, and it is cleared when a new job starts rather than inheriting the previous
job's edit. The name is read when a download button is pressed, not when the panel rendered, so an
edit made in between is the one that takes effect. Named-speaker exports get a `-named` suffix so
they cannot silently overwrite the plain ones.

Every download opens a **Save As** dialog so the folder can be chosen, which is why each control
is a button rather than a link: a link goes straight to the download folder. `showSaveFilePicker`
needs the click's transient user activation, so it is called before the file contents are built —
awaiting a DOCX or PDF build first would spend the activation and the dialog would never appear.
Where the API is unavailable (Firefox, Safari) it falls back to a plain download.

## Diagnosing a failed job

Three places record what happened, because they fail in different ways.

`GET /api/diagnostics` returns the last jobs and an append-only event trail from D1 — one row
per step, written as it happens rather than with the job record. Add `?job=<id>` for a single
job. Because each row is written immediately, a consumer that is killed outright leaves a trail
that simply stops at the last step it finished, which is the only way to tell "ElevenLabs
rejected it" from "the worker died mid-upload":

```sh
curl -s https://<worker-host>/api/diagnostics?limit=20 | python3 -m json.tool
```

The events carry timings (`elapsed_ms`), sizes, upstream status codes, error payloads and
stack traces. `consumer.received` records the queue attempt number, so a retry after a silent
death is visible.

**Cloudflare's Workers Logs** (`observability` is enabled in `wrangler.jsonc`) capture the same
lines plus uncaught exceptions and hard kills that never got to write anything. Read them under
the Worker → Logs in the dashboard. A search on the job id pulls one run together.

The job's own **progress timeline** in the UI is the same story for the person waiting.

Note that `/api/diagnostics` is not separately protected: it exposes filenames, timings and
error text, though no API key or transcript content. It sits behind the same Cloudflare Access
gate as everything else.

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

### R2 signing credentials (needed for files over 100 MiB)

Without these the app still works, but is capped at 100 MiB per recording for the reason set out
above. With them, ElevenLabs downloads the audio from R2 itself and the cap becomes 2 GB. There
is no extra cost: R2 egress is free, and this stays inside the free allowances.

In the Cloudflare dashboard:

1. **R2** → **API** → **Manage API tokens** → **Create API token**.
2. Permission **Object Read only**, scoped to the `workbench-transcripts` bucket. Read is all
   the Worker needs — it only ever signs download URLs.
3. Copy the **Access Key ID**, the **Secret Access Key**, and your **Account ID**. The secret is
   shown once.
4. **Workers & Pages** → this Worker → **Settings** → **Variables and Secrets**, and add three
   secrets:

   | Name | Value |
   | --- | --- |
   | `R2_ACCOUNT_ID` | your Cloudflare account ID |
   | `R2_ACCESS_KEY_ID` | the Access Key ID from step 3 |
   | `R2_SECRET_ACCESS_KEY` | the Secret Access Key from step 3 |

Locally, put the same three in `.dev.vars`, which is gitignored.

The signed URL lives for two hours and carries its signature in the query string, so anyone
holding it can download that one object until it expires. That is unavoidable — ElevenLabs has
to fetch it without credentials — and is why the lifetime is short and object keys are random
UUIDs. The audio is deleted from R2 as soon as the transcript comes back.

`GET /api/settings` reports `audio_delivery` as `linked` once signing is configured, and
`direct` otherwise, which is the quickest way to confirm the secrets took effect.

### Restrict access (do this before saving an API key)

The Worker URL is public by default, and the app stores your ElevenLabs API key server-side —
so anyone who finds the URL could spend your credits.

Access is now attached to the Worker itself rather than to a hostname, which matters here: a
`workers.dev` subdomain is not a zone you own, so the older self-hosted-application flow did not
cleanly cover it. The Worker-level policy covers every route, Custom Domain, `workers.dev`
hostname and preview URL at once.

1. Cloudflare dashboard → **Workers & Pages** → this Worker → the **Access** tab.
2. **Protect this Worker behind Access**.
3. Choose **All traffic**, not Previews only. Previews only leaves production open.
4. Allow by Cloudflare account membership, your email address, or your email domain.
5. **Apply Access**, then confirm a private window prompts for authentication.

Zero Trust is free up to 50 users, so this costs nothing at one user.

Nothing the app depends on needs a bypass. ElevenLabs fetches the audio from
`r2.cloudflarestorage.com`, not from this Worker, so a signed download URL keeps working. The
queue consumer runs inside the runtime rather than over HTTP, and CI deploys go through the
Cloudflare API, so neither is affected.

Be aware of what it does close off: `GET /api/diagnostics` stops being readable from outside
without a service token, so the event trail has to be read from a signed-in browser. Turn Access
on last, after a large file has been confirmed working end to end.

This replaces the Windows Credential Manager decision in spec §2. There is no per-device
encrypted secret store on Cloudflare; the protection is the Access gate, not the storage layer.

### Housekeeping: expire abandoned uploads

An upload that completes but whose job is never created has nothing left pointing at it. The app
discards those itself, but a lifecycle rule catches anything a failed or stale browser session
leaves behind:

Cloudflare dashboard → **R2** → `workbench-transcripts` → **Settings** → **Object lifecycle
rules** → **Add rule**, scoped to prefix `uploads/`, deleting objects after 1 day and aborting
incomplete multipart uploads after 1 day.

Audio is deleted as soon as its transcript comes back, so a day is generous.

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
- **Abandoned uploads are not swept up.** Audio is deleted once a job finishes or fails, and
  when a job is deleted, but a file uploaded in a tab that is then closed before submitting
  stays in R2. Add an R2 lifecycle rule expiring the `uploads/` prefix after a day to cover it.
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
