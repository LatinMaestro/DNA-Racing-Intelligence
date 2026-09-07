export const DNA_OPEN_LAB_SAFE_FALLBACK_REQUESTS_PER_MINUTE = 30;
export const DNA_OPEN_LAB_MAX_CONFIGURABLE_REQUESTS_PER_MINUTE = 150;
export const DNA_OPEN_LAB_RATE_LIMIT_WINDOW_MILLISECONDS = 5 * 60_000;
export const DNA_OPEN_LAB_MAX_ELEVATION_MILLISECONDS = 31 * 24 * 60 * 60_000;

export type DnaOpenLabSyncRateFallbackReason =
  "elevation_expired" | "provider_limit_reduced" | "rate_limit_observed";

export type DnaOpenLabSyncRatePolicy = Readonly<{
  requestedRequestsPerMinute: number;
  effectiveRequestsPerMinute: number;
  elevatedUntil: string | null;
  fallbackReason: DnaOpenLabSyncRateFallbackReason | null;
  consecutiveRateLimits: number;
  lastRateLimitedAt: string | null;
  lastProviderLimit: number | null;
  version: number;
  updatedAt: string;
}>;

export type DnaOpenLabRateLimitObservation = Readonly<{
  observedAt: string;
  providerLimit: number | null;
}>;

function policyError(message: string): never {
  throw new Error(`DNA Open Lab sync rate policy: ${message}`);
}

function timestamp(value: string, field: string): string {
  const normalized = value.trim();
  const parsed = new Date(normalized);
  if (normalized === "" || Number.isNaN(parsed.getTime())) {
    policyError(`${field} must be an ISO timestamp`);
  }
  return parsed.toISOString();
}

function requestRate(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < DNA_OPEN_LAB_SAFE_FALLBACK_REQUESTS_PER_MINUTE ||
    value > DNA_OPEN_LAB_MAX_CONFIGURABLE_REQUESTS_PER_MINUTE
  ) {
    policyError(
      `requestedRequestsPerMinute must be between ${DNA_OPEN_LAB_SAFE_FALLBACK_REQUESTS_PER_MINUTE} and ${DNA_OPEN_LAB_MAX_CONFIGURABLE_REQUESTS_PER_MINUTE}`,
    );
  }
  return value;
}

function providerLimit(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 1) {
    policyError("providerLimit must be a positive safe integer or null");
  }
  return value;
}

export function createDnaOpenLabSyncRatePolicy(input: {
  requestedRequestsPerMinute: number;
  elevatedUntil?: string | null;
  now: string;
  version?: number;
}): DnaOpenLabSyncRatePolicy {
  const now = timestamp(input.now, "now");
  const requested = requestRate(input.requestedRequestsPerMinute);
  const elevatedUntil =
    input.elevatedUntil === undefined || input.elevatedUntil === null
      ? null
      : timestamp(input.elevatedUntil, "elevatedUntil");
  if (requested > DNA_OPEN_LAB_SAFE_FALLBACK_REQUESTS_PER_MINUTE) {
    if (
      elevatedUntil === null ||
      Date.parse(elevatedUntil) <= Date.parse(now)
    ) {
      policyError("an elevated rate requires a future expiry");
    }
    if (
      Date.parse(elevatedUntil) - Date.parse(now) >
      DNA_OPEN_LAB_MAX_ELEVATION_MILLISECONDS
    ) {
      policyError("an elevated rate may remain active for at most 31 days");
    }
  } else if (elevatedUntil !== null) {
    policyError("the safe rate must not carry an elevation expiry");
  }
  const version = input.version ?? 1;
  if (!Number.isSafeInteger(version) || version < 1) {
    policyError("version must be a positive safe integer");
  }
  return Object.freeze({
    requestedRequestsPerMinute: requested,
    effectiveRequestsPerMinute: requested,
    elevatedUntil,
    fallbackReason: null,
    consecutiveRateLimits: 0,
    lastRateLimitedAt: null,
    lastProviderLimit: null,
    version,
    updatedAt: now,
  });
}

export function evaluateDnaOpenLabSyncRatePolicy(
  policy: DnaOpenLabSyncRatePolicy,
  nowValue: string,
): DnaOpenLabSyncRatePolicy {
  const now = timestamp(nowValue, "now");
  if (
    policy.requestedRequestsPerMinute >
      DNA_OPEN_LAB_SAFE_FALLBACK_REQUESTS_PER_MINUTE &&
    policy.elevatedUntil !== null &&
    Date.parse(policy.elevatedUntil) <= Date.parse(now)
  ) {
    return Object.freeze({
      ...policy,
      effectiveRequestsPerMinute:
        DNA_OPEN_LAB_SAFE_FALLBACK_REQUESTS_PER_MINUTE,
      fallbackReason: "elevation_expired",
      updatedAt: now,
    });
  }
  return policy;
}

export function observeDnaOpenLabRateLimit(
  policy: DnaOpenLabSyncRatePolicy,
  observation: DnaOpenLabRateLimitObservation,
): DnaOpenLabSyncRatePolicy {
  const observedAt = timestamp(observation.observedAt, "observedAt");
  const observedProviderLimit = providerLimit(observation.providerLimit);
  const previousAt =
    policy.lastRateLimitedAt === null
      ? null
      : Date.parse(timestamp(policy.lastRateLimitedAt, "lastRateLimitedAt"));
  const withinWindow =
    previousAt !== null &&
    Date.parse(observedAt) - previousAt <=
      DNA_OPEN_LAB_RATE_LIMIT_WINDOW_MILLISECONDS;
  const consecutiveRateLimits = withinWindow
    ? policy.consecutiveRateLimits + 1
    : 1;
  const providerReduced =
    observedProviderLimit !== null &&
    observedProviderLimit <= DNA_OPEN_LAB_SAFE_FALLBACK_REQUESTS_PER_MINUTE;
  const wasElevated =
    policy.effectiveRequestsPerMinute >
    DNA_OPEN_LAB_SAFE_FALLBACK_REQUESTS_PER_MINUTE;
  return Object.freeze({
    ...policy,
    effectiveRequestsPerMinute: DNA_OPEN_LAB_SAFE_FALLBACK_REQUESTS_PER_MINUTE,
    fallbackReason:
      providerReduced && wasElevated
        ? "provider_limit_reduced"
        : wasElevated
          ? "rate_limit_observed"
          : policy.fallbackReason,
    consecutiveRateLimits,
    lastRateLimitedAt: observedAt,
    lastProviderLimit: observedProviderLimit,
    updatedAt: observedAt,
  });
}

export function observeDnaOpenLabRateSuccess(
  policy: DnaOpenLabSyncRatePolicy,
  input: Readonly<{ observedAt: string; providerLimit: number | null }>,
): DnaOpenLabSyncRatePolicy {
  const observedAt = timestamp(input.observedAt, "observedAt");
  const observedProviderLimit = providerLimit(input.providerLimit);
  const evaluated = evaluateDnaOpenLabSyncRatePolicy(policy, observedAt);
  return Object.freeze({
    ...evaluated,
    consecutiveRateLimits: 0,
    lastProviderLimit: observedProviderLimit,
    updatedAt: observedAt,
  });
}
