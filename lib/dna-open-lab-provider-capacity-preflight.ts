import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";
import {
  projectDnaOpenLabZeroCostProviderCapacity,
  type DnaOpenLabNeonUsage,
  type DnaOpenLabProviderCapacityBlockerId,
  type DnaOpenLabProviderCapacityProjection,
} from "./dna-open-lab-zero-cost-provider-capacity";
import type { DnaOpenLabR2Usage } from "./dna-open-lab-zero-cost-refresh-policy";

export const DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION =
  "dna-open-lab-provider-capacity-preflight/v1" as const;
export const DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT =
  "inspect_private_daily_refresh_capacity" as const;
export const DNA_OPEN_LAB_PROVIDER_CAPACITY_MAXIMUM_AGE_MILLISECONDS =
  5 * 60 * 1000;

export const DNA_OPEN_LAB_PROVIDER_CAPACITY_MEASUREMENT_FAILURE_IDS = [
  "measurement_clock_invalid",
  "cloudflare_transport_failed",
  "cloudflare_http_rejected",
  "cloudflare_graphql_rejected",
  "cloudflare_usage_invalid",
  "neon_transport_failed",
  "neon_http_rejected",
  "neon_usage_invalid",
  "unexpected_measurement_failure",
] as const;

export type DnaOpenLabProviderCapacityMeasurementFailureId =
  (typeof DNA_OPEN_LAB_PROVIDER_CAPACITY_MEASUREMENT_FAILURE_IDS)[number];

const MEASUREMENT_FAILURE_ID_SET = new Set<string>(
  DNA_OPEN_LAB_PROVIDER_CAPACITY_MEASUREMENT_FAILURE_IDS,
);

/** Fixed, non-sensitive failure authority for connected measurement diagnostics. */
export class DnaOpenLabProviderCapacityMeasurementError extends Error {
  readonly failureId: DnaOpenLabProviderCapacityMeasurementFailureId;

  constructor(failureId: DnaOpenLabProviderCapacityMeasurementFailureId) {
    super("Provider capacity measurement failed.");
    this.name = "DnaOpenLabProviderCapacityMeasurementError";
    this.failureId = failureId;
  }
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const GIT_OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

export type DnaOpenLabProviderCapacityMeasurement = Readonly<{
  evidenceSource: "provider_api";
  r2StorageClass: string;
  measuredAt: string;
  billingWindowStartAt: string;
  billingWindowEndAt: string;
  currentR2Usage: DnaOpenLabR2Usage;
  neonMeasuredAt: string;
  neonBillingWindowStartAt: string;
  neonBillingWindowEndAt: string;
  currentNeonUsage: DnaOpenLabNeonUsage;
}>;

export type DnaOpenLabProviderCapacityMeasurementSource =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      measure: (input: {
        ownerId: string;
      }) => Promise<DnaOpenLabProviderCapacityMeasurement>;
    }>;

export type DnaOpenLabProviderCapacityPreflightInvocation = Readonly<{
  preflightVersion: typeof DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION;
  intent: typeof DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT;
  authenticatedOwnerId: string;
  exactCodeHeadSha: string;
  refreshCycleId: string;
  budgetWindowId: string;
  plannedR2UsagePerRefresh: DnaOpenLabR2Usage;
  plannedNeonUsagePerRefresh: DnaOpenLabNeonUsage;
}>;

type SafeReceipt = Readonly<{
  persistentWritePerformed: false;
  providerWritePerformed: false;
  paidUsageAllowed: false;
  preserveLastGood: true;
}>;

export type DnaOpenLabProviderCapacityHeldReason =
  | "measurement_not_configured"
  | "measurement_failed"
  | "measurement_invalid"
  | "measurement_stale"
  | "capacity_blocked";

export type DnaOpenLabProviderCapacityPreflightReceipt =
  | (SafeReceipt &
      Readonly<{
        status: "held";
        readyForRefresh: false;
        reason: DnaOpenLabProviderCapacityHeldReason;
        blockerIds: readonly DnaOpenLabProviderCapacityBlockerId[];
        measurementFailureId?: DnaOpenLabProviderCapacityMeasurementFailureId | null;
      }>)
  | (SafeReceipt &
      Readonly<{
        status: "ready";
        readyForRefresh: true;
        exactCodeHeadSha: string;
        ownerScopeSha256: string;
        refreshCycleId: string;
        budgetWindowId: string;
        measurementSha256: string;
        planSha256: string;
        preflightSha256: string;
        checkedAt: string;
        validUntil: string;
        projection: DnaOpenLabProviderCapacityProjection;
      }>);

export type DnaOpenLabProviderCapacityPreflight = Readonly<{
  inspect: (
    invocation: DnaOpenLabProviderCapacityPreflightInvocation,
  ) => Promise<DnaOpenLabProviderCapacityPreflightReceipt>;
}>;

const SAFE = Object.freeze({
  persistentWritePerformed: false as const,
  providerWritePerformed: false as const,
  paidUsageAllowed: false as const,
  preserveLastGood: true as const,
});

function held(
  reason: DnaOpenLabProviderCapacityHeldReason,
  blockerIds: readonly DnaOpenLabProviderCapacityBlockerId[] = [],
  measurementFailureId: DnaOpenLabProviderCapacityMeasurementFailureId | null = null,
): DnaOpenLabProviderCapacityPreflightReceipt {
  return Object.freeze({
    ...SAFE,
    status: "held" as const,
    readyForRefresh: false as const,
    reason,
    blockerIds: Object.freeze([...blockerIds]),
    measurementFailureId,
  });
}

function measurementFailureId(
  error: unknown,
): DnaOpenLabProviderCapacityMeasurementFailureId {
  if (
    error instanceof DnaOpenLabProviderCapacityMeasurementError &&
    MEASUREMENT_FAILURE_ID_SET.has(error.failureId)
  ) {
    return error.failureId;
  }
  return "unexpected_measurement_failure";
}

function identity(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`DNA Open Lab provider preflight ${field} is invalid.`);
  }
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 512 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)
  ) {
    throw new Error(`DNA Open Lab provider preflight ${field} is invalid.`);
  }
  return normalized;
}

function sha256(value: unknown, field: string): string {
  const normalized = identity(value, field).toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new Error(`DNA Open Lab provider preflight ${field} is invalid.`);
  }
  return normalized;
}

function gitObjectId(value: unknown, field: string): string {
  const normalized = identity(value, field).toLowerCase();
  if (!GIT_OBJECT_ID_PATTERN.test(normalized)) {
    throw new Error(`DNA Open Lab provider preflight ${field} is invalid.`);
  }
  return normalized;
}

function instant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value
    ? null
    : parsed.getTime();
}

function validMeasurementTime(
  measuredAt: string,
  checkedAt: number,
  maximumAgeMilliseconds: number,
): boolean {
  const measured = instant(measuredAt);
  return (
    measured !== null &&
    measured <= checkedAt &&
    checkedAt - measured <= maximumAgeMilliseconds
  );
}

function ownerScopeSha256(ownerId: string): string {
  return dnaOpenLabRawEvidenceSha256({
    domain: "dna-open-lab-provider-capacity-owner/v1",
    ownerId,
  });
}

function invocationPlan(input: {
  ownerId: string;
  exactCodeHeadSha: string;
  refreshCycleId: string;
  budgetWindowId: string;
  plannedR2UsagePerRefresh: DnaOpenLabR2Usage;
  plannedNeonUsagePerRefresh: DnaOpenLabNeonUsage;
}) {
  return Object.freeze({
    version: DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION,
    ownerScopeSha256: ownerScopeSha256(input.ownerId),
    exactCodeHeadSha: input.exactCodeHeadSha,
    refreshCycleId: input.refreshCycleId,
    budgetWindowId: input.budgetWindowId,
    plannedR2UsagePerRefresh: input.plannedR2UsagePerRefresh,
    plannedNeonUsagePerRefresh: input.plannedNeonUsagePerRefresh,
  });
}

/**
 * Read-only commissioning gate. It obtains one fresh, sanitized provider
 * measurement and binds the resulting projection to the exact code head,
 * owner scope, refresh cycle, budget window and per-refresh upper bounds.
 * The returned digest is stable for an exact replay; any changed authority
 * produces a different receipt before persistent or provider writes begin.
 */
export function createDnaOpenLabProviderCapacityPreflight(input: {
  configuredOwnerId: string;
  measurementSource: DnaOpenLabProviderCapacityMeasurementSource;
  now?: () => Date;
  maximumMeasurementAgeMilliseconds?: number;
}): DnaOpenLabProviderCapacityPreflight {
  const configuredOwnerId = identity(
    input.configuredOwnerId,
    "configured owner",
  );
  const now = input.now ?? (() => new Date());
  const maximumMeasurementAgeMilliseconds =
    input.maximumMeasurementAgeMilliseconds ??
    DNA_OPEN_LAB_PROVIDER_CAPACITY_MAXIMUM_AGE_MILLISECONDS;
  if (
    !Number.isSafeInteger(maximumMeasurementAgeMilliseconds) ||
    maximumMeasurementAgeMilliseconds < 1 ||
    maximumMeasurementAgeMilliseconds >
      DNA_OPEN_LAB_PROVIDER_CAPACITY_MAXIMUM_AGE_MILLISECONDS
  ) {
    throw new Error(
      "DNA Open Lab provider preflight measurement age is invalid.",
    );
  }

  return Object.freeze({
    async inspect(invocation) {
      if (
        invocation.preflightVersion !==
          DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION ||
        invocation.intent !== DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT
      ) {
        throw new Error(
          "DNA Open Lab provider preflight invocation is invalid.",
        );
      }
      const authenticatedOwnerId = identity(
        invocation.authenticatedOwnerId,
        "authenticated owner",
      );
      if (authenticatedOwnerId !== configuredOwnerId) {
        throw new Error("DNA Open Lab provider preflight owner scope denied.");
      }
      const exactCodeHeadSha = gitObjectId(
        invocation.exactCodeHeadSha,
        "exact code head",
      );
      const refreshCycleId = sha256(invocation.refreshCycleId, "refresh cycle");
      const budgetWindowId = sha256(invocation.budgetWindowId, "budget window");
      const checked = now();
      if (Number.isNaN(checked.getTime())) {
        return held("measurement_invalid");
      }
      const checkedAt = checked.toISOString();
      if (input.measurementSource.status !== "ready") {
        return held("measurement_not_configured");
      }

      let measurement: DnaOpenLabProviderCapacityMeasurement;
      try {
        measurement = await input.measurementSource.measure({
          ownerId: authenticatedOwnerId,
        });
      } catch (error) {
        return held("measurement_failed", [], measurementFailureId(error));
      }
      if (
        measurement === null ||
        typeof measurement !== "object" ||
        measurement.evidenceSource !== "provider_api"
      ) {
        return held("measurement_invalid");
      }
      if (
        !validMeasurementTime(
          measurement.measuredAt,
          checked.getTime(),
          maximumMeasurementAgeMilliseconds,
        ) ||
        !validMeasurementTime(
          measurement.neonMeasuredAt,
          checked.getTime(),
          maximumMeasurementAgeMilliseconds,
        )
      ) {
        return held("measurement_stale");
      }

      let projection: DnaOpenLabProviderCapacityProjection;
      try {
        projection = projectDnaOpenLabZeroCostProviderCapacity({
          ...measurement,
          plannedR2UsagePerRefresh: invocation.plannedR2UsagePerRefresh,
          plannedNeonUsagePerRefresh: invocation.plannedNeonUsagePerRefresh,
        });
      } catch {
        return held("measurement_invalid");
      }
      if (!projection.allowed) {
        return held("capacity_blocked", projection.blockerIds);
      }

      const plan = invocationPlan({
        ownerId: authenticatedOwnerId,
        exactCodeHeadSha,
        refreshCycleId,
        budgetWindowId,
        plannedR2UsagePerRefresh: invocation.plannedR2UsagePerRefresh,
        plannedNeonUsagePerRefresh: invocation.plannedNeonUsagePerRefresh,
      });
      const measurementSha256 = dnaOpenLabRawEvidenceSha256({
        domain: "dna-open-lab-provider-capacity-measurement/v1",
        measurement,
      });
      const planSha256 = dnaOpenLabRawEvidenceSha256({
        domain: "dna-open-lab-provider-capacity-plan/v1",
        plan,
      });
      const validUntil = new Date(
        Math.min(
          Date.parse(measurement.measuredAt),
          Date.parse(measurement.neonMeasuredAt),
        ) + maximumMeasurementAgeMilliseconds,
      ).toISOString();
      const stableAuthority = Object.freeze({
        ...SAFE,
        status: "ready" as const,
        readyForRefresh: true as const,
        exactCodeHeadSha,
        ownerScopeSha256: plan.ownerScopeSha256,
        refreshCycleId,
        budgetWindowId,
        measurementSha256,
        planSha256,
        validUntil,
        projection,
      });
      return Object.freeze({
        ...stableAuthority,
        checkedAt,
        preflightSha256: dnaOpenLabRawEvidenceSha256({
          domain: "dna-open-lab-provider-capacity-preflight-receipt/v1",
          authority: stableAuthority,
        }),
      });
    },
  });
}
