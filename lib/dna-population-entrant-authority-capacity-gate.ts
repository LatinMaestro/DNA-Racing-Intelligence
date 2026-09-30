import type {
  DnaPopulationEntrantAuthorityCapacityApproval,
  DnaPopulationEntrantAuthorityCapacityGate,
} from "./dna-population-entrant-authority-commit-protocol";
import { projectDnaPopulationEntrantAuthorityChunkArchive } from "./dna-population-entrant-authority-chunk-projection";
import {
  DNA_POPULATION_ENTRANT_AUTHORITY_VERIFIED_COMPACT_RECORD_BYTES,
  planDnaPopulationEntrantAuthorityRemainingR2Usage,
  projectDnaPopulationEntrantAuthorityR2Cost,
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
  DNA_POPULATION_ENTRANT_AUTHORITY_VERIFIED_COMPACT_RECORD_BYTES;

export const DNA_POPULATION_ENTRANT_AUTHORITY_COMMIT_PLANNED_NEON_USAGE =
  Object.freeze({
    storageBytes: 4_096,
    computeMilliCuHours: 1_000,
  });

export type DnaPopulationEntrantAuthorityCapacityDiagnostic =
  | "invalid_configuration"
  | "measurement_unavailable"
  | "measurement_failed"
  | "measurement_invalid"
  | "measurement_stale"
  | "projection_invalid"
  | "r2_storage_class_blocked"
  | "r2_cost_ceiling_blocked"
  | "neon_storage_blocked"
  | "neon_compute_blocked";

export class DnaPopulationEntrantAuthorityCapacityError extends Error {
  readonly diagnostic: DnaPopulationEntrantAuthorityCapacityDiagnostic;

  constructor(
    diagnostic: DnaPopulationEntrantAuthorityCapacityDiagnostic,
    message: string,
  ) {
    super(`Population entrant authority capacity gate: ${message}`);
    this.name = "DnaPopulationEntrantAuthorityCapacityError";
    this.diagnostic = diagnostic;
  }
}

export type DnaPopulationEntrantAuthoritySizingAuthority = Readonly<{
  version: 1;
  unresolvedRaceCount: number;
  unresolvedRaceSetSha256: string;
  measuredMaximumCompactEntrantAuthorityBytes: number;
  verifiedIncrementalMaximumCompactEntrantAuthorityBytes: number;
}>;

function capacityError(
  message: string,
  diagnostic: DnaPopulationEntrantAuthorityCapacityDiagnostic = "invalid_configuration",
): never {
  throw new DnaPopulationEntrantAuthorityCapacityError(diagnostic, message);
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
    capacityError(
      "current provider measurement is invalid",
      "measurement_invalid",
    );
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
      capacityError(
        "current provider measurement is stale or future-dated",
        "measurement_stale",
      );
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
    async assertFreshCurrentCapacity(requestedAuthority, requestedRemainingRaceCount) {
      const authority = validateAuthority(requestedAuthority);
      const remainingRaceCount =
        requestedRemainingRaceCount === undefined
          ? authority.unresolvedRaceCount
          : positive(requestedRemainingRaceCount, "remainingRaceCount");
      if (remainingRaceCount > authority.unresolvedRaceCount) {
        capacityError("remainingRaceCount exceeds audited authority");
      }
      if (
        sizingAuthority.unresolvedRaceCount !== authority.unresolvedRaceCount ||
        sizingAuthority.unresolvedRaceSetSha256 !==
          authority.unresolvedRaceSetSha256
      ) {
        capacityError("sizing authority disagrees with audited authority");
      }
      if (input.measurementSource.status !== "ready") {
        capacityError(
          "current provider measurement is unavailable",
          "measurement_unavailable",
        );
      }

      const started = now();
      if (Number.isNaN(started.getTime())) {
        capacityError("measurement clock is invalid");
      }

      let measurement: DnaOpenLabProviderCapacityMeasurement;
      try {
        measurement = await input.measurementSource.measure({ ownerId });
      } catch {
        capacityError(
          "current provider measurement failed",
          "measurement_failed",
        );
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

      let archiveProjection: ReturnType<
        typeof projectDnaPopulationEntrantAuthorityChunkArchive
      >;
      let r2CostProjection: ReturnType<
        typeof projectDnaPopulationEntrantAuthorityR2Cost
      >;
      let projectedImmediateNeonStorageBytes: number;
      let projectedImmediateNeonComputeMilliCuHours: number;
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
        r2CostProjection = projectDnaPopulationEntrantAuthorityR2Cost({
          currentUsage: measurement.currentR2Usage,
          // Continuation callers bind this count to independently recovered
          // durable state. First-cohort callers omit it and retain the
          // conservative full-authority reservation.
          plannedUsage: planDnaPopulationEntrantAuthorityRemainingR2Usage({
            remainingRaceCount,
          }),
        });
        projectedImmediateNeonStorageBytes =
          measurement.currentNeonUsage.storageBytes +
          DNA_POPULATION_ENTRANT_AUTHORITY_COMMIT_PLANNED_NEON_USAGE.storageBytes;
        projectedImmediateNeonComputeMilliCuHours =
          measurement.currentNeonUsage.computeMilliCuHours +
          DNA_POPULATION_ENTRANT_AUTHORITY_COMMIT_PLANNED_NEON_USAGE.computeMilliCuHours;
        if (
          !Number.isSafeInteger(projectedImmediateNeonStorageBytes) ||
          !Number.isSafeInteger(projectedImmediateNeonComputeMilliCuHours)
        ) {
          capacityError(
            "current provider capacity projection is invalid",
            "projection_invalid",
          );
        }
      } catch {
        capacityError("current provider capacity projection is invalid");
      }

      if (
        measurement.r2StorageClass !== DNA_OPEN_LAB_REQUIRED_R2_STORAGE_CLASS
      ) {
        capacityError(
          "current provider capacity is blocked",
          "r2_storage_class_blocked",
        );
      }
      if (
        !r2CostProjection.allowed ||
        r2CostProjection.paidR2UsageAllowed !== true
      ) {
        capacityError(
          "current provider capacity is blocked",
          "r2_cost_ceiling_blocked",
        );
      }
      if (
        archiveProjection.projectedUsage.neonStorageBytes >
          DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.storageBytes ||
        projectedImmediateNeonStorageBytes >
          DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.storageBytes
      ) {
        capacityError(
          "current provider capacity is blocked",
          "neon_storage_blocked",
        );
      }
      if (
        projectedImmediateNeonComputeMilliCuHours >
        DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.computeMilliCuHours
      ) {
        capacityError(
          "current provider capacity is blocked",
          "neon_compute_blocked",
        );
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
