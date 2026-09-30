import type {
  DnaPopulationEntrantAuthorityCapacityApproval,
  DnaPopulationEntrantAuthorityCapacityGate,
} from "./dna-population-entrant-authority-commit-protocol";
import { projectDnaPopulationEntrantAuthorityChunkArchive } from "./dna-population-entrant-authority-chunk-projection";
import {
  DNA_POPULATION_ENTRANT_AUTHORITY_MAXIMUM_AUTHORIZED_R2_COST_MICRO_USD,
  dnaPopulationEntrantAuthorityR2CostMicroUsd,
} from "./dna-population-entrant-authority-zero-cost-policy";
import {
  DNA_OPEN_LAB_PROVIDER_CAPACITY_MAXIMUM_AGE_MILLISECONDS,
  type DnaOpenLabProviderCapacityMeasurement,
  type DnaOpenLabProviderCapacityMeasurementSource,
} from "./dna-open-lab-provider-capacity-preflight";
import {
  DNA_OPEN_LAB_REQUIRED_R2_STORAGE_CLASS,
  DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS,
} from "./dna-open-lab-zero-cost-provider-capacity";
import {
  DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS,
} from "./dna-population-race-index-r2-chunk";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export const DNA_POPULATION_ENTRANT_AUTHORITY_VERIFIED_COMPACT_BYTES_FLOOR =
  902 as const;

export const DNA_POPULATION_ENTRANT_AUTHORITY_VERIFIED_RACE_BYTES_CEILING =
  11_795 as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_RECOVERY_CLASS_B_RESERVE =
  512 as const;

export const DNA_POPULATION_ENTRANT_AUTHORITY_COMMIT_PLANNED_R2_USAGE =
  Object.freeze({
    storageBytes:
      8 * 1024 * 1024 +
      DNA_POPULATION_ENTRANT_AUTHORITY_VERIFIED_RACE_BYTES_CEILING *
        DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS,
    classAOperations:
      DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS + 2,
    classBOperations:
      DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS +
      4 +
      DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_RECOVERY_CLASS_B_RESERVE,
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
 * commit primitive.
 *
 * Every assertion obtains a fresh sanitized Cloudflare/Neon measurement. Neon
 * must remain inside the existing zero-cost budgets. R2 Standard may cross its
 * free allowance only under the owner's explicit US$5 total billing-window cap.
 * The next cohort reserves one conservative 5,000-Race raw-evidence/compact
 * write envelope before hydration or persistence can proceed.
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
    async assertFreshCurrentCapacity(requestedAuthority) {
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

      let archiveProjection;
      let projectedR2CostMicroUsd: number;
      let projectedNeonStorageBytes: number;
      let projectedNeonComputeMilliCuHours: number;
      try {
        archiveProjection = projectDnaPopulationEntrantAuthorityChunkArchive({
          unresolvedRaceCount: authority.unresolvedRaceCount,
          unresolvedRaceSetSha256: authority.unresolvedRaceSetSha256,
          measuredMaximumCompactEntrantAuthorityBytes:
            sizingAuthority.measuredMaximumCompactEntrantAuthorityBytes,
          verifiedIncrementalMaximumCompactEntrantAuthorityBytes:
            sizingAuthority.verifiedIncrementalMaximumCompactEntrantAuthorityBytes,
          currentR2StorageBytes: measurement.currentR2Usage.storageBytes,
          currentR2ClassAOperations:
            measurement.currentR2Usage.classAOperations,
          currentR2ClassBOperations:
            measurement.currentR2Usage.classBOperations,
          currentNeonStorageBytes: measurement.currentNeonUsage.storageBytes,
        });
        const immediateR2CostMicroUsd =
          dnaPopulationEntrantAuthorityR2CostMicroUsd({
            storageBytes:
              measurement.currentR2Usage.storageBytes +
              DNA_POPULATION_ENTRANT_AUTHORITY_COMMIT_PLANNED_R2_USAGE
                .storageBytes,
            classAOperations:
              measurement.currentR2Usage.classAOperations +
              DNA_POPULATION_ENTRANT_AUTHORITY_COMMIT_PLANNED_R2_USAGE
                .classAOperations,
            classBOperations:
              measurement.currentR2Usage.classBOperations +
              DNA_POPULATION_ENTRANT_AUTHORITY_COMMIT_PLANNED_R2_USAGE
                .classBOperations,
          });
        const fullPopulationRawRaceBytes =
          authority.unresolvedRaceCount *
          DNA_POPULATION_ENTRANT_AUTHORITY_VERIFIED_RACE_BYTES_CEILING;
        const fullPopulationR2CostMicroUsd =
          dnaPopulationEntrantAuthorityR2CostMicroUsd({
            storageBytes:
              measurement.currentR2Usage.storageBytes +
              fullPopulationRawRaceBytes +
              archiveProjection.projected.r2StorageBytes,
            classAOperations:
              measurement.currentR2Usage.classAOperations +
              authority.unresolvedRaceCount +
              archiveProjection.projected.r2ClassAOperations,
            classBOperations:
              measurement.currentR2Usage.classBOperations +
              authority.unresolvedRaceCount +
              archiveProjection.projected.r2ClassBOperations,
          });
        projectedR2CostMicroUsd = Math.max(
          immediateR2CostMicroUsd,
          fullPopulationR2CostMicroUsd,
        );
        projectedNeonStorageBytes =
          measurement.currentNeonUsage.storageBytes +
          DNA_POPULATION_ENTRANT_AUTHORITY_COMMIT_PLANNED_NEON_USAGE
            .storageBytes;
        projectedNeonComputeMilliCuHours =
          measurement.currentNeonUsage.computeMilliCuHours +
          DNA_POPULATION_ENTRANT_AUTHORITY_COMMIT_PLANNED_NEON_USAGE
            .computeMilliCuHours;
      } catch {
        capacityError("current provider capacity projection is invalid");
      }

      if (
        measurement.r2StorageClass !== DNA_OPEN_LAB_REQUIRED_R2_STORAGE_CLASS ||
        projectedR2CostMicroUsd >
          DNA_POPULATION_ENTRANT_AUTHORITY_MAXIMUM_AUTHORIZED_R2_COST_MICRO_USD ||
        projectedNeonStorageBytes >
          DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.storageBytes ||
        projectedNeonComputeMilliCuHours >
          DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.computeMilliCuHours ||
        archiveProjection.projectedUsage.neonStorageBytes >
          DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.storageBytes
      ) {
        capacityError("current bounded provider capacity is blocked");
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
        maximumAuthorizedR2CostMicroUsd:
          DNA_POPULATION_ENTRANT_AUTHORITY_MAXIMUM_AUTHORIZED_R2_COST_MICRO_USD,
        projectedR2CostMicroUsd,
      }) satisfies DnaPopulationEntrantAuthorityCapacityApproval;
    },
  });
}
