import type {
  DnaPopulationEntrantAuthorityCapacityApproval,
  DnaPopulationEntrantAuthorityCapacityGate,
} from "./dna-population-entrant-authority-commit-protocol";
import {
  DNA_POPULATION_ENTRANT_AUTHORITY_R2_MAXIMUM_COST_MICRO_USD,
  projectDnaPopulationEntrantAuthorityR2CompletionCost,
} from "./dna-population-entrant-authority-r2-cost-policy";
import {
  DNA_OPEN_LAB_PROVIDER_CAPACITY_MAXIMUM_AGE_MILLISECONDS,
  type DnaOpenLabProviderCapacityMeasurement,
  type DnaOpenLabProviderCapacityMeasurementSource,
} from "./dna-open-lab-provider-capacity-preflight";
import {
  DNA_OPEN_LAB_REQUIRED_R2_STORAGE_CLASS,
  DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS,
} from "./dna-open-lab-zero-cost-provider-capacity";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export const DNA_POPULATION_ENTRANT_AUTHORITY_VERIFIED_COMPACT_BYTES_FLOOR =
  902 as const;

export const DNA_POPULATION_ENTRANT_AUTHORITY_COMMIT_PLANNED_R2_USAGE =
  Object.freeze({
    storageBytes: 8 * 1024 * 1024,
    classAOperations: 2,
    classBOperations: 4,
  });

export const DNA_POPULATION_ENTRANT_AUTHORITY_COMMIT_PLANNED_NEON_USAGE =
  Object.freeze({
    storageBytes: 4_096,
    computeMilliCuHours: 1_000,
  });

export type DnaPopulationEntrantAuthoritySizingAuthority = Readonly<{
  version: 1;
  unresolvedRaceCount: number;
  unresolvedRaceSetSha256: string;
  measuredMaximumCompactEntrantAuthorityBytes: number;
  verifiedIncrementalMaximumCompactEntrantAuthorityBytes: number;
}>;

function capacityError(message: string): never {
  throw new Error(`Population entrant authority capacity gate: ${message}`);
}

function identity(value: string, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 512 ||
    CONTROL_PATTERN.test(value)
  ) {
    capacityError(`${field} is invalid`);
  }
  return value;
}

function sha256(value: string, field: string): string {
  const normalized = identity(value, field).toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) {
    capacityError(`${field} is invalid`);
  }
  return normalized;
}

function positive(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    capacityError(`${field} is invalid`);
  }
  return value;
}

function exactInstant(value: string, field: string): number {
  if (typeof value !== "string") {
    capacityError(`${field} is invalid`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    capacityError(`${field} is invalid`);
  }
  return parsed.getTime();
}

function validateSizingAuthority(
  value: DnaPopulationEntrantAuthoritySizingAuthority,
): DnaPopulationEntrantAuthoritySizingAuthority {
  if (value.version !== 1) {
    capacityError("sizing authority is invalid");
  }
  const verifiedIncrementalMaximumCompactEntrantAuthorityBytes = positive(
    value.verifiedIncrementalMaximumCompactEntrantAuthorityBytes,
    "verified incremental compact entrant authority bytes",
  );
  if (
    verifiedIncrementalMaximumCompactEntrantAuthorityBytes <
    DNA_POPULATION_ENTRANT_AUTHORITY_VERIFIED_COMPACT_BYTES_FLOOR
  ) {
    capacityError("verified compact entrant sizing authority regressed");
  }
  return Object.freeze({
    version: 1 as const,
    unresolvedRaceCount: positive(
      value.unresolvedRaceCount,
      "sizing unresolvedRaceCount",
    ),
    unresolvedRaceSetSha256: sha256(
      value.unresolvedRaceSetSha256,
      "sizing unresolvedRaceSetSha256",
    ),
    measuredMaximumCompactEntrantAuthorityBytes: positive(
      value.measuredMaximumCompactEntrantAuthorityBytes,
      "measured compact entrant authority bytes",
    ),
    verifiedIncrementalMaximumCompactEntrantAuthorityBytes,
  });
}

function validateAuthority(
  value: Parameters<
    DnaPopulationEntrantAuthorityCapacityGate["assertFreshCurrentCapacity"]
  >[0],
) {
  const generationId = sha256(value.generationId, "generationId");
  const unresolvedRaceSetSha256 = sha256(
    value.unresolvedRaceSetSha256,
    "unresolvedRaceSetSha256",
  );
  if (value.version !== 1 || generationId !== unresolvedRaceSetSha256) {
    capacityError("audited authority binding is invalid");
  }
  return Object.freeze({
    version: 1 as const,
    generationId,
    unresolvedRaceCount: positive(
      value.unresolvedRaceCount,
      "unresolvedRaceCount",
    ),
    unresolvedRaceSetSha256,
  });
}

function assertFreshMeasurement(input: {
  measurement: DnaOpenLabProviderCapacityMeasurement;
  checkedAt: number;
  maximumAgeMilliseconds: number;
}): void {
  if (
    input.measurement === null ||
    typeof input.measurement !== "object" ||
    input.measurement.evidenceSource !== "provider_api"
  ) {
    capacityError("current provider measurement is invalid");
  }
  const r2MeasuredAt = exactInstant(input.measurement.measuredAt, "measuredAt");
  const neonMeasuredAt = exactInstant(
    input.measurement.neonMeasuredAt,
    "neonMeasuredAt",
  );
  for (const measuredAt of [r2MeasuredAt, neonMeasuredAt]) {
    if (
      measuredAt > input.checkedAt ||
      input.checkedAt - measuredAt > input.maximumAgeMilliseconds
    ) {
      capacityError("current provider measurement is stale or future-dated");
    }
  }
}

/**
 * Creates the read-only capacity gate used by the R2-first entrant authority
 * commit primitive. R2 may use the owner's explicit bounded paid allowance,
 * while Neon remains inside the existing zero-cost storage/compute budgets.
 *
 * Every assertion obtains a fresh sanitized Cloudflare/Neon measurement and
 * projects all remaining Race-document evidence, compact entrant chunks and
 * future audit overhead to exact completion. It fails closed before the next
 * cohort whenever that projection exceeds the authorized US$5 R2 ceiling.
 *
 * This adapter performs provider reads only. It exposes no collection command
 * and performs no DNA, R2 or Neon write itself.
 */
export function createDnaPopulationEntrantAuthorityCapacityGate(input: {
  ownerId: string;
  measurementSource: DnaOpenLabProviderCapacityMeasurementSource;
  sizingAuthority: DnaPopulationEntrantAuthoritySizingAuthority;
  now?: () => Date;
  maximumMeasurementAgeMilliseconds?: number;
}): DnaPopulationEntrantAuthorityCapacityGate {
  const ownerId = identity(input.ownerId, "ownerId");
  const sizingAuthority = validateSizingAuthority(input.sizingAuthority);
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
    capacityError("maximum measurement age is invalid");
  }

  return Object.freeze({
    async assertFreshCurrentCapacity(requestedAuthority, context) {
      const authority = validateAuthority(requestedAuthority);
      if (
        sizingAuthority.unresolvedRaceCount !== authority.unresolvedRaceCount ||
        sizingAuthority.unresolvedRaceSetSha256 !==
          authority.unresolvedRaceSetSha256
      ) {
        capacityError("sizing authority disagrees with audited authority");
      }
      if (input.measurementSource.status !== "ready") {
        capacityError("current provider measurement is unavailable");
      }

      const started = now();
      if (Number.isNaN(started.getTime())) {
        capacityError("measurement clock is invalid");
      }

      let measurement: DnaOpenLabProviderCapacityMeasurement;
      try {
        measurement = await input.measurementSource.measure({ ownerId });
      } catch {
        capacityError("current provider measurement failed");
      }

      const checked = now();
      if (
        Number.isNaN(checked.getTime()) ||
        checked.getTime() < started.getTime()
      ) {
        capacityError("measurement clock is invalid");
      }
      assertFreshMeasurement({
        measurement,
        checkedAt: checked.getTime(),
        maximumAgeMilliseconds: maximumMeasurementAgeMilliseconds,
      });

      if (
        !Number.isSafeInteger(context.persistedRaceCount) ||
        context.persistedRaceCount < 0 ||
        context.persistedRaceCount > authority.unresolvedRaceCount
      ) {
        capacityError("durable population progress is invalid");
      }

      let r2Projection;
      try {
        r2Projection = projectDnaPopulationEntrantAuthorityR2CompletionCost({
          currentUsage: measurement.currentR2Usage,
          unresolvedRaceCount: authority.unresolvedRaceCount,
          persistedRaceCount: context.persistedRaceCount,
          maximumCompactRecordBytes: Math.max(
            sizingAuthority.measuredMaximumCompactEntrantAuthorityBytes,
            sizingAuthority.verifiedIncrementalMaximumCompactEntrantAuthorityBytes,
          ),
        });
      } catch {
        capacityError("current provider capacity projection is invalid");
      }

      const projectedNeonStorageBytes =
        measurement.currentNeonUsage.storageBytes +
        DNA_POPULATION_ENTRANT_AUTHORITY_COMMIT_PLANNED_NEON_USAGE.storageBytes;
      const projectedNeonComputeMilliCuHours =
        measurement.currentNeonUsage.computeMilliCuHours +
        DNA_POPULATION_ENTRANT_AUTHORITY_COMMIT_PLANNED_NEON_USAGE.computeMilliCuHours;
      if (
        measurement.r2StorageClass.trim() !==
          DNA_OPEN_LAB_REQUIRED_R2_STORAGE_CLASS ||
        !r2Projection.allowed ||
        r2Projection.projectedCostMicroUsd >
          DNA_POPULATION_ENTRANT_AUTHORITY_R2_MAXIMUM_COST_MICRO_USD ||
        projectedNeonStorageBytes >
          DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.storageBytes ||
        projectedNeonComputeMilliCuHours >
          DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.computeMilliCuHours
      ) {
        capacityError("current authorized provider capacity is blocked");
      }

      return Object.freeze({
        version: 1 as const,
        generationId: authority.generationId,
        unresolvedRaceCount: authority.unresolvedRaceCount,
        unresolvedRaceSetSha256: authority.unresolvedRaceSetSha256,
        observedAt: checked.toISOString(),
        capacityAllowed: true as const,
        paidUsageAllowed: false as const,
        r2PaidUsageAuthorized: true as const,
        maximumR2CostMicroUsd:
          DNA_POPULATION_ENTRANT_AUTHORITY_R2_MAXIMUM_COST_MICRO_USD,
        projectedR2CostMicroUsd: r2Projection.projectedCostMicroUsd,
      }) satisfies DnaPopulationEntrantAuthorityCapacityApproval;
    },
  });
}
