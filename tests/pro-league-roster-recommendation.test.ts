import { describe, expect, it } from "vitest";

import type {
  ProLeagueExactFormatEvidence,
  ProLeagueMatchupCore,
  ProLeagueMatchupVault,
} from "@/domain/pro-league-matchup";
import { buildProLeagueDraftLineupRecommendation } from "@/domain/pro-league-lineup-recommendation";
import { buildProLeagueDraftRosterRecommendation } from "@/domain/pro-league-roster-recommendation";
import type { ActiveProLeagueEvidenceGeneration } from "@/lib/neon-pro-league-evidence-generation-repository";

const generation: ActiveProLeagueEvidenceGeneration = {
  generationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  raceDatasetVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  sourceVersionSetSha256: "1".repeat(64),
  evidenceCutoffAt: "2026-08-31T00:00:00.000Z",
  inputObservationCount: 1_000,
  acceptedEntryCount: 900,
  nonBikeEntryCount: 10,
  missingFormatEntryCount: 20,
  unsupportedFormatEntryCount: 30,
  unpublishedCellEntryCount: 40,
  unbenchmarkedEntryCount: 0,
  benchmarkCount: 1,
  profileCount: 30,
  payloadSha256: "2".repeat(64),
  publishedAt: "2026-08-31T00:01:00.000Z",
};

function evidence(
  assessment: ProLeagueExactFormatEvidence["benchmarkAssessment"],
  overrides: Partial<ProLeagueExactFormatEvidence> &
    Readonly<{
      medianMilliseconds?: number;
      standardDeviationMilliseconds?: number;
      winCount?: number;
      topThreeCount?: number;
    }> = {},
): ProLeagueExactFormatEvidence {
  const raceCount = overrides.raceCount ?? 12;
  const defaultMedian = {
    winning_range: 49_000,
    top_three_range: 54_000,
    outside_top_three_range: 58_000,
  }[assessment];
  const medianMilliseconds = overrides.medianMilliseconds ?? defaultMedian;
  const standardDeviationMilliseconds =
    overrides.standardDeviationMilliseconds ?? 600;
  return {
    raceType: "1v1",
    distanceMetres: 1_000,
    raceCount,
    sampleStatus: "minimally_analytical",
    freshness: "current",
    dataCurrentThrough: "2026-08-28T00:00:00.000Z",
    benchmarkAssessment: assessment,
    elapsedTime: {
      bestMilliseconds: 45_000,
      medianMilliseconds,
      trimmedMeanMilliseconds: medianMilliseconds + 500,
      standardDeviationMilliseconds,
      interquartileRangeMilliseconds: 800,
    },
    speed: {
      bestMetresPerSecond: 22.222,
      medianMetresPerSecond:
        Math.round((1_000 / (medianMilliseconds / 1_000)) * 1_000) / 1_000,
    },
    populationBenchmark: {
      dataCurrentThrough: "2026-08-28T00:00:00.000Z",
      raceEntryCount: 1_000,
      coreCount: 300,
      winningEntryCount: 100,
      topThreeEntryCount: 300,
      winningP25Milliseconds: 48_000,
      winningMedianMilliseconds: 50_000,
      winningP75Milliseconds: 52_000,
      winningStandardDeviationMilliseconds: 1_200,
      winningInterquartileRangeMilliseconds: 4_000,
      topThreeP25Milliseconds: 53_000,
      topThreeMedianMilliseconds: 55_000,
      topThreeP75Milliseconds: 57_000,
      topThreeStandardDeviationMilliseconds: 1_400,
      topThreeInterquartileRangeMilliseconds: 4_000,
    },
    supportingEvidence: {
      outcomes: {
        status: "available",
        winCount: overrides.winCount ?? 2,
        topThreeCount: overrides.topThreeCount ?? 5,
      },
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
      oppositionAdjustedStars: {
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
      strongOpposition: {
        status: "unavailable",
        raceCount: 0,
        winCount: 0,
        topThreeCount: 0,
      },
    },
    ...overrides,
  };
}

function core(
  index: number,
  overrides: Partial<ProLeagueMatchupCore> = {},
): ProLeagueMatchupCore {
  return {
    coreId: `core-${String(index).padStart(2, "0")}`,
    displayName: `Core ${index}`,
    element: "Water",
    coreClass: "Morphed",
    sex: "female",
    fNumber: 16,
    rosterStatus: "not_rostered",
    exactFormatEvidence: [evidence("winning_range")],
    ...overrides,
  };
}

function recommend(
  cores: readonly ProLeagueMatchupCore[],
  maximumSearchNodes = 1_000_000,
) {
  const vault: ProLeagueMatchupVault = {
    vaultId: "my-vault",
    displayName: "My Vault",
    cores,
  };
  return buildProLeagueDraftRosterRecommendation({
    vault,
    generation: { ...generation, profileCount: cores.length },
    rosterVersionId: "draft-v1",
    versionNumber: 1,
    maximumSearchNodes,
  });
}

describe("Pro League draft roster recommendation", () => {
  it("ranks intrinsic exact-format performance ahead of raw outcomes", () => {
    const result = recommend([
      ...Array.from({ length: 12 }, (_, index) => core(index)),
      core(12, {
        exactFormatEvidence: [
          evidence("winning_range", {
            medianMilliseconds: 50_000,
            standardDeviationMilliseconds: 900,
            winCount: 12,
            topThreeCount: 12,
          }),
        ],
      }),
      core(13, {
        exactFormatEvidence: [
          evidence("winning_range", {
            medianMilliseconds: 48_000,
            standardDeviationMilliseconds: 400,
            winCount: 1,
            topThreeCount: 2,
          }),
        ],
      }),
    ]);

    expect(result.candidates[0]!.core.coreId).toBe("core-13");
    expect(result.candidates[0]!.supportingWinCount).toBe(1);
    expect(result.selectionMethod.resultEvidenceRole).toBe(
      "supporting_only_not_ranked",
    );
  });

  it("constructs the largest quality-first roster that satisfies every rule", () => {
    const metal = Array.from({ length: 9 }, (_, index) =>
      core(index, { element: "Metal", sex: "male" }),
    );
    const water = Array.from({ length: 21 }, (_, offset) =>
      core(offset + 9, {
        sex: offset < 7 ? "male" : "female",
      }),
    );
    const result = recommend([...metal, ...water]);

    expect(result.search).toMatchObject({
      status: "constructed",
      targetSize: 25,
    });
    expect(result.draftRoster?.audit).toMatchObject({
      readiness: "compliant",
      selectedCoreCount: 25,
      femaleCount: 11,
      aboveF15Count: 25,
    });
    expect(result.draftRoster!.audit.elementCounts.Metal).toBe(7);
  });

  it("marks the best-owned population-weak cell provisional and exposes the gap", () => {
    const result = recommend(
      Array.from({ length: 12 }, (_, index) =>
        core(index, {
          exactFormatEvidence: [evidence("outside_top_three_range")],
        }),
      ),
    );

    expect(result.draftRoster?.members[0]).toMatchObject({
      role: "structural_coverage",
      evidence: { confidence: "limited" },
    });
    expect(result.candidates[0]).toMatchObject({
      selectionStatus: "population_weak_provisional",
      provisional: true,
    });
    expect(
      result.coverageGaps.find(
        (gap) => gap.raceType === "1v1" && gap.distanceMetres === 1_000,
      ),
    ).toMatchObject({ status: "best_available_but_weak" });
  });

  it("does not rank hypothesis-only evidence", () => {
    const result = recommend([
      ...Array.from({ length: 12 }, (_, index) => core(index)),
      core(20, {
        exactFormatEvidence: [
          evidence("winning_range", {
            raceCount: 3,
            sampleStatus: "hypothesis_only",
            winCount: 3,
            topThreeCount: 3,
          }),
        ],
      }),
    ]);

    const candidate = result.candidates.find(
      ({ core: value }) => value.coreId === "core-20",
    )!;
    expect(candidate).toMatchObject({
      selectionStatus: "unproven",
      qualityVector: { exactFormatCells: 0, acceptedRaceCount: 0 },
      cells: [{ evidenceUse: "hypothesis_only" }],
    });
  });

  it("returns no draft when the owned pool cannot satisfy the female rule", () => {
    const result = recommend(
      Array.from({ length: 12 }, (_, index) => core(index, { sex: "male" })),
    );

    expect(result.draftRoster).toBeNull();
    expect(result.search.status).toBe("no_rule_valid_roster");
  });

  it("fails closed when the bounded search cannot finish", () => {
    const result = recommend(
      Array.from({ length: 25 }, (_, index) => core(index)),
      1,
    );

    expect(result.draftRoster).toBeNull();
    expect(result.search).toMatchObject({
      status: "search_bound_reached",
      maximumNodeCount: 1,
    });
  });

  it("rejects evidence that exceeds the generation cutoff", () => {
    expect(() =>
      recommend([
        core(1, {
          exactFormatEvidence: [
            evidence("winning_range", {
              dataCurrentThrough: "2026-09-01T00:00:00.000Z",
            }),
          ],
        }),
      ]),
    ).toThrow("exceeds the active generation cutoff");
  });

  it("rejects invalid Core metadata and generation digests at the domain edge", () => {
    expect(() => recommend([core(1, { fNumber: 0 })])).toThrow(
      "metadata is invalid",
    );

    expect(() =>
      buildProLeagueDraftRosterRecommendation({
        vault: {
          vaultId: "my-vault",
          displayName: "My Vault",
          cores: Array.from({ length: 12 }, (_, index) => core(index)),
        },
        generation: { ...generation, payloadSha256: "invalid" },
        rosterVersionId: "draft-v1",
        versionNumber: 1,
      }),
    ).toThrow("generation digest is invalid");
  });
});

describe("Pro League draft lineup recommendation", () => {
  it("maps all 168 lines through exact-cell bulk assignments", () => {
    const roster = recommend(
      Array.from({ length: 12 }, (_, index) => core(index)),
    );
    const result = buildProLeagueDraftLineupRecommendation({
      roster,
      lineupVersionId: "lineup-draft-v1",
      versionNumber: 1,
    });

    expect(result.maps).toHaveLength(4);
    expect(result.lineup.maps.flatMap(({ entries }) => entries)).toHaveLength(
      168,
    );
    expect(result.totals).toMatchObject({
      lineCount: 168,
      first16LineCount: 64,
    });
    expect(result.totals.bulkAssignmentCount).toBeLessThan(168);
    expect(
      result.assignmentCommands.every(
        ({ scope }) => scope === "same_type_and_distance",
      ),
    ).toBe(true);
    expect(
      new Set(
        result.maps
          .flatMap(({ lines }) => lines)
          .filter(
            ({ evidenceStatus }) =>
              evidenceStatus === "no_exact_format_evidence",
          )
          .map(({ coreId }) => coreId),
      ).size,
    ).toBeGreaterThan(1);
    for (const map of result.maps) {
      const cellAssignments = new Map<string, string>();
      for (const line of map.lines) {
        const cell = `${line.raceType}:${line.distanceMetres}`;
        expect(cellAssignments.get(cell) ?? line.coreId).toBe(line.coreId);
        cellAssignments.set(cell, line.coreId);
      }
    }
  });

  it("maps a cell to faster intrinsic evidence despite fewer raw wins", () => {
    const roster = recommend([
      core(0, {
        exactFormatEvidence: [
          evidence("winning_range", {
            medianMilliseconds: 50_000,
            standardDeviationMilliseconds: 900,
            winCount: 12,
            topThreeCount: 12,
          }),
        ],
      }),
      core(1, {
        exactFormatEvidence: [
          evidence("winning_range", {
            medianMilliseconds: 48_000,
            standardDeviationMilliseconds: 400,
            winCount: 1,
            topThreeCount: 2,
          }),
        ],
      }),
      ...Array.from({ length: 10 }, (_, index) => core(index + 2)),
    ]);
    const result = buildProLeagueDraftLineupRecommendation({
      roster,
      lineupVersionId: "lineup-draft-v1",
      versionNumber: 1,
    });
    const line = result.maps[0]!.lines.find(
      (value) => value.raceType === "1v1" && value.distanceMetres === 1_000,
    );

    expect(line).toMatchObject({
      coreId: "core-01",
      evidenceStatus: "winning_range",
      provisional: false,
      evidence: { supportingOutcomes: { winCount: 1 } },
    });
    expect(result.selectionMethod.resultEvidenceRole).toBe(
      "supporting_only_not_ranked",
    );
  });

  it("keeps weak and missing cells provisional instead of inventing confidence", () => {
    const roster = recommend(
      Array.from({ length: 12 }, (_, index) =>
        core(index, {
          exactFormatEvidence: [evidence("outside_top_three_range")],
        }),
      ),
    );
    const result = buildProLeagueDraftLineupRecommendation({
      roster,
      lineupVersionId: "lineup-draft-v1",
      versionNumber: 1,
    });
    const weak = result.maps[0]!.lines.find(
      (value) => value.raceType === "1v1" && value.distanceMetres === 1_000,
    );
    const missing = result.maps[0]!.lines.find(
      (value) =>
        value.raceType === "6 gate madness" && value.distanceMetres === 1_000,
    );

    expect(weak).toMatchObject({
      evidenceStatus: "population_weak_provisional",
      provisional: true,
    });
    expect(missing).toMatchObject({
      evidenceStatus: "no_exact_format_evidence",
      provisional: true,
      evidence: null,
    });
    expect(result.totals.provisionalLineCount).toBeGreaterThan(0);
  });

  it("rejects a lineup when no compliant draft roster exists", () => {
    const roster = recommend(
      Array.from({ length: 12 }, (_, index) => core(index, { sex: "male" })),
    );

    expect(() =>
      buildProLeagueDraftLineupRecommendation({
        roster,
        lineupVersionId: "lineup-draft-v1",
        versionNumber: 1,
      }),
    ).toThrow("requires a compliant draft roster");
  });
});
