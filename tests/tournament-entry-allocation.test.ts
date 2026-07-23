import { describe, expect, it } from "vitest";

import {
  allocateTournamentEntries,
  type EntryAllocationCandidateInput,
  type QualificationRacePlanInput,
} from "@/domain/tournament-entry-allocation";

function candidate(
  coreId: string,
  rank: number,
  requestedInitialRaces = 1,
  overrides: Partial<EntryAllocationCandidateInput> = {},
): EntryAllocationCandidateInput {
  return {
    coreId,
    leaderboardGroupId: "fire",
    configuredMetricRank: rank,
    disposition: "review_candidate",
    requestedInitialRaces,
    ...overrides,
  };
}

function race(
  racePlanId: string,
  gateCount = 6,
  existingPlannedOwnedCoreIds: readonly string[] = [],
): QualificationRacePlanInput {
  return { racePlanId, gateCount, existingPlannedOwnedCoreIds };
}

function allocation(
  candidates: readonly EntryAllocationCandidateInput[],
  racePlans: readonly QualificationRacePlanInput[],
) {
  return allocateTournamentEntries({
    tournamentId: "season-12",
    bracketId: "horse-fire",
    candidates,
    racePlans,
  });
}

describe("tournament entry allocation", () => {
  it("allocates only explicitly requested initial races", () => {
    const result = allocation(
      [candidate("one", 1), candidate("two", 2)],
      [race("race-a", 10)],
    );

    expect(result.races[0]).toEqual(
      expect.objectContaining({
        maximumOwnedEntries: 5,
        suggestedCoreIds: ["one", "two"],
        spareOwnedCapacity: 3,
        spareCapacityDeliberatelyUnfilled: true,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        capacityTarget: false,
        allocationObjective: "requested_initial_evidence_only",
        automaticEntryAllowed: false,
      }),
    );
  });

  it("never exceeds half of the configured gates", () => {
    const result = allocation(
      [candidate("one", 1), candidate("two", 2), candidate("three", 3)],
      [race("race-a", 5)],
    );

    expect(result.races[0]).toEqual(
      expect.objectContaining({
        maximumOwnedEntries: 2,
        totalPlannedOwnedEntries: 2,
      }),
    );
    expect(result.candidates.find((item) => item.coreId === "three")).toEqual(
      expect.objectContaining({
        unallocatedInitialRaces: 1,
        warnings: expect.arrayContaining(["REQUEST_EXCEEDS_PLANNED_CAPACITY"]),
      }),
    );
  });

  it("spreads repeated probes without duplicating a core in one race", () => {
    const result = allocation(
      [candidate("probe", 1, 2)],
      [race("race-a"), race("race-b")],
    );

    expect(result.candidates[0]?.racePlanIds).toEqual(["race-a", "race-b"]);
    expect(result.races.map((item) => item.suggestedCoreIds)).toEqual([
      ["probe"],
      ["probe"],
    ]);
  });

  it("accounts for an existing planned entry without duplicating it", () => {
    const result = allocation(
      [candidate("probe", 1, 2)],
      [race("race-a", 6, ["probe"]), race("race-b")],
    );

    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        allocatedInitialRaces: 2,
        racePlanIds: ["race-a", "race-b"],
      }),
    );
    expect(result.races[0]?.suggestedCoreIds).toEqual([]);
  });

  it("excludes held, ineligible and preserve-ME candidates", () => {
    const result = allocation(
      [
        candidate("hold", 1, 1, { disposition: "hold" }),
        candidate("preserve", 2, 1, { disposition: "preserve_me" }),
        candidate("ineligible", 3, 1, { disposition: "ineligible" }),
      ],
      [race("race-a")],
    );

    expect(result.races[0]?.suggestedCoreIds).toEqual([]);
    expect(result.candidates.map((item) => item.warnings)).toEqual([
      ["CANDIDATE_HELD", "REQUEST_EXCEEDS_PLANNED_CAPACITY"],
      ["PRESERVE_ME", "REQUEST_EXCEEDS_PLANNED_CAPACITY"],
      ["CANDIDATE_INELIGIBLE", "REQUEST_EXCEEDS_PLANNED_CAPACITY"],
    ]);
  });

  it("requires live-field confirmation for every planned race", () => {
    const result = allocation([candidate("one", 1)], [race("race-a")]);

    expect(
      result.races.every((item) => item.requiresLiveFieldConfirmation),
    ).toBe(true);
    expect(result.liveOccupancyAvailable).toBe(false);
  });

  it("fails closed when existing planned entries already exceed the cap", () => {
    expect(() =>
      allocation(
        [candidate("one", 1), candidate("two", 2)],
        [race("race-a", 3, ["one", "two"])],
      ),
    ).toThrow("exceed the 50% gate cap");
  });

  it("accepts tied metric ranks with a deterministic core-ID tiebreak", () => {
    const result = allocation(
      [candidate("zeta", 1), candidate("alpha", 1)],
      [race("race-a", 4)],
    );

    expect(result.races[0]?.suggestedCoreIds).toEqual(["alpha", "zeta"]);
  });

  it("rejects duplicate core and race identities", () => {
    expect(() =>
      allocation(
        [candidate("same", 1), candidate("same", 2)],
        [race("race-a")],
      ),
    ).toThrow("core IDs must be unique");
    expect(() =>
      allocation([candidate("one", 1)], [race("same"), race("same")]),
    ).toThrow("plan IDs must be unique");
  });

  it("does not infer an unknown existing core into the plan", () => {
    expect(() =>
      allocation([candidate("known", 1)], [race("race-a", 6, ["unknown"])]),
    ).toThrow("must be present in the candidate set");
  });
});
