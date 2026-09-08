import { describe, expect, it } from "vitest";

import {
  DNA_OPEN_LAB_NEON_FREE_ALLOWANCES,
  DNA_OPEN_LAB_REQUIRED_R2_STORAGE_CLASS,
  DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS,
  projectDnaOpenLabZeroCostProviderCapacity,
} from "@/lib/dna-open-lab-zero-cost-provider-capacity";
import {
  DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES,
  DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS,
} from "@/lib/dna-open-lab-zero-cost-refresh-policy";

const safe = {
  r2StorageClass: "Standard",
  measuredAt: "2026-09-09T00:00:00.000Z",
  billingWindowStartAt: "2026-09-01T00:00:00.000Z",
  billingWindowEndAt: "2026-10-01T00:00:00.000Z",
  neonMeasuredAt: "2026-09-09T00:00:00.000Z",
  neonBillingWindowStartAt: "2026-09-05T00:00:00.000Z",
  neonBillingWindowEndAt: "2026-10-05T00:00:00.000Z",
  currentR2Usage: {
    storageBytes: 874_370_990,
    classAOperations: 35_000,
    classBOperations: 105_000,
  },
  plannedR2UsagePerRefresh: {
    storageBytes: 1_000_000,
    classAOperations: 100,
    classBOperations: 200,
  },
  currentNeonUsage: {
    storageBytes: 28_082_176,
    computeMilliCuHours: 5_000,
  },
  plannedNeonUsagePerRefresh: {
    storageBytes: 250_000,
    computeMilliCuHours: 500,
  },
} as const;

describe("DNA Open Lab zero-cost provider capacity", () => {
  it("keeps recurring Neon budgets below the free allowances", () => {
    expect(DNA_OPEN_LAB_REQUIRED_R2_STORAGE_CLASS).toBe("Standard");
    expect(DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.storageBytes).toBeLessThan(
      DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES.storageBytes,
    );
    expect(DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.storageBytes).toBeLessThan(
      DNA_OPEN_LAB_NEON_FREE_ALLOWANCES.storageBytes,
    );
    expect(
      DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.computeMilliCuHours,
    ).toBeLessThan(DNA_OPEN_LAB_NEON_FREE_ALLOWANCES.computeMilliCuHours);
  });

  it("projects the complete remaining daily cadence from measured usage", () => {
    const result = projectDnaOpenLabZeroCostProviderCapacity(safe);

    expect(result).toMatchObject({
      allowed: true,
      action: "commission_refresh",
      blockerIds: [],
      r2RemainingRefreshes: 22,
      neonRemainingRefreshes: 26,
      maximumSafeR2RemainingRefreshes: 22,
      maximumSafeNeonRemainingRefreshes: 26,
      projectedR2Usage: {
        storageBytes: 896_370_990,
        classAOperations: 37_200,
        classBOperations: 109_400,
      },
      projectedNeonUsage: {
        storageBytes: 34_582_176,
        computeMilliCuHours: 18_000,
      },
      requiredR2StorageClass: "Standard",
      r2Budgets: DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS,
      neonBudgets: DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS,
      paidUsageAllowed: false,
      preserveLastGood: true,
    });
    expect(result.r2Headroom.storageBytes).toBeGreaterThan(0);
    expect(result.neonHeadroom.storageBytes).toBeGreaterThan(0);
  });

  it("fails closed when the R2 storage class is not Standard", () => {
    expect(
      projectDnaOpenLabZeroCostProviderCapacity({
        ...safe,
        r2StorageClass: "Infrequent Access",
      }),
    ).toMatchObject({
      allowed: false,
      action: "pause_and_serve_last_good",
      blockerIds: ["r2_storage_class_not_standard"],
      maximumSafeR2RemainingRefreshes: 0,
      maximumSafeNeonRemainingRefreshes: 26,
    });
  });

  it("rejects a single refresh above either operation ceiling", () => {
    const result = projectDnaOpenLabZeroCostProviderCapacity({
      ...safe,
      plannedR2UsagePerRefresh: {
        storageBytes: 1,
        classAOperations: 1_001,
        classBOperations: 2_001,
      },
    });

    expect(result.blockerIds).toEqual([
      "class_a_refresh_limit_exceeded",
      "class_b_refresh_limit_exceeded",
    ]);
    expect(result.maximumSafeR2RemainingRefreshes).toBe(0);
  });

  it("reports all exhausted monthly provider budgets and safe cadence", () => {
    const result = projectDnaOpenLabZeroCostProviderCapacity({
      ...safe,
      measuredAt: "2026-09-28T00:00:00.000Z",
      neonMeasuredAt: "2026-10-02T00:00:00.000Z",
      currentR2Usage: {
        storageBytes: 7_999_999_998,
        classAOperations: 799_998,
        classBOperations: 7_999_998,
      },
      plannedR2UsagePerRefresh: {
        storageBytes: 1,
        classAOperations: 1,
        classBOperations: 1,
      },
      currentNeonUsage: {
        storageBytes: 499_999_998,
        computeMilliCuHours: 79_998,
      },
      plannedNeonUsagePerRefresh: {
        storageBytes: 1,
        computeMilliCuHours: 1,
      },
    });

    expect(result.blockerIds).toEqual([
      "storage_budget_exhausted",
      "class_a_budget_exhausted",
      "class_b_budget_exhausted",
      "neon_storage_budget_exhausted",
      "neon_compute_budget_exhausted",
    ]);
    expect(result.maximumSafeR2RemainingRefreshes).toBe(2);
    expect(result.maximumSafeNeonRemainingRefreshes).toBe(2);
    expect(result.r2Headroom).toEqual({
      storageBytes: 0,
      classAOperations: 0,
      classBOperations: 0,
    });
    expect(result.neonHeadroom).toEqual({
      storageBytes: 0,
      computeMilliCuHours: 0,
    });
  });

  it("rejects stale-window, oversized-horizon, and overflow projections", () => {
    expect(() =>
      projectDnaOpenLabZeroCostProviderCapacity({
        ...safe,
        measuredAt: "2026-10-02T00:00:00.000Z",
      }),
    ).toThrow("R2 measurement must fall within the billing window");
    expect(() =>
      projectDnaOpenLabZeroCostProviderCapacity({
        ...safe,
        neonMeasuredAt: "2026-10-06T00:00:00.000Z",
      }),
    ).toThrow("Neon measurement must fall within the billing window");
    expect(() =>
      projectDnaOpenLabZeroCostProviderCapacity({
        ...safe,
        billingWindowEndAt: "2026-11-01T00:00:00.000Z",
      }),
    ).toThrow("31-day planning horizon");
    expect(() =>
      projectDnaOpenLabZeroCostProviderCapacity({
        ...safe,
        currentR2Usage: {
          ...safe.currentR2Usage,
          storageBytes: Number.MAX_SAFE_INTEGER,
        },
      }),
    ).toThrow("projectedR2Usage.storageBytes exceeds safe integer capacity");
  });
});
