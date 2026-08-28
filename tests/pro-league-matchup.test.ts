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
): ProLeagueExactFormatEvidence {
  return {
    raceType,
    distanceMetres,
    raceCount,
    sampleStatus: "minimally_analytical",
    freshness: "current",
    dataCurrentThrough: "2026-08-28T00:00:00.000Z",
    benchmarkAssessment,
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
      mapControl: "ours",
      gateAllocation: "equal_halves",
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
    });
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

  it("leaves map selection to the opposition when our Vault is away", () => {
    const result = buildProLeagueMatchupAnalysis({
      ourVault: vault("ours", []),
      oppositionVault: vault("theirs", []),
      homeVaultId: "theirs",
    });

    expect(result.mapControl).toBe("opposition");
    expect(
      result.maps.every(({ selectionRank }) => selectionRank === null),
    ).toBe(true);
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
});
