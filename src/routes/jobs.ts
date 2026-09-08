import { Hono } from "hono";
import { ElevenLabsAPIError, ElevenLabsClient } from "../elevenlabsClient";
import { isTerminal, serializeSummary } from "../serialization";
import { readSpeakerNames, readTranscriptResponse, writeSpeakerNames } from "../storage";
import { httpError, requireApiKey, requireJob, services, translateError, type AppContext } from "./deps";

export const jobRoutes = new Hono<AppContext>();

jobRoutes.get("/api/jobs", async (c) => {
  const { repository, service } = services(c);
  const includeHidden = c.req.query("include_hidden") === "true";

  let records = await repository.listJobs();
  records = await service.markStaleJobsAsInterrupted(records);
  await service.reconcileSupersededJobs(records);
  records = await repository.listJobs();

  const hiddenCount = records.filter((record) => service.hidden(record)).length;
  const visible = includeHidden ? records : records.filter((record) => !service.hidden(record));

  return c.json({
    jobs: visible.map(serializeSummary),
    hidden_count: hiddenCount,
    include_hidden: includeHidden,
  });
});

// Declared before the /:job_id routes so "audit-remote" is not read as a job id.
jobRoutes.post("/api/jobs/audit-remote", async (c) => {
  const { repository, keyStore, service } = services(c);
  const apiKey = await requireApiKey(keyStore, "auditing remote data");

  const records = await repository.listJobs();
  const counts = { present: 0, missing: 0, not_available: 0, unknown: 0 };

  for (const record of records) {
    if (!isTerminal(record)) {
      continue;
    }
    const updated = await service.verifyRemoteRecord(record, apiKey);
    const status = (updated.effective_settings?.remote_presence_status ?? "unknown") as keyof typeof counts;
    if (status in counts) {
      counts[status] += 1;
    }
  }

  const refreshed = await repository.listJobs();
  return c.json({
    counts,
    message: `Checked ${counts.present + counts.missing + counts.not_available + counts.unknown} jobs against ElevenLabs.`,
    jobs: refreshed.map(serializeSummary),
  });
});

jobRoutes.get("/api/jobs/:job_id", async (c) => {
  const { repository, service } = services(c);
  let record = await requireJob(repository, c.req.param("job_id"));
  record = await service.refreshSavedOutputs(record);
  return c.json(await service.detailFor(record));
});

jobRoutes.post("/api/jobs/:job_id/verify-remote", async (c) => {
  const { repository, keyStore, service } = services(c);
  const apiKey = await requireApiKey(keyStore, "verifying remote data");
  const record = await requireJob(repository, c.req.param("job_id"));
  const updated = await service.verifyRemoteRecord(record, apiKey);
  return c.json(await service.detailFor(updated));
});

jobRoutes.post("/api/jobs/:job_id/visibility", async (c) => {
  const { repository, service } = services(c);
  const record = await requireJob(repository, c.req.param("job_id"));
  if (!isTerminal(record)) {
    throw httpError(409, "Finish or cancel the job before hiding it from Recent Jobs.");
  }

  const body = await c.req.json<{ hidden?: boolean }>().catch(() => ({}) as { hidden?: boolean });
  const hidden = Boolean(body.hidden);
  const updated = await service.saveHiddenState(record, { hidden, reason: "manual" });

  return c.json({
    message: hidden ? "Hidden from Recent Jobs." : "Restored to Recent Jobs.",
    job: await service.detailFor(updated),
  });
});

jobRoutes.post("/api/jobs/:job_id/cancel", async (c) => {
  const { repository, service } = services(c);
  const record = await requireJob(repository, c.req.param("job_id"));
  const updated = await service.cancelJob(record);
  return c.json(await service.detailFor(updated));
});

jobRoutes.post("/api/jobs/:job_id/delete", async (c) => {
  const { repository, keyStore, service } = services(c);
  const record = await requireJob(repository, c.req.param("job_id"));
  if (!isTerminal(record)) {
    throw httpError(409, "Wait for the job to finish or cancel it before deleting.");
  }

  const body = await c.req
    .json<{ delete_local?: boolean; delete_remote?: boolean }>()
    .catch(() => ({}) as { delete_local?: boolean; delete_remote?: boolean });
  const deleteLocal = Boolean(body.delete_local);
  const deleteRemote = Boolean(body.delete_remote);

  if (!deleteLocal && !deleteRemote) {
    throw httpError(400, "Choose local data, ElevenLabs data, or both.");
  }

  const messages: string[] = [];

  if (deleteRemote) {
    if (!record.transcription_id) {
      throw httpError(400, "This job does not have a saved ElevenLabs transcript ID to delete.");
    }
    const apiKey = await requireApiKey(keyStore, "deleting transcript data from ElevenLabs");
    const client = new ElevenLabsClient(c.env.ELEVENLABS_API_URL);
    try {
      await client.deleteTranscript(apiKey, record.transcription_id);
    } catch (error) {
      if (!(error instanceof ElevenLabsAPIError && error.statusCode === 404)) {
        throw translateError(error);
      }
    }
    const settings = record.effective_settings ?? {};
    settings.remote_deleted_at = new Date().toISOString();
    settings.remote_delete_status = "deleted";
    settings.last_known_transcription_id = record.transcription_id;
    record.transcription_id = null;
    record.effective_settings = settings;
    await repository.saveJob(record);
    messages.push("Deleted the ElevenLabs transcript.");
  }

  if (deleteLocal) {
    await service.deleteLocalJobData(record);
    messages.push("Deleted the local copy.");
    return c.json({ message: messages.join(" "), job_removed: true, job: null });
  }

  const updated = await requireJob(repository, record.job_id);
  return c.json({
    message: messages.join(" "),
    job_removed: false,
    job: await service.detailFor(updated),
  });
});

jobRoutes.post("/api/jobs/:job_id/speaker-names", async (c) => {
  const { repository, service } = services(c);
  const record = await requireJob(repository, c.req.param("job_id"));

  const body = await c.req
    .json<{ speaker_names?: Record<string, string> }>()
    .catch(() => ({}) as { speaker_names?: Record<string, string> });

  const names = Object.fromEntries(
    Object.entries(body.speaker_names ?? {})
      .map(([key, value]) => [key, String(value ?? "").trim()])
      .filter(([, value]) => value)
  );

  const response = await readTranscriptResponse(c.env.TRANSCRIPTS, record.response_json_path);
  if (!response) {
    throw httpError(404, "Requested export is not available for this job.");
  }

  await writeSpeakerNames(c.env.TRANSCRIPTS, record.job_id, names);
  const namedAssets = await service.refreshNamedOutputs(record, response, names);
  record.output_files = [
    ...(record.output_files ?? []).filter((asset) => !asset.format.startsWith("named_")),
    ...namedAssets,
  ];
  await repository.saveJob(record);

  return c.json(await service.detailFor(record));
});

jobRoutes.delete("/api/jobs/:job_id/speaker-names", async (c) => {
  const { repository, service } = services(c);
  const record = await requireJob(repository, c.req.param("job_id"));
  const updated = await service.clearSpeakerNames(record);
  return c.json(await service.detailFor(updated));
});
