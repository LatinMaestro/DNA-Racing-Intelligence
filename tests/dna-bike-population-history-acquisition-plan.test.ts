import { describe, expect, it } from "vitest";

import type { CanonicalRaceDocumentMetadata } from "../lib/dna-open-lab-v1-adapters";
import { planDnaBikePopulationHistoryAcquisition } from "../lib/dna-bike-population-history-acquisition-plan";

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

describe("Bike population history acquisition plan", () => {
  it("deduplicates global Bike entrants, excludes owned Cores and chunks stable bounded cohorts", () => {
    const first = Array.from({ length: 4_096 }, (_, index) =>
      String(index + 1),
    );
    const plan = planDnaBikePopulationHistoryAcquisition({
      raceDocuments: [
        race("bike-1", "bike", first),
        race("bike-2", "bike", ["4096", "4097", "4098"]),
        race("car-1", "car", ["9000"]),
      ],
      ownedCoreIds: [1, 4_098],
    });

    expect(plan).toMatchObject({
      status: "ready_for_budget_measurement",
      bikeRaceCount: 2,
      bikeRaceWithoutEntrantAuthorityCount: 0,
      raceWithUnknownModeCount: 0,
      populationCoreCount: 4_098,
      ownedPopulationCoreCount: 2,
      acquisitionCoreCount: 4_096,
      minimumProviderRequestCount: 4_096,
      structuralMaximumProviderRequestCount: 40_960_000,
      budgetMeasurementRequired: true,
      providerReadAllowed: false,
      persistentWriteAllowed: false,
      paidUsageAllowed: false,
    });
    expect(plan.cohorts).toHaveLength(1);
    expect(plan.cohorts[0]?.coreIds).toHaveLength(4_096);
    expect(plan.cohorts[0]?.coreIds[0]).toBe(2);
    expect(plan.cohorts[0]?.coreIds.at(-1)).toBe(4_097);
    expect(plan.populationCoreSetSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(plan.acquisitionCoreSetSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(plan.cohorts[0]?.coreSetSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("splits populations larger than one durable Core-history cycle", () => {
    const plan = planDnaBikePopulationHistoryAcquisition({
      raceDocuments: [
        race(
          "bike-1",
          "bike",
          Array.from({ length: 4_097 }, (_, index) => String(index + 1)),
        ),
      ],
    });

    expect(plan.cohorts.map(({ coreIds }) => coreIds.length)).toEqual([
      4_096, 1,
    ]);
    expect(plan.cohorts.map(({ ordinal }) => ordinal)).toEqual([0, 1]);
  });

  it("holds rather than shrinking the denominator when mode or Bike entrants are unavailable", () => {
    const plan = planDnaBikePopulationHistoryAcquisition({
      raceDocuments: [
        race("bike-complete", "bike", ["1", "2"]),
        race("bike-missing", "bike"),
        race("unknown-mode", undefined, ["3"]),
      ],
    });

    expect(plan.status).toBe("held_incomplete_race_authority");
    expect(plan.bikeRaceWithoutEntrantAuthorityCount).toBe(1);
    expect(plan.raceWithUnknownModeCount).toBe(1);
    expect(plan.providerReadAllowed).toBe(false);
    expect(plan.cohorts).toHaveLength(1);
  });

  it("holds when the global set contains no unowned Core", () => {
    const plan = planDnaBikePopulationHistoryAcquisition({
      raceDocuments: [race("bike-1", "bike", ["1", "2"])],
      ownedCoreIds: [1, 2],
    });

    expect(plan.status).toBe("held_no_unowned_population");
    expect(plan.acquisitionCoreCount).toBe(0);
    expect(plan.acquisitionCoreSetSha256).toBeNull();
    expect(plan.cohorts).toEqual([]);
  });

  it("rejects duplicate Race authority and holds malformed entrant identities", () => {
    expect(() =>
      planDnaBikePopulationHistoryAcquisition({
        raceDocuments: [
          race("same", "bike", ["1"]),
          race("same", "bike", ["2"]),
        ],
      }),
    ).toThrow("Race authority is invalid");

    const malformed = planDnaBikePopulationHistoryAcquisition({
      raceDocuments: [race("bike-1", "bike", ["1", "not-a-core"])],
    });
    expect(malformed.status).toBe("held_incomplete_race_authority");
    expect(malformed.populationCoreCount).toBe(0);
  });
});
