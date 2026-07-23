import { describe, expect, it } from "vitest";

import {
  reviewTournamentPath,
  type TournamentAttemptInput,
  type TournamentPathGuidanceInput,
} from "@/domain/tournament-path-guidance";

function attempt(
  eventId: string,
  overrides: Partial<TournamentAttemptInput> = {},
): TournamentAttemptInput {
  return {
    eventId,
    eventAt: `2026-07-${String(Number(eventId.replace(/\D/g, "")) || 10).padStart(2, "0")}T00:00:00Z`,
    metricAssessment: "competitive",
    starContext: "neutral",
    ...overrides,
  };
}

function guidance(overrides: Partial<TournamentPathGuidanceInput> = {}) {
  return reviewTournamentPath({
    tournamentId: "season-12",
    bracketId: "horse-fire",
    coreId: "core-a",
    minimumReviewRaces: 3,
    maximumProbeRaces: 5,
    remainingRaceBudget: 2,
    timeEvidence: "competitive",
    evidenceConfidence: "high",
    maidenCommitment: "not_maiden",
    maidenModeDisposition: "not_applicable",
    attempts: [attempt("event-10")],
    dataCurrentThrough: "2026-07-20T00:00:00Z",
    lastImported: "2026-07-21T00:00:00Z",
    freshness: "current",
    ...overrides,
  });
}

describe("tournament path guidance", () => {
  it("continues a limited probe when primary evidence is competitive", () => {
    expect(guidance()).toEqual(
      expect.objectContaining({
        reviewSignal: "continue_probe",
        stopEvidence: "not_established",
        noStarUsedForStop: false,
        actionableRecommendationAllowed: false,
      }),
    );
  });

  it("requires both sufficient weak metric evidence and weak time to stop", () => {
    const attempts = [
      attempt("event-10", { metricAssessment: "weak" }),
      attempt("event-11", { metricAssessment: "weak" }),
      attempt("event-12", { metricAssessment: "weak" }),
    ];
    const result = guidance({ attempts, timeEvidence: "weak" });

    expect(result).toEqual(
      expect.objectContaining({
        reviewSignal: "stop_candidate",
        stopEvidence: "sufficient_weak_metric_and_time",
      }),
    );
  });

  it("never creates a stop from eligible no-star evidence", () => {
    const result = guidance({
      attempts: [
        attempt("event-10", {
          metricAssessment: "competitive",
          starContext: "weak_field_eligible_no_star",
        }),
        attempt("event-11", {
          metricAssessment: "competitive",
          starContext: "weak_field_eligible_no_star",
        }),
        attempt("event-12", {
          metricAssessment: "competitive",
          starContext: "weak_field_eligible_no_star",
        }),
      ],
    });

    expect(result.reviewSignal).toBe("continue_probe");
    expect(result.noStarUsedForStop).toBe(false);
    expect(result.warnings).toContain("NO_STAR_NON_DISPOSITIVE");
  });

  it("keeps Gold-ineligible no-star evidence excluded", () => {
    const result = guidance({
      attempts: [
        attempt("event-10", {
          starContext: "gold_ineligible_no_star",
        }),
      ],
    });

    expect(result.goldIneligibleNoStarCount).toBe(1);
    expect(result.warnings).toContain("GOLD_INELIGIBLE_NO_STAR_EXCLUDED");
  });

  it("allows strong-field stars to support only a limited early continuation", () => {
    const result = guidance({
      attempts: [
        attempt("event-10", {
          metricAssessment: "unavailable",
          starContext: "strong_field_star",
        }),
      ],
      timeEvidence: "competitive",
    });

    expect(result).toEqual(
      expect.objectContaining({
        reviewSignal: "continue_probe",
        historicalStarsRole: "supports_limited_continuation_only",
      }),
    );
    expect(result.warnings).toContain("STRONG_FIELD_STAR_SUPPORTS_CONTINUE");
  });

  it("does not let a strong-field star override weak time", () => {
    const result = guidance({
      attempts: [
        attempt("event-10", {
          metricAssessment: "competitive",
          starContext: "strong_field_star",
        }),
      ],
      timeEvidence: "weak",
    });

    expect(result.reviewSignal).toBe("pause_review");
    expect(result.warnings).toContain("TIME_METRIC_DISAGREEMENT");
  });

  it("preserves an uncommitted ME core for the stronger projected mode", () => {
    const result = guidance({
      maidenCommitment: "uncommitted",
      maidenModeDisposition: "preserve_for_stronger_mode",
    });

    expect(result.reviewSignal).toBe("preserve_me");
    expect(result.warnings).toContain("PRESERVE_ME");
  });

  it("pauses stale, low-confidence and exhausted-budget evidence", () => {
    expect(guidance({ freshness: "stale" }).reviewSignal).toBe("pause_review");
    expect(guidance({ evidenceConfidence: "low" }).reviewSignal).toBe(
      "pause_review",
    );
    expect(guidance({ remainingRaceBudget: 0 }).reviewSignal).toBe(
      "pause_review",
    );
  });

  it("fails closed on future and duplicate attempt evidence", () => {
    expect(() =>
      guidance({
        attempts: [attempt("event-22", { eventAt: "2026-07-22T00:00:00Z" })],
      }),
    ).toThrow("cannot exceed the data cutoff");
    expect(() =>
      guidance({ attempts: [attempt("same"), attempt("same")] }),
    ).toThrow("event IDs must be unique");
  });

  it("enforces probe limits and valid Maiden preservation state", () => {
    expect(() =>
      guidance({
        minimumReviewRaces: 4,
        maximumProbeRaces: 3,
      }),
    ).toThrow("cannot be below");
    expect(() =>
      guidance({
        maidenCommitment: "committed",
        maidenModeDisposition: "preserve_for_stronger_mode",
      }),
    ).toThrow("Only an uncommitted Maiden");
  });

  it("preserves separate freshness timestamps", () => {
    expect(() =>
      guidance({
        dataCurrentThrough: "2026-07-22T00:00:00Z",
        lastImported: "2026-07-21T00:00:00Z",
      }),
    ).toThrow("Last imported cannot precede data current through");
  });
});
