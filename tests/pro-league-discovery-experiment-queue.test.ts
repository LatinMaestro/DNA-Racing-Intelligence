import { describe, expect, it } from "vitest";

import {
  buildProLeagueDiscoveryExperimentQueue,
  type ProLeagueDiscoveryExperimentQueue,
} from "@/domain/pro-league-discovery-experiment-queue";
import type {
  ProLeagueCandidateCellScore,
  ProLeagueDraftRosterRecommendation,
  ProLeagueRosterCandidateScore,
} from "@/domain/pro-league-roster-recommendation";

function cell(
  distanceMetres: number,
  benchmarkAssessment: ProLeagueCandidateCellScore["benchmarkAssessment"],
  overrides: Partial<ProLeagueCandidateCellScore> = {},
): ProLeagueCandidateCellScore {
  return {
    raceType: "1v1",
    distanceMetres,
    mapIds: ["map-1"],
    raceLineCount: 2,
    first16RaceLineCount: 1,
    evidenceUse: "hypothesis_only",
    benchmarkAssessment,
    raceCount: 2,
    freshness: "current",
    dataCurrentThrough: "2026-09-07T00:00:00.000Z",
    medianMilliseconds: 50_000,
    trimmedMeanMilliseconds: 50_500,
    standardDeviationMilliseconds: 600,
    medianVersusTopThreeBasisPoints: 500,
    consistencyVersusTopThreeBasisPoints: 4_000,
    supportingOutcomes: {
      status: "available",
      winCount: 0,
      topThreeCount: 0,
    },
    supportingOpposition: {
      status: "unavailable",
      raceCount: 0,
      winCount: 0,
      topThreeCount: 0,
    },
    supportingStars: {
      status: "unavailable",
      qualityKnownRaceCount: 0,
      strongFieldYellowReceivedCount: 0,
      strongFieldBlueReceivedCount: 0,
      eliteOpponentYellowReceivedCount: 0,
      eliteOpponentBlueReceivedCount: 0,
      yellowFieldAdjustedIndex: null,
      blueFieldAdjustedIndex: null,
      rawConversionUsedForRanking: false,
    },
    ...overrides,
  };
}

function candidate(
  coreId: string,
  cells: readonly ProLeagueCandidateCellScore[],
): ProLeagueRosterCandidateScore {
  return {
    core: {
      coreId,
      displayName: `Core ${coreId}`,
      element: "Water",
      coreClass: "Morphed",
      sex: "female",
      fNumber: 16,
      inMyVault: true,
    },
    selectionStatus: "unproven",
    qualityVector: {
      first16WinningLines: 0,
      first16TopThreeOrBetterLines: 0,
      winningLines: 0,
      topThreeOrBetterLines: 0,
      exactFormatCells: 0,
      weightedMedianMarginBasisPoints: 0,
      weightedConsistencyBasisPoints: null,
      acceptedRaceCount: 0,
      currentCellCount: 0,
    },
    cells,
    supportingWinCount: 0,
    supportingTopThreeCount: 0,
    provisional: true,
    reasons: [],
  };
}

function recommendation(
  candidates: readonly ProLeagueRosterCandidateScore[],
): ProLeagueDraftRosterRecommendation {
  return {
    authority: "active_verified_exact_format_generation",
    evidenceCutoffAt: "2026-09-07T00:00:00.000Z",
    candidates,
    coverageGaps: [
      {
        raceType: "1v1",
        distanceMetres: 1_000,
        mapIds: ["map-1"],
        raceLineCount: 4,
        maximumGateEntriesPerVault: 1,
        status: "unproven",
        bestAvailableCoreIds: [],
        bestAvailableRostered: false,
        discoveryPriority: "high",
        rosterAdvice: "test_before_roster_lock",
        guidance: "Test before lock.",
      },
    ],
    draftRoster: {
      members: [
        {
          core: { coreId: "structural" },
          disposition: "rostered",
          role: "structural_coverage",
        },
        {
          core: { coreId: "optional" },
          disposition: "rostered",
          role: "optional",
        },
        {
          core: { coreId: "nucleus" },
          disposition: "rostered",
          role: "nucleus",
        },
      ],
    },
  } as unknown as ProLeagueDraftRosterRecommendation;
}

describe("Pro League Discovery experiment queue", () => {
  it("ranks bounded exact and adjacent-distance tests that could change the roster", () => {
    const result = buildProLeagueDiscoveryExperimentQueue(
      recommendation([
        candidate("challenger", [
          cell(1_000, "winning_range", { raceCount: 8 }),
        ]),
        candidate("structural", [
          cell(1_000, "top_three_range", { raceCount: 2 }),
        ]),
        candidate("optional", [
          cell(800, "winning_range", {
            evidenceUse: "ranked",
            raceCount: 12,
          }),
        ]),
        candidate("nucleus", [cell(1_000, "winning_range")]),
      ]),
    );

    expect(result.experiments.map(({ coreId }) => coreId)).toEqual([
      "challenger",
      "structural",
      "optional",
    ]);
    expect(result.experiments[0]).toMatchObject({
      rosterImpact: "challenge_provisional_roster_slot",
      directRaceCount: 8,
      observationsToMinimum: 2,
      recommendedNextRaceCount: 2,
      automaticRaceEntryAllowed: false,
      automaticRosterMutationAllowed: false,
    });
    expect(result.experiments[2]).toMatchObject({
      hypothesisSource: "adjacent_distance_same_race_type",
      sourceDistanceMetres: 800,
      directRaceCount: 0,
      observationsToMinimum: 10,
      recommendedNextRaceCount: 3,
    });
    expect(result.experiments[2]!.warnings).toContain(
      "ADJACENT_DISTANCE_IS_HYPOTHESIS_ONLY",
    );
    expect(result.substitutionBudget).toMatchObject({
      maximumPerYear: 10,
      usedCount: null,
      initialRosterCountingPolicy: "unresolved",
    });
  });

  it("stops weak paths early and never lets raw wins rescue inferior time evidence", () => {
    const weak = cell(1_000, "outside_top_three_range", {
      raceCount: 5,
      supportingOutcomes: {
        status: "available",
        winCount: 5,
        topThreeCount: 5,
      },
    });
    const conflicting = cell(1_000, "outside_top_three_range", {
      raceCount: 5,
      supportingOpposition: {
        status: "available",
        raceCount: 2,
        winCount: 0,
        topThreeCount: 1,
      },
    });
    const result = buildProLeagueDiscoveryExperimentQueue(
      recommendation([
        candidate("weak", [weak]),
        candidate("conflicting", [conflicting]),
      ]),
    );

    expect(result.experiments).toEqual([]);
    expect(result.diagnostics).toMatchObject({
      stoppedWeakPathCount: 1,
      conflictingEvidenceCount: 1,
    });
  });

  it("allows one confirmation before stopping a very small weak sample", () => {
    const result: ProLeagueDiscoveryExperimentQueue =
      buildProLeagueDiscoveryExperimentQueue(
        recommendation([
          candidate("small-weak", [
            cell(1_000, "outside_top_three_range", { raceCount: 3 }),
          ]),
        ]),
      );

    expect(result.experiments[0]).toMatchObject({
      decision: "single_confirmation",
      recommendedNextRaceCount: 1,
      observationsToMinimum: 7,
    });
  });

  it("caps the rendered queue while reporting every eligible experiment", () => {
    const result = buildProLeagueDiscoveryExperimentQueue(
      recommendation(
        Array.from({ length: 101 }, (_, index) =>
          candidate(`candidate-${String(index).padStart(3, "0")}`, [
            cell(1_000, "winning_range"),
          ]),
        ),
      ),
    );

    expect(result.experiments).toHaveLength(100);
    expect(result.diagnostics).toMatchObject({
      eligibleExperimentCount: 101,
      truncatedExperimentCount: 1,
    });
  });
});
