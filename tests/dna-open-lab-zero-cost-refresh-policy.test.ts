import { describe, expect, it } from "vitest";

import {
  DNA_OPEN_LAB_MAX_RECURRING_R2_OPERATIONS_PER_31_DAYS,
  DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES,
  DNA_OPEN_LAB_TARGET_REFRESH_INTERVAL_MILLISECONDS,
  DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS,
  evaluateDnaOpenLabZeroCostRefresh,
} from "@/lib/dna-open-lab-zero-cost-refresh-policy";

describe("DNA Open Lab zero-cost refresh policy", () => {
  it("keeps recurring operation budgets well below the free allowances", () => {
    expect(DNA_OPEN_LAB_TARGET_REFRESH_INTERVAL_MILLISECONDS).toBe(86_400_000);
    expect(
      DNA_OPEN_LAB_MAX_RECURRING_R2_OPERATIONS_PER_31_DAYS.classAOperations,
    ).toBeLessThan(DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.classAOperations);
    expect(
      DNA_OPEN_LAB_MAX_RECURRING_R2_OPERATIONS_PER_31_DAYS.classBOperations,
    ).toBeLessThan(DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.classBOperations);
    expect(DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.storageBytes).toBeLessThan(
      DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES.storageBytes,
    );
    expect(DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.classAOperations).toBeLessThan(
      DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES.classAOperations,
    );
    expect(DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.classBOperations).toBeLessThan(
      DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES.classBOperations,
    );
  });

  it("allows a daily refresh that remains inside every operating budget", () => {
    expect(
      evaluateDnaOpenLabZeroCostRefresh({
        currentUsage: {
          storageBytes: 2_000_000_000,
          classAOperations: 12_000,
          classBOperations: 24_000,
        },
        plannedRefreshUsage: {
          storageBytes: 1_000_000,
          classAOperations: 1_000,
          classBOperations: 2_000,
        },
      }),
    ).toMatchObject({
      allowed: true,
      action: "run_daily_refresh",
      blockerIds: [],
      paidUsageAllowed: false,
      preserveLastGood: true,
    });
  });

  it("pauses before any storage or operation budget would be exceeded", () => {
    expect(
      evaluateDnaOpenLabZeroCostRefresh({
        currentUsage: {
          storageBytes: DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.storageBytes,
          classAOperations: DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.classAOperations,
          classBOperations: DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.classBOperations,
        },
        plannedRefreshUsage: {
          storageBytes: 1,
          classAOperations: 1,
          classBOperations: 1,
        },
      }),
    ).toMatchObject({
      allowed: false,
      action: "pause_and_serve_last_good",
      blockerIds: [
        "storage_budget_exhausted",
        "class_a_budget_exhausted",
        "class_b_budget_exhausted",
      ],
      paidUsageAllowed: false,
      preserveLastGood: true,
    });
  });

  it("fails closed on malformed or overflowing usage", () => {
    expect(() =>
      evaluateDnaOpenLabZeroCostRefresh({
        currentUsage: {
          storageBytes: -1,
          classAOperations: 0,
          classBOperations: 0,
        },
        plannedRefreshUsage: {
          storageBytes: 0,
          classAOperations: 0,
          classBOperations: 0,
        },
      }),
    ).toThrow("currentUsage.storageBytes");

    expect(() =>
      evaluateDnaOpenLabZeroCostRefresh({
        currentUsage: {
          storageBytes: Number.MAX_SAFE_INTEGER,
          classAOperations: 0,
          classBOperations: 0,
        },
        plannedRefreshUsage: {
          storageBytes: 1,
          classAOperations: 0,
          classBOperations: 0,
        },
      }),
    ).toThrow("projectedUsage.storageBytes exceeds safe integer capacity");
  });
});
