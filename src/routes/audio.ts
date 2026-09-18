import { Hono, type Context } from "hono";
import { verifyAudioUrl } from "../signing";
import { httpError, services, type AppContext } from "./deps";

export const audioRoutes = new Hono<AppContext>();

/**
 * Hands the uploaded audio to ElevenLabs, which fetches this URL itself.
 *
 * The body is streamed straight from R2, so a recording of any size passes through without
 * being held in the Worker's 128 MB of memory. Access is granted by a signature with a short
 * expiry rather than a session, because the caller is ElevenLabs rather than a browser.
 *
 * NOTE: if Cloudflare Access is enabled on this Worker, /audio/* needs a Bypass policy or
 * ElevenLabs will be served the login page instead of the audio.
 */
async function serveAudio(c: Context<AppContext>) {
  const { repository } = services(c);
  const jobId = c.req.param("job_id") ?? "";

  const valid = await verifyAudioUrl(
    repository,
    jobId,
    c.req.query("expires"),
    c.req.query("signature")
  );
  if (!valid) {
    throw httpError(403, "This audio link is not valid or has expired.");
  }

  const record = await repository.getJob(jobId);
  const key = record?.effective_settings?.upload_key;
  if (!key) {
    throw httpError(404, "No audio is stored for this job.");
  }

  const range = c.req.header("range");
  const object = await c.env.TRANSCRIPTS.get(key, range ? { range: c.req.raw.headers } : undefined);
  if (!object) {
    throw httpError(404, "The uploaded audio is no longer available.");
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("accept-ranges", "bytes");
  headers.set("etag", object.httpEtag);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/octet-stream");
  }

  // A ranged hit reports the slice it actually returned.
  if (object.range && "offset" in object.range) {
    const offset = object.range.offset ?? 0;
    const length = object.range.length ?? object.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set("content-length", String(object.size));
  return new Response(object.body, { headers });
}

audioRoutes.get("/audio/:job_id", serveAudio);
// The filename segment is what gives the URL its extension.
audioRoutes.get("/audio/:job_id/:filename", serveAudio);
