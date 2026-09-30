import {
  DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES,
  type DnaOpenLabR2Usage,
} from "./dna-open-lab-zero-cost-refresh-policy";
import {
  DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_SESSION_COHORT_LIMIT,
  DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_MAXIMUM_RACES,
} from "./dna-population-entrant-authority-cohort";

export const DNA_POPULATION_ENTRANT_AUTHORITY_R2_MAXIMUM_COST_MICRO_USD =
  5_000_000 as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_R2_STORAGE_MICRO_USD_PER_GB_MONTH =
  15_000 as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_R2_CLASS_A_MICRO_USD_PER_MILLION =
  4_500_000 as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_R2_CLASS_B_MICRO_USD_PER_MILLION =
  360_000 as const;

export const DNA_POPULATION_ENTRANT_AUTHORITY_MAXIMUM_RACE_DOCUMENT_BYTES =
  11_795 as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_MAXIMUM_COMPACT_RECORD_BYTES =
  902 as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_LIVE_AUDIT_CLASS_B_RESERVE_PER_SESSION =
  100_000 as const;

const BYTES_PER_BILLABLE_GB = 1_000_000_000;
const CHUNK_ENVELOPE_BYTES_CEILING = 1_024;
const CLASS_A_OPERATIONS_PER_REMAINING_RACE = 1;
const CLASS_B_OPERATIONS_PER_REMAINING_RACE = 1;
const CLASS_A_OPERATIONS_PER_COMPACT_CHUNK_CEILING = 4;
const CLASS_B_OPERATIONS_PER_COMPACT_CHUNK_CEILING = 8;
const CLASS_A_OPERATION_SAFETY_RESERVE = 25_000;
const CLASS_B_OPERATION_SAFETY_RESERVE = 50_000;

function nonNegative(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Population entrant R2 cost policy: ${field} is invalid`);
  }
  return value;
}

function add(...values: number[]): number {
  const result = values.reduce((total, value) => total + value, 0);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(
      "Population entrant R2 cost policy: projection exceeds safe integer capacity",
    );
  }
  return result;
}

function multiply(left: number, right: number): number {
  const result = left * right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error("Population entrant R2 cost policy: projection exceeds safe integer capacity");
  }
  return result;
}

function pricedOverageMicroUsd(
  usage: number,
  freeAllowance: number,
  microUsdPerUnit: number,
  unitsPerPrice: number,
): number {
  const billable = Math.max(0, usage - freeAllowance);
  if (billable === 0) return 0;
  return Math.ceil((billable * microUsdPerUnit) / unitsPerPrice);
}

export function dnaPopulationEntrantAuthorityR2BillMicroUsd(
  usage: DnaOpenLabR2Usage,
): number {
  const storageBytes = nonNegative(usage.storageBytes, "storageBytes");
  const classAOperations = nonNegative(
    usage.classAOperations,
    "classAOperations",
  );
  const classBOperations = nonNegative(
    usage.classBOperations,
    "classBOperations",
  );
  return add(
    pricedOverageMicroUsd(
      storageBytes,
      DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES.storageBytes,
      DNA_POPULATION_ENTRANT_AUTHORITY_R2_STORAGE_MICRO_USD_PER_GB_MONTH,
      BYTES_PER_BILLABLE_GB,
    ),
    pricedOverageMicroUsd(
      classAOperations,
      DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES.classAOperations,
      DNA_POPULATION_ENTRANT_AUTHORITY_R2_CLASS_A_MICRO_USD_PER_MILLION,
      1_000_000,
    ),
    pricedOverageMicroUsd(
      classBOperations,
      DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES.classBOperations,
      DNA_POPULATION_ENTRANT_AUTHORITY_R2_CLASS_B_MICRO_USD_PER_MILLION,
      1_000_000,
    ),
  );
}

export function dnaPopulationEntrantAuthorityMaximumAdditionalClassBOperations(
  currentUsage: DnaOpenLabR2Usage,
): number {
  const current = Object.freeze({
    storageBytes: nonNegative(currentUsage.storageBytes, "storageBytes"),
    classAOperations: nonNegative(
      currentUsage.classAOperations,
      "classAOperations",
    ),
    classBOperations: nonNegative(
      currentUsage.classBOperations,
      "classBOperations",
    ),
  });
  const fixedCost = dnaPopulationEntrantAuthorityR2BillMicroUsd({
    ...current,
    classBOperations: 0,
  });
  if (fixedCost >= DNA_POPULATION_ENTRANT_AUTHORITY_R2_MAXIMUM_COST_MICRO_USD) {
    return 0;
  }
  const classBBudgetMicroUsd =
    DNA_POPULATION_ENTRANT_AUTHORITY_R2_MAXIMUM_COST_MICRO_USD - fixedCost;
  const maximumBillableClassBOperations = Math.floor(
    (classBBudgetMicroUsd * 1_000_000) /
      DNA_POPULATION_ENTRANT_AUTHORITY_R2_CLASS_B_MICRO_USD_PER_MILLION,
  );
  const maximumTotalClassBOperations = add(
    DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES.classBOperations,
    maximumBillableClassBOperations,
  );
  return Math.max(0, maximumTotalClassBOperations - current.classBOperations);
}

export type DnaPopulationEntrantAuthorityR2CompletionCostProjection = Readonly<{
  remainingRaceCount: number;
  remainingCompactChunkCount: number;
  remainingAutonomousSessionCount: number;
  projectedUsage: DnaOpenLabR2Usage;
  projectedCostMicroUsd: number;
  maximumAuthorizedCostMicroUsd: typeof DNA_POPULATION_ENTRANT_AUTHORITY_R2_MAXIMUM_COST_MICRO_USD;
  allowed: boolean;
}>;

export function projectDnaPopulationEntrantAuthorityR2CompletionCost(input: {
  currentUsage: DnaOpenLabR2Usage;
  unresolvedRaceCount: number;
  persistedRaceCount: number;
  maximumCompactRecordBytes?: number;
}): DnaPopulationEntrantAuthorityR2CompletionCostProjection {
  const unresolvedRaceCount = nonNegative(
    input.unresolvedRaceCount,
    "unresolvedRaceCount",
  );
  const persistedRaceCount = nonNegative(
    input.persistedRaceCount,
    "persistedRaceCount",
  );
  if (unresolvedRaceCount < 1 || persistedRaceCount > unresolvedRaceCount) {
    throw new Error(
      "Population entrant R2 cost policy: durable Race counters are invalid",
    );
  }
  const maximumCompactRecordBytes =
    input.maximumCompactRecordBytes === undefined
      ? DNA_POPULATION_ENTRANT_AUTHORITY_MAXIMUM_COMPACT_RECORD_BYTES
      : nonNegative(
          input.maximumCompactRecordBytes,
          "maximumCompactRecordBytes",
        );
  if (
    maximumCompactRecordBytes <
    DNA_POPULATION_ENTRANT_AUTHORITY_MAXIMUM_COMPACT_RECORD_BYTES
  ) {
    throw new Error(
      "Population entrant R2 cost policy: compact record bound regressed",
    );
  }

  const remainingRaceCount = unresolvedRaceCount - persistedRaceCount;
  const remainingCompactChunkCount =
    remainingRaceCount === 0
      ? 0
      : Math.ceil(
          remainingRaceCount /
            DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_MAXIMUM_RACES,
        );
  const racesPerAutonomousSession =
    DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_MAXIMUM_RACES *
    DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_SESSION_COHORT_LIMIT;
  const remainingAutonomousSessionCount =
    remainingRaceCount === 0
      ? 0
      : Math.ceil(remainingRaceCount / racesPerAutonomousSession);

  const rawRaceBytes = multiply(
    remainingRaceCount,
    DNA_POPULATION_ENTRANT_AUTHORITY_MAXIMUM_RACE_DOCUMENT_BYTES,
  );
  const compactRecordBytes = multiply(
    remainingRaceCount,
    maximumCompactRecordBytes,
  );
  const compactSeparatorBytes = Math.max(
    0,
    remainingRaceCount - remainingCompactChunkCount,
  );
  const compactEnvelopeBytes = multiply(
    remainingCompactChunkCount,
    CHUNK_ENVELOPE_BYTES_CEILING,
  );
  const futureAuditClassBOperations = multiply(
    remainingAutonomousSessionCount,
    DNA_POPULATION_ENTRANT_AUTHORITY_LIVE_AUDIT_CLASS_B_RESERVE_PER_SESSION,
  );

  const projectedUsage = Object.freeze({
    storageBytes: add(
      input.currentUsage.storageBytes,
      rawRaceBytes,
      compactRecordBytes,
      compactSeparatorBytes,
      compactEnvelopeBytes,
    ),
    classAOperations: add(
      input.currentUsage.classAOperations,
      multiply(remainingRaceCount, CLASS_A_OPERATIONS_PER_REMAINING_RACE),
      multiply(
        remainingCompactChunkCount,
        CLASS_A_OPERATIONS_PER_COMPACT_CHUNK_CEILING,
      ),
      CLASS_A_OPERATION_SAFETY_RESERVE,
    ),
    classBOperations: add(
      input.currentUsage.classBOperations,
      multiply(remainingRaceCount, CLASS_B_OPERATIONS_PER_REMAINING_RACE),
      multiply(
        remainingCompactChunkCount,
        CLASS_B_OPERATIONS_PER_COMPACT_CHUNK_CEILING,
      ),
      futureAuditClassBOperations,
      CLASS_B_OPERATION_SAFETY_RESERVE,
    ),
  });
  const projectedCostMicroUsd =
    dnaPopulationEntrantAuthorityR2BillMicroUsd(projectedUsage);
  return Object.freeze({
    remainingRaceCount,
    remainingCompactChunkCount,
    remainingAutonomousSessionCount,
    projectedUsage,
    projectedCostMicroUsd,
    maximumAuthorizedCostMicroUsd:
      DNA_POPULATION_ENTRANT_AUTHORITY_R2_MAXIMUM_COST_MICRO_USD,
    allowed:
      projectedCostMicroUsd <=
      DNA_POPULATION_ENTRANT_AUTHORITY_R2_MAXIMUM_COST_MICRO_USD,
  });
}
