import { describe, expect, it } from "vitest";

import { projectTournamentCandidateEligibility } from "@/domain/tournament-candidate-eligibility";
import type { TournamentRuleConfiguration } from "@/domain/tournament-configuration";

function rule(
  overrides: Partial<
    Pick<TournamentRuleConfiguration, "eligibility" | "leaderboard">
  > = {},
): Pick<
  TournamentRuleConfiguration,
  "bracketId" | "splitLabel" | "eligibility" | "leaderboard"
> {
  return {
    bracketId: "bike-split",
    splitLabel: "Bike split",
    eligibility: {
      breeds: ["Genesis"],
      classes: [],
      elements: ["Fire", "Metal"],
      fNumbers: [1],
      fNumberRanges: [{ minimum: 3, maximum: 4 }],
      groups: [],
      ...overrides.eligibility,
    },
    leaderboard: {
      splitDimension: "element",
      groups: [
        { id: "fire", label: "Fire" },
        { id: "metal", label: "Metal" },
      ],
      qualifyingRaceSemantics: "separate",
      ...overrides.leaderboard,
    },
  };
}

const core = {
  coreId: "core-1",
  coreClass: "Genesis",
  element: "Fire",
  fNumber: 3,
};

describe("Tournament candidate eligibility", () => {
  it("applies class-or-breed, element and exact-or-range restrictions", () => {
    expect(projectTournamentCandidateEligibility(rule(), core)).toEqual({
      eligibility: "eligible",
      leaderboardGroupId: "fire",
      leaderboardGroupLabel: "Fire",
    });
    expect(
      projectTournamentCandidateEligibility(rule(), {
        ...core,
        coreClass: "Morphed",
      }),
    ).toMatchObject({ eligibility: "ineligible" });
    expect(
      projectTournamentCandidateEligibility(rule(), {
        ...core,
        fNumber: 2,
      }),
    ).toMatchObject({ eligibility: "ineligible" });
  });

  it("assigns combined eligibility groups only through matching leaderboard IDs", () => {
    const grouped = rule({
      eligibility: {
        breeds: [],
        classes: [],
        elements: [],
        fNumbers: [],
        fNumberRanges: [],
        groups: [
          {
            id: "hot",
            label: "Metal + Fire",
            breeds: [],
            classes: ["Genesis"],
            elements: ["Metal", "Fire"],
            fNumbers: [],
            fNumberRanges: [{ minimum: 1, maximum: 4 }],
          },
          {
            id: "cold",
            label: "Earth + Water",
            breeds: [],
            classes: ["Genesis"],
            elements: ["Earth", "Water"],
            fNumbers: [],
            fNumberRanges: [{ minimum: 1, maximum: 4 }],
          },
        ],
      },
      leaderboard: {
        splitDimension: "combined",
        groups: [
          { id: "hot", label: "Metal + Fire" },
          { id: "cold", label: "Earth + Water" },
        ],
        qualifyingRaceSemantics: "separate",
      },
    });
    expect(projectTournamentCandidateEligibility(grouped, core)).toEqual({
      eligibility: "eligible",
      leaderboardGroupId: "hot",
      leaderboardGroupLabel: "Metal + Fire",
    });
  });

  it("fails closed when configured groups overlap or cannot be mapped", () => {
    const overlapping = rule({
      eligibility: {
        breeds: [],
        classes: [],
        elements: [],
        fNumbers: [],
        fNumberRanges: [],
        groups: [
          {
            id: "first",
            label: "First",
            breeds: [],
            classes: [],
            elements: ["Fire"],
            fNumbers: [],
            fNumberRanges: [],
          },
          {
            id: "second",
            label: "Second",
            breeds: [],
            classes: [],
            elements: ["Fire"],
            fNumbers: [],
            fNumberRanges: [],
          },
        ],
      },
      leaderboard: {
        splitDimension: "combined",
        groups: [
          { id: "first", label: "First" },
          { id: "second", label: "Second" },
        ],
        qualifyingRaceSemantics: "separate",
      },
    });
    expect(
      projectTournamentCandidateEligibility(overlapping, core),
    ).toMatchObject({
      eligibility: "review_required",
      leaderboardGroupId: "unassigned",
    });

    expect(
      projectTournamentCandidateEligibility(
        rule({
          leaderboard: {
            splitDimension: "unsupported-combination",
            groups: [{ id: "group", label: "Group" }],
            qualifyingRaceSemantics: "separate",
          },
        }),
        core,
      ),
    ).toMatchObject({ eligibility: "review_required" });
  });

  it("uses the bracket as the single unsplit leaderboard", () => {
    expect(
      projectTournamentCandidateEligibility(
        rule({
          leaderboard: {
            splitDimension: "none",
            groups: [],
            qualifyingRaceSemantics: "shared",
          },
        }),
        core,
      ),
    ).toEqual({
      eligibility: "eligible",
      leaderboardGroupId: "bike-split",
      leaderboardGroupLabel: "Bike split",
    });
  });
});
