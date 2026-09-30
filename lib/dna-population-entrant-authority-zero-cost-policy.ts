import {
  DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES,
  DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS,
  type DnaOpenLabR2Usage,
} from "./dna-open-lab-zero-cost-refresh-policy";

export const DNA_POPULATION_ENTRANT_AUTHORITY_R2_OPERATION_RESERVE_BASIS_POINTS =
  1_000 as const;

export const DNA_POPULATION_ENTRANT_AUTHORITY_MAXIMUM_AUTHORIZED_R2_COST_MICRO_USD =
  5_000_000 as const;

export const DNA_POPULATION_ENTRANT_AUTHORITY_R2_PRICING = Object.freeze({
  bytesPerBillableGb: 1_000_000_000,
  storageMicroUsdPerGbMonth: 15_000,
  classAMicroUsdPerMillion: 4_500_000,
  classBMicroUsdPerMillion: 360_000,
});

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

function nonNegative(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Population entrant R2 cost policy: ${field} is invalid`);
  }
  return value;
}

function billedMicroUsd(input: {
  used: number;
  free: number;
  microUsdPerUnit: number;
  units: number;
}): number {
  const billable = Math.max(
    0,
    nonNegative(input.used, "usage") - nonNegative(input.free, "free allowance"),
  );
  if (
    !Number.isSafeInteger(input.microUsdPerUnit) ||
    input.microUsdPerUnit < 0 ||
    !Number.isSafeInteger(input.units) ||
    input.units < 1
  ) {
    throw new Error("Population entrant R2 cost policy: pricing is invalid");
  }
  const microUsd = Math.ceil(
    (billable * input.microUsdPerUnit) / input.units,
  );
  if (!Number.isSafeInteger(microUsd) || microUsd < 0) {
    throw new Error(
      "Population entrant R2 cost policy: projected charge is invalid",
    );
  }
  return microUsd;
}

/**
 * Historical zero-cost budget retained for older projection evidence and for
 * unrelated recurring refreshes. The entrant population may now cross this
 * operation ceiling only through the separately owner-authorized US$5 R2 cap.
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

/**
 * Conservative monthly R2 charge at the published Standard prices.
 *
 * Storage above the free allowance is charged as if retained for the full
 * month. Operation charges subtract only the published free allowances.
 */
export function dnaPopulationEntrantAuthorityR2CostMicroUsd(
  usage: DnaOpenLabR2Usage,
): number {
  const storage = billedMicroUsd({
    used: usage.storageBytes,
    free: DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES.storageBytes,
    microUsdPerUnit:
      DNA_POPULATION_ENTRANT_AUTHORITY_R2_PRICING.storageMicroUsdPerGbMonth,
    units: DNA_POPULATION_ENTRANT_AUTHORITY_R2_PRICING.bytesPerBillableGb,
  });
  const classA = billedMicroUsd({
    used: usage.classAOperations,
    free: DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES.classAOperations,
    microUsdPerUnit:
      DNA_POPULATION_ENTRANT_AUTHORITY_R2_PRICING.classAMicroUsdPerMillion,
    units: 1_000_000,
  });
  const classB = billedMicroUsd({
    used: usage.classBOperations,
    free: DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES.classBOperations,
    microUsdPerUnit:
      DNA_POPULATION_ENTRANT_AUTHORITY_R2_PRICING.classBMicroUsdPerMillion,
    units: 1_000_000,
  });
  const total = storage + classA + classB;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error(
      "Population entrant R2 cost policy: total projected charge is invalid",
    );
  }
  return total;
}

/**
 * Maximum additional Class-B reads available under the owner-authorized R2
 * dollar ceiling after conservatively charging current storage and Class-A use.
 */
export function dnaPopulationEntrantAuthorityAdditionalClassBOperations(
  usage: DnaOpenLabR2Usage,
): number {
  const fixedCost = dnaPopulationEntrantAuthorityR2CostMicroUsd({
    ...usage,
    classBOperations: 0,
  });
  if (
    fixedCost >=
    DNA_POPULATION_ENTRANT_AUTHORITY_MAXIMUM_AUTHORIZED_R2_COST_MICRO_USD
  ) {
    return 0;
  }
  const remainingMicroUsd =
    DNA_POPULATION_ENTRANT_AUTHORITY_MAXIMUM_AUTHORIZED_R2_COST_MICRO_USD -
    fixedCost;
  const maximumBillableClassB = Math.floor(
    (remainingMicroUsd * 1_000_000) /
      DNA_POPULATION_ENTRANT_AUTHORITY_R2_PRICING.classBMicroUsdPerMillion,
  );
  const maximumClassBOperations =
    DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES.classBOperations +
    maximumBillableClassB;
  if (!Number.isSafeInteger(maximumClassBOperations)) {
    throw new Error(
      "Population entrant R2 cost policy: Class-B ceiling is invalid",
    );
  }
  return Math.max(0, maximumClassBOperations - usage.classBOperations);
}
