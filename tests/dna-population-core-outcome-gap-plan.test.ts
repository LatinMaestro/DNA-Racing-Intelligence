import { describe, expect, it } from "vitest";

import type { DnaPopulationCoreLinkedHistory } from "@/lib/dna-population-core-race-link-index";
import {
  adaptDnaRaceMergeOutcomeSourceRow,
  planDnaPopulationCoreOutcomeGapAcquisition,
  type DnaCompactCoreOutcomeEvidence,
} from "@/lib/dna-population-core-outcome-gap-plan";

function histories(
  values: readonly DnaPopulationCoreLinkedHistory[],
): AsyncIterable<DnaPopulationCoreLinkedHistory> {
  return (async function* () {
    for (const value of values) yield value;
  })();
}

function history(input: {
  coreId: number;
  bike?: readonly string[];
  car?: readonly string[];
  horse?: readonly string[];
}): DnaPopulationCoreLinkedHistory {
  const bike = input.bike ?? [];
  const car = input.car ?? [];
  const horse = input.horse ?? [];
  return Object.freeze({
    sourceCoreId: input.coreId,
    raceCount: bike.length + car.length + horse.length,
    raceIdsByMode: Object.freeze({
      bike: Object.freeze([...bike]),
      car: Object.freeze([...car]),
      horse: Object.freeze([...horse]),
    }),
  });
}

function outcome(input: {
  source: "race_merge" | "core_history_api";
  coreId: number;
  raceId: string;
  position: number;
  elapsedMilliseconds: number;
}): DnaCompactCoreOutcomeEvidence {
  return Object.freeze({
    source: input.source,
    sourceCoreId: input.coreId,
    sourceRaceId: input.raceId,
    finishPosition: input.position,
    elapsedMilliseconds: input.elapsedMilliseconds,
  });
}

describe("DNA population Core outcome gap plan", () => {
  it("accepts old Race Merge outcome rows without requiring rmode", () => {
    expect(
      adaptDnaRaceMergeOutcomeSourceRow({
        event_id: 12345,
        token_id: "678",
        pos: "2",
        time: "65.125",
      }),
    ).toEqual({
      source: "race_merge",
      sourceCoreId: 678,
      sourceRaceId: "12345",
      finishPosition: 2,
      elapsedMilliseconds: 65125,
    });
  });

  it("uses Race Merge first, persisted API second, and requests only true gap Cores", async () => {
    const plan = await planDnaPopulationCoreOutcomeGapAcquisition({
      linkedHistories: histories([
        history({ coreId: 10, bike: ["race-1", "race-2"], car: ["race-3"] }),
        history({ coreId: 20, horse: ["race-4"] }),
      ]),
      loadRaceMergeOutcomes: async (coreId) =>
        coreId === 10
          ? [
              outcome({
                source: "race_merge",
                coreId,
                raceId: "race-1",
                position: 1,
                elapsedMilliseconds: 60000,
              }),
              outcome({
                source: "race_merge",
                coreId,
                raceId: "race-2",
                position: 2,
                elapsedMilliseconds: 61000,
              }),
            ]
          : [
              outcome({
                source: "race_merge",
                coreId,
                raceId: "unlinked-race",
                position: 3,
                elapsedMilliseconds: 70000,
              }),
            ],
      loadPersistedApiOutcomes: async (coreId) =>
        coreId === 10
          ? [
              outcome({
                source: "core_history_api",
                coreId,
                raceId: "race-2",
                position: 2,
                elapsedMilliseconds: 61000,
              }),
              outcome({
                source: "core_history_api",
                coreId,
                raceId: "race-3",
                position: 3,
                elapsedMilliseconds: 62000,
              }),
            ]
          : [],
    });

    expect(plan).toMatchObject({
      status: "complete",
      linkedCoreCount: 2,
      requiredMembershipCount: 4,
      coveredMembershipCount: 3,
      raceMergeCoveredMembershipCount: 2,
      apiCoveredMembershipCount: 1,
      exactCrossSourceOverlapCount: 1,
      extraOutcomeCount: 1,
      missingMembershipCount: 1,
      apiGapCoreCount: 1,
      apiGapCoreIds: [20],
      dnaProviderRequestCount: 0,
    });
    expect(plan.requiredMembershipSetSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(plan.coveredMembershipSetSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(plan.missingMembershipSetSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("fails closed when Race Merge and API disagree on time or position", async () => {
    await expect(
      planDnaPopulationCoreOutcomeGapAcquisition({
        linkedHistories: histories([history({ coreId: 10, bike: ["race-1"] })]),
        loadRaceMergeOutcomes: async () => [
          outcome({
            source: "race_merge",
            coreId: 10,
            raceId: "race-1",
            position: 1,
            elapsedMilliseconds: 60000,
          }),
        ],
        loadPersistedApiOutcomes: async () => [
          outcome({
            source: "core_history_api",
            coreId: 10,
            raceId: "race-1",
            position: 2,
            elapsedMilliseconds: 60000,
          }),
        ],
      }),
    ).rejects.toThrow("Race Merge and API outcomes conflict");
  });

  it("accepts exact replay duplicates but rejects conflicting same-source duplicates", async () => {
    const exact = outcome({
      source: "race_merge",
      coreId: 10,
      raceId: "race-1",
      position: 1,
      elapsedMilliseconds: 60000,
    });
    const plan = await planDnaPopulationCoreOutcomeGapAcquisition({
      linkedHistories: histories([history({ coreId: 10, bike: ["race-1"] })]),
      loadRaceMergeOutcomes: async () => [exact, exact],
      loadPersistedApiOutcomes: async () => [],
    });
    expect(plan.replayDuplicateCount).toBe(1);
    expect(plan.missingMembershipCount).toBe(0);

    await expect(
      planDnaPopulationCoreOutcomeGapAcquisition({
        linkedHistories: histories([history({ coreId: 10, bike: ["race-1"] })]),
        loadRaceMergeOutcomes: async () => [
          exact,
          outcome({
            source: "race_merge",
            coreId: 10,
            raceId: "race-1",
            position: 1,
            elapsedMilliseconds: 60001,
          }),
        ],
        loadPersistedApiOutcomes: async () => [],
      }),
    ).rejects.toThrow("Race Merge replay conflicts");
  });
});
