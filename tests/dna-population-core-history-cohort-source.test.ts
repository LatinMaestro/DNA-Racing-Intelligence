import { describe, expect, it } from "vitest";

import type { CanonicalRaceDocumentMetadata } from "@/lib/dna-open-lab-v1-adapters";
import { populationCoreHistoryCohortServingAuthority } from "@/lib/dna-population-core-history-cohort-source";
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

describe("population Core-history cohort source", () => {
  it("uses the population cohort rather than an owner-Vault Core list", () => {
    const plan = planDnaPopulationHistoryAcquisition({
      raceDocuments: [
        race("bike-1", "bike", ["2", "9"]),
        race("car-1", "car", ["9", "12"]),
        race("quarantine", "horse"),
      ],
      allowQuarantinedRaceGaps: true,
    });

    expect(plan).toMatchObject({
      status: "ready_for_budget_measurement",
      populationUniverseCompleteness: "partial_due_to_unresolved_races",
      populationCoreCount: 3,
      unresolvedRaceCount: 1,
    });

    const rows = populationCoreHistoryCohortServingAuthority({
      plan,
      cohortOrdinal: 0,
    });

    expect(rows.map((row) => row.canonical.sourceCoreId)).toEqual([
      "2",
      "9",
      "12",
    ]);
    expect(new Set(rows.map((row) => row.generationId))).toEqual(
      new Set([plan.cohorts[0]!.coreSetSha256]),
    );
  });

  it("rejects held or complete plans rather than inventing acquisition work", () => {
    const held = planDnaPopulationHistoryAcquisition({
      raceDocuments: [race("missing", "bike")],
    });
    expect(() =>
      populationCoreHistoryCohortServingAuthority({
        plan: held,
        cohortOrdinal: 0,
      }),
    ).toThrow("population plan is not ready for acquisition");

    const complete = planDnaPopulationHistoryAcquisition({
      raceDocuments: [race("bike-1", "bike", ["1"])],
      persistedPerformanceCoreIds: [1],
    });
    expect(() =>
      populationCoreHistoryCohortServingAuthority({
        plan: complete,
        cohortOrdinal: 0,
      }),
    ).toThrow("population plan is not ready for acquisition");
  });

  it("rejects an out-of-range cohort ordinal", () => {
    const plan = planDnaPopulationHistoryAcquisition({
      raceDocuments: [race("bike-1", "bike", ["1"])],
    });
    expect(() =>
      populationCoreHistoryCohortServingAuthority({
        plan,
        cohortOrdinal: 1,
      }),
    ).toThrow("cohort ordinal is invalid");
  });
});
