import type { Account } from "./accounts";
import type { JobRepository } from "./db";

const API_KEY_META = "elevenlabs_api_key";

/**
 * The ElevenLabs key for whoever is signed in.
 *
 * Replaces the Windows Credential Manager store from REBUILD_SPEC.md §2. Cloudflare has no
 * per-device secret vault, so keys live in D1. They are now per account rather than one global
 * key, which is what lets several people use the app with their own credits.
 */
export class KeyStore {
  constructor(
    private readonly repository: JobRepository,
    private readonly account?: Account
  ) {}

  async getKey(): Promise<string | null> {
    if (this.account) {
      const key = this.account.api_key;
      return key && key.trim() ? key : null;
    }
    // No account in hand: the single key from before accounts existed.
    const stored = await this.repository.getMetaJson<string | null>(API_KEY_META, null);
    return stored && stored.trim() ? stored : null;
  }
}

export function maskKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 4) {
    return "••••••••";
  }
  return `••••••••${trimmed.slice(-4)}`;
}

export const LEGACY_API_KEY_META = API_KEY_META;
