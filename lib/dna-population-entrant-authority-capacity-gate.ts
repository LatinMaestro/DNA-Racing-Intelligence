import type {
  DnaPopulationEntrantAuthorityCapacityApproval,
  DnaPopulationEntrantAuthorityCapacityGate,
} from "./dna-population-entrant-authority-commit-protocol";
import { projectDnaPopulationEntrantAuthorityChunkArchive } from "./dna-population-entrant-authority-chunk-projection";
import {
  DNA_OPEN_LAB_PROVIDER_CAPACITY_MAXIMUM_AGE_MILLISECONDS,
  type DnaOpenLabProviderCapacityMeasurement,
  type DnaOpenLabProviderCapacityMeasurementSource,
} from "./dna-open-lab-provider-capacity-preflight";
import { projectDnaOpenLabZeroCostProviderCapacity } from "./dna-open-lab-zero-cost-provider-capacity";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

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
  return Object.freeze({
    version: 1 as const,
    measuredMaximumCompactEntrantAuthorityBytes: positive(
      value.measuredMaximumCompactEntrantAuthorityBytes,
      "measured compact entrant authority bytes",
    ),
    verifiedIncrementalMaximumCompactEntrantAuthorityBytes: positive(
      value.verifiedIncrementalMaximumCompactEntrantAuthorityBytes,
      "verified incremental compact entrant authority bytes",
    ),
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
 * Creates the read-only zero-cost capacity gate used by the R2-first entrant
 * authority commit primitive.
 *
 * Every assertion obtains a fresh sanitized Cloudflare/Neon measurement,
 * proves that one conservative commit fits the normal provider budgets
 * (including Neon compute), and separately projects the complete compact
 * archive against current R2/Neon storage and R2 operation usage.
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

      let immediateProjection;
      let archiveProjection;
      try {
        immediateProjection = projectDnaOpenLabZeroCostProviderCapacity({
          ...measurement,
          projectionHorizon: "single_refresh",
          plannedR2UsagePerRefresh:
            DNA_POPULATION_ENTRANT_AUTHORITY_COMMIT_PLANNED_R2_USAGE,
          plannedNeonUsagePerRefresh:
            DNA_POPULATION_ENTRANT_AUTHORITY_COMMIT_PLANNED_NEON_USAGE,
        });
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
      } catch {
        capacityError("current provider capacity projection is invalid");
      }

      if (
        !immediateProjection.allowed ||
        immediateProjection.paidUsageAllowed !== false ||
        !archiveProjection.capacityAllowed ||
        archiveProjection.blockerIds.length !== 0 ||
        archiveProjection.paidUsageAllowed !== false
      ) {
        capacityError("current zero-cost provider capacity is blocked");
      }

      return Object.freeze({
        version: 1 as const,
        generationId: authority.generationId,
        unresolvedRaceCount: authority.unresolvedRaceCount,
        unresolvedRaceSetSha256: authority.unresolvedRaceSetSha256,
        observedAt: checked.toISOString(),
        capacityAllowed: true as const,
        paidUsageAllowed: false as const,
      }) satisfies DnaPopulationEntrantAuthorityCapacityApproval;
    },
  });
}
