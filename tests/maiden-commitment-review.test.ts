import { describe, expect, it } from "vitest";

import {
  reviewMaidenCommitment,
  type MaidenCommitmentReviewInput,
} from "@/domain/maiden-commitment-review";

function input(
  overrides: Partial<MaidenCommitmentReviewInput> = {},
): MaidenCommitmentReviewInput {
  return {
    coreId: "core-me",
    tournamentId: "car-maiden",
    bracketId: "car-fire",
    mode: "car",
    lifecycleState: "eligible",
    lifecycleTournamentId: null,
    crossModeDisposition: "strongest_mode",
    bracketDisposition: "review_candidate",
    tournamentAvailability: "upcoming",
    tournamentStructureStatus: "complete",
    eligibilityEvidence: "complete",
    evidenceConfidence: "moderate",
    dataCurrentThrough: "2026-07-20T00:00:00Z",
    lastImported: "2026-07-21T00:00:00Z",
    freshness: "current",
    ...overrides,
  };
}

describe("Maiden commitment review", () => {
  it("creates a warning-gated review without mutating or consuming ME", () => {
    const result = reviewMaidenCommitment(input());
    expect(result).toEqual(
      expect.objectContaining({
        disposition: "commitment_review",
        acknowledgementRequired: true,
        entitlementConsumedByThisReview: false,
        lifecycleMutationPerformed: false,
        maidenCommitmentAllowed: false,
        automaticEntryAllowed: false,
      }),
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "SINGLE_USE_ENTITLEMENT",
        "COMMITMENT_DOES_NOT_CONSUME_ENTITLEMENT",
        "GATE_C_NOT_PASSED",
        "GATE_D_NOT_PASSED",
      ]),
    );
  });

  it("preserves ME for a weaker projected mode", () => {
    const result = reviewMaidenCommitment(
      input({
        mode: "horse",
        tournamentId: "horse-maiden",
        bracketId: "horse-water",
        crossModeDisposition: "weaker_mode",
        bracketDisposition: "preserve_me",
      }),
    );
    expect(result.disposition).toBe("preserve_me");
    expect(result.warnings).toContain("PRESERVE_ME");
  });

  it("holds unresolved, stale or incomplete evidence", () => {
    const result = reviewMaidenCommitment(
      input({
        crossModeDisposition: "unresolved",
        tournamentStructureStatus: "partial",
        eligibilityEvidence: "unknown",
        evidenceConfidence: "low",
        freshness: "stale",
      }),
    );
    expect(result.disposition).toBe("hold");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "STRONGEST_MODE_UNRESOLVED",
        "TOURNAMENT_STRUCTURE_INCOMPLETE",
        "ELIGIBILITY_EVIDENCE_INCOMPLETE",
        "LOW_EVIDENCE_CONFIDENCE",
        "IMPORTED_DATA_STALE",
      ]),
    );
  });

  it("distinguishes planning, commitment and commitment elsewhere", () => {
    expect(
      reviewMaidenCommitment(
        input({
          lifecycleState: "planned",
          lifecycleTournamentId: "car-maiden",
        }),
      ).disposition,
    ).toBe("already_planned");
    expect(
      reviewMaidenCommitment(
        input({
          lifecycleState: "committed",
          lifecycleTournamentId: "car-maiden",
        }),
      ).disposition,
    ).toBe("already_committed");
    const elsewhere = reviewMaidenCommitment(
      input({
        lifecycleState: "committed",
        lifecycleTournamentId: "bike-maiden",
      }),
    );
    expect(elsewhere.disposition).toBe("committed_elsewhere");
    expect(elsewhere.warnings).toContain("COMMITTED_ELSEWHERE");
  });

  it("keeps consumed, ineligible and closed states distinct", () => {
    expect(
      reviewMaidenCommitment(
        input({
          lifecycleState: "consumed",
          lifecycleTournamentId: "car-maiden",
        }),
      ).disposition,
    ).toBe("already_consumed");
    expect(
      reviewMaidenCommitment(input({ lifecycleState: "not_eligible" }))
        .disposition,
    ).toBe("ineligible");
    expect(
      reviewMaidenCommitment(input({ tournamentAvailability: "closed" }))
        .disposition,
    ).toBe("closed");
  });

  it("requires lifecycle tournament identity only for reserved states", () => {
    expect(() =>
      reviewMaidenCommitment(
        input({ lifecycleState: "planned", lifecycleTournamentId: null }),
      ),
    ).toThrow("require one lifecycle tournament");
    expect(() =>
      reviewMaidenCommitment(
        input({
          lifecycleState: "eligible",
          lifecycleTournamentId: "car-maiden",
        }),
      ),
    ).toThrow("require one lifecycle tournament");
  });

  it("fails closed on unknown cutoff and invalid timestamp order", () => {
    const unknown = reviewMaidenCommitment(
      input({
        dataCurrentThrough: null,
        lastImported: null,
        freshness: "unknown",
      }),
    );
    expect(unknown.disposition).toBe("hold");
    expect(unknown.warnings).toEqual(
      expect.arrayContaining(["DATA_CUTOFF_UNKNOWN", "LAST_IMPORTED_UNKNOWN"]),
    );
    expect(() =>
      reviewMaidenCommitment(
        input({
          dataCurrentThrough: "2026-07-22T00:00:00Z",
          lastImported: "2026-07-21T00:00:00Z",
        }),
      ),
    ).toThrow("Last imported cannot precede");
  });

  it("rejects unsupported runtime values", () => {
    expect(() =>
      reviewMaidenCommitment(
        input({
          mode: "hovercraft" as MaidenCommitmentReviewInput["mode"],
        }),
      ),
    ).toThrow("mode is invalid");
  });
});
