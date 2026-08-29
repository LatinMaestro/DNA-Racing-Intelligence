export const DNA_OPEN_LAB_TARGET_REFRESH_INTERVAL_MILLISECONDS =
  24 * 60 * 60_000;

export const DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES = Object.freeze({
  storageBytes: 10_000_000_000,
  classAOperations: 1_000_000,
  classBOperations: 10_000_000,
});

/**
 * Operating budgets deliberately stop at 80% of the published R2 Standard
 * free allowances. They are safety limits, not targets.
 */
export const DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS = Object.freeze({
  storageBytes: 8_000_000_000,
  classAOperations: 800_000,
  classBOperations: 8_000_000,
});

export const DNA_OPEN_LAB_MAX_RECURRING_R2_OPERATIONS_PER_DAILY_REFRESH =
  Object.freeze({
    classAOperations: 1_000,
    classBOperations: 2_000,
  });

export const DNA_OPEN_LAB_MAX_RECURRING_R2_OPERATIONS_PER_31_DAYS =
  Object.freeze({
    classAOperations:
      DNA_OPEN_LAB_MAX_RECURRING_R2_OPERATIONS_PER_DAILY_REFRESH.classAOperations *
      31,
    classBOperations:
      DNA_OPEN_LAB_MAX_RECURRING_R2_OPERATIONS_PER_DAILY_REFRESH.classBOperations *
      31,
  });

export const DNA_OPEN_LAB_ZERO_COST_BLOCKER_IDS = Object.freeze([
  "storage_budget_exhausted",
  "class_a_budget_exhausted",
  "class_b_budget_exhausted",
] as const);

export type DnaOpenLabZeroCostBlockerId =
  (typeof DNA_OPEN_LAB_ZERO_COST_BLOCKER_IDS)[number];

export type DnaOpenLabR2Usage = Readonly<{
  storageBytes: number;
  classAOperations: number;
  classBOperations: number;
}>;

export type DnaOpenLabZeroCostRefreshDecision = Readonly<{
  allowed: boolean;
  action: "run_daily_refresh" | "pause_and_serve_last_good";
  blockerIds: readonly DnaOpenLabZeroCostBlockerId[];
  targetRefreshIntervalMilliseconds: typeof DNA_OPEN_LAB_TARGET_REFRESH_INTERVAL_MILLISECONDS;
  projectedUsage: DnaOpenLabR2Usage;
  budgets: typeof DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS;
  paidUsageAllowed: false;
  preserveLastGood: true;
}>;

function policyError(message: string): never {
  throw new Error(`DNA Open Lab zero-cost refresh policy: ${message}`);
}

function usageCount(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    policyError(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function usage(input: DnaOpenLabR2Usage, prefix: string): DnaOpenLabR2Usage {
  return Object.freeze({
    storageBytes: usageCount(input.storageBytes, `${prefix}.storageBytes`),
    classAOperations: usageCount(
      input.classAOperations,
      `${prefix}.classAOperations`,
    ),
    classBOperations: usageCount(
      input.classBOperations,
      `${prefix}.classBOperations`,
    ),
  });
}

function addUsage(
  current: DnaOpenLabR2Usage,
  planned: DnaOpenLabR2Usage,
): DnaOpenLabR2Usage {
  const projected = {
    storageBytes: current.storageBytes + planned.storageBytes,
    classAOperations: current.classAOperations + planned.classAOperations,
    classBOperations: current.classBOperations + planned.classBOperations,
  };
  for (const [field, value] of Object.entries(projected)) {
    if (!Number.isSafeInteger(value)) {
      policyError(`projectedUsage.${field} exceeds safe integer capacity`);
    }
  }
  return Object.freeze(projected);
}

/**
 * Checks the current billing-window usage plus one proposed refresh before any
 * provider write. Exhaustion pauses acquisition and preserves the last-good
 * publication; it never rolls into paid usage automatically.
 */
export function evaluateDnaOpenLabZeroCostRefresh(input: {
  currentUsage: DnaOpenLabR2Usage;
  plannedRefreshUsage: DnaOpenLabR2Usage;
}): DnaOpenLabZeroCostRefreshDecision {
  const projectedUsage = addUsage(
    usage(input.currentUsage, "currentUsage"),
    usage(input.plannedRefreshUsage, "plannedRefreshUsage"),
  );
  const blockerIds: DnaOpenLabZeroCostBlockerId[] = [];
  if (
    projectedUsage.storageBytes > DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.storageBytes
  ) {
    blockerIds.push("storage_budget_exhausted");
  }
  if (
    projectedUsage.classAOperations >
    DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.classAOperations
  ) {
    blockerIds.push("class_a_budget_exhausted");
  }
  if (
    projectedUsage.classBOperations >
    DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.classBOperations
  ) {
    blockerIds.push("class_b_budget_exhausted");
  }
  const allowed = blockerIds.length === 0;
  return Object.freeze({
    allowed,
    action: allowed ? "run_daily_refresh" : "pause_and_serve_last_good",
    blockerIds: Object.freeze(blockerIds),
    targetRefreshIntervalMilliseconds:
      DNA_OPEN_LAB_TARGET_REFRESH_INTERVAL_MILLISECONDS,
    projectedUsage,
    budgets: DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS,
    paidUsageAllowed: false,
    preserveLastGood: true,
  });
}
