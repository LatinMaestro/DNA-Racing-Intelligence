import { describe, expect, it } from "vitest";

import {
  buildProLeagueMatchupAnalysis,
  type ProLeagueExactFormatEvidence,
  type ProLeagueMatchupCore,
  type ProLeagueMatchupVault,
} from "@/domain/pro-league-matchup";

function evidence(
  raceType: string,
  distanceMetres: number,
  benchmarkAssessment: ProLeagueExactFormatEvidence["benchmarkAssessment"],
  raceCount = 12,
  overrides: Readonly<{
    medianMilliseconds?: number;
    trimmedMeanMilliseconds?: number;
    standardDeviationMilliseconds?: number;
    interquartileRangeMilliseconds?: number;
    winCount?: number;
    topThreeCount?: number;
    strongOppositionStatus?: "available" | "unavailable";
  }> = {},
): ProLeagueExactFormatEvidence {
  const defaults = {
    winning_range: { best: 45_000, median: 49_000, trimmedMean: 51_000 },
    top_three_range: { best: 50_000, median: 54_000, trimmedMean: 56_000 },
    outside_top_three_range: {
      best: 55_000,
      median: 58_000,
      trimmedMean: 59_000,
    },
  }[benchmarkAssessment];
  const medianMilliseconds = overrides.medianMilliseconds ?? defaults.median;
  const trimmedMeanMilliseconds =
    overrides.trimmedMeanMilliseconds ?? defaults.trimmedMean;
  const winCount = overrides.winCount ?? 2;
  const topThreeCount = overrides.topThreeCount ?? Math.max(winCount, 5);
  const speed = (elapsedMilliseconds: number) =>
    Math.round((distanceMetres / (elapsedMilliseconds / 1_000)) * 1_000) /
    1_000;
  return {
    raceType,
    distanceMetres,
    raceCount,
    sampleStatus: "minimally_analytical",
    freshness: "current",
    dataCurrentThrough: "2026-08-28T00:00:00.000Z",
    benchmarkAssessment,
    elapsedTime: {
      bestMilliseconds: defaults.best,
      medianMilliseconds,
      trimmedMeanMilliseconds,
      standardDeviationMilliseconds:
        overrides.standardDeviationMilliseconds ?? 600,
      interquartileRangeMilliseconds:
        overrides.interquartileRangeMilliseconds ?? 800,
    },
    speed: {
      bestMetresPerSecond: speed(defaults.best),
      medianMetresPerSecond: speed(medianMilliseconds),
    },
    populationBenchmark: {
      raceEntryCount: 1_000,
      winningEntryCount: 100,
      topThreeEntryCount: 300,
      winningMedianMilliseconds: 50_000,
      winningP75Milliseconds: 52_000,
      topThreeMedianMilliseconds: 55_000,
      topThreeP75Milliseconds: 57_000,
    },
    supportingEvidence: {
      outcomes: { status: "available", winCount, topThreeCount },
      goldStar: {
        status: "available",
        assignedCount: 1,
        eligibleRaceCount: raceCount,
      },
      blueStar: {
        status: "available",
        assignedCount: 1,
        opportunityCount: raceCount,
      },
      strongOpposition:
        overrides.strongOppositionStatus === "available"
          ? {
              status: "available",
              raceCount: 4,
              winCount: 1,
              topThreeCount: 2,
            }
          : {
              status: "unavailable",
              raceCount: 0,
              winCount: 0,
              topThreeCount: 0,
            },
    },
  };
}

function core(
  coreId: string,
  exactFormatEvidence: readonly ProLeagueExactFormatEvidence[],
  rosterStatus: ProLeagueMatchupCore["rosterStatus"] = "rostered",
): ProLeagueMatchupCore {
  return {
    coreId,
    displayName: coreId,
    element: "Water",
    coreClass: "Morphed",
    sex: "female",
    fNumber: 16,
    rosterStatus,
    exactFormatEvidence,
  };
}

function vault(
  vaultId: string,
  cores: readonly ProLeagueMatchupCore[],
): ProLeagueMatchupVault {
  return { vaultId, displayName: vaultId, cores };
}

describe("Pro League matchup analysis", () => {
  it("uses equal gate allocation and ranks maps for the home Vault", () => {
    const result = buildProLeagueMatchupAnalysis({
      ourVault: vault("ours", [
        core("our-sprinter", [evidence("1v1", 1_000, "winning_range")]),
      ]),
      oppositionVault: vault("theirs", [
        core("their-sprinter", [
          evidence("1v1", 1_000, "outside_top_three_range"),
        ]),
      ]),
      homeVaultId: "ours",
    });

    const anchor = result.maps.find(({ mapId }) => mapId === "map-1")!;
    const first = anchor.lines[0]!;
    expect(result).toMatchObject({
      mapSelectionRole: "home_first_pick_and_deny",
      thirdMapPolicy: "match_record_required",
      gateAllocation: "equal_halves",
      selectionMethod: {
        primaryEvidence: "exact_format_distance_time_speed_consistency",
        resultEvidenceRole: "supporting_only",
        supportingTieBreak: "strong_opposition_and_stars_only",
        missingOppositionQuality: "unknown_never_favourable",
      },
      substitutionStrategy: {
        annualMaximum: 10,
        principle: "quality_first_preserve_replacements",
      },
    });
    expect(anchor.selectionRank).toBe(1);
    expect(anchor.first16FavouredRaceLines).toBeGreaterThan(0);
    expect(first).toMatchObject({
      totalGateEntries: 2,
      gateEntriesPerVault: 1,
      ourRecommendedCoreId: "our-sprinter",
      oppositionLikelyCoreId: "their-sprinter",
      edge: "favoured",
      ourEvidence: {
        elapsedTime: { medianMilliseconds: 49_000 },
        speed: { medianMetresPerSecond: 20.408 },
      },
    });
  });

  it("prefers faster, steadier exact-format evidence over a higher raw win rate", () => {
    const result = buildProLeagueMatchupAnalysis({
      ourVault: vault("ours", [
        core("high-win-slower", [
          evidence("1v1", 1_000, "winning_range", 12, {
            medianMilliseconds: 50_000,
            trimmedMeanMilliseconds: 52_000,
            standardDeviationMilliseconds: 900,
            interquartileRangeMilliseconds: 1_100,
            winCount: 10,
            topThreeCount: 11,
          }),
        ]),
        core("low-win-faster", [
          evidence("1v1", 1_000, "winning_range", 12, {
            medianMilliseconds: 49_000,
            trimmedMeanMilliseconds: 51_000,
            standardDeviationMilliseconds: 450,
            interquartileRangeMilliseconds: 600,
            winCount: 1,
            topThreeCount: 3,
          }),
        ]),
      ]),
      oppositionVault: vault("theirs", [
        core("opposition", [evidence("1v1", 1_000, "top_three_range")]),
      ]),
      homeVaultId: "ours",
    });

    expect(result.maps[0]!.lines[0]!.ourRecommendedCoreId).toBe(
      "low-win-faster",
    );
  });

  it("uses consistency after equal population band and central time", () => {
    const result = buildProLeagueMatchupAnalysis({
      ourVault: vault("ours", [
        core("variable", [
          evidence("1v1", 1_000, "winning_range", 12, {
            standardDeviationMilliseconds: 1_200,
            interquartileRangeMilliseconds: 1_500,
          }),
        ]),
        core("consistent", [
          evidence("1v1", 1_000, "winning_range", 12, {
            standardDeviationMilliseconds: 350,
            interquartileRangeMilliseconds: 500,
          }),
        ]),
      ]),
      oppositionVault: vault("theirs", []),
      homeVaultId: "ours",
    });

    expect(result.maps[0]!.lines[0]!.ourRecommendedCoreId).toBe("consistent");
  });

  it("uses evidenced strong-opposition results only after intrinsic evidence ties", () => {
    const result = buildProLeagueMatchupAnalysis({
      ourVault: vault("ours", [
        core("unknown-field", [evidence("1v1", 1_000, "winning_range")]),
        core("proven-field", [
          evidence("1v1", 1_000, "winning_range", 12, {
            strongOppositionStatus: "available",
          }),
        ]),
      ]),
      oppositionVault: vault("theirs", []),
      homeVaultId: "ours",
    });

    expect(result.maps[0]!.lines[0]!.ourRecommendedCoreId).toBe("proven-field");
    expect(
      result.maps[0]!.lines[0]!.ourEvidence?.supportingEvidence
        .strongOpposition,
    ).toMatchObject({ status: "available", winCount: 1, topThreeCount: 2 });
  });

  it("does not score incomplete opposition evidence as an advantage", () => {
    const result = buildProLeagueMatchupAnalysis({
      ourVault: vault("ours", [
        core("our-sprinter", [evidence("1v1", 1_000, "winning_range")]),
      ]),
      oppositionVault: vault("theirs", [core("unknown", [])]),
      homeVaultId: "ours",
    });
    const line = result.maps[0]!.lines[0]!;

    expect(line.edge).toBe("unknown");
    expect(line.oppositionLikelyCoreId).toBeNull();
    expect(line.evidenceWarning).toContain("do not score");
  });

  it("ranks the away Vault's second-map options after the home action", () => {
    const result = buildProLeagueMatchupAnalysis({
      ourVault: vault("ours", []),
      oppositionVault: vault("theirs", []),
      homeVaultId: "theirs",
    });

    expect(result.mapSelectionRole).toBe("away_second_pick");
    expect(
      result.maps.map(({ selectionRank }) => selectionRank).sort(),
    ).toEqual([1, 2, 3, 4]);
  });

  it("labels the best owned Core as weak without recommending a roster lock", () => {
    const result = buildProLeagueMatchupAnalysis({
      ourVault: vault("ours", [
        core(
          "best-we-have",
          [evidence("24 gate madness", 2_200, "outside_top_three_range")],
          "not_rostered",
        ),
      ]),
      oppositionVault: vault("theirs", []),
      homeVaultId: "ours",
    });
    const gap = result.coverageGaps.find(
      ({ raceType, distanceMetres }) =>
        raceType === "24 gate madness" && distanceMetres === 2_200,
    )!;

    expect(gap).toMatchObject({
      status: "best_available_but_weak",
      bestAvailableCoreIds: ["best-we-have"],
      bestAvailableRostered: false,
      discoveryPriority: "high",
      rosterAdvice: "do_not_lock_for_gap_alone",
    });
    expect(gap.guidance).toContain("best currently evidenced option");
    expect(gap.guidance).toContain("replacement priority");
  });

  it("routes an unproven exact format to testing or breeding before roster lock", () => {
    const result = buildProLeagueMatchupAnalysis({
      ourVault: vault("ours", [core("unproven", [])]),
      oppositionVault: vault("theirs", []),
      homeVaultId: "ours",
    });
    const gap = result.coverageGaps.find(
      ({ raceType, distanceMetres }) =>
        raceType === "22 gate WTA" && distanceMetres === 1_800,
    )!;

    expect(gap).toMatchObject({
      status: "unproven",
      bestAvailableCoreIds: [],
      discoveryPriority: "high",
      rosterAdvice: "test_before_roster_lock",
    });
    expect(gap.guidance).toContain("before using a roster place");
  });

  it("rejects self-matchups and duplicate Core identities", () => {
    expect(() =>
      buildProLeagueMatchupAnalysis({
        ourVault: vault("same", []),
        oppositionVault: vault("same", []),
        homeVaultId: "same",
      }),
    ).toThrow("two different Vaults");
    expect(() =>
      buildProLeagueMatchupAnalysis({
        ourVault: vault("ours", [core("duplicate", []), core("duplicate", [])]),
        oppositionVault: vault("theirs", []),
        homeVaultId: "ours",
      }),
    ).toThrow("unique per Vault");
  });

  it("rejects invented speed and population labels that disagree with the evidence", () => {
    const invalidSpeed = {
      ...evidence("1v1", 1_000, "winning_range"),
      speed: { bestMetresPerSecond: 999, medianMetresPerSecond: 998 },
    };
    const invalidAssessment = {
      ...evidence("1v1", 1_000, "winning_range"),
      benchmarkAssessment: "outside_top_three_range" as const,
    };

    for (const invalid of [invalidSpeed, invalidAssessment]) {
      expect(() =>
        buildProLeagueMatchupAnalysis({
          ourVault: vault("ours", [core("invalid", [invalid])]),
          oppositionVault: vault("theirs", []),
          homeVaultId: "ours",
        }),
      ).toThrow("exact-format evidence is invalid");
    }
  });
});
