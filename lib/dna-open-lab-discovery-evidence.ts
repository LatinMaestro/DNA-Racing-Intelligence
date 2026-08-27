import { createHash } from "node:crypto";

import type {
  DnaOpenLabRateLimit,
  DnaOpenLabScope,
  DnaRaceDocument,
} from "./dna-open-lab-v1-client";

const DEFAULT_MAXIMUM_DEPTH = 10;
const DEFAULT_MAXIMUM_PATHS = 1_024;
const MAXIMUM_DEPTH_LIMIT = 16;
const MAXIMUM_PATH_LIMIT = 4_096;
const SENSITIVE_DYNAMIC_KEY_PATTERNS = [
  /^\d+$/u,
  /^0x[0-9a-f]{40}$/iu,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu,
  /^[A-Za-z0-9_-]{24,}$/u,
  /^[^@\s]+@[^@\s]+\.[^@\s]+$/u,
] as const;

export type DnaOpenLabJsonKind =
  "null" | "boolean" | "number" | "string" | "array" | "object";

export type DnaOpenLabShapePath = Readonly<{
  path: string;
  kinds: readonly DnaOpenLabJsonKind[];
}>;

export type DnaOpenLabShapeSummary = Readonly<{
  rootKind: DnaOpenLabJsonKind;
  pathCount: number;
  paths: readonly DnaOpenLabShapePath[];
  sha256: string;
}>;

export type DnaOpenLabSafeRateLimitEvidence = Readonly<{
  limit: number | null;
  remaining: number | null;
  resetSeconds: number | null;
  rateClass: string | null;
  retryAfterSeconds: number | null;
}>;

export type DnaOpenLabConnectedProbeEvidence = Readonly<{
  endpoint: string;
  scope: DnaOpenLabScope;
  laneId: "key-1" | "key-2" | "key-3";
  outcome: "success" | "api_error" | "not_probed";
  httpStatus: number | null;
  errorKind: string | null;
  rateLimit: DnaOpenLabSafeRateLimitEvidence | null;
  shape: DnaOpenLabShapeSummary | null;
}>;

export type DnaOpenLabHistoryWindowId =
  | "recent_0_7d"
  | "historical_30_90d"
  | "historical_90_365d"
  | "historical_365_730d"
  | "historical_730_1095d";

export type DnaOpenLabHistoryWindowPlan = Readonly<{
  windowId: DnaOpenLabHistoryWindowId;
  startTime: string;
  endTime: string;
  limit: number;
}>;

export type DnaOpenLabHistoryWindowEvidence = Readonly<{
  windowId: DnaOpenLabHistoryWindowId;
  resultCountClass: "zero" | "below_request_limit" | "at_request_limit";
  timestampVerification:
    | "not_applicable"
    | "verified_within_window"
    | "unverified_missing_timestamp"
    | "invalid_timestamp"
    | "outside_requested_window";
}>;

export type DnaOpenLabPairCandidate = Readonly<{
  fatherCoreId: number;
  motherCoreId: number;
}>;

const CONNECTED_DISCOVERY_LANES = ["key-1", "key-2", "key-3"] as const;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;
const HISTORY_WINDOW_SPECS = Object.freeze([
  Object.freeze({
    windowId: "recent_0_7d" as const,
    olderAgeDays: 7,
    newerAgeDays: 0,
    limit: 200,
  }),
  Object.freeze({
    windowId: "historical_30_90d" as const,
    olderAgeDays: 90,
    newerAgeDays: 30,
    limit: 1,
  }),
  Object.freeze({
    windowId: "historical_90_365d" as const,
    olderAgeDays: 365,
    newerAgeDays: 90,
    limit: 1,
  }),
  Object.freeze({
    windowId: "historical_365_730d" as const,
    olderAgeDays: 730,
    newerAgeDays: 365,
    limit: 1,
  }),
  Object.freeze({
    windowId: "historical_730_1095d" as const,
    olderAgeDays: 1_095,
    newerAgeDays: 730,
    limit: 1,
  }),
]);

function positiveSafeInteger(
  value: number,
  field: string,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`DNA Open Lab discovery evidence: ${field} is invalid`);
  }
  return value;
}

function jsonKind(value: unknown): DnaOpenLabJsonKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "string";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        "DNA Open Lab discovery evidence: non-finite number is not JSON-safe",
      );
    }
    return "number";
  }
  if (typeof value === "object") return "object";
  throw new Error(
    "DNA Open Lab discovery evidence: value is not JSON-compatible",
  );
}

function safeObjectSegment(value: string): string {
  if (
    value.length < 1 ||
    value.length > 64 ||
    SENSITIVE_DYNAMIC_KEY_PATTERNS.some((pattern) => pattern.test(value))
  ) {
    return "*";
  }
  return value.replace(/[.[\]\\]/gu, "_");
}

function stableKindOrder(left: DnaOpenLabJsonKind, right: DnaOpenLabJsonKind) {
  const order: readonly DnaOpenLabJsonKind[] = [
    "null",
    "boolean",
    "number",
    "string",
    "array",
    "object",
  ];
  return order.indexOf(left) - order.indexOf(right);
}

export function planDnaOpenLabHistoryWindows(
  now: Date,
): readonly DnaOpenLabHistoryWindowPlan[] {
  const nowMilliseconds = now.getTime();
  if (!Number.isFinite(nowMilliseconds)) {
    throw new Error("DNA Open Lab discovery evidence: now is invalid");
  }
  return Object.freeze(
    HISTORY_WINDOW_SPECS.map((window) =>
      Object.freeze({
        windowId: window.windowId,
        startTime: new Date(
          nowMilliseconds - window.olderAgeDays * DAY_MILLISECONDS,
        ).toISOString(),
        endTime: new Date(
          nowMilliseconds - window.newerAgeDays * DAY_MILLISECONDS,
        ).toISOString(),
        limit: window.limit,
      }),
    ),
  );
}

export function buildDnaOpenLabPairCandidates(input: {
  owned: readonly Readonly<{ hid: number; gender: string }>[];
  arena: readonly Readonly<{ hid: number; gender: string }>[];
  maximum: number;
}): readonly DnaOpenLabPairCandidate[] {
  const maximum = positiveSafeInteger(input.maximum, "maximum", 20);
  const valid = (core: Readonly<{ hid: number; gender: string }>) => {
    if (!Number.isSafeInteger(core.hid) || core.hid < 1) {
      throw new Error(
        "DNA Open Lab discovery evidence: pair candidate identity is invalid",
      );
    }
    return core.gender.trim().toLowerCase();
  };
  const ownedMales = input.owned.filter((core) => valid(core) === "male");
  const ownedFemales = input.owned.filter((core) => valid(core) === "female");
  const arenaMales = input.arena.filter((core) => valid(core) === "male");
  const arenaFemales = input.arena.filter((core) => valid(core) === "female");
  const candidates: DnaOpenLabPairCandidate[] = [];
  const seen = new Set<string>();
  const append = (
    fathers: readonly Readonly<{ hid: number }>[],
    mothers: readonly Readonly<{ hid: number }>[],
  ) => {
    for (const father of fathers) {
      for (const mother of mothers) {
        if (candidates.length >= maximum) return;
        if (father.hid === mother.hid) continue;
        const key = `${father.hid}:${mother.hid}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(
          Object.freeze({
            fatherCoreId: father.hid,
            motherCoreId: mother.hid,
          }),
        );
      }
    }
  };

  // Prefer one owned Core plus one currently listed Arena Core, then bounded
  // owned-owned and Arena-Arena fallbacks. Identities remain in memory only.
  append(ownedMales, arenaFemales);
  append(arenaMales, ownedFemales);
  append(ownedMales, ownedFemales);
  append(arenaMales, arenaFemales);
  return Object.freeze(candidates);
}

/**
 * Verifies a finished-race window without retaining race identities or scalar
 * timestamps. Only the fixed age-band label, a bounded count class and a
 * timestamp-verification classification are safe to serialize.
 */
export function summarizeDnaOpenLabHistoryWindow(input: {
  plan: DnaOpenLabHistoryWindowPlan;
  races: readonly DnaRaceDocument[];
}): DnaOpenLabHistoryWindowEvidence {
  if (input.races.length > input.plan.limit) {
    throw new Error(
      "DNA Open Lab discovery evidence: history result exceeds request limit",
    );
  }
  if (input.races.length === 0) {
    return Object.freeze({
      windowId: input.plan.windowId,
      resultCountClass: "zero",
      timestampVerification: "not_applicable",
    });
  }

  const startMilliseconds = Date.parse(input.plan.startTime);
  const endMilliseconds = Date.parse(input.plan.endTime);
  if (
    !Number.isFinite(startMilliseconds) ||
    !Number.isFinite(endMilliseconds) ||
    startMilliseconds > endMilliseconds
  ) {
    throw new Error(
      "DNA Open Lab discovery evidence: history plan timestamps are invalid",
    );
  }

  let missingTimestamp = false;
  for (const race of input.races) {
    const timestamp = race.end_time ?? race.start_time;
    if (timestamp === undefined || timestamp === null) {
      missingTimestamp = true;
      continue;
    }
    const observedMilliseconds = Date.parse(timestamp);
    if (!Number.isFinite(observedMilliseconds)) {
      return Object.freeze({
        windowId: input.plan.windowId,
        resultCountClass:
          input.races.length === input.plan.limit
            ? "at_request_limit"
            : "below_request_limit",
        timestampVerification: "invalid_timestamp",
      });
    }
    if (
      observedMilliseconds < startMilliseconds ||
      observedMilliseconds > endMilliseconds
    ) {
      return Object.freeze({
        windowId: input.plan.windowId,
        resultCountClass:
          input.races.length === input.plan.limit
            ? "at_request_limit"
            : "below_request_limit",
        timestampVerification: "outside_requested_window",
      });
    }
  }

  return Object.freeze({
    windowId: input.plan.windowId,
    resultCountClass:
      input.races.length === input.plan.limit
        ? "at_request_limit"
        : "below_request_limit",
    timestampVerification: missingTimestamp
      ? "unverified_missing_timestamp"
      : "verified_within_window",
  });
}

/**
 * Produces schema-discovery evidence without retaining scalar values. Object
 * keys that look like IDs, wallet addresses, emails, UUIDs or credential-like
 * tokens are collapsed to `*`, so connected P3 logs can expose useful field
 * structure without leaking owner identifiers or DNA payload values.
 */
export function summarizeDnaOpenLabShape(
  value: unknown,
  configuration: Readonly<{
    maximumDepth?: number;
    maximumPaths?: number;
  }> = {},
): DnaOpenLabShapeSummary {
  const maximumDepth = positiveSafeInteger(
    configuration.maximumDepth ?? DEFAULT_MAXIMUM_DEPTH,
    "maximumDepth",
    MAXIMUM_DEPTH_LIMIT,
  );
  const maximumPaths = positiveSafeInteger(
    configuration.maximumPaths ?? DEFAULT_MAXIMUM_PATHS,
    "maximumPaths",
    MAXIMUM_PATH_LIMIT,
  );
  const rootKind = jsonKind(value);
  const kindsByPath = new Map<string, Set<DnaOpenLabJsonKind>>();
  const active = new WeakSet<object>();

  const record = (path: string, kind: DnaOpenLabJsonKind) => {
    const existing = kindsByPath.get(path);
    if (existing === undefined) {
      if (kindsByPath.size >= maximumPaths) {
        throw new Error(
          "DNA Open Lab discovery evidence: shape path bound exceeded",
        );
      }
      kindsByPath.set(path, new Set([kind]));
      return;
    }
    existing.add(kind);
  };

  const visit = (current: unknown, path: string, depth: number): void => {
    const kind = jsonKind(current);
    record(path, kind);
    if (depth >= maximumDepth || current === null) return;
    if (kind !== "object" && kind !== "array") return;

    const object = current as object;
    if (active.has(object)) {
      throw new Error("DNA Open Lab discovery evidence: cyclic value rejected");
    }
    active.add(object);
    try {
      if (Array.isArray(current)) {
        for (const entry of current) visit(entry, `${path}[]`, depth + 1);
        return;
      }
      for (const [key, entry] of Object.entries(
        current as Record<string, unknown>,
      )) {
        visit(entry, `${path}.${safeObjectSegment(key)}`, depth + 1);
      }
    } finally {
      active.delete(object);
    }
  };

  visit(value, "$", 0);

  const paths = Object.freeze(
    [...kindsByPath.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, kinds]) =>
        Object.freeze({
          path,
          kinds: Object.freeze([...kinds].sort(stableKindOrder)),
        }),
      ),
  );
  const sha256 = createHash("sha256")
    .update(JSON.stringify(paths), "utf8")
    .digest("hex");
  return Object.freeze({
    rootKind,
    pathCount: paths.length,
    paths,
    sha256,
  });
}

export function safeDnaOpenLabRateLimitEvidence(
  value: DnaOpenLabRateLimit,
): DnaOpenLabSafeRateLimitEvidence {
  return Object.freeze({
    limit: value.limit,
    remaining: value.remaining,
    resetSeconds: value.resetSeconds,
    rateClass:
      value.rateClass === null || value.rateClass.length <= 64
        ? value.rateClass
        : "redacted",
    retryAfterSeconds: value.retryAfterSeconds,
  });
}

/**
 * Recognizes the conservative connected proof that each configured API key has
 * its own advertised quota counter. Every lane must begin at `limit - 1`, then
 * decrement only its own counter once within the same reset window.
 */
export function hasProvenDnaOpenLabIndependentRateBuckets(
  evidence: readonly DnaOpenLabConnectedProbeEvidence[],
): boolean {
  let sharedLimit: number | null = null;
  let sharedInitialRemaining: number | null = null;

  for (const laneId of CONNECTED_DISCOVERY_LANES) {
    const initial = evidence.find(
      (entry) =>
        entry.endpoint === "test_auth.initial" && entry.laneId === laneId,
    );
    const repeat = evidence.find(
      (entry) =>
        entry.endpoint === "test_auth.repeat" && entry.laneId === laneId,
    );
    if (
      initial?.outcome !== "success" ||
      repeat?.outcome !== "success" ||
      initial.rateLimit === null ||
      repeat.rateLimit === null
    ) {
      return false;
    }

    const first = initial.rateLimit;
    const second = repeat.rateLimit;
    if (
      first.rateClass !== "api_key" ||
      second.rateClass !== "api_key" ||
      first.limit === null ||
      first.limit < 2 ||
      second.limit !== first.limit ||
      first.remaining !== first.limit - 1 ||
      second.remaining !== first.remaining - 1 ||
      first.resetSeconds === null ||
      second.resetSeconds === null ||
      Math.abs(first.resetSeconds - second.resetSeconds) > 2
    ) {
      return false;
    }

    sharedLimit ??= first.limit;
    sharedInitialRemaining ??= first.remaining;
    if (
      first.limit !== sharedLimit ||
      first.remaining !== sharedInitialRemaining
    ) {
      return false;
    }
  }

  return true;
}
