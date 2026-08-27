import { createHash } from "node:crypto";

import type {
  DnaOpenLabRateLimit,
  DnaOpenLabScope,
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

const CONNECTED_DISCOVERY_LANES = ["key-1", "key-2", "key-3"] as const;

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
