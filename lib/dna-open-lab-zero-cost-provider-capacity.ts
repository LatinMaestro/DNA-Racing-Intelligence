import {
  DNA_OPEN_LAB_MAX_RECURRING_R2_OPERATIONS_PER_DAILY_REFRESH,
  DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES,
  DNA_OPEN_LAB_TARGET_REFRESH_INTERVAL_MILLISECONDS,
  DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS,
  type DnaOpenLabR2Usage,
  type DnaOpenLabZeroCostBlockerId,
} from "./dna-open-lab-zero-cost-refresh-policy";

export const DNA_OPEN_LAB_REQUIRED_R2_STORAGE_CLASS = "Standard" as const;

export const DNA_OPEN_LAB_NEON_FREE_ALLOWANCES = Object.freeze({
  storageBytes: 536_870_912,
  computeMilliCuHours: 100_000,
});

/**
 * Recurring operation stops below Neon's published free allowances. The
 * storage margin protects migrations and indexes; the compute margin protects
 * interactive private-site reads and recovery work.
 */
export const DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS = Object.freeze({
  storageBytes: 500_000_000,
  computeMilliCuHours: 80_000,
});

export const DNA_OPEN_LAB_MAX_PROJECTED_DAILY_REFRESHES = 31 as const;

export const DNA_OPEN_LAB_PROVIDER_CAPACITY_BLOCKER_IDS = Object.freeze([
  "r2_storage_class_not_standard",
  "class_a_refresh_limit_exceeded",
  "class_b_refresh_limit_exceeded",
  "storage_budget_exhausted",
  "class_a_budget_exhausted",
  "class_b_budget_exhausted",
  "neon_storage_budget_exhausted",
  "neon_compute_budget_exhausted",
] as const);

export type DnaOpenLabProviderCapacityBlockerId =
  (typeof DNA_OPEN_LAB_PROVIDER_CAPACITY_BLOCKER_IDS)[number];

export type DnaOpenLabNeonUsage = Readonly<{
  storageBytes: number;
  computeMilliCuHours: number;
}>;

export type DnaOpenLabProviderCapacityProjection = Readonly<{
  allowed: boolean;
  action: "commission_refresh" | "pause_and_serve_last_good";
  blockerIds: readonly DnaOpenLabProviderCapacityBlockerId[];
  measuredAt: string;
  billingWindowStartAt: string;
  billingWindowEndAt: string;
  neonMeasuredAt: string;
  neonBillingWindowStartAt: string;
  neonBillingWindowEndAt: string;
  r2RemainingRefreshes: number;
  neonRemainingRefreshes: number;
  maximumSafeR2RemainingRefreshes: number;
  maximumSafeNeonRemainingRefreshes: number;
  projectedR2Usage: DnaOpenLabR2Usage;
  projectedNeonUsage: DnaOpenLabNeonUsage;
  r2Headroom: DnaOpenLabR2Usage;
  neonHeadroom: DnaOpenLabNeonUsage;
  requiredR2StorageClass: typeof DNA_OPEN_LAB_REQUIRED_R2_STORAGE_CLASS;
  r2FreeAllowances: typeof DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES;
  r2Budgets: typeof DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS;
  neonFreeAllowances: typeof DNA_OPEN_LAB_NEON_FREE_ALLOWANCES;
  neonBudgets: typeof DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS;
  paidUsageAllowed: false;
  preserveLastGood: true;
}>;

function capacityError(message: string): never {
  throw new Error(`DNA Open Lab provider capacity: ${message}`);
}

function count(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    capacityError(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function timestamp(value: string, field: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) capacityError(`${field} is invalid`);
  return new Date(parsed).toISOString();
}

function r2Usage(value: DnaOpenLabR2Usage, field: string): DnaOpenLabR2Usage {
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

function neonUsage(
  value: DnaOpenLabNeonUsage,
  field: string,
): DnaOpenLabNeonUsage {
  return Object.freeze({
    storageBytes: count(value.storageBytes, `${field}.storageBytes`),
    computeMilliCuHours: count(
      value.computeMilliCuHours,
      `${field}.computeMilliCuHours`,
    ),
  });
}

function addProjected(
  current: number,
  perRefresh: number,
  refreshes: number,
  field: string,
): number {
  const projected = current + perRefresh * refreshes;
  if (!Number.isSafeInteger(projected)) {
    capacityError(`${field} exceeds safe integer capacity`);
  }
  return projected;
}

function safeRefreshes(input: {
  current: number;
  perRefresh: number;
  budget: number;
  requested: number;
}): number {
  if (input.current > input.budget) return 0;
  if (input.perRefresh === 0) return input.requested;
  return Math.min(
    input.requested,
    Math.floor((input.budget - input.current) / input.perRefresh),
  );
}

function headroom(projected: number, budget: number): number {
  return Math.max(0, budget - projected);
}

/**
 * Projects the complete remaining daily cadence before commissioning. Inputs
 * must come from dated provider measurements and conservative per-refresh
 * upper bounds. This function performs no provider work.
 */
export function projectDnaOpenLabZeroCostProviderCapacity(input: {
  r2StorageClass: string;
  measuredAt: string;
  billingWindowStartAt: string;
  billingWindowEndAt: string;
  neonMeasuredAt: string;
  neonBillingWindowStartAt: string;
  neonBillingWindowEndAt: string;
  currentR2Usage: DnaOpenLabR2Usage;
  plannedR2UsagePerRefresh: DnaOpenLabR2Usage;
  currentNeonUsage: DnaOpenLabNeonUsage;
  plannedNeonUsagePerRefresh: DnaOpenLabNeonUsage;
}): DnaOpenLabProviderCapacityProjection {
  const measuredAt = timestamp(input.measuredAt, "measuredAt");
  const billingWindowStartAt = timestamp(
    input.billingWindowStartAt,
    "billingWindowStartAt",
  );
  const billingWindowEndAt = timestamp(
    input.billingWindowEndAt,
    "billingWindowEndAt",
  );
  const neonMeasuredAt = timestamp(input.neonMeasuredAt, "neonMeasuredAt");
  const neonBillingWindowStartAt = timestamp(
    input.neonBillingWindowStartAt,
    "neonBillingWindowStartAt",
  );
  const neonBillingWindowEndAt = timestamp(
    input.neonBillingWindowEndAt,
    "neonBillingWindowEndAt",
  );
  if (
    billingWindowStartAt >= billingWindowEndAt ||
    measuredAt < billingWindowStartAt ||
    measuredAt > billingWindowEndAt
  ) {
    capacityError("R2 measurement must fall within the billing window");
  }
  if (
    neonBillingWindowStartAt >= neonBillingWindowEndAt ||
    neonMeasuredAt < neonBillingWindowStartAt ||
    neonMeasuredAt > neonBillingWindowEndAt
  ) {
    capacityError("Neon measurement must fall within the billing window");
  }
  const r2RemainingRefreshes = Math.ceil(
    (Date.parse(billingWindowEndAt) - Date.parse(measuredAt)) /
      DNA_OPEN_LAB_TARGET_REFRESH_INTERVAL_MILLISECONDS,
  );
  const neonRemainingRefreshes = Math.ceil(
    (Date.parse(neonBillingWindowEndAt) - Date.parse(neonMeasuredAt)) /
      DNA_OPEN_LAB_TARGET_REFRESH_INTERVAL_MILLISECONDS,
  );
  if (
    r2RemainingRefreshes > DNA_OPEN_LAB_MAX_PROJECTED_DAILY_REFRESHES ||
    neonRemainingRefreshes > DNA_OPEN_LAB_MAX_PROJECTED_DAILY_REFRESHES
  ) {
    capacityError("billing window exceeds the 31-day planning horizon");
  }
  const currentR2 = r2Usage(input.currentR2Usage, "currentR2Usage");
  const plannedR2 = r2Usage(
    input.plannedR2UsagePerRefresh,
    "plannedR2UsagePerRefresh",
  );
  const currentNeon = neonUsage(input.currentNeonUsage, "currentNeonUsage");
  const plannedNeon = neonUsage(
    input.plannedNeonUsagePerRefresh,
    "plannedNeonUsagePerRefresh",
  );
  const projectedR2Usage = Object.freeze({
    storageBytes: addProjected(
      currentR2.storageBytes,
      plannedR2.storageBytes,
      r2RemainingRefreshes,
      "projectedR2Usage.storageBytes",
    ),
    classAOperations: addProjected(
      currentR2.classAOperations,
      plannedR2.classAOperations,
      r2RemainingRefreshes,
      "projectedR2Usage.classAOperations",
    ),
    classBOperations: addProjected(
      currentR2.classBOperations,
      plannedR2.classBOperations,
      r2RemainingRefreshes,
      "projectedR2Usage.classBOperations",
    ),
  });
  const projectedNeonUsage = Object.freeze({
    storageBytes: addProjected(
      currentNeon.storageBytes,
      plannedNeon.storageBytes,
      neonRemainingRefreshes,
      "projectedNeonUsage.storageBytes",
    ),
    computeMilliCuHours: addProjected(
      currentNeon.computeMilliCuHours,
      plannedNeon.computeMilliCuHours,
      neonRemainingRefreshes,
      "projectedNeonUsage.computeMilliCuHours",
    ),
  });
  const blockerIds: DnaOpenLabProviderCapacityBlockerId[] = [];
  const standardStorage =
    input.r2StorageClass.trim() === DNA_OPEN_LAB_REQUIRED_R2_STORAGE_CLASS;
  if (!standardStorage) blockerIds.push("r2_storage_class_not_standard");
  if (
    plannedR2.classAOperations >
    DNA_OPEN_LAB_MAX_RECURRING_R2_OPERATIONS_PER_DAILY_REFRESH.classAOperations
  ) {
    blockerIds.push("class_a_refresh_limit_exceeded");
  }
  if (
    plannedR2.classBOperations >
    DNA_OPEN_LAB_MAX_RECURRING_R2_OPERATIONS_PER_DAILY_REFRESH.classBOperations
  ) {
    blockerIds.push("class_b_refresh_limit_exceeded");
  }
  const r2BudgetChecks: readonly [
    keyof DnaOpenLabR2Usage,
    DnaOpenLabZeroCostBlockerId,
  ][] = [
    ["storageBytes", "storage_budget_exhausted"],
    ["classAOperations", "class_a_budget_exhausted"],
    ["classBOperations", "class_b_budget_exhausted"],
  ];
  for (const [field, blocker] of r2BudgetChecks) {
    if (projectedR2Usage[field] > DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS[field]) {
      blockerIds.push(blocker);
    }
  }
  if (
    projectedNeonUsage.storageBytes >
    DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.storageBytes
  ) {
    blockerIds.push("neon_storage_budget_exhausted");
  }
  if (
    projectedNeonUsage.computeMilliCuHours >
    DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.computeMilliCuHours
  ) {
    blockerIds.push("neon_compute_budget_exhausted");
  }
  const maximumSafeR2RemainingRefreshes = standardStorage
    ? Math.min(
        ...r2BudgetChecks.map(([field]) =>
          safeRefreshes({
            current: currentR2[field],
            perRefresh: plannedR2[field],
            budget: DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS[field],
            requested: r2RemainingRefreshes,
          }),
        ),
        plannedR2.classAOperations >
          DNA_OPEN_LAB_MAX_RECURRING_R2_OPERATIONS_PER_DAILY_REFRESH.classAOperations ||
          plannedR2.classBOperations >
            DNA_OPEN_LAB_MAX_RECURRING_R2_OPERATIONS_PER_DAILY_REFRESH.classBOperations
          ? 0
          : r2RemainingRefreshes,
      )
    : 0;
  const maximumSafeNeonRemainingRefreshes = Math.min(
    safeRefreshes({
      current: currentNeon.storageBytes,
      perRefresh: plannedNeon.storageBytes,
      budget: DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.storageBytes,
      requested: neonRemainingRefreshes,
    }),
    safeRefreshes({
      current: currentNeon.computeMilliCuHours,
      perRefresh: plannedNeon.computeMilliCuHours,
      budget: DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.computeMilliCuHours,
      requested: neonRemainingRefreshes,
    }),
  );
  const allowed = blockerIds.length === 0;
  return Object.freeze({
    allowed,
    action: allowed ? "commission_refresh" : "pause_and_serve_last_good",
    blockerIds: Object.freeze(blockerIds),
    measuredAt,
    billingWindowStartAt,
    billingWindowEndAt,
    neonMeasuredAt,
    neonBillingWindowStartAt,
    neonBillingWindowEndAt,
    r2RemainingRefreshes,
    neonRemainingRefreshes,
    maximumSafeR2RemainingRefreshes,
    maximumSafeNeonRemainingRefreshes,
    projectedR2Usage,
    projectedNeonUsage,
    r2Headroom: Object.freeze({
      storageBytes: headroom(
        projectedR2Usage.storageBytes,
        DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.storageBytes,
      ),
      classAOperations: headroom(
        projectedR2Usage.classAOperations,
        DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.classAOperations,
      ),
      classBOperations: headroom(
        projectedR2Usage.classBOperations,
        DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.classBOperations,
      ),
    }),
    neonHeadroom: Object.freeze({
      storageBytes: headroom(
        projectedNeonUsage.storageBytes,
        DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.storageBytes,
      ),
      computeMilliCuHours: headroom(
        projectedNeonUsage.computeMilliCuHours,
        DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.computeMilliCuHours,
      ),
    }),
    requiredR2StorageClass: DNA_OPEN_LAB_REQUIRED_R2_STORAGE_CLASS,
    r2FreeAllowances: DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES,
    r2Budgets: DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS,
    neonFreeAllowances: DNA_OPEN_LAB_NEON_FREE_ALLOWANCES,
    neonBudgets: DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS,
    paidUsageAllowed: false,
    preserveLastGood: true,
  });
}
