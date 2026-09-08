import { Hono } from "hono";
import {
  AUDIO_TYPES,
  ENTITY_DETECTION_OPTIONS,
  LANGUAGES,
  MODELS,
  TIMESTAMP_GRANULARITIES,
} from "../constants";
import { maskKey } from "../keyStore";
import { AUDIO_TYPE_PRESETS } from "../presets";
import type { KeytermPreset } from "../types";
import { httpError, services, type AppContext } from "./deps";

export const settingsRoutes = new Hono<AppContext>();

settingsRoutes.get("/api/settings", async (c) => {
  const { repository, keyStore } = services(c);
  const apiKey = await keyStore.getKey();
  const [defaults, presets] = await Promise.all([
    repository.getLastUsedDefaults(),
    repository.getKeytermPresets(),
  ]);

  return c.json({
    api_key_saved: Boolean(apiKey),
    api_key_masked: apiKey ? maskKey(apiKey) : null,
    last_used_defaults: defaults,
    keyterm_presets: presets,
    audio_types: AUDIO_TYPES,
    models: MODELS,
    timestamps: TIMESTAMP_GRANULARITIES,
    entity_detection: ENTITY_DETECTION_OPTIONS,
    languages: LANGUAGES,
    presets: AUDIO_TYPE_PRESETS,
  });
});

settingsRoutes.post("/api/settings/api-key", async (c) => {
  const { keyStore } = services(c);
  const body = await c.req.json<{ api_key?: string }>().catch(() => ({}) as { api_key?: string });
  const apiKey = (body.api_key ?? "").trim();
  if (!apiKey) {
    throw httpError(400, "Enter an ElevenLabs API key.");
  }
  await keyStore.saveKey(apiKey);
  return c.json({ saved: true, masked: maskKey(apiKey) });
});

settingsRoutes.delete("/api/settings/api-key", async (c) => {
  const { keyStore } = services(c);
  await keyStore.removeKey();
  return c.json({ saved: false, masked: null });
});

settingsRoutes.get("/api/keyterm-presets", async (c) => {
  const { repository } = services(c);
  return c.json({ presets: await repository.getKeytermPresets() });
});

settingsRoutes.post("/api/keyterm-presets", async (c) => {
  const { repository } = services(c);
  const body = await c.req
    .json<{ name?: string; terms?: string[] | string }>()
    .catch(() => ({}) as { name?: string; terms?: string[] | string });

  const name = (body.name ?? "").trim();
  if (!name) {
    throw httpError(400, "Enter a preset name.");
  }

  const rawTerms = body.terms ?? [];
  const terms = (Array.isArray(rawTerms) ? rawTerms : String(rawTerms).split(/[\n,]/))
    .map((term) => String(term).trim())
    .filter(Boolean);

  const presets = await repository.getKeytermPresets();
  const next: KeytermPreset[] = presets.filter(
    (preset) => preset.name.toLowerCase() !== name.toLowerCase()
  );
  next.push({ name, terms });
  next.sort((left, right) => left.name.localeCompare(right.name));

  await repository.setKeytermPresets(next);
  return c.json({ presets: next });
});

settingsRoutes.delete("/api/keyterm-presets/:name", async (c) => {
  const { repository } = services(c);
  const name = decodeURIComponent(c.req.param("name")).toLowerCase();
  const presets = await repository.getKeytermPresets();
  const next = presets.filter((preset) => preset.name.toLowerCase() !== name);
  await repository.setKeytermPresets(next);
  return c.json({ presets: next });
});
