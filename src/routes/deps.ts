import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
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
}

export function services(c: Context<AppContext>): Services {
  const repository = new JobRepository(c.env.DB);
  return {
    repository,
    keyStore: new KeyStore(repository),
    service: new JobService(c.env, repository),
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
    throw httpError(400, `Save an ElevenLabs API key before ${purpose}.`);
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
