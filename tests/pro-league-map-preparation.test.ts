import { describe, expect, it } from "vitest";

import {
  buildProLeagueMapPreparationPlan,
  type ProLeagueMapPreparationPlan,
} from "@/domain/pro-league-map-preparation";
import type {
  ProLeagueDraftLineRecommendation,
  ProLeagueDraftLineupRecommendation,
  ProLeagueDraftMapRecommendation,
} from "@/domain/pro-league-lineup-recommendation";
import type { ProLeagueMapId } from "@/domain/pro-league-maps";

function map(
  mapId: ProLeagueMapId,
  name: string,
  counts: Readonly<{
    first16NoExact: number;
    first16Provisional: number;
    laterNoExact: number;
    laterProvisional: number;
  }>,
): ProLeagueDraftMapRecommendation {
  const lines = Array.from({ length: 42 }, (_, index) => {
    const first16 = index < 16;
    const position = first16 ? index : index - 16;
    const noExactLimit = first16 ? counts.first16NoExact : counts.laterNoExact;
    const provisionalLimit =
      noExactLimit +
      (first16 ? counts.first16Provisional : counts.laterProvisional);
    const evidenceStatus =
      position < noExactLimit
        ? "no_exact_format_evidence"
        : position < provisionalLimit
          ? "population_weak_provisional"
          : "winning_range";
    return {
      mapId,
      raceNumber: index + 1,
      first16,
      raceType: "1v1",
      distanceMetres: 1_000,
      coreId: "private-core",
      assignmentScope: "same_type_and_distance",
      sourceRaceNumber: 1,
      evidenceStatus,
      provisional: evidenceStatus !== "winning_range",
      evidence: null,
      reason: "Synthetic map-preparation fixture.",
    } satisfies ProLeagueDraftLineRecommendation;
  });
  return {
    mapId,
    name,
    lineCount: 42,
    first16LineCount: 16,
    bulkAssignmentCount: 1,
    winningRangeLineCount: lines.filter(
      ({ evidenceStatus }) => evidenceStatus === "winning_range",
    ).length,
    topThreeRangeLineCount: 0,
    provisionalLineCount: lines.filter(({ provisional }) => provisional).length,
    noExactEvidenceLineCount: lines.filter(
      ({ evidenceStatus }) => evidenceStatus === "no_exact_format_evidence",
    ).length,
    lines,
  };
}

function lineup(
  maps: readonly ProLeagueDraftMapRecommendation[],
): ProLeagueDraftLineupRecommendation {
  return {
    authority: "active_verified_exact_format_generation_and_rule_valid_roster",
    generationId: "private-generation",
    evidenceCutoffAt: "2026-09-08T00:00:00.000Z",
    rosterVersionId: "private-roster",
    selectionMethod: {
      primaryEvidence: "same_bike_race_type_and_exact_distance",
      order: "population_band_then_intrinsic_time_consistency_sample_freshness",
      resultEvidenceRole: "supporting_only_not_ranked",
      missingOppositionQuality: "unknown_never_favourable",
      equalQualityTieBreak: "lower_mapped_line_load_then_core_id",
    },
    lineup: {} as ProLeagueDraftLineupRecommendation["lineup"],
    assignmentCommands: [],
    maps,
    totals: {
      lineCount: 168,
      first16LineCount: 64,
      bulkAssignmentCount: 4,
      winningRangeLineCount: 0,
      topThreeRangeLineCount: 0,
      provisionalLineCount: 0,
      noExactEvidenceLineCount: 0,
    },
    operationalWarnings: [],
  };
}

function completeLineup(): ProLeagueDraftLineupRecommendation {
  return lineup([
    map("map-1", "Anchor", {
      first16NoExact: 0,
      first16Provisional: 0,
      laterNoExact: 5,
      laterProvisional: 0,
    }),
    map("map-2", "Glory", {
      first16NoExact: 0,
      first16Provisional: 2,
      laterNoExact: 0,
      laterProvisional: 0,
    }),
    map("map-3", "Measure", {
      first16NoExact: 1,
      first16Provisional: 0,
      laterNoExact: 0,
      laterProvisional: 0,
    }),
    map("map-4", "Miracles", {
      first16NoExact: 2,
      first16Provisional: 0,
      laterNoExact: 0,
      laterProvisional: 0,
    }),
  ]);
}

describe("Pro League map preparation", () => {
  it("orders home preference by first-16 intrinsic coverage before the full map", () => {
    const plan = buildProLeagueMapPreparationPlan(completeLineup());

    expect(plan.homePreferenceOrder).toEqual([
      "map-1",
      "map-2",
      "map-3",
      "map-4",
    ]);
    expect(plan.defensivePreparationOrder).toEqual([
      "map-4",
      "map-3",
      "map-2",
      "map-1",
    ]);
    expect(
      plan.assessments.find(({ mapId }) => mapId === "map-1"),
    ).toMatchObject({
      readiness: "evidence_gap",
      first16: {
        winningRangeLineCount: 16,
        provisionalLineCount: 0,
        noExactEvidenceLineCount: 0,
      },
      fullMap: { noExactEvidenceLineCount: 5 },
    });
  });

  it("withholds opponent denial, head-to-head and every match action", () => {
    const plan: ProLeagueMapPreparationPlan =
      buildProLeagueMapPreparationPlan(completeLineup());

    expect(plan).toMatchObject({
      authority: "verified_owned_exact_format_lineup_only",
      opponentDenialStatus: "held_without_opponent_exact_format_evidence",
      headToHeadStatus: "unavailable",
      matchActionAllowed: false,
      selectionMethod: {
        primaryWindow: "first_16_race_points",
        resultEvidenceRole: "not_used",
        missingOppositionQuality: "unknown_never_favourable",
      },
    });
  });

  it("rejects incomplete or duplicated map coverage", () => {
    const complete = completeLineup();
    expect(() =>
      buildProLeagueMapPreparationPlan(lineup(complete.maps.slice(0, 3))),
    ).toThrow("complete verified four-map lineup");
    expect(() =>
      buildProLeagueMapPreparationPlan(
        lineup([
          complete.maps[0]!,
          complete.maps[0]!,
          complete.maps[2]!,
          complete.maps[3]!,
        ]),
      ),
    ).toThrow("complete verified four-map lineup");
  });
});
