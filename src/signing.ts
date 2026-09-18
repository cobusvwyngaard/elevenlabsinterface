import type { JobRepository } from "./db";

/**
 * Signs the temporary audio URLs handed to ElevenLabs.
 *
 * The key is generated on first use and kept in app_meta, so large-file support needs no
 * manual secret setup. Rotating it simply invalidates URLs that have not been fetched yet.
 */
const KEY_NAME = "audio_signing_key";

async function signingKey(repository: JobRepository): Promise<string> {
  const existing = await repository.getMetaJson<string | null>(KEY_NAME, null);
  if (typeof existing === "string" && existing.length >= 32) {
    return existing;
  }

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const key = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  await repository.setMetaJson(KEY_NAME, key);
  return key;
}

async function sign(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const imported = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", imported, encoder.encode(payload));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signAudioUrl(
  repository: JobRepository,
  origin: string,
  jobId: string,
  ttlSeconds: number,
  filename?: string
): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const secret = await signingKey(repository);
  const signature = await sign(secret, `${jobId}:${expires}`);

  // The filename is cosmetic and unsigned, but it gives the URL an extension. ElevenLabs uses
  // it alongside the content type to decide whether the target is audio it can handle.
  const suffix = filename ? `/${encodeURIComponent(filename)}` : "";
  return `${origin}/audio/${jobId}${suffix}?expires=${expires}&signature=${signature}`;
}

export async function verifyAudioUrl(
  repository: JobRepository,
  jobId: string,
  expires: string | undefined,
  signature: string | undefined
): Promise<boolean> {
  if (!expires || !signature) {
    return false;
  }
  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const secret = await signingKey(repository);
  const expected = await sign(secret, `${jobId}:${expiresAt}`);

  if (expected.length !== signature.length) {
    return false;
  }
  // Constant-time compare, so a wrong signature reveals nothing through timing.
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}
