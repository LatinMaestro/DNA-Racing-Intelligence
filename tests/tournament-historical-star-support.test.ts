import { describe, expect, it } from "vitest";

import {
  projectTournamentHistoricalStarSupport,
  type TournamentStarCandidate,
  type TournamentStarProfile,
} from "@/domain/tournament-historical-star-support";
import type { TournamentRuleConfiguration } from "@/domain/tournament-configuration";

function rule(
  distances: readonly number[] = [1_200],
): Pick<
  TournamentRuleConfiguration,
  "mode" | "eligibleDistancesMetres" | "qualification"
> {
  return {
    mode: "bike",
    eligibleDistancesMetres: distances,
    qualification: {
      minimumRaceCount: 10,
      target: { kind: "count", value: 5 },
      rankingMetric: "fastest_single_time",
      topFinishPosition: null,
      pointsTable: {},
      customScoringConfiguration: {},
    },
  };
}

function candidate(
  coreId: string,
  timeEvidence: TournamentStarCandidate["timeEvidence"] = "competitive",
  eligibility: TournamentStarCandidate["eligibility"] = "eligible",
): TournamentStarCandidate {
  return { coreId, timeEvidence, eligibility };
}

function profile(
  coreId: string,
  overrides: Partial<TournamentStarProfile> = {},
): TournamentStarProfile {
  return {
    coreId,
    mode: "bike",
    distanceMetres: 1_200,
    dataCurrentThrough: "2026-08-01T00:00:00.000Z",
    raceCount: 12,
    completeStarDataRaceCount: 12,
    partialStarDataRaceCount: 0,
    missingStarDataRaceCount: 0,
    invalidStarDataRaceCount: 0,
    goldAssignmentOpportunityCount: 10,
    goldReceivedCount: 2,
    goldNegativeOpportunityCount: 8,
    goldExcludedAnomalyCount: 0,
    blueAssignmentOpportunityCount: 10,
    blueReceivedCount: 1,
    blueNegativeOpportunityCount: 9,
    blueExcludedAnomalyCount: 0,
    refreshedAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("Tournament historical star support", () => {
  it("uses repeated exact-distance stars as supporting rationale only", () => {
    const result = projectTournamentHistoricalStarSupport(
      rule(),
      [candidate("supported")],
      [profile("supported")],
    );
    expect(result.get("supported")).toBe("supports");
  });

  it("surfaces repeated star/time disagreement without changing metric order", () => {
    const positiveConflict = projectTournamentHistoricalStarSupport(
      rule(),
      [candidate("positive-conflict", "weak")],
      [profile("positive-conflict")],
    );
    expect(positiveConflict.get("positive-conflict")).toBe("conflicts");

    const negativeConflict = projectTournamentHistoricalStarSupport(
      rule(),
      [candidate("negative-conflict", "strong")],
      [
        profile("negative-conflict", {
          goldReceivedCount: 0,
          goldNegativeOpportunityCount: 10,
          blueReceivedCount: 0,
          blueNegativeOpportunityCount: 10,
        }),
      ],
    );
    expect(negativeConflict.get("negative-conflict")).toBe("conflicts");
  });

  it("keeps isolated or incomplete negative evidence neutral", () => {
    const result = projectTournamentHistoricalStarSupport(
      rule(),
      [candidate("neutral")],
      [
        profile("neutral", {
          goldAssignmentOpportunityCount: 4,
          goldReceivedCount: 0,
          goldNegativeOpportunityCount: 4,
          blueAssignmentOpportunityCount: 4,
          blueReceivedCount: 1,
          blueNegativeOpportunityCount: 3,
        }),
      ],
    );
    expect(result.get("neutral")).toBe("neutral");
  });

  it("fails closed for missing, anomalous, multi-distance, or ineligible evidence", () => {
    expect(
      projectTournamentHistoricalStarSupport(
        rule(),
        [candidate("missing")],
        [],
      ).get("missing"),
    ).toBe("unavailable");
    expect(
      projectTournamentHistoricalStarSupport(
        rule(),
        [candidate("anomaly")],
        [profile("anomaly", { goldExcludedAnomalyCount: 1 })],
      ).get("anomaly"),
    ).toBe("unavailable");
    expect(
      projectTournamentHistoricalStarSupport(
        rule([1_200, 1_400]),
        [candidate("multi")],
        [profile("multi")],
      ).get("multi"),
    ).toBe("unavailable");
    expect(
      projectTournamentHistoricalStarSupport(
        rule(),
        [candidate("ineligible", "competitive", "ineligible")],
        [profile("ineligible")],
      ).get("ineligible"),
    ).toBe("unavailable");
  });

  it("rejects duplicated or inconsistent profiles", () => {
    expect(() =>
      projectTournamentHistoricalStarSupport(
        rule(),
        [candidate("duplicate")],
        [profile("duplicate"), profile("duplicate")],
      ),
    ).toThrow("profile is duplicated");
    expect(() =>
      projectTournamentHistoricalStarSupport(
        rule(),
        [candidate("invalid")],
        [profile("invalid", { goldNegativeOpportunityCount: 7 })],
      ),
    ).toThrow("profile is inconsistent");
  });
});
