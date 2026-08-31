import { describe, expect, it } from "vitest";

import {
  buildDiscoveryProbePlan,
  type DiscoveryProbeCandidateInput,
} from "@/domain/discovery-probe-plan";

function candidate(
  overrides: Partial<DiscoveryProbeCandidateInput> = {},
): DiscoveryProbeCandidateInput {
  return {
    coreId: "core-a",
    coreName: "Synthetic Core",
    mode: "bike",
    distanceMetres: 1400,
    directRaceCount: 4,
    directTimeEvidence: {
      bestMilliseconds: 90_000,
      medianMilliseconds: 91_500,
      meanMilliseconds: 91_750,
      standardDeviationMilliseconds: 1_100,
    },
    starEvidence: {
      completeStarDataRaceCount: 3,
      goldEligibleRaceCount: 3,
      goldAssignmentOpportunityCount: 2,
      goldReceivedCount: 1,
      blueAssignmentOpportunityCount: 3,
      blueReceivedCount: 1,
    },
    lineageRelationship: "parent",
    lineageResolved: true,
    lineageRaceCount: 12,
    tournamentRelevance: "priority",
    maidenState: "not_eligible",
    freshness: "current",
    dataCurrentThrough: "2026-07-20T00:00:00Z",
    ...overrides,
  };
}

describe("discovery probe plan", () => {
  it("orders strategic evidence gaps and recommends a bounded owner probe", () => {
    const plan = buildDiscoveryProbePlan([
      candidate({
        coreId: "ordinary",
        coreName: "Ordinary",
        tournamentRelevance: "none",
      }),
      candidate({ coreId: "priority", coreName: "Priority" }),
    ]);

    expect(plan.map(({ coreId }) => coreId)).toEqual(["priority", "ordinary"]);
    expect(plan[0]).toEqual(
      expect.objectContaining({
        reviewPriority: "high",
        confidence: "moderate",
        observationsToMinimum: 6,
        recommendedInitialProbeSize: 3,
        guidance: "continue_targeted_probe",
        actionable: true,
        automaticEntryAllowed: false,
        automaticStopAllowed: false,
      }),
    );
  });

  it("preserves direct time and eligibility-aware star evidence", () => {
    const [result] = buildDiscoveryProbePlan([candidate()]);

    expect(result?.directTimeEvidence).toEqual({
      bestMilliseconds: 90_000,
      medianMilliseconds: 91_500,
      meanMilliseconds: 91_750,
      standardDeviationMilliseconds: 1_100,
    });
    expect(result?.starEvidence).toEqual({
      completeStarDataRaceCount: 3,
      goldEligibleRaceCount: 3,
      goldAssignmentOpportunityCount: 2,
      goldReceivedCount: 1,
      blueAssignmentOpportunityCount: 3,
      blueReceivedCount: 1,
      oppositionAdjusted: null,
    });
    expect(result?.warnings).not.toContain("STAR_EVIDENCE_UNAVAILABLE");
    expect(result?.warnings).toContain("STAR_OPPOSITION_QUALITY_UNAVAILABLE");
  });

  it("keeps the ten-race minimum as a review boundary only", () => {
    const [nine, ten] = buildDiscoveryProbePlan([
      candidate({ coreId: "nine", coreName: "Nine", directRaceCount: 9 }),
      candidate({
        coreId: "ten",
        coreName: "Ten",
        directRaceCount: 10,
        starEvidence: {
          completeStarDataRaceCount: 8,
          goldEligibleRaceCount: 8,
          goldAssignmentOpportunityCount: 7,
          goldReceivedCount: 3,
          blueAssignmentOpportunityCount: 8,
          blueReceivedCount: 2,
        },
      }),
    ]);

    expect(nine).toEqual(
      expect.objectContaining({
        observationsToMinimum: 1,
        recommendedInitialProbeSize: 1,
        guidance: "continue_targeted_probe",
        evidencePurpose: "complete_direct_sample",
      }),
    );
    expect(ten).toEqual(
      expect.objectContaining({
        observationsToMinimum: 0,
        recommendedInitialProbeSize: 0,
        guidance: "review_minimum_sample",
        evidencePurpose: "validate_lineage_hypothesis",
        confidence: "high",
        actionable: false,
      }),
    );
  });

  it("flags Maiden commitment context without blocking an ordinary-race probe", () => {
    const [result] = buildDiscoveryProbePlan([
      candidate({ maidenState: "eligible" }),
    ]);

    expect(result?.warnings).toContain("MAIDEN_COMMITMENT_REVIEW_REQUIRED");
    expect(result?.maidenState).toBe("eligible");
    expect(result?.actionable).toBe(true);
  });

  it("defers stale, unknown-cutoff and unresolved-Maiden evidence", () => {
    const plan = buildDiscoveryProbePlan([
      candidate({
        freshness: "stale",
        dataCurrentThrough: null,
        maidenState: "unknown",
      }),
    ]);

    expect(plan[0]).toEqual(
      expect.objectContaining({
        reviewPriority: "defer",
        confidence: "low",
        recommendedInitialProbeSize: 0,
        guidance: "defer_stale_or_unresolved",
        actionable: false,
        warnings: expect.arrayContaining([
          "DATA_CUTOFF_UNKNOWN",
          "DATA_STALE",
          "MAIDEN_STATE_UNRESOLVED",
        ]),
      }),
    );
  });

  it("does not treat unresolved lineage as supporting evidence", () => {
    const [result] = buildDiscoveryProbePlan([
      candidate({
        lineageRelationship: "parent",
        lineageResolved: false,
        lineageRaceCount: 0,
        tournamentRelevance: "none",
      }),
    ]);

    expect(result?.warnings).toEqual(
      expect.arrayContaining([
        "LINEAGE_UNRESOLVED",
        "LINEAGE_SAMPLE_UNAVAILABLE",
      ]),
    );
    expect(result?.reviewPriority).toBe("low");
  });

  it("keeps zero-direct lineage hypotheses low confidence", () => {
    const [result] = buildDiscoveryProbePlan([
      candidate({
        directRaceCount: 0,
        directTimeEvidence: null,
        starEvidence: null,
        lineageRelationship: "full_sibling",
        lineageRaceCount: 18,
      }),
    ]);

    expect(result).toEqual(
      expect.objectContaining({
        confidence: "low",
        directTimeEvidence: null,
        starEvidence: null,
        recommendedInitialProbeSize: 3,
      }),
    );
  });

  it("keeps mode and exact distance candidates distinct", () => {
    const plan = buildDiscoveryProbePlan([
      candidate(),
      candidate({ mode: "car" }),
      candidate({ distanceMetres: 1600 }),
    ]);

    expect(plan).toHaveLength(3);
  });

  it("raises an under-tested strong-field star prospect without using conversion", () => {
    const [result] = buildDiscoveryProbePlan([
      candidate({
        tournamentRelevance: "none",
        lineageRelationship: null,
        lineageRaceCount: 0,
        starEvidence: {
          completeStarDataRaceCount: 4,
          goldEligibleRaceCount: 4,
          goldAssignmentOpportunityCount: 4,
          goldReceivedCount: 1,
          blueAssignmentOpportunityCount: 4,
          blueReceivedCount: 1,
          oppositionAdjusted: {
            support: "strong_support",
            qualityKnownRaceCount: 2,
            strongFieldStarCount: 2,
            eliteOpponentStarCount: 1,
            weakFieldNoStarOpportunityCount: 0,
            rawConversionUsedForPriority: false,
          },
        },
      }),
    ]);

    expect(result?.reviewPriority).toBe("high");
    expect(result?.starEvidence?.oppositionAdjusted).toMatchObject({
      support: "strong_support",
      eliteOpponentStarCount: 1,
      rawConversionUsedForPriority: false,
    });
    expect(result?.warnings).not.toContain(
      "STAR_OPPOSITION_QUALITY_UNAVAILABLE",
    );
  });

  it("rejects duplicate cells and invalid runtime values", () => {
    expect(() => buildDiscoveryProbePlan([candidate(), candidate()])).toThrow(
      "unique by core, mode and exact distance",
    );

    expect(() =>
      buildDiscoveryProbePlan([
        candidate({
          mode: "plane" as DiscoveryProbeCandidateInput["mode"],
        }),
      ]),
    ).toThrow("mode is invalid");
  });

  it("rejects fabricated lineage, direct-time and star samples", () => {
    expect(() =>
      buildDiscoveryProbePlan([
        candidate({
          lineageRelationship: null,
          lineageRaceCount: 2,
        }),
      ]),
    ).toThrow("requires a lineage relationship");

    expect(() =>
      buildDiscoveryProbePlan([
        candidate({
          directRaceCount: 0,
          starEvidence: null,
        }),
      ]),
    ).toThrow("Direct time evidence requires direct races");

    expect(() =>
      buildDiscoveryProbePlan([
        candidate({
          starEvidence: {
            completeStarDataRaceCount: 4,
            goldEligibleRaceCount: 2,
            goldAssignmentOpportunityCount: 3,
            goldReceivedCount: 1,
            blueAssignmentOpportunityCount: 4,
            blueReceivedCount: 1,
          },
        }),
      ]),
    ).toThrow("Star evidence is inconsistent");
  });
});
