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
        observationsToMinimum: 6,
        recommendedInitialProbeSize: 3,
        guidance: "continue_targeted_probe",
        actionable: true,
        automaticEntryAllowed: false,
        automaticStopAllowed: false,
      }),
    );
  });

  it("keeps the ten-race minimum as a review boundary only", () => {
    const [nine, ten] = buildDiscoveryProbePlan([
      candidate({ coreId: "nine", coreName: "Nine", directRaceCount: 9 }),
      candidate({ coreId: "ten", coreName: "Ten", directRaceCount: 10 }),
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

  it("keeps mode and exact distance candidates distinct", () => {
    const plan = buildDiscoveryProbePlan([
      candidate(),
      candidate({ mode: "car" }),
      candidate({ distanceMetres: 1600 }),
    ]);

    expect(plan).toHaveLength(3);
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

  it("rejects fabricated lineage samples", () => {
    expect(() =>
      buildDiscoveryProbePlan([
        candidate({
          lineageRelationship: null,
          lineageRaceCount: 2,
        }),
      ]),
    ).toThrow("requires a lineage relationship");
  });
});
