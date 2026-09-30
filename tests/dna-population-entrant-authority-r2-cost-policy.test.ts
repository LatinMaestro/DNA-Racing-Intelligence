import { describe, expect, it } from "vitest";

import {
  DNA_POPULATION_ENTRANT_AUTHORITY_MAXIMUM_R2_COST_MICRO_USD,
  planDnaPopulationEntrantAuthorityRemainingR2Usage,
  projectDnaPopulationEntrantAuthorityR2Cost,
} from "@/lib/dna-population-entrant-authority-r2-cost-policy";

describe("population entrant authority R2 cost policy", () => {
  it("prices current usage plus the complete conservative remaining archive below the owner cap", () => {
    const plannedUsage = planDnaPopulationEntrantAuthorityRemainingR2Usage({
      remainingRaceCount: 1_135_198,
    });
    const projection = projectDnaPopulationEntrantAuthorityR2Cost({
      currentUsage: {
        storageBytes: 1_500_631_079,
        classAOperations: 58_080,
        classBOperations: 1_177_686,
      },
      plannedUsage,
    });

    expect(plannedUsage.storageBytes).toBeGreaterThan(14_000_000_000);
    expect(plannedUsage.classAOperations).toBeGreaterThan(1_135_198);
    expect(plannedUsage.classBOperations).toBeGreaterThan(2_270_396);
    expect(projection.allowed).toBe(true);
    expect(projection.projectedPaidCostMicroUsd).toBeGreaterThan(0);
    expect(projection.projectedPaidCostMicroUsd).toBeLessThanOrEqual(
      DNA_POPULATION_ENTRANT_AUTHORITY_MAXIMUM_R2_COST_MICRO_USD,
    );
    expect(projection.paidR2UsageAllowed).toBe(true);
    expect(projection.paidUsageAllowed).toBe(false);
  });

  it("fails closed when measured usage is already above the authorized cost ceiling", () => {
    const projection = projectDnaPopulationEntrantAuthorityR2Cost({
      currentUsage: {
        storageBytes: 0,
        classAOperations: 2_200_000,
        classBOperations: 0,
      },
      plannedUsage: {
        storageBytes: 0,
        classAOperations: 0,
        classBOperations: 0,
      },
    });

    expect(projection.allowed).toBe(false);
    expect(projection.projectedPaidCostMicroUsd).toBeGreaterThan(
      DNA_POPULATION_ENTRANT_AUTHORITY_MAXIMUM_R2_COST_MICRO_USD,
    );
    expect(projection.paidR2UsageAllowed).toBe(false);
  });

  it("rejects unsafe or negative accounting inputs", () => {
    expect(() =>
      planDnaPopulationEntrantAuthorityRemainingR2Usage({
        remainingRaceCount: -1,
      }),
    ).toThrow("remainingRaceCount is invalid");
    expect(() =>
      projectDnaPopulationEntrantAuthorityR2Cost({
        currentUsage: {
          storageBytes: Number.MAX_SAFE_INTEGER,
          classAOperations: 0,
          classBOperations: 0,
        },
        plannedUsage: {
          storageBytes: 1,
          classAOperations: 0,
          classBOperations: 0,
        },
      }),
    ).toThrow("exceeds safe integer capacity");
  });
});
