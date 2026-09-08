export interface NormalizedSubscription {
  tier: string | null;
  credits_used: number | null;
  credits_limit: number | null;
  credits_remaining: number | null;
  next_reset_unix: number | null;
  next_reset_at: string | null;
  billing_period: string | null;
  can_extend_character_limit: boolean | null;
}

export interface UsagePoint {
  timestamp: number;
  timestamp_iso: string | null;
  value: number;
}

export interface NormalizedUsageHistory {
  metric: string;
  series_label: string | null;
  points: UsagePoint[];
  total: number;
}

function toNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function isoFromUnix(value: number | null): string | null {
  if (value === null) {
    return null;
  }
  // ElevenLabs mixes seconds and milliseconds; anything past 10^10 is milliseconds.
  const millis = value > 1e10 ? value : value * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeSubscription(payload: Record<string, unknown>): NormalizedSubscription {
  const used = toNumber(payload.character_count);
  const limit = toNumber(payload.character_limit);
  const nextResetUnix = toNumber(payload.next_character_count_reset_unix);

  return {
    tier: typeof payload.tier === "string" ? payload.tier : null,
    credits_used: used,
    credits_limit: limit,
    credits_remaining: used !== null && limit !== null ? Math.max(limit - used, 0) : null,
    next_reset_unix: nextResetUnix,
    next_reset_at: isoFromUnix(nextResetUnix),
    billing_period: typeof payload.billing_period === "string" ? payload.billing_period : null,
    can_extend_character_limit:
      typeof payload.can_extend_character_limit === "boolean" ? payload.can_extend_character_limit : null,
  };
}

export function normalizeUsageHistory(payload: Record<string, unknown>, metric = "credits"): NormalizedUsageHistory {
  const timestamps = Array.isArray(payload.time) ? (payload.time as unknown[]).map(toNumber) : [];

  let seriesLabel: string | null = null;
  let values: (number | null)[] = [];

  const usage = payload.usage;
  if (Array.isArray(usage)) {
    values = usage.map(toNumber);
  } else if (usage && typeof usage === "object") {
    const entries = Object.entries(usage as Record<string, unknown>);
    if (entries.length > 0) {
      const [label, series] = entries[0];
      seriesLabel = label;
      values = Array.isArray(series) ? (series as unknown[]).map(toNumber) : [];
    }
  }

  const points: UsagePoint[] = values.map((value, index) => {
    const rawTimestamp = timestamps[index] ?? null;
    return {
      timestamp: rawTimestamp ?? 0,
      timestamp_iso: isoFromUnix(rawTimestamp),
      value: value ?? 0,
    };
  });

  return {
    metric,
    series_label: seriesLabel,
    points,
    total: points.reduce((sum, point) => sum + point.value, 0),
  };
}
