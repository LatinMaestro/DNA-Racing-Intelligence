import { describe, expect, it } from "vitest";

import { proLeagueOwnerFinalRosterPlan } from "@/domain/pro-league-owner-final-plan";
import type { ProLeagueOwnerCommissioningPlan } from "@/domain/pro-league-owner-commissioning-plan";
import { buildProLeagueSubstitutionWatch } from "@/domain/pro-league-substitution-watch";
import type {
  ProLeagueCandidateCellScore,
  ProLeagueDraftRosterRecommendation,
  ProLeagueRosterCandidateScore,
} from "@/domain/pro-league-roster-recommendation";
import { buildProLeagueRosterVersion } from "@/domain/pro-league-roster-version";

function candidate(
  index: number,
  displayName: string,
  cells: readonly ProLeagueCandidateCellScore[] = [],
): ProLeagueRosterCandidateScore {
  const elements = ["Metal", "Fire", "Earth", "Water"] as const;
  return {
    core: {
      coreId: `core-${index + 1}`,
      displayName,
      element:
        index < 7 ? "Metal" : index < 14 ? "Fire" : index < 21 ? "Earth" : "Water",
      coreClass: "Morphed",
      sex: index < 12 ? "female" : "male",
      fNumber: 11 + index,
      inMyVault: true,
    },
    selectionStatus: cells.length > 0 ? "top_three_range" : "unproven",
    qualityVector: {
      first16WinningLines: 0,
      first16TopThreeOrBetterLines: cells.reduce(
        (sum, cell) => sum + cell.first16RaceLineCount,
        0,
      ),
      winningLines: 0,
      topThreeOrBetterLines: cells.reduce(
        (sum, cell) => sum + cell.raceLineCount,
        0,
      ),
      exactFormatCells: cells.length,
      weightedMedianMarginBasisPoints: cells.length > 0 ? 500 : 0,
      weightedConsistencyBasisPoints: cells.length > 0 ? 500 : null,
      acceptedRaceCount: cells.reduce((sum, cell) => sum + cell.raceCount, 0),
      currentCellCount: cells.length,
    },
    cells,
    supportingWinCount: 0,
    supportingTopThreeCount: 0,
    provisional: cells.length === 0,
    reasons: [],
  };
}

function cell(
  distanceMetres: number,
  raceType = "1v1",
): ProLeagueCandidateCellScore {
  return {
    raceType,
    distanceMetres,
    mapIds: ["map-1", "map-2", "map-3", "map-4"],
    raceLineCount: 4,
    first16RaceLineCount: 2,
    evidenceUse: "ranked",
    benchmarkAssessment: "top_three_range",
    raceCount: 12,
    freshness: "current",
    dataCurrentThrough: "2026-09-20T02:00:00.000Z",
    medianMilliseconds: 50_000,
    trimmedMeanMilliseconds: 50_100,
    standardDeviationMilliseconds: 500,
    medianVersusTopThreeBasisPoints: 500,
    consistencyVersusTopThreeBasisPoints: 500,
    supportingOutcomes: { status: "available", winCount: 1, topThreeCount: 4 },
    supportingOpposition: { status: "unavailable" },
    supportingStars: { status: "unavailable" },
  };
}

function fixture(): Readonly<{
  roster: ProLeagueDraftRosterRecommendation;
  ownerPlan: ProLeagueOwnerCommissioningPlan;
}> {
  const baseCandidates = proLeagueOwnerFinalRosterPlan.map((entry, index) =>
    candidate(index, entry.displayName),
  );
  const challenger = candidate(25, "Challenger", [
    cell(1000),
    cell(1200),
    cell(1400),
    cell(1600),
    cell(1800),
    cell(2000),
    cell(2200),
  ]);
  const rosterVersion = buildProLeagueRosterVersion({
    rosterVersionId: "draft-roster/test",
    versionNumber: 1,
    initialRosterCountingPolicy: "does_not_count",
    evidenceCutoffAt: "2026-09-20T02:00:00.000Z",
    rationale: "Test final roster.",
    members: baseCandidates.map((value) => ({
      core: value.core,
      disposition: "rostered" as const,
      role: "optional" as const,
      reason: "Test",
      evidence: {
        asOf: "2026-09-20T02:00:00.000Z",
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
    evidenceCutoffAt: "2026-09-20T02:00:00.000Z",
    candidates: [challenger, ...baseCandidates],
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
    roster: baseCandidates.map(({ core }, index) => ({
      coreId: core.coreId,
      displayName: core.displayName,
      element: core.element,
      fNumber: core.fNumber,
      sex: core.sex,
      primaryDistances:
        proLeagueOwnerFinalRosterPlan[index]?.primaryDistances ?? [],
    })),
    mapStrategy: {
      homePick: "Anchor",
      homeDeny: "Miracles",
      awayPriority: ["Anchor", "Measure", "Glory", "Miracles"],
      contingencyMap: "Miracles",
    },
    maps: ["map-1", "map-2", "map-3", "map-4"].map((mapId, mapIndex) => ({
      mapId: mapId as "map-1" | "map-2" | "map-3" | "map-4",
      name: ["Anchor", "Glory", "Measure", "Miracles"][mapIndex]!,
      requiredCoreEntries: 42,
      assignedCoreEntries: 42,
      allSlotsFilled: true,
      lines: Array.from({ length: 42 }, (_, index) => ({
        raceNumber: index + 1,
        first16: index < 16,
        raceType: "1v1",
        distanceMetres: [1000, 1200, 1400, 1600, 1800, 2000, 2200][
          index % 7
        ]!,
        totalGateEntries: 2,
        ourSlots: 1,
        coreIds: [baseCandidates[index % 12]!.core.coreId],
        coreNames: [baseCandidates[index % 12]!.core.displayName],
        evidenceBackedCount: 0,
        allSlotsFilled: true,
      })),
    })),
    requiredCoreEntries: 168,
    assignedCoreEntries: 168,
    allSlotsFilled: true,
  } as ProLeagueOwnerCommissioningPlan;

  return { roster, ownerPlan };
}

describe("Pro League substitution watch", () => {
  it("uses the final roster methodology and produces a compliant full-remap scenario", () => {
    const result = buildProLeagueSubstitutionWatch(fixture());

    expect(result.methodology).toMatchObject({
      primaryEvidence: "same_bike_race_type_and_exact_distance",
      metrics: "time_speed_consistency_sample_freshness",
      first16Priority: true,
      primaryMaps: ["Anchor", "Measure", "Glory"],
      contingencyMap: "Miracles",
      maximumAdjacentDistanceSteps: 1,
      winRateRole: "supporting_only",
      automaticRosterMutationAllowed: false,
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      displayName: "Challenger",
      strongestDistances: expect.arrayContaining([1000, 1200]),
      recommendedScenario: {
        rosterCompliant: true,
        allSlotsFilled: true,
      },
    });
    expect(
      result.candidates[0]?.recommendedScenario.requiredCoreEntries,
    ).toBeGreaterThan(0);
    expect(
      result.candidates[0]?.recommendedScenario.assignedCoreEntries,
    ).toBe(
      result.candidates[0]?.recommendedScenario.requiredCoreEntries,
    );
  });

  it("keeps ageing-triggered substitutions held until authoritative cap semantics exist", () => {
    const result = buildProLeagueSubstitutionWatch(fixture());
    expect(result.ageingWatch.status).toBe("authority_pending");
    expect(result.ageingWatch.detail).toContain("must not invent a cap");
  });
});
