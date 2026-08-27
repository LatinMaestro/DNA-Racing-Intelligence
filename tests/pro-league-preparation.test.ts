import { describe, expect, it } from "vitest";

import {
  buildProLeaguePreparation,
  type ProLeagueBenchmarkAssessment,
  type ProLeaguePreparationCore,
} from "@/domain/pro-league-preparation";
import type { RaceMode } from "@/domain/core-performance";
import type { Element } from "@/domain/game-rules";

function profile(
  mode: RaceMode,
  distanceMetres: number,
  benchmarkAssessment: ProLeagueBenchmarkAssessment,
  raceCount = 10,
  freshness: "current" | "ageing" | "stale" | "unknown" = "current",
) {
  return {
    mode,
    distanceMetres,
    raceCount,
    sampleStatus:
      raceCount >= 10
        ? ("minimally_analytical" as const)
        : ("hypothesis_only" as const),
    freshness,
    dataCurrentThrough: "2026-08-19T00:00:00.000Z",
    benchmarkAssessment,
  };
}

function core(
  id: string,
  element: Element,
  overrides: Partial<ProLeaguePreparationCore> = {},
): ProLeaguePreparationCore {
  return {
    coreId: id,
    displayName: id,
    coreClass: "Morphed",
    element,
    sex: "male",
    fNumber: 10,
    performanceProfiles: [],
    payoutFormatProfiles: [],
    ...overrides,
  };
}

describe("Pro League preparation", () => {
  it("uses shared DNA Racing performance and excludes additional Genesis minting", () => {
    const result = buildProLeaguePreparation([core("m1", "Metal")]);

    expect(result.mintStrategy).toBe("no_additional_genesis_mint");
    expect(result.performanceAuthority).toBe("shared_dna_racing_core_stats");
    expect(result.selectionObjective).toBe(
      "most_powerful_overall_cross_mode_and_format",
    );
    expect(result.formatEvidenceStatus).toBe("descriptive_context_connected");
    expect(result.genesisInterpretationStatus).toBe("confirmed");
  });

  it("exposes only fresh minimally-supported payout-format context without changing power tiers", () => {
    const result = buildProLeaguePreparation([
      core("format-context", "Fire", {
        payoutFormatProfiles: [
          {
            mode: "bike",
            payoutFormatKey: "top 3",
            payoutFormatLabel: "Top 3",
            raceCount: 12,
            winCount: 2,
            topThreeCount: 7,
            exactDistanceCount: 3,
            timedRaceCount: 12,
            sampleStatus: "minimally_supported",
            freshness: "current",
            dataCurrentThrough: "2026-08-19T00:00:00.000Z",
          },
          {
            mode: "car",
            payoutFormatKey: "winner take all",
            payoutFormatLabel: "Winner Take All",
            raceCount: 4,
            winCount: 1,
            topThreeCount: 1,
            exactDistanceCount: 1,
            timedRaceCount: 4,
            sampleStatus: "hypothesis_only",
            freshness: "current",
            dataCurrentThrough: "2026-08-19T00:00:00.000Z",
          },
        ],
      }),
    ]);
    const candidate = result.overallPowerPool[0]!;

    expect(candidate.supportedPayoutFormatCount).toBe(1);
    expect(candidate.payoutFormatProfiles).toHaveLength(2);
    expect(candidate.powerTier).toBe("unproven");
    expect(candidate.reasons.join(" ")).toContain("descriptive context only");
  });

  it("limits selectable pool depth using current element and Genesis ceilings", () => {
    const result = buildProLeaguePreparation([
      core("m1", "Metal", { coreClass: "Genesis" }),
      core("m2", "Metal", { coreClass: "Genesis" }),
      core("m3", "Metal", { coreClass: "Genesis" }),
      core("m4", "Metal", { coreClass: "Genesis" }),
      core("m5", "Metal"),
    ]);
    const metal = result.elements.find(({ element }) => element === "Metal");

    expect(metal).toMatchObject({
      rosterFloorGap: 0,
      nonGenesisDepthGap: 0,
      breedingPriority: "quality",
    });
    expect(result.selectableUnderGenesisCaps).toBe(3);
  });

  it("ranks broad winning-range power ahead of a one-mode specialist", () => {
    const result = buildProLeaguePreparation([
      core("all-rounder", "Water", {
        performanceProfiles: [
          profile("bike", 1_200, "winning_range"),
          profile("car", 1_400, "winning_range"),
          profile("horse", 1_600, "top_three_range"),
        ],
      }),
      core("specialist", "Water", {
        performanceProfiles: [
          profile("bike", 1_200, "winning_range"),
          profile("bike", 1_400, "winning_range"),
          profile("bike", 1_600, "winning_range"),
        ],
      }),
    ]);

    expect(result.overallPowerPool[0]).toMatchObject({
      coreId: "all-rounder",
      powerTier: "multi_mode_winning_range",
      winningRangeModes: ["bike", "car"],
      topThreeOrBetterModes: ["bike", "car", "horse"],
    });
    expect(result.overallPowerPool[1]).toMatchObject({
      coreId: "specialist",
      powerTier: "single_mode_winning_range",
    });
  });

  it("prioritises Discovery when a powerful core is still untested in other modes", () => {
    const result = buildProLeaguePreparation([
      core("promising", "Fire", {
        sex: "female",
        fNumber: 18,
        performanceProfiles: [profile("bike", 1_400, "winning_range")],
      }),
      core("unknown", "Fire"),
    ]);

    expect(result.discoveryQueue[0]).toMatchObject({
      coreId: "promising",
      discoveryPriority: "high",
      powerTier: "single_mode_winning_range",
    });
    expect(result.discoveryQueue[0]?.reasons.join(" ")).toContain(
      "missing modes",
    );
  });

  it("keeps an under-tested fast hypothesis out of proven power tiers while prioritising Discovery", () => {
    const result = buildProLeaguePreparation([
      core("early-signal", "Fire", {
        performanceProfiles: [profile("bike", 1_400, "winning_range", 4)],
      }),
    ]);

    expect(result.overallPowerPool[0]).toMatchObject({
      coreId: "early-signal",
      powerTier: "unproven",
      winningRangeModes: [],
      topThreeOrBetterModes: [],
      discoveryPriority: "high",
    });
  });

  it("labels stale evidence and excludes it from current power tiers", () => {
    const result = buildProLeaguePreparation([
      core("stale-signal", "Earth", {
        performanceProfiles: [
          profile("horse", 1_600, "winning_range", 12, "stale"),
        ],
      }),
    ]);

    expect(result.overallPowerPool[0]).toMatchObject({
      coreId: "stale-signal",
      powerTier: "unproven",
      evidenceFreshness: "stale",
      dataCurrentThrough: "2026-08-19T00:00:00.000Z",
    });
  });

  it("separates structural readiness from the need to improve power depth", () => {
    const pool: ProLeaguePreparationCore[] = [];
    let sequence = 0;
    for (const element of ["Metal", "Fire", "Earth", "Water"] as const) {
      for (let index = 0; index < 7; index += 1) {
        sequence += 1;
        pool.push(
          core(`${element}-${index}`, element, {
            sex: sequence <= 8 ? "female" : "male",
            fNumber: sequence <= 2 ? 15 + sequence : 11,
          }),
        );
      }
    }

    const result = buildProLeaguePreparation(pool);

    expect(result.structuralPoolReady).toBe(true);
    expect(
      result.elements.every(
        ({ breedingPriority }) => breedingPriority === "quality",
      ),
    ).toBe(true);
    expect(
      result.elements.every(({ powerDepthGap }) => powerDepthGap === 1),
    ).toBe(true);
  });

  it("keeps female outcomes non-targetable and uses the parent-sum threshold for above F15", () => {
    const result = buildProLeaguePreparation([core("one", "Fire")]);

    expect(result.breeding.femaleOutcomeTargetable).toBe(false);
    expect(result.breeding.minimumParentFSumForAboveF15).toBe(16);
    expect(result.breeding.genesisMintExcluded).toBe(true);
    expect(result.breeding.qualityObjective).toBe("elite_all_rounder_upside");
  });
});
