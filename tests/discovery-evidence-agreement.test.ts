import { describe, expect, it } from "vitest";

import {
  assessDiscoveryEvidenceAgreement,
  type DiscoveryEvidenceAgreementInput,
} from "@/domain/discovery-evidence-agreement";

const thresholds = {
  competitiveTimePercentile: 70,
  weakTimePercentile: 30,
  repeatedPositiveStarCount: 2,
  repeatedWeakFieldNoStarCount: 3,
  version: "synthetic-v1",
} as const;

function input(
  overrides: Partial<DiscoveryEvidenceAgreementInput> = {},
): DiscoveryEvidenceAgreementInput {
  return {
    coreId: "core-a",
    mode: "horse",
    distanceMetres: 1600,
    directRaceCount: 8,
    successfulTimePercentile: 75,
    timeEvidenceStatus: "complete",
    goldEligibleRaces: 7,
    goldAssignmentOpportunities: 6,
    goldReceived: 2,
    blueAssignmentOpportunities: 8,
    blueReceived: 1,
    strongFieldStarCount: 2,
    weakFieldEligibleNoStarCount: 0,
    starEvidenceStatus: "complete",
    freshness: "current",
    dataCurrentThrough: "2026-07-20T00:00:00Z",
    lastImported: "2026-07-20T01:00:00Z",
    ...overrides,
  };
}

describe("discovery evidence agreement", () => {
  it("reports positive agreement without confirming quality", () => {
    const result = assessDiscoveryEvidenceAgreement(input(), thresholds);
    expect(result).toEqual(
      expect.objectContaining({
        status: "positive_agreement",
        timeSignal: "positive",
        starSignal: "positive",
        experimental: true,
        actionable: false,
        qualityConfirmed: false,
      }),
    );
  });

  it("keeps repeated weak-field no-star evidence non-dispositive", () => {
    const result = assessDiscoveryEvidenceAgreement(
      input({
        successfulTimePercentile: 20,
        goldReceived: 0,
        blueReceived: 0,
        strongFieldStarCount: 0,
        weakFieldEligibleNoStarCount: 4,
      }),
      thresholds,
    );
    expect(result.status).toBe("negative_agreement_candidate");
    expect(result.warnings).toContain("NO_STAR_NON_DISPOSITIVE");
    expect(result.automaticStopAllowed).toBe(false);
  });

  it("holds weak-time positive-star disagreement for review", () => {
    const result = assessDiscoveryEvidenceAgreement(
      input({ successfulTimePercentile: 20 }),
      thresholds,
    );
    expect(result.status).toBe("time_weak_star_positive_mismatch");
    expect(result.warnings).toContain("TIME_STAR_MISMATCH");
  });

  it("does not treat absent supporting stars as negative evidence", () => {
    const result = assessDiscoveryEvidenceAgreement(
      input({
        goldReceived: 0,
        blueReceived: 0,
        strongFieldStarCount: 0,
      }),
      thresholds,
    );
    expect(result.status).toBe("time_positive_star_neutral");
    expect(result.starSignal).toBe("neutral");
    expect(result.warnings).not.toContain("NO_STAR_NON_DISPOSITIVE");
  });

  it("fails closed on incomplete star evidence", () => {
    const result = assessDiscoveryEvidenceAgreement(
      input({ starEvidenceStatus: "partial" }),
      thresholds,
    );
    expect(result.status).toBe("insufficient_evidence");
    expect(result.warnings).toContain("STAR_EVIDENCE_INCOMPLETE");
  });

  it("fails closed on stale or unknown-cutoff evidence", () => {
    const result = assessDiscoveryEvidenceAgreement(
      input({ freshness: "stale", dataCurrentThrough: null }),
      thresholds,
    );
    expect(result.status).toBe("insufficient_evidence");
    expect(result.warnings).toEqual(
      expect.arrayContaining(["DATA_CUTOFF_UNKNOWN", "DATA_STALE"]),
    );
  });

  it("keeps import time separate and rejects inverted coverage", () => {
    const result = assessDiscoveryEvidenceAgreement(input(), thresholds);
    expect(result.dataCurrentThrough).toBe("2026-07-20T00:00:00.000Z");
    expect(result.lastImported).toBe("2026-07-20T01:00:00.000Z");
    expect(() =>
      assessDiscoveryEvidenceAgreement(
        input({ lastImported: "2026-07-19T23:59:59Z" }),
        thresholds,
      ),
    ).toThrow("cannot precede");
  });

  it("preserves separate Gold and Blue denominators", () => {
    const result = assessDiscoveryEvidenceAgreement(input(), thresholds);
    expect(result.gold).toEqual({
      eligibleRaces: 7,
      assignmentOpportunities: 6,
      received: 2,
    });
    expect(result.blue).toEqual({
      assignmentOpportunities: 8,
      received: 1,
    });
  });

  it("rejects impossible counts and time evidence", () => {
    expect(() =>
      assessDiscoveryEvidenceAgreement(
        input({ goldAssignmentOpportunities: 8 }),
        thresholds,
      ),
    ).toThrow("denominators are inconsistent");
    expect(() =>
      assessDiscoveryEvidenceAgreement(
        input({ weakFieldEligibleNoStarCount: 8 }),
        thresholds,
      ),
    ).toThrow("denominators are inconsistent");
    expect(() =>
      assessDiscoveryEvidenceAgreement(
        input({
          directRaceCount: 0,
          successfulTimePercentile: 75,
          goldEligibleRaces: 0,
          goldAssignmentOpportunities: 0,
          goldReceived: 0,
          blueAssignmentOpportunities: 0,
          blueReceived: 0,
          strongFieldStarCount: 0,
        }),
        thresholds,
      ),
    ).toThrow("time evidence is inconsistent");
  });

  it("validates runtime enums and ordered versioned thresholds", () => {
    expect(() =>
      assessDiscoveryEvidenceAgreement(
        input({
          mode: "plane" as DiscoveryEvidenceAgreementInput["mode"],
        }),
        thresholds,
      ),
    ).toThrow("mode is invalid");
    expect(() =>
      assessDiscoveryEvidenceAgreement(input(), {
        ...thresholds,
        weakTimePercentile: 80,
      }),
    ).toThrow("must be lower");
  });
});
