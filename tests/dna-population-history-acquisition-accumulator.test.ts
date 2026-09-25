import { describe, expect, it } from "vitest";

import { createDnaPopulationHistoryAcquisitionAccumulator } from "@/lib/dna-population-history-acquisition-accumulator";
import { planDnaPopulationHistoryAcquisition } from "@/lib/dna-population-history-acquisition-plan";
import type { CanonicalRaceDocumentMetadata } from "@/lib/dna-open-lab-v1-adapters";

function race(
  sourceRaceId: string,
  mode: "bike" | "car" | "horse",
  entrants: readonly string[],
): CanonicalRaceDocumentMetadata {
  return Object.freeze({
    sourceType: "race_document" as const,
    sourceRaceId,
    mode,
    entrantCoreIds: Object.freeze([...entrants]),
  });
}

describe("DNA population history acquisition accumulator", () => {
  it("matches the array planner while streaming one document at a time", () => {
    const documents = Object.freeze([
      race("race-1", "bike", ["1", "2"]),
      race("race-2", "car", ["2", "3"]),
      race("race-3", "horse", ["4"]),
    ]);
    const expected = planDnaPopulationHistoryAcquisition({
      raceDocuments: documents,
      persistedPerformanceCoreIds: [2],
    });
    const accumulator = createDnaPopulationHistoryAcquisitionAccumulator();
    for (const document of documents) accumulator.accept(document);

    expect(accumulator.finalize([2])).toEqual(expected);
  });

  it("preserves incomplete entrant authority and one-shot finalization", () => {
    const accumulator = createDnaPopulationHistoryAcquisitionAccumulator();
    accumulator.accept(
      Object.freeze({
        sourceType: "race_document" as const,
        sourceRaceId: "race-1",
        mode: "bike" as const,
      }),
    );

    expect(accumulator.finalize()).toMatchObject({
      status: "held_incomplete_race_authority",
      raceWithoutEntrantAuthorityByMode: {
        bike: 1,
        car: 0,
        horse: 0,
      },
    });
    expect(() => accumulator.finalize()).toThrow(
      "DNA population history accumulator is finalized.",
    );
  });
});
