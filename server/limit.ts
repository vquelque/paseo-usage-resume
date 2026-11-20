/** Pure decision logic: recognising a usage-limit failure and working out when the quota comes back. */

export interface UsageWindow {
  id: string;
  label?: string;
  usedPct?: number | null;
  remainingPct?: number | null;
  resetsAt?: string | null;
}

export interface UsageEntry {
  sourceId?: string;
  report?: { status?: string; windows?: UsageWindow[] };
}

/** Texts providers use when an account quota (not a transient error) stops a turn. */
const LIMIT_PATTERN =
  /usage limit|session limit|weekly limit|5-hour limit|hit your limit|limit reached|out of (extra )?usage|rate[ _-]?limit|usage_limit_reached|insufficient_quota|quota exceeded|too many requests|\b429\b/i;

/** A limit notice is short. Longer text is an agent merely talking about limits. */
const MAX_NOTICE_LENGTH = 400;

export function looksLikeLimit(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  return trimmed.length <= MAX_NOTICE_LENGTH && LIMIT_PATTERN.test(trimmed);
}

/** A window counts as depleted when at most this share of it is left. */
const DEPLETED_REMAINING_PCT = 1;

function isDepleted(window: UsageWindow): boolean {
  if (typeof window.remainingPct === "number") return window.remainingPct <= DEPLETED_REMAINING_PCT;
  if (typeof window.usedPct === "number") return window.usedPct >= 100 - DEPLETED_REMAINING_PCT;
  return false;
}

/** Per-model windows ("weekly_model_fable") only bind agents running that model. */
function appliesToModel(window: UsageWindow, model: string | null): boolean {
  const match = /_model_(.+)$/.exec(window.id);
  if (!match) return true;
  if (!model) return false;
  return model.toLowerCase().includes(match[1].toLowerCase());
}

export interface Depletion {
  /** Epoch ms when every depleted window has reset, or null when a depleted window has no reset time. */
  resetsAt: number | null;
  labels: string[];
}

/** Returns the depleted windows that block this agent, or null when none are depleted. */
export function findDepletion(entries: UsageEntry[], model: string | null): Depletion | null {
  let latest: number | null = null;
  let unknownReset = false;
  const labels: string[] = [];
  for (const entry of entries) {
    if (entry.report?.status !== "available") continue;
    for (const window of entry.report.windows ?? []) {
      if (!isDepleted(window) || !appliesToModel(window, model)) continue;
      labels.push(window.label ?? window.id);
      const at = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
      if (Number.isNaN(at)) unknownReset = true;
      else latest = latest === null ? at : Math.max(latest, at);
    }
  }
  if (labels.length === 0) return null;
  return { resetsAt: unknownReset ? null : latest, labels };
}
