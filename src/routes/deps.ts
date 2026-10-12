import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { AccountStore, readSessionCookie, type Account } from "../accounts";
import { JobRepository } from "../db";
import { ElevenLabsAPIError } from "../elevenlabsClient";
import { JobService } from "../jobs";
import { KeyStore } from "../keyStore";
import type { Env, JobRecord } from "../types";

export type AppContext = { Bindings: Env };

export interface Services {
  repository: JobRepository;
  keyStore: KeyStore;
  service: JobService;
  account: Account;
}

/**
 * Resolves the signed-in account from the session cookie.
 *
 * Returns null rather than throwing, so the login route and the page itself can ask without
 * being refused.
 */
export async function currentAccount(c: Context<AppContext>): Promise<Account | null> {
  const identifier = readSessionCookie(c.req.header("cookie"));
  if (!identifier) {
    return null;
  }
  return new AccountStore(c.env.DB).findByIdentifier(identifier);
}

/**
 * Everything a signed-in request needs, with the account already applied to the data layer.
 *
 * This is the only way routes get a repository, which is what makes the per-account scoping
 * hold: there is no unscoped path for a request to reach by accident.
 */
export async function services(c: Context<AppContext>): Promise<Services> {
  const account = await currentAccount(c);
  if (!account) {
    throw httpError(401, "Sign in to continue.");
  }
  const repository = new JobRepository(c.env.DB, account.account_id);
  return {
    repository,
    keyStore: new KeyStore(repository, account),
    service: new JobService(c.env, repository),
    account,
  };
}

export function httpError(status: number, detail: string): HTTPException {
  return new HTTPException(status as never, {
    res: Response.json({ detail }, { status }),
  });
}

export async function requireApiKey(keyStore: KeyStore, purpose: string): Promise<string> {
  const apiKey = await keyStore.getKey();
  if (!apiKey) {
    throw httpError(400, `This account has no ElevenLabs API key set, so ${purpose} cannot start.`);
  }
  return apiKey;
}

export async function requireJob(repository: JobRepository, jobId: string): Promise<JobRecord> {
  const record = await repository.getJob(jobId);
  if (!record) {
    throw httpError(404, "Transcript job not found.");
  }
  return record;
}

/** Maps upstream ElevenLabs failures onto the same {detail} shape the UI expects. */
export function translateError(error: unknown): HTTPException {
  if (error instanceof HTTPException) {
    return error;
  }
  if (error instanceof ElevenLabsAPIError) {
    return httpError(error.statusCode, error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  return httpError(500, message);
}
