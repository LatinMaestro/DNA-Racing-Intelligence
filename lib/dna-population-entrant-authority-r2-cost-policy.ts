import {
  DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES,
  type DnaOpenLabR2Usage,
} from "./dna-open-lab-zero-cost-refresh-policy";
import { DNA_POPULATION_ENTRANT_AUTHORITY_ZERO_COST_R2_BUDGETS } from "./dna-population-entrant-authority-zero-cost-policy";
import { DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS } from "./dna-population-race-index-r2-chunk";

export const DNA_POPULATION_ENTRANT_AUTHORITY_MAXIMUM_R2_COST_MICRO_USD =
  0 as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_R2_BYTES_PER_BILLABLE_GB =
  1_000_000_000 as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_R2_STORAGE_MICRO_USD_PER_GB_MONTH =
  15_000 as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_R2_CLASS_A_MICRO_USD_PER_MILLION =
  4_500_000 as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_R2_CLASS_B_MICRO_USD_PER_MILLION =
  360_000 as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_VERIFIED_RACE_DOCUMENT_BYTES =
  11_795 as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_VERIFIED_COMPACT_RECORD_BYTES =
  902 as const;

const COMPACT_CHUNK_ENVELOPE_BYTES = 1_024;
const COMPACT_CHUNK_CLASS_A_OPERATIONS = 2;
const COMPACT_CHUNK_CLASS_B_OPERATIONS = 4;
const RACE_DOCUMENT_CLASS_A_OPERATIONS = 1;
const RACE_DOCUMENT_CLASS_B_OPERATIONS = 2;

function costError(message: string): never {
  throw new Error(`Population entrant authority R2 cost policy: ${message}`);
}

function count(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    costError(`${field} is invalid`);
  }
  return value;
}

function add(left: number, right: number, field: string): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) {
    costError(`${field} exceeds safe integer capacity`);
  }
  return value;
}

function multiply(left: number, right: number, field: string): number {
  const value = left * right;
  if (!Number.isSafeInteger(value) || value < 0) {
    costError(`${field} exceeds safe integer capacity`);
  }
  return value;
}

function usage(value: DnaOpenLabR2Usage, field: string): DnaOpenLabR2Usage {
  return Object.freeze({
    storageBytes: count(value.storageBytes, `${field}.storageBytes`),
    classAOperations: count(
      value.classAOperations,
      `${field}.classAOperations`,
    ),
    classBOperations: count(
      value.classBOperations,
      `${field}.classBOperations`,
    ),
  });
}

function pricedExcess(input: {
  projected: number;
  freeAllowance: number;
  priceMicroUsd: number;
  unitsPerPrice: number;
  field: string;
}): number {
  const excess = Math.max(0, input.projected - input.freeAllowance);
  const numerator = multiply(excess, input.priceMicroUsd, input.field);
  return Math.ceil(numerator / input.unitsPerPrice);
}

export function planDnaPopulationEntrantAuthorityRemainingR2Usage(input: {
  remainingRaceCount: number;
}): DnaOpenLabR2Usage {
  const remainingRaceCount = count(
    input.remainingRaceCount,
    "remainingRaceCount",
  );
  const compactChunkCount = Math.ceil(
    remainingRaceCount / DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS,
  );
  const raceDocumentBytes = multiply(
    remainingRaceCount,
    DNA_POPULATION_ENTRANT_AUTHORITY_VERIFIED_RACE_DOCUMENT_BYTES,
    "Race-document archive bytes",
  );
  const compactRecordBytes = multiply(
    remainingRaceCount,
    DNA_POPULATION_ENTRANT_AUTHORITY_VERIFIED_COMPACT_RECORD_BYTES + 1,
    "compact entrant bytes",
  );
  const compactEnvelopeBytes = multiply(
    compactChunkCount,
    COMPACT_CHUNK_ENVELOPE_BYTES,
    "compact chunk envelope bytes",
  );

  return Object.freeze({
    storageBytes: add(
      add(raceDocumentBytes, compactRecordBytes, "remaining archive storage"),
      compactEnvelopeBytes,
      "remaining archive storage",
    ),
    classAOperations: add(
      multiply(
        remainingRaceCount,
        RACE_DOCUMENT_CLASS_A_OPERATIONS,
        "Race-document Class A operations",
      ),
      multiply(
        compactChunkCount,
        COMPACT_CHUNK_CLASS_A_OPERATIONS,
        "compact chunk Class A operations",
      ),
      "remaining Class A operations",
    ),
    classBOperations: add(
      multiply(
        remainingRaceCount,
        RACE_DOCUMENT_CLASS_B_OPERATIONS,
        "Race-document verification Class B operations",
      ),
      multiply(
        compactChunkCount,
        COMPACT_CHUNK_CLASS_B_OPERATIONS,
        "compact chunk Class B operations",
      ),
      "remaining Class B operations",
    ),
  });
}

export function projectDnaPopulationEntrantAuthorityR2Cost(input: {
  currentUsage: DnaOpenLabR2Usage;
  plannedUsage: DnaOpenLabR2Usage;
}) {
  const currentUsage = usage(input.currentUsage, "currentUsage");
  const plannedUsage = usage(input.plannedUsage, "plannedUsage");
  const projectedUsage = Object.freeze({
    storageBytes: add(
      currentUsage.storageBytes,
      plannedUsage.storageBytes,
      "projected storage",
    ),
    classAOperations: add(
      currentUsage.classAOperations,
      plannedUsage.classAOperations,
      "projected Class A operations",
    ),
    classBOperations: add(
      currentUsage.classBOperations,
      plannedUsage.classBOperations,
      "projected Class B operations",
    ),
  });

  const currentPaidCostMicroUsd =
    pricedExcess({
      projected: currentUsage.storageBytes,
      freeAllowance: DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES.storageBytes,
      priceMicroUsd:
        DNA_POPULATION_ENTRANT_AUTHORITY_R2_STORAGE_MICRO_USD_PER_GB_MONTH,
      unitsPerPrice: DNA_POPULATION_ENTRANT_AUTHORITY_R2_BYTES_PER_BILLABLE_GB,
      field: "current storage cost",
    }) +
    pricedExcess({
      projected: currentUsage.classAOperations,
      freeAllowance: DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES.classAOperations,
      priceMicroUsd:
        DNA_POPULATION_ENTRANT_AUTHORITY_R2_CLASS_A_MICRO_USD_PER_MILLION,
      unitsPerPrice: 1_000_000,
      field: "current Class A cost",
    }) +
    pricedExcess({
      projected: currentUsage.classBOperations,
      freeAllowance: DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES.classBOperations,
      priceMicroUsd:
        DNA_POPULATION_ENTRANT_AUTHORITY_R2_CLASS_B_MICRO_USD_PER_MILLION,
      unitsPerPrice: 1_000_000,
      field: "current Class B cost",
    });
  const projectedPaidCostMicroUsd =
    pricedExcess({
      projected: projectedUsage.storageBytes,
      freeAllowance: DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES.storageBytes,
      priceMicroUsd:
        DNA_POPULATION_ENTRANT_AUTHORITY_R2_STORAGE_MICRO_USD_PER_GB_MONTH,
      unitsPerPrice: DNA_POPULATION_ENTRANT_AUTHORITY_R2_BYTES_PER_BILLABLE_GB,
      field: "projected storage cost",
    }) +
    pricedExcess({
      projected: projectedUsage.classAOperations,
      freeAllowance: DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES.classAOperations,
      priceMicroUsd:
        DNA_POPULATION_ENTRANT_AUTHORITY_R2_CLASS_A_MICRO_USD_PER_MILLION,
      unitsPerPrice: 1_000_000,
      field: "projected Class A cost",
    }) +
    pricedExcess({
      projected: projectedUsage.classBOperations,
      freeAllowance: DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES.classBOperations,
      priceMicroUsd:
        DNA_POPULATION_ENTRANT_AUTHORITY_R2_CLASS_B_MICRO_USD_PER_MILLION,
      unitsPerPrice: 1_000_000,
      field: "projected Class B cost",
    });
  if (
    !Number.isSafeInteger(currentPaidCostMicroUsd) ||
    !Number.isSafeInteger(projectedPaidCostMicroUsd)
  ) {
    costError("projected paid cost exceeds safe integer capacity");
  }

  const allowed =
    projectedPaidCostMicroUsd === 0 &&
    projectedUsage.storageBytes <=
      DNA_POPULATION_ENTRANT_AUTHORITY_ZERO_COST_R2_BUDGETS.storageBytes &&
    projectedUsage.classAOperations <=
      DNA_POPULATION_ENTRANT_AUTHORITY_ZERO_COST_R2_BUDGETS.classAOperations &&
    projectedUsage.classBOperations <=
      DNA_POPULATION_ENTRANT_AUTHORITY_ZERO_COST_R2_BUDGETS.classBOperations;
  return Object.freeze({
    allowed,
    currentUsage,
    plannedUsage,
    projectedUsage,
    currentPaidCostMicroUsd,
    projectedPaidCostMicroUsd,
    maximumAuthorizedCostMicroUsd:
      DNA_POPULATION_ENTRANT_AUTHORITY_MAXIMUM_R2_COST_MICRO_USD,
    paidR2UsageAllowed: false as const,
    paidUsageAllowed: false as const,
    preserveLastGood: true as const,
  });
}
