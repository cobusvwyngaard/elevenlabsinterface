import type { TranscriptResponse } from "./types";

export const UPLOAD_PREFIX = "uploads";

export function uploadKey(jobId: string, fileName: string): string {
  return `${UPLOAD_PREFIX}/${jobId}/${fileName}`;
}

export function speakerNamesKey(jobId: string): string {
  return `${jobId}/speaker-names.json`;
}

export async function readJsonObject<T>(bucket: R2Bucket, key: string | null): Promise<T | null> {
  if (!key) {
    return null;
  }
  const object = await bucket.get(key);
  if (!object) {
    return null;
  }
  try {
    return (await object.json()) as T;
  } catch {
    return null;
  }
}

export function readTranscriptResponse(bucket: R2Bucket, key: string | null): Promise<TranscriptResponse | null> {
  return readJsonObject<TranscriptResponse>(bucket, key);
}

export async function readSpeakerNames(bucket: R2Bucket, jobId: string): Promise<Record<string, string>> {
  return (await readJsonObject<Record<string, string>>(bucket, speakerNamesKey(jobId))) ?? {};
}

export async function writeSpeakerNames(
  bucket: R2Bucket,
  jobId: string,
  names: Record<string, string>
): Promise<void> {
  await bucket.put(speakerNamesKey(jobId), JSON.stringify(names, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
}

async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix, cursor });
    const keys = listed.objects.map((object) => object.key);
    if (keys.length > 0) {
      await bucket.delete(keys);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

/** Removes every stored object for a job: exports, transcript JSON, and any upload. */
export async function deleteJobObjects(bucket: R2Bucket, jobId: string): Promise<void> {
  await deletePrefix(bucket, `${jobId}/`);
  await deletePrefix(bucket, `${UPLOAD_PREFIX}/${jobId}/`);
}

export async function deleteNamedExports(bucket: R2Bucket, jobId: string): Promise<void> {
  await deletePrefix(bucket, `${jobId}/named-transcript`);
  await bucket.delete(speakerNamesKey(jobId));
}
