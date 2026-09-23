import { describe, expect, it } from "vitest";

import type { CanonicalRaceDocumentMetadata } from "@/lib/dna-open-lab-v1-adapters";
import { planDnaPopulationHistoryAcquisition } from "@/lib/dna-population-history-acquisition-plan";

function race(
  sourceRaceId: string,
  mode: CanonicalRaceDocumentMetadata["mode"],
  entrantCoreIds?: readonly string[],
): CanonicalRaceDocumentMetadata {
  return Object.freeze({
    sourceType: "race_document",
    sourceRaceId,
    ...(mode === undefined ? {} : { mode }),
    ...(entrantCoreIds === undefined ? {} : { entrantCoreIds }),
  });
}

describe("DNA all-mode population history acquisition plan", () => {
  it("builds one missing-Core enrichment universe across Bike, Car and Horse", () => {
    const plan = planDnaPopulationHistoryAcquisition({
      raceDocuments: [
        race("bike-1", "bike", ["1", "2", "3"]),
        race("car-1", "car", ["2", "4"]),
        race("horse-1", "horse", ["2", "5"]),
        race("horse-2", "horse", ["6"]),
      ],
      persistedPerformanceCoreIds: [1, 2, 5],
    });

    expect(plan).toMatchObject({
      status: "ready_for_budget_measurement",
      raceDocumentCount: 4,
      raceCountByMode: { bike: 1, car: 1, horse: 2 },
      raceWithoutEntrantAuthorityByMode: { bike: 0, car: 0, horse: 0 },
      raceWithUnknownModeCount: 0,
      populationCoreCountByMode: { bike: 3, car: 2, horse: 3 },
      populationCoreCount: 6,
      persistedPerformanceCoreCount: 3,
      missingPerformanceCoreCount: 3,
      minimumProviderRequestCount: 3,
      structuralMaximumProviderRequestCount: 30_000,
      budgetMeasurementRequired: true,
      providerReadAllowed: false,
      persistentWriteAllowed: false,
      paidUsageAllowed: false,
      incrementalOnly: true,
    });
    expect(plan.cohorts).toHaveLength(1);
    expect(plan.cohorts[0]?.coreIds).toEqual([3, 4, 6]);
    expect(plan.populationCoreSetSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(plan.persistedPerformanceCoreSetSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(plan.missingPerformanceCoreSetSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("acquires a Core only once even when it races in every mode", () => {
    const plan = planDnaPopulationHistoryAcquisition({
      raceDocuments: [
        race("bike-1", "bike", ["42"]),
        race("car-1", "car", ["42"]),
        race("horse-1", "horse", ["42"]),
      ],
    });

    expect(plan.populationCoreCountByMode).toEqual({
      bike: 1,
      car: 1,
      horse: 1,
    });
    expect(plan.populationCoreCount).toBe(1);
    expect(plan.missingPerformanceCoreCount).toBe(1);
    expect(plan.cohorts[0]?.coreIds).toEqual([42]);
  });

  it("holds rather than shrinking any mode when mode or entrant authority is incomplete", () => {
    const plan = planDnaPopulationHistoryAcquisition({
      raceDocuments: [
        race("bike-complete", "bike", ["1"]),
        race("car-missing", "car"),
        race("horse-malformed", "horse", ["3", "not-a-core"]),
        race("unknown-mode", undefined, ["4"]),
      ],
    });

    expect(plan.status).toBe("held_incomplete_race_authority");
    expect(plan.raceWithoutEntrantAuthorityByMode).toEqual({
      bike: 0,
      car: 1,
      horse: 1,
    });
    expect(plan.raceWithUnknownModeCount).toBe(1);
    expect(plan.budgetMeasurementRequired).toBe(false);
    expect(plan.providerReadAllowed).toBe(false);
  });

  it("reports complete enrichment when every population Core is already persisted", () => {
    const plan = planDnaPopulationHistoryAcquisition({
      raceDocuments: [
        race("bike-1", "bike", ["1", "2"]),
        race("car-1", "car", ["2", "3"]),
        race("horse-1", "horse", ["3", "4"]),
      ],
      persistedPerformanceCoreIds: [1, 2, 3, 4, 99],
    });

    expect(plan.status).toBe("complete_population_enrichment");
    expect(plan.populationCoreCount).toBe(4);
    expect(plan.persistedPerformanceCoreCount).toBe(4);
    expect(plan.missingPerformanceCoreCount).toBe(0);
    expect(plan.missingPerformanceCoreSetSha256).toBeNull();
    expect(plan.cohorts).toEqual([]);
    expect(plan.minimumProviderRequestCount).toBe(0);
    expect(plan.structuralMaximumProviderRequestCount).toBe(0);
    expect(plan.budgetMeasurementRequired).toBe(false);
  });

  it("chunks a large missing population without mode duplication", () => {
    const entrants = Array.from({ length: 4_097 }, (_, index) =>
      String(index + 1),
    );
    const plan = planDnaPopulationHistoryAcquisition({
      raceDocuments: [
        race("bike-1", "bike", entrants),
        race("car-1", "car", ["1", "4097"]),
      ],
    });

    expect(plan.cohorts.map(({ coreIds }) => coreIds.length)).toEqual([
      4_096, 1,
    ]);
    expect(plan.cohorts.map(({ ordinal }) => ordinal)).toEqual([0, 1]);
    expect(plan.missingPerformanceCoreCount).toBe(4_097);
  });

  it("rejects duplicate Race authority and invalid persisted Core identities", () => {
    expect(() =>
      planDnaPopulationHistoryAcquisition({
        raceDocuments: [
          race("same", "bike", ["1"]),
          race("same", "car", ["2"]),
        ],
      }),
    ).toThrow("Race authority is invalid");

    expect(() =>
      planDnaPopulationHistoryAcquisition({
        raceDocuments: [race("bike-1", "bike", ["1"])],
        persistedPerformanceCoreIds: [1, 1],
      }),
    ).toThrow("persisted performance Core IDs are invalid");
  });
});
