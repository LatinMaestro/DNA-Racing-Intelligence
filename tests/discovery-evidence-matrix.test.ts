import { describe, expect, it } from "vitest";

import {
  buildDiscoveryEvidenceMatrix,
  type DiscoveryEvidenceCellInput,
} from "@/domain/discovery-evidence-matrix";

function cell(
  overrides: Partial<DiscoveryEvidenceCellInput> = {},
): DiscoveryEvidenceCellInput {
  return {
    coreId: "core-a",
    mode: "bike",
    distanceMetres: 1400,
    directRaceCount: 4,
    directBestTimeMs: 60_000,
    directMedianTimeMs: 61_000,
    directSuccessfulTimePercentile: 80,
    lineageEvidence: [
      {
        sourceCoreId: "parent-a",
        relationship: "parent",
        raceCount: 12,
        successfulTimePercentile: 75,
        evidenceCutoff: "2026-07-15T00:00:00Z",
        resolved: true,
      },
    ],
    starEvidence: {
      dataStatus: "complete",
      goldEligibleRaces: 4,
      goldAssignmentOpportunities: 3,
      goldReceived: 1,
      blueAssignmentOpportunities: 4,
      blueReceived: 1,
      earlyStrongFieldStars: 1,
      weakFieldEligibleNoStarCount: 1,
    },
    maidenEligible: true,
    upcomingTournamentRelevance: "priority",
    dataCurrentThrough: "2026-07-20T00:00:00Z",
    lastImported: "2026-07-21T00:00:00Z",
    freshnessState: "current",
    ...overrides,
  };
}

describe("discovery evidence matrix", () => {
  it("keeps mode and exact distance cells separate and deterministic", () => {
    const matrix = buildDiscoveryEvidenceMatrix([
      cell({ mode: "horse", distanceMetres: 1600 }),
      cell({ mode: "bike", distanceMetres: 1600 }),
      cell(),
    ]);

    expect(
      matrix.cells.map((item) => [item.mode, item.distanceMetres]),
    ).toEqual([
      ["bike", 1400],
      ["bike", 1600],
      ["horse", 1600],
    ]);
    expect(matrix.cellCount).toBe(3);
    expect(matrix.coreCount).toBe(1);
  });

  it("enforces the ten-race minimum without claiming proof", () => {
    const matrix = buildDiscoveryEvidenceMatrix([
      cell({ directRaceCount: 9 }),
      cell({
        distanceMetres: 1600,
        directRaceCount: 10,
      }),
    ]);

    expect(matrix.cells[0]).toEqual(
      expect.objectContaining({
        sampleStatus: "hypothesis_only",
        additionalRacesToMinimum: 1,
      }),
    );
    expect(matrix.cells[1]).toEqual(
      expect.objectContaining({
        sampleStatus: "minimally_analytical",
        additionalRacesToMinimum: 0,
      }),
    );
  });

  it("preserves the confirmed lineage evidence priority", () => {
    const matrix = buildDiscoveryEvidenceMatrix([
      cell({
        lineageEvidence: [
          {
            sourceCoreId: "wide-a",
            relationship: "wider_lineage",
            raceCount: 20,
            successfulTimePercentile: 90,
            evidenceCutoff: "2026-07-10T00:00:00Z",
            resolved: true,
          },
          {
            sourceCoreId: "parent-a",
            relationship: "parent",
            raceCount: 3,
            successfulTimePercentile: 60,
            evidenceCutoff: "2026-07-10T00:00:00Z",
            resolved: true,
          },
          {
            sourceCoreId: "sibling-a",
            relationship: "full_sibling",
            raceCount: 8,
            successfulTimePercentile: 70,
            evidenceCutoff: "2026-07-10T00:00:00Z",
            resolved: true,
          },
        ],
      }),
    ]);

    expect(
      matrix.cells[0]?.lineageEvidence.map((item) => item.relationship),
    ).toEqual(["parent", "full_sibling", "wider_lineage"]);
  });

  it("does not permit no-star evidence to create an automatic stop", () => {
    const matrix = buildDiscoveryEvidenceMatrix([
      cell({
        starEvidence: {
          dataStatus: "complete",
          goldEligibleRaces: 4,
          goldAssignmentOpportunities: 4,
          goldReceived: 0,
          blueAssignmentOpportunities: 4,
          blueReceived: 0,
          earlyStrongFieldStars: 0,
          weakFieldEligibleNoStarCount: 4,
        },
      }),
    ]);

    expect(matrix.cells[0]).toEqual(
      expect.objectContaining({
        automaticStopAllowed: false,
        actionableRecommendationAllowed: false,
        compositeQualityScoreAvailable: false,
      }),
    );
  });

  it("shows absent direct evidence without fabricating zero-time metrics", () => {
    const matrix = buildDiscoveryEvidenceMatrix([
      cell({
        directRaceCount: 0,
        directBestTimeMs: null,
        directMedianTimeMs: null,
        directSuccessfulTimePercentile: null,
      }),
    ]);

    expect(matrix.cells[0]).toEqual(
      expect.objectContaining({
        sampleStatus: "no_direct_evidence",
        directBestTimeMs: null,
        directMedianTimeMs: null,
      }),
    );
    expect(matrix.cells[0]?.warnings).toContain("DIRECT_TIME_UNAVAILABLE");
  });

  it("rejects future lineage evidence to preserve chronological integrity", () => {
    expect(() =>
      buildDiscoveryEvidenceMatrix([
        cell({
          lineageEvidence: [
            {
              sourceCoreId: "parent-a",
              relationship: "parent",
              raceCount: 20,
              successfulTimePercentile: 90,
              evidenceCutoff: "2026-07-21T00:00:00Z",
              resolved: true,
            },
          ],
        }),
      ]),
    ).toThrow("cannot extend beyond the cell data cutoff");
  });

  it("rejects repeated lineage support from the same relationship and core", () => {
    expect(() =>
      buildDiscoveryEvidenceMatrix([
        cell({
          lineageEvidence: [
            {
              sourceCoreId: "parent-a",
              relationship: "parent",
              raceCount: 2,
              successfulTimePercentile: 50,
              evidenceCutoff: "2026-07-10T00:00:00Z",
              resolved: true,
            },
            {
              sourceCoreId: "parent-a",
              relationship: "parent",
              raceCount: 4,
              successfulTimePercentile: 60,
              evidenceCutoff: "2026-07-15T00:00:00Z",
              resolved: true,
            },
          ],
        }),
      ]),
    ).toThrow("lineage evidence must be unique");
  });

  it("validates star eligibility and assignment denominators", () => {
    expect(() =>
      buildDiscoveryEvidenceMatrix([
        cell({
          starEvidence: {
            dataStatus: "complete",
            goldEligibleRaces: 2,
            goldAssignmentOpportunities: 3,
            goldReceived: 1,
            blueAssignmentOpportunities: 4,
            blueReceived: 1,
            earlyStrongFieldStars: 1,
            weakFieldEligibleNoStarCount: 1,
          },
        }),
      ]),
    ).toThrow("star denominators are inconsistent");
  });

  it("retains unresolved, stale and incomplete evidence as warnings", () => {
    const matrix = buildDiscoveryEvidenceMatrix([
      cell({
        lineageEvidence: [
          {
            sourceCoreId: null,
            relationship: "grandparent",
            raceCount: 0,
            successfulTimePercentile: null,
            evidenceCutoff: "2026-07-10T00:00:00Z",
            resolved: false,
          },
        ],
        starEvidence: {
          dataStatus: "partial",
          goldEligibleRaces: 0,
          goldAssignmentOpportunities: 0,
          goldReceived: 0,
          blueAssignmentOpportunities: 0,
          blueReceived: 0,
          earlyStrongFieldStars: 0,
          weakFieldEligibleNoStarCount: 0,
        },
        freshnessState: "stale",
      }),
    ]);

    expect(matrix.cells[0]?.warnings).toEqual(
      expect.arrayContaining([
        "LINEAGE_EVIDENCE_UNRESOLVED",
        "STAR_EVIDENCE_INCOMPLETE",
        "IMPORTED_DATA_STALE",
        "GATE_C_NOT_PASSED",
      ]),
    );
  });

  it("fails closed on duplicate cells and invalid runtime enums", () => {
    expect(() => buildDiscoveryEvidenceMatrix([cell(), cell()])).toThrow(
      "unique by core, mode and exact distance",
    );

    expect(() =>
      buildDiscoveryEvidenceMatrix([
        cell({ mode: "plane" as DiscoveryEvidenceCellInput["mode"] }),
      ]),
    ).toThrow("mode is invalid");
  });
});
