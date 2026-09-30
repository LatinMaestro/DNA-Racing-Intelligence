import { describe, expect, it } from "vitest";

import {
  dnaPopulationEntrantAuthorityMaximumAdditionalClassBOperations,
  dnaPopulationEntrantAuthorityR2BillMicroUsd,
  DNA_POPULATION_ENTRANT_AUTHORITY_R2_MAXIMUM_COST_MICRO_USD,
  projectDnaPopulationEntrantAuthorityR2CompletionCost,
} from "@/lib/dna-population-entrant-authority-r2-cost-policy";

describe("DNA population entrant R2 cost policy", () => {
  it("projects the remaining 476k durable boundary below the US$5 ceiling", () => {
    const projection = projectDnaPopulationEntrantAuthorityR2CompletionCost({
      currentUsage: {
        storageBytes: 1_500_631_079,
        classAOperations: 600_000,
        classBOperations: 9_200_000,
      },
      unresolvedRaceCount: 1_135_198,
      persistedRaceCount: 476_000,
      maximumCompactRecordBytes: 902,
    });

    expect(projection.remainingRaceCount).toBe(659_198);
    expect(projection.remainingAutonomousSessionCount).toBe(11);
    expect(projection.remainingCompactChunkCount).toBe(132);
    expect(projection.projectedCostMicroUsd).toBeLessThanOrEqual(
      DNA_POPULATION_ENTRANT_AUTHORITY_R2_MAXIMUM_COST_MICRO_USD,
    );
    expect(projection.allowed).toBe(true);
  });

  it("fails the projection when existing Class A usage makes completion exceed US$5", () => {
    const projection = projectDnaPopulationEntrantAuthorityR2CompletionCost({
      currentUsage: {
        storageBytes: 1_500_631_079,
        classAOperations: 1_800_000,
        classBOperations: 9_200_000,
      },
      unresolvedRaceCount: 1_135_198,
      persistedRaceCount: 476_000,
      maximumCompactRecordBytes: 902,
    });

    expect(projection.projectedCostMicroUsd).toBeGreaterThan(
      DNA_POPULATION_ENTRANT_AUTHORITY_R2_MAXIMUM_COST_MICRO_USD,
    );
    expect(projection.allowed).toBe(false);
  });

  it("prices only published-free-tier overage", () => {
    expect(
      dnaPopulationEntrantAuthorityR2BillMicroUsd({
        storageBytes: 10_000_000_000,
        classAOperations: 1_000_000,
        classBOperations: 10_000_000,
      }),
    ).toBe(0);
    expect(
      dnaPopulationEntrantAuthorityR2BillMicroUsd({
        storageBytes: 10_000_000_000,
        classAOperations: 2_000_000,
        classBOperations: 11_000_000,
      }),
    ).toBe(4_860_000);
  });

  it("bounds paid Class B audit reads against the same US$5 ceiling", () => {
    const additional =
      dnaPopulationEntrantAuthorityMaximumAdditionalClassBOperations({
        storageBytes: 1_500_000_000,
        classAOperations: 900_000,
        classBOperations: 9_000_000,
      });

    expect(additional).toBeGreaterThan(1_000_000);
    expect(
      dnaPopulationEntrantAuthorityR2BillMicroUsd({
        storageBytes: 1_500_000_000,
        classAOperations: 900_000,
        classBOperations: 9_000_000 + additional,
      }),
    ).toBeLessThanOrEqual(
      DNA_POPULATION_ENTRANT_AUTHORITY_R2_MAXIMUM_COST_MICRO_USD,
    );
  });

  it("rejects a compact-record sizing regression", () => {
    expect(() =>
      projectDnaPopulationEntrantAuthorityR2CompletionCost({
        currentUsage: {
          storageBytes: 0,
          classAOperations: 0,
          classBOperations: 0,
        },
        unresolvedRaceCount: 100,
        persistedRaceCount: 0,
        maximumCompactRecordBytes: 901,
      }),
    ).toThrow("compact record bound regressed");
  });
});
