import type { JobRepository } from "./db";

const API_KEY_META = "elevenlabs_api_key";

/**
 * Replaces the Windows Credential Manager store from REBUILD_SPEC.md §2.
 * Cloudflare has no per-device secret vault, so the key lives in D1 and the whole
 * app is expected to sit behind Cloudflare Access (see README).
 */
export class KeyStore {
  constructor(private readonly repository: JobRepository) {}

  async getKey(): Promise<string | null> {
    const stored = await this.repository.getMetaJson<string | null>(API_KEY_META, null);
    return stored && stored.trim() ? stored : null;
  }

  async saveKey(apiKey: string): Promise<void> {
    await this.repository.setMetaJson(API_KEY_META, apiKey);
  }

  async removeKey(): Promise<void> {
    await this.repository.deleteMeta(API_KEY_META);
  }
}

export function maskKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 4) {
    return "••••••••";
  }
  return `••••••••${trimmed.slice(-4)}`;
}
