import { Hono } from "hono";
import { UPLOAD_PREFIX } from "../storage";
import { httpError, type AppContext } from "./deps";

export const uploadRoutes = new Hono<AppContext>();

/**
 * Audio is uploaded straight into R2 in parts rather than posted with the job.
 *
 * Cloudflare rejects any request body over 100 MB, and a Worker only has 128 MB of memory, so
 * a long recording can neither arrive in one request nor be held in one. Each part is its own
 * small request that the Worker passes to R2 without buffering.
 */
export const PART_SIZE = 20 * 1024 * 1024;

function sanitizeName(name: string): string {
  return (name || "audio").replace(/[^A-Za-z0-9._-]/g, "_").slice(-120);
}

const EXTENSION_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/opus",
  webm: "video/webm",
  aac: "audio/aac",
  aiff: "audio/aiff",
  aif: "audio/aiff",
  wma: "audio/x-ms-wma",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  amr: "audio/amr",
  "3gp": "video/3gpp",
};

/** Browsers leave the type blank for some formats, so the extension is the fallback. */
export function contentTypeFor(filename: string, provided?: string): string {
  if (provided && provided !== "application/octet-stream") {
    return provided;
  }
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TYPES[extension] ?? "audio/mpeg";
}

uploadRoutes.post("/api/uploads", async (c) => {
  const body = await c.req
    .json<{ filename?: string; content_type?: string }>()
    .catch(() => ({}) as { filename?: string; content_type?: string });

  const filename = sanitizeName(body.filename ?? "audio");
  const key = `${UPLOAD_PREFIX}/${crypto.randomUUID()}/${filename}`;

  // The content type has to be stored here. ElevenLabs fetches this object by URL and rejects
  // it unless the response identifies itself as audio or video.
  const upload = await c.env.TRANSCRIPTS.createMultipartUpload(key, {
    httpMetadata: { contentType: contentTypeFor(filename, body.content_type) },
  });
  return c.json({ key, upload_id: upload.uploadId, part_size: PART_SIZE });
});

uploadRoutes.put("/api/uploads/part", async (c) => {
  const key = c.req.query("key");
  const uploadId = c.req.query("upload_id");
  const partNumber = Number(c.req.query("part_number"));

  if (!key || !uploadId || !Number.isInteger(partNumber) || partNumber < 1) {
    throw httpError(400, "Missing upload details for this part.");
  }
  if (!key.startsWith(`${UPLOAD_PREFIX}/`)) {
    throw httpError(400, "Unexpected upload key.");
  }
  if (!c.req.raw.body) {
    throw httpError(400, "This part had no data.");
  }

  const upload = c.env.TRANSCRIPTS.resumeMultipartUpload(key, uploadId);
  // Streamed through to R2, so part size is bounded by the request limit, not by memory.
  const part = await upload.uploadPart(partNumber, c.req.raw.body);

  return c.json({ part_number: part.partNumber, etag: part.etag });
});

uploadRoutes.post("/api/uploads/complete", async (c) => {
  const body = await c.req
    .json<{ key?: string; upload_id?: string; parts?: { part_number: number; etag: string }[] }>()
    .catch(() => ({}) as Record<string, never>);

  if (!body.key || !body.upload_id || !Array.isArray(body.parts) || body.parts.length === 0) {
    throw httpError(400, "Missing upload details.");
  }
  if (!body.key.startsWith(`${UPLOAD_PREFIX}/`)) {
    throw httpError(400, "Unexpected upload key.");
  }

  const upload = c.env.TRANSCRIPTS.resumeMultipartUpload(body.key, body.upload_id);
  const parts = body.parts
    .slice()
    .sort((left, right) => left.part_number - right.part_number)
    .map((part) => ({ partNumber: part.part_number, etag: part.etag }));

  try {
    const object = await upload.complete(parts);
    return c.json({ key: body.key, size: object.size });
  } catch (error) {
    throw httpError(400, `Could not assemble the upload: ${error instanceof Error ? error.message : error}`);
  }
});

/**
 * Throws away audio that no job will ever read.
 *
 * With an upload_id this abandons a multipart upload that never finished. Without one it deletes
 * an object that did finish but whose job was never created — a failed submission would otherwise
 * leave the whole file in the bucket permanently, with nothing left holding a reference to it.
 */
uploadRoutes.post("/api/uploads/abort", async (c) => {
  const body = await c.req
    .json<{ key?: string; upload_id?: string }>()
    .catch(() => ({}) as { key?: string; upload_id?: string });

  if (!body.key || !body.key.startsWith(`${UPLOAD_PREFIX}/`)) {
    throw httpError(400, "Missing upload details.");
  }

  if (body.upload_id) {
    await c.env.TRANSCRIPTS.resumeMultipartUpload(body.key, body.upload_id)
      .abort()
      .catch(() => undefined);
  } else {
    await c.env.TRANSCRIPTS.delete(body.key).catch(() => undefined);
  }
  return c.json({ aborted: true });
});
