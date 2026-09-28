import {
  DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES,
  DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS,
  type DnaOpenLabR2Usage,
} from "./dna-open-lab-zero-cost-refresh-policy";

export const DNA_POPULATION_ENTRANT_AUTHORITY_R2_OPERATION_RESERVE_BASIS_POINTS =
  1_000 as const;

function budgetBelowFreeAllowance(freeAllowance: number): number {
  return (
    freeAllowance -
    Math.ceil(
      (freeAllowance *
        DNA_POPULATION_ENTRANT_AUTHORITY_R2_OPERATION_RESERVE_BASIS_POINTS) /
        10_000,
    )
  );
}

/**
 * The entrant backfill is a bounded, owner-gated one-time acquisition rather
 * than the recurring daily refresh. Keep the normal refresh/storage budgets
 * unchanged, but allow this backfill to use at most 90% of R2 operation free
 * allowances. The remaining 10% is a hard operational reserve for unrelated
 * private-site reads/recovery and keeps the acquisition below paid usage.
 */
export const DNA_POPULATION_ENTRANT_AUTHORITY_ZERO_COST_R2_BUDGETS =
  Object.freeze({
    storageBytes: DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.storageBytes,
    classAOperations: budgetBelowFreeAllowance(
      DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES.classAOperations,
    ),
    classBOperations: budgetBelowFreeAllowance(
      DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES.classBOperations,
    ),
  }) satisfies DnaOpenLabR2Usage;
