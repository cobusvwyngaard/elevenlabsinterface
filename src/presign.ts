import { AwsClient } from "aws4fetch";
import type { Env } from "./types";

/** Long enough for ElevenLabs to fetch and read a large file, short enough to be worth expiring. */
const URL_TTL_SECONDS = 2 * 60 * 60;

/** The bucket name from wrangler.jsonc, unless an override is configured. */
const DEFAULT_BUCKET = "workbench-transcripts";

export function presignConfigured(env: Env): boolean {
  return Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY);
}

/**
 * Signs a temporary download URL for an object in the bucket.
 *
 * This exists so the audio never has to travel through the Worker. Cloudflare caps a request body
 * at 100 MiB on this plan, and that cap applies to the Worker's own outgoing request, so pushing a
 * large recording to ElevenLabs is refused with a 413 before any of it is sent. Handing them a URL
 * instead means the bytes go straight from R2, and the ceiling becomes ElevenLabs' own 2 GB.
 *
 * The signature is in the query string, so the URL works for anyone holding it until it expires.
 * That is the point — ElevenLabs has to be able to fetch it without credentials — and is why the
 * lifetime is short and the key is a random UUID rather than anything guessable.
 */
export async function presignAudioUrl(env: Env, key: string): Promise<string> {
  if (!presignConfigured(env)) {
    throw new Error("R2 signing credentials are not configured.");
  }

  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    service: "s3",
    region: "auto",
  });

  const bucket = env.R2_BUCKET_NAME || DEFAULT_BUCKET;
  // Each path segment is encoded separately: the key contains slashes that must stay slashes.
  const path = key.split("/").map(encodeURIComponent).join("/");
  const endpoint = new URL(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${bucket}/${path}`);
  endpoint.searchParams.set("X-Amz-Expires", String(URL_TTL_SECONDS));

  const signed = await client.sign(endpoint.toString(), {
    method: "GET",
    aws: { signQuery: true },
  });

  return signed.url;
}
