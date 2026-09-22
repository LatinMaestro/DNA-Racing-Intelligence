import { describe, expect, it } from "vitest";

import type { CoreEsportsRaceObservation } from "@/domain/core-esports-performance";
import type { ProLeagueOwnerCommissioningPlan } from "@/domain/pro-league-owner-commissioning-plan";
import type {
  ProLeagueCandidateCellScore,
  ProLeagueDraftRosterRecommendation,
  ProLeagueRosterCandidateScore,
} from "@/domain/pro-league-roster-recommendation";
import { buildProLeagueRosterVersion } from "@/domain/pro-league-roster-version";
import type { ProLeagueSubstitutionWatch } from "@/domain/pro-league-substitution-watch";
import { buildProLeagueWeeklyRosterPerformance } from "@/domain/pro-league-weekly-roster-performance";

const now = new Date("2026-09-23T00:00:00.000Z");

function cell(
  raceType: string,
  distanceMetres: number,
  medianMilliseconds = 50_000,
): ProLeagueCandidateCellScore {
  return {
    raceType,
    distanceMetres,
    mapIds: ["map-1"],
    raceLineCount: 1,
    first16RaceLineCount: 1,
    evidenceUse: "ranked",
    benchmarkAssessment: "top_three_range",
    raceCount: 20,
    freshness: "current",
    dataCurrentThrough: "2026-09-22T00:00:00.000Z",
    medianMilliseconds,
    trimmedMeanMilliseconds: medianMilliseconds + 100,
    standardDeviationMilliseconds: 500,
    medianVersusTopThreeBasisPoints: 500,
    consistencyVersusTopThreeBasisPoints: 500,
    supportingOutcomes: { status: "available", winCount: 2, topThreeCount: 8 },
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
  };
}

function candidate(
  index: number,
  cells: readonly ProLeagueCandidateCellScore[] = [],
): ProLeagueRosterCandidateScore {
  const element =
    index < 7 ? "Metal" : index < 14 ? "Fire" : index < 21 ? "Earth" : "Water";
  return {
    core: {
      coreId: `core-${index + 1}`,
      displayName: `Core ${index + 1}`,
      element,
      coreClass: "Morphed",
      sex: index < 12 ? "female" : "male",
      fNumber: 11 + index,
      inMyVault: true,
    },
    selectionStatus: cells.length > 0 ? "top_three_range" : "unproven",
    qualityVector: {
      first16WinningLines: 0,
      first16TopThreeOrBetterLines: cells.length,
      winningLines: 0,
      topThreeOrBetterLines: cells.length,
      exactFormatCells: cells.length,
      weightedMedianMarginBasisPoints: cells.length > 0 ? 500 : 0,
      weightedConsistencyBasisPoints: cells.length > 0 ? 500 : null,
      acceptedRaceCount: cells.reduce((sum, value) => sum + value.raceCount, 0),
      currentCellCount: cells.length,
    },
    cells,
    supportingWinCount: 0,
    supportingTopThreeCount: 0,
    provisional: cells.length === 0,
    reasons: [],
  };
}

function fixture(): Readonly<{
  roster: ProLeagueDraftRosterRecommendation;
  ownerPlan: ProLeagueOwnerCommissioningPlan;
  watch: ProLeagueSubstitutionWatch;
}> {
  const candidates = Array.from({ length: 26 }, (_, index) =>
    candidate(index, index === 0 ? [cell("1v1", 1000)] : []),
  );
  const rosterCandidates = candidates.slice(0, 25);
  const rosterVersion = buildProLeagueRosterVersion({
    rosterVersionId: "draft-roster/weekly-test",
    versionNumber: 1,
    initialRosterCountingPolicy: "does_not_count",
    evidenceCutoffAt: "2026-09-22T00:00:00.000Z",
    rationale: "Weekly test roster.",
    members: rosterCandidates.map((value) => ({
      core: value.core,
      disposition: "rostered" as const,
      role: "optional" as const,
      reason: "Test",
      evidence: {
        asOf: "2026-09-22T00:00:00.000Z",
        generationId: "generation",
        sha256: "a".repeat(64),
        confidence: "limited" as const,
      },
    })),
  });
  const roster = {
    authority: "active_verified_exact_format_generation",
    selectionMethod: {
      order: "lexicographic_quality_first",
      primaryEvidence: "same_bike_race_type_and_exact_distance",
      intrinsicMetrics: "time_speed_consistency_sample_freshness",
      resultEvidenceRole: "supporting_only_not_ranked",
      missingOppositionQuality: "unknown_never_favourable",
      rosterTarget: "owner_finalized_25",
    },
    generationId: "84000000-0000-4000-8000-000000000401",
    evidenceCutoffAt: "2026-09-22T00:00:00.000Z",
    candidates,
    draftRoster: rosterVersion,
    coverageGaps: [],
    search: {
      targetSize: 25,
      visitedNodeCount: 0,
      maximumNodeCount: 1_000_000,
      status: "constructed",
    },
    operationalWarnings: [],
  } as ProLeagueDraftRosterRecommendation;
  const ownerPlan = {
    planId: "owner-final-roster/full-gate-win-first/2026-09-20",
    roster: rosterCandidates.map(({ core }) => ({
      coreId: core.coreId,
      displayName: core.displayName,
      element: core.element,
      fNumber: core.fNumber,
      sex: core.sex,
      primaryDistances: [],
    })),
    mapStrategy: {
      homePick: "Anchor",
      homeDeny: "Miracles",
      awayPriority: ["Anchor", "Measure", "Glory", "Miracles"],
      contingencyMap: "Miracles",
    },
    maps: [
      {
        mapId: "map-1",
        name: "Anchor",
        requiredCoreEntries: 1,
        assignedCoreEntries: 1,
        allSlotsFilled: true,
        lines: [
          {
            raceNumber: 1,
            first16: true,
            raceType: "1v1",
            distanceMetres: 1000,
            totalGateEntries: 2,
            ourSlots: 1,
            coreIds: ["core-1"],
            coreNames: ["Core 1"],
            evidenceBackedCount: 1,
            allSlotsFilled: true,
          },
        ],
      },
    ],
    requiredCoreEntries: 1,
    assignedCoreEntries: 1,
    allSlotsFilled: true,
  } as ProLeagueOwnerCommissioningPlan;
  const watch = {
    methodology: {
      primaryEvidence: "same_bike_race_type_and_exact_distance",
      metrics: "time_speed_consistency_sample_freshness",
      populationBoundary: "required_but_currently_gated",
      first16Priority: true,
      primaryMaps: ["Anchor", "Measure", "Glory"],
      contingencyMap: "Miracles",
      maximumAdjacentDistanceSteps: 1,
      winRateRole: "supporting_only",
      automaticRosterMutationAllowed: false,
    },
    candidates: [
      {
        coreId: "core-26",
        displayName: "Core 26",
        element: "Water",
        fNumber: 36,
        sex: "male",
        selectionStatus: "top_three_range",
        strongestDistances: [1000],
        exactFormatCellCount: 1,
        acceptedRaceCount: 20,
        watchReason: "performance_or_map_upgrade",
        recommendedScenario: {
          incomingCoreId: "core-26",
          incomingCoreName: "Core 26",
          outgoingCoreId: "core-1",
          outgoingCoreName: "Core 1",
          rosterCompliant: true,
          assignedCoreEntries: 1,
          requiredCoreEntries: 1,
          allSlotsFilled: true,
          changedLineCount: 1,
          changedFirst16LineCount: 1,
          strongerLineCount: 1,
          weakerLineCount: 0,
          strongerFirst16LineCount: 1,
          weakerFirst16LineCount: 0,
          netFirst16Direction: 1,
          netAllLineDirection: 1,
          qualityRankDelta: 1,
          changedLines: [],
        },
      },
    ],
    ageingWatch: {
      status: "authority_pending",
      detail: "Do not invent a cap.",
    },
  } as ProLeagueSubstitutionWatch;
  return { roster, ownerPlan, watch };
}

function observation(
  index: number,
  overrides: Partial<CoreEsportsRaceObservation> = {},
): CoreEsportsRaceObservation {
  return {
    sourceRaceId: `race-${index}`,
    sourceCoreId: "core-1",
    status: "completed",
    raceType: "1v1",
    distanceMetres: 1000,
    gateCount: 2,
    completedAt: `2026-09-22T0${index}:00:00.000Z`,
    finishPosition: 2,
    elapsedTimeMilliseconds: 52_000,
    matchId: "match-1",
    mapId: "map-1",
    observedAt: `2026-09-22T0${index}:05:00.000Z`,
    sourceAuthority: "synthetic-esports-api",
    ...overrides,
  };
}

describe("weekly Pro League roster performance", () => {
  it("does not call normal Bike evidence a weekly league loss when Esports results are unavailable", () => {
    const { roster, ownerPlan, watch } = fixture();
    const result = buildProLeagueWeeklyRosterPerformance({
      roster,
      ownerPlan,
      substitutionWatch: watch,
      esportsSourceConnected: false,
      now,
    });

    expect(result.sourceStatus).toBe("intrinsic_only");
    expect(result.rows).toHaveLength(25);
    expect(result.summary.substitutionReviewCount).toBe(0);
    expect(result.summary.remapReviewCount).toBe(0);
    expect(result.rows[0]).toMatchObject({
      weeklyRaceCount: null,
      weeklySuccessRatePercent: null,
      action: "monitor",
    });
    expect(result.rows[0]?.reasons.join(" ")).toContain(
      "do not infer league wins/losses",
    );
  });

  it("escalates sustained poor league contribution only when timing is also slower and a stronger legal replacement exists", () => {
    const { roster, ownerPlan, watch } = fixture();
    const result = buildProLeagueWeeklyRosterPerformance({
      roster,
      ownerPlan,
      substitutionWatch: watch,
      esportsObservations: [
        observation(1),
        observation(2),
        observation(3),
        observation(4),
      ],
      esportsSourceConnected: true,
      now,
    });

    const row = result.rows.find(({ coreId }) => coreId === "core-1");
    expect(row).toMatchObject({
      weeklyRaceCount: 4,
      weeklyKnownResultCount: 4,
      weeklySuccessCount: 0,
      weeklySuccessRatePercent: 0,
      timingTrend: "slower",
      replacementCandidateName: "Core 26",
      action: "substitution_review",
    });
    expect(result.summary.substitutionReviewCount).toBe(1);
  });

  it("keeps a contributing Core when weekly results are positive and timing has not deteriorated", () => {
    const { roster, ownerPlan, watch } = fixture();
    const result = buildProLeagueWeeklyRosterPerformance({
      roster,
      ownerPlan,
      substitutionWatch: watch,
      esportsObservations: [
        observation(1, {
          finishPosition: 1,
          elapsedTimeMilliseconds: 49_500,
        }),
        observation(2, {
          finishPosition: 1,
          elapsedTimeMilliseconds: 50_000,
        }),
        observation(3, {
          finishPosition: 2,
          elapsedTimeMilliseconds: 50_000,
        }),
      ],
      esportsSourceConnected: true,
      now,
    });

    expect(
      result.rows.find(({ coreId }) => coreId === "core-1"),
    ).toMatchObject({
      weeklyKnownResultCount: 3,
      weeklySuccessCount: 2,
      weeklySuccessRatePercent: 67,
      timingTrend: "stable",
      action: "keep",
    });
  });
});
