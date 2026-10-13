import type { Env } from "./types";

/** Long enough that guessing is not a strategy, and in groups of four so it can be read aloud. */
const IDENTIFIER_BYTES = 15;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0 or I/1, which get misread

export interface Account {
  account_id: string;
  label: string;
  api_key: string;
  created_at: string;
  last_seen_at: string | null;
  disabled: number;
}

/**
 * Hashes a login identifier.
 *
 * SHA-256 rather than a password hash on purpose: this is a long random value, not a human-chosen
 * password, so there is no dictionary to slow an attacker down with and nothing for a work factor
 * to buy. What matters is that the plaintext is never stored.
 */
export async function hashIdentifier(identifier: string): Promise<string> {
  const normalised = normaliseIdentifier(identifier);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalised));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Spaces and case are forgiven, so a code read off a page still works. */
export function normaliseIdentifier(identifier: string): string {
  return String(identifier || "").replace(/[\s-]+/g, "").toUpperCase();
}

/** Generates an identifier for a new account, grouped for legibility. */
export function generateIdentifier(): string {
  const bytes = new Uint8Array(IDENTIFIER_BYTES);
  crypto.getRandomValues(bytes);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
  return chars.join("").replace(/(.{5})(?=.)/g, "$1-");
}

/**
 * A short, stable label for a key, so two accounts on the same key can be seen to be on it.
 *
 * Derived from the key rather than stored, which keeps it in step automatically. It is a truncated
 * hash: enough to group by, not enough to work backwards from.
 */
export async function keyFingerprint(apiKey: string): Promise<string> {
  const trimmed = (apiKey || "").trim();
  if (!trimmed) {
    return "";
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(trimmed));
  return [...new Uint8Array(digest)]
    .slice(0, 4)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class AccountStore {
  constructor(private readonly db: D1Database) {}

  async findByIdentifier(identifier: string): Promise<Account | null> {
    const hash = await hashIdentifier(identifier);
    const row = await this.db
      .prepare(`SELECT * FROM accounts WHERE identifier_hash = ? AND disabled = 0`)
      .bind(hash)
      .first<Account>();
    return row ?? null;
  }

  async findById(accountId: string): Promise<Account | null> {
    const row = await this.db
      .prepare(`SELECT * FROM accounts WHERE account_id = ?`)
      .bind(accountId)
      .first<Account>();
    return row ?? null;
  }

  async touch(accountId: string): Promise<void> {
    await this.db
      .prepare(`UPDATE accounts SET last_seen_at = ? WHERE account_id = ?`)
      .bind(new Date().toISOString(), accountId)
      .run();
  }

  async list(): Promise<Omit<Account, "api_key">[]> {
    const result = await this.db
      .prepare(
        `SELECT account_id, label, created_at, last_seen_at, disabled
         FROM accounts ORDER BY datetime(created_at) DESC`
      )
      .all<Omit<Account, "api_key">>();
    return result.results ?? [];
  }

  /**
   * The account list, with each key reduced to a fingerprint.
   *
   * Several accounts may deliberately hold the same key, drawing on the same credits while keeping
   * separate transcripts. Without this the admin page could not show which ones those are, and a
   * shared key would have to be tracked by memory.
   */
  async listWithKeys(): Promise<
    (Omit<Account, "api_key"> & { key_fingerprint: string; key_masked: string | null; shared_with: number })[]
  > {
    const result = await this.db
      .prepare(
        `SELECT account_id, label, api_key, created_at, last_seen_at, disabled
         FROM accounts ORDER BY datetime(created_at) DESC`
      )
      .all<Account>();

    const rows = result.results ?? [];
    const withPrints = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        key_fingerprint: await keyFingerprint(row.api_key),
      }))
    );

    const counts = new Map<string, number>();
    for (const row of withPrints) {
      if (row.key_fingerprint) {
        counts.set(row.key_fingerprint, (counts.get(row.key_fingerprint) ?? 0) + 1);
      }
    }

    return withPrints.map(({ api_key, ...rest }) => ({
      ...rest,
      key_masked: api_key?.trim() ? `••••${api_key.trim().slice(-4)}` : null,
      // How many accounts in total are on this key, this one included.
      shared_with: Math.max(0, (counts.get(rest.key_fingerprint) ?? 1) - 1),
    }));
  }

  /**
   * Replaces a key everywhere it is in use.
   *
   * Rotating a shared key one account at a time leaves any that were missed pointing at a key that
   * no longer works, which surfaces later as a transcription failing for no visible reason.
   */
  async replaceKeyEverywhere(fingerprint: string, newKey: string): Promise<number> {
    const result = await this.db.prepare(`SELECT account_id, api_key FROM accounts`).all<Account>();
    const matching: string[] = [];
    for (const row of result.results ?? []) {
      if ((await keyFingerprint(row.api_key)) === fingerprint) {
        matching.push(row.account_id);
      }
    }
    for (const accountId of matching) {
      await this.setApiKey(accountId, newKey);
    }
    return matching.length;
  }

  /** Reads one account's key, so a new account can be put on the same one without retyping it. */
  async keyOf(accountId: string): Promise<string | null> {
    const row = await this.db
      .prepare(`SELECT api_key FROM accounts WHERE account_id = ?`)
      .bind(accountId)
      .first<{ api_key: string }>();
    const key = row?.api_key?.trim();
    return key ? key : null;
  }

  /** Creates an account and returns the identifier, which is the only time it exists in plaintext. */
  async create(label: string, apiKey: string): Promise<{ accountId: string; identifier: string }> {
    const identifier = generateIdentifier();
    const accountId = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO accounts (account_id, identifier_hash, label, api_key, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(accountId, await hashIdentifier(identifier), label, apiKey, new Date().toISOString())
      .run();
    return { accountId, identifier };
  }

  async setApiKey(accountId: string, apiKey: string): Promise<void> {
    await this.db
      .prepare(`UPDATE accounts SET api_key = ? WHERE account_id = ?`)
      .bind(apiKey, accountId)
      .run();
  }

  async setDisabled(accountId: string, disabled: boolean): Promise<void> {
    await this.db
      .prepare(`UPDATE accounts SET disabled = ? WHERE account_id = ?`)
      .bind(disabled ? 1 : 0, accountId)
      .run();
  }

  /** Issues a fresh identifier for an account whose old one was lost or shared by accident. */
  async rotateIdentifier(accountId: string): Promise<string> {
    const identifier = generateIdentifier();
    await this.db
      .prepare(`UPDATE accounts SET identifier_hash = ? WHERE account_id = ?`)
      .bind(await hashIdentifier(identifier), accountId)
      .run();
    return identifier;
  }

  async deleteAccount(accountId: string): Promise<void> {
    await this.db.prepare(`DELETE FROM accounts WHERE account_id = ?`).bind(accountId).run();
  }

  /** Claims rows written before accounts existed, so the first account keeps its own history. */
  async adoptOrphanJobs(accountId: string): Promise<number> {
    const result = await this.db
      .prepare(`UPDATE jobs SET account_id = ? WHERE account_id IS NULL`)
      .bind(accountId)
      .run();
    return result.meta?.changes ?? 0;
  }
}

/** The cookie holding the identifier. HttpOnly so page scripts cannot read it back out. */
export const SESSION_COOKIE = "wb_session";

export function sessionCookie(identifier: string, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(identifier)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${60 * 60 * 24 * 30}`,
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function clearedCookie(secure: boolean): string {
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function readSessionCookie(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      const value = decodeURIComponent(rest.join("="));
      return value || null;
    }
  }
  return null;
}

/** Constant-time string compare, for the admin code where the secret is human-chosen. */
export function sameSecret(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left[i] ^ right[i];
  }
  return diff === 0;
}

export function isSecureRequest(env: Env, url: string): boolean {
  return new URL(url).protocol === "https:";
}
