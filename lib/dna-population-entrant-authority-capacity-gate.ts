import type {
  DnaPopulationEntrantAuthorityCapacityApproval,
  DnaPopulationEntrantAuthorityCapacityGate,
} from "./dna-population-entrant-authority-commit-protocol";
import { projectDnaPopulationEntrantAuthorityChunkArchive } from "./dna-population-entrant-authority-chunk-projection";
import {
  DNA_POPULATION_ENTRANT_AUTHORITY_R2_COST_LIMIT_MICRO_USD,
  DNA_POPULATION_ENTRANT_AUTHORITY_R2_STANDARD_PRICING,
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
import { DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES } from "./dna-open-lab-zero-cost-refresh-policy";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export const DNA_POPULATION_ENTRANT_AUTHORITY_VERIFIED_COMPACT_BYTES_FLOOR =
  902 as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_VERIFIED_RACE_DOCUMENT_BYTES_FLOOR =
  11_795 as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_LIVE_AUDIT_CLASS_B_CEILING =
  100_000 as const;

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

function billableR2CostMicroUsd(input: {
  storageBytes: number;
  classAOperations: number;
  classBOperations: number;
}): number {
  const pricing = DNA_POPULATION_ENTRANT_AUTHORITY_R2_STANDARD_PRICING;
  const million = 1_000_000n;
  const ceil = (numerator: bigint, denominator: bigint): bigint =>
    (numerator + denominator - 1n) / denominator;
  const storageBytes = Math.max(
    0,
    input.storageBytes - DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES.storageBytes,
  );
  const classAOperations = Math.max(
    0,
    input.classAOperations -
      DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES.classAOperations,
  );
  const classBOperations = Math.max(
    0,
    input.classBOperations -
      DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES.classBOperations,
  );
  const total =
    ceil(
      BigInt(storageBytes) * BigInt(pricing.storageMicroUsdPerGbMonth),
      BigInt(pricing.bytesPerBillableGb),
    ) +
    ceil(
      BigInt(classAOperations) * BigInt(pricing.classAMicroUsdPerMillion),
      million,
    ) +
    ceil(
      BigInt(classBOperations) * BigInt(pricing.classBMicroUsdPerMillion),
      million,
    );
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    capacityError("projected R2 cost exceeds safe integer capacity");
  }
  return Number(total);
}

function safeAdd(left: number, right: number, field: string): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) {
    capacityError(`${field} exceeds safe integer capacity`);
  }
  return value;
}

function safeMultiply(left: number, right: number, field: string): number {
  const value = left * right;
  if (!Number.isSafeInteger(value) || value < 0) {
    capacityError(`${field} exceeds safe integer capacity`);
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
 * Creates the read-only bounded-capacity gate used by the R2-first entrant
 * authority commit primitive.
 *
 * Every assertion obtains a fresh sanitized Cloudflare/Neon measurement,
 * keeps Neon inside the zero-cost budget and permits only the owner-approved
 * bounded R2 spend. The R2 projection conservatively includes the complete
 * unresolved Race-document archive, compact entrant archive, verification
 * reads, and the live-audit read ceiling; incremental billable R2 cost may not
 * exceed US$5 for the population workload.
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
      } catch {
        capacityError("current provider capacity projection is invalid");
      }

      if (
        measurement.r2StorageClass !== DNA_OPEN_LAB_REQUIRED_R2_STORAGE_CLASS
      ) {
        capacityError("current provider capacity projection is invalid");
      }

      const rawRaceStorageBytes = safeMultiply(
        authority.unresolvedRaceCount,
        DNA_POPULATION_ENTRANT_AUTHORITY_VERIFIED_RACE_DOCUMENT_BYTES_FLOOR,
        "full Race-document storage projection",
      );
      const projectedR2Usage = Object.freeze({
        storageBytes: safeAdd(
          safeAdd(
            measurement.currentR2Usage.storageBytes,
            rawRaceStorageBytes,
            "projected R2 storage",
          ),
          archiveProjection.projected.r2StorageBytes,
          "projected R2 storage",
        ),
        classAOperations: safeAdd(
          safeAdd(
            measurement.currentR2Usage.classAOperations,
            authority.unresolvedRaceCount,
            "projected R2 Class A operations",
          ),
          archiveProjection.projected.r2ClassAOperations,
          "projected R2 Class A operations",
        ),
        classBOperations: safeAdd(
          safeAdd(
            safeAdd(
              measurement.currentR2Usage.classBOperations,
              authority.unresolvedRaceCount,
              "projected R2 Class B operations",
            ),
            archiveProjection.projected.r2ClassBOperations,
            "projected R2 Class B operations",
          ),
          DNA_POPULATION_ENTRANT_AUTHORITY_LIVE_AUDIT_CLASS_B_CEILING,
          "projected R2 Class B operations",
        ),
      });
      const currentR2CostMicroUsd = billableR2CostMicroUsd(
        measurement.currentR2Usage,
      );
      const projectedR2CostMicroUsd = billableR2CostMicroUsd(projectedR2Usage);
      const incrementalR2CostMicroUsd = Math.max(
        0,
        projectedR2CostMicroUsd - currentR2CostMicroUsd,
      );

      const projectedNeonStorageBytes = safeAdd(
        measurement.currentNeonUsage.storageBytes,
        archiveProjection.projected.neonStorageBytes,
        "projected Neon storage",
      );
      const projectedNeonComputeMilliCuHours = safeAdd(
        measurement.currentNeonUsage.computeMilliCuHours,
        DNA_POPULATION_ENTRANT_AUTHORITY_COMMIT_PLANNED_NEON_USAGE.computeMilliCuHours,
        "projected Neon compute",
      );

      if (
        incrementalR2CostMicroUsd >
          DNA_POPULATION_ENTRANT_AUTHORITY_R2_COST_LIMIT_MICRO_USD ||
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
      }) satisfies DnaPopulationEntrantAuthorityCapacityApproval;
    },
  });
}
