export const UPLOAD_PREFIX = "uploads";

export function uploadKey(jobId: string, fileName: string): string {
  return `${UPLOAD_PREFIX}/${jobId}/${fileName}`;
}

export function speakerNamesKey(jobId: string): string {
  return `${jobId}/speaker-names.json`;
}

export async function readSpeakerNames(bucket: R2Bucket, jobId: string): Promise<Record<string, string>> {
  const object = await bucket.get(speakerNamesKey(jobId));
  if (!object) {
    return {};
  }
  try {
    return (await object.json()) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function writeSpeakerNames(
  bucket: R2Bucket,
  jobId: string,
  names: Record<string, string>
): Promise<void> {
  await bucket.put(speakerNamesKey(jobId), JSON.stringify(names), {
    httpMetadata: { contentType: "application/json" },
  });
}

export async function deleteSpeakerNames(bucket: R2Bucket, jobId: string): Promise<void> {
  await bucket.delete(speakerNamesKey(jobId));
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

/** Removes every stored object for a job: the transcript, speaker names, and any upload. */
export async function deleteJobObjects(bucket: R2Bucket, jobId: string): Promise<void> {
  await deletePrefix(bucket, `${jobId}/`);
  await deletePrefix(bucket, `${UPLOAD_PREFIX}/${jobId}/`);
}
