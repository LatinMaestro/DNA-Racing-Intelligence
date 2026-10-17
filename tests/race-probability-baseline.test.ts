import { describe, expect, it } from "vitest";

import {
  calculatePairwiseRaceProbability,
  type EmpiricalRaceTimeObservation,
  type PairwiseRaceProbabilityInput,
} from "../domain/race-probability-baseline";

function observations(
  prefix: string,
  times: readonly number[],
): readonly EmpiricalRaceTimeObservation[] {
  return times.map((elapsedTimeMilliseconds, index) => ({
    eventId: `${prefix}-${index}`,
    eventAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
    elapsedTimeMilliseconds,
  }));
}

function input(
  overrides: Partial<PairwiseRaceProbabilityInput> = {},
): PairwiseRaceProbabilityInput {
  return {
    baselineId: "pairwise-bike-1000",
    modelVersion: "empirical-pairwise-v1",
    evidenceCutoff: "2026-08-01T00:00:00Z",
    context: {
      mode: "bike",
      distanceMeters: 1000,
      competition: "normal",
      format: "1v1",
      gateCount: 2,
      element: { status: "known", value: "Fire" },
    },
    candidateCoreId: "candidate",
    opponentCoreId: "opponent",
    candidateObservations: observations(
      "candidate",
      Array.from({ length: 10 }, (_, index) => 1_000 + index),
    ),
    opponentObservations: observations(
      "opponent",
      [500, 501, 502, 503, 504, 2_000, 2_001, 2_002, 2_003, 2_004],
    ),
    ...overrides,
  };
}

describe("independent empirical pairwise race probability baseline", () => {
  it("uses every exact-context outcome and reports the auditable pair counts", () => {
    expect(calculatePairwiseRaceProbability(input())).toMatchObject({
      status: "available",
      pWinMillionths: 500_000,
      candidateSampleCount: 10,
      opponentSampleCount: 10,
      outcomePairCount: 100,
      candidateWinPairCount: 50,
      candidateLossPairCount: 50,
      tiedPairCount: 0,
      reasons: [],
      probabilityBasis: "empirical_cartesian_pairwise_elapsed_time",
      uncertaintyStatus: "sample_counts_only",
      calibrationStatus: "not_evaluated",
      analyticalStatus: "experimental",
      decisionUseAllowed: false,
      economicUseAllowed: false,
    });
  });

  it("is deterministic when accepted observations arrive in another order", () => {
    const baseline = input();
    const reversed = input({
      candidateObservations: [...baseline.candidateObservations].reverse(),
      opponentObservations: [...baseline.opponentObservations].reverse(),
    });
    expect(calculatePairwiseRaceProbability(reversed)).toEqual(
      calculatePairwiseRaceProbability(baseline),
    );
  });

  it("fails closed below the minimum analytical sample", () => {
    const result = calculatePairwiseRaceProbability(
      input({
        candidateObservations: observations(
          "candidate",
          Array.from({ length: 9 }, (_, index) => 1_000 + index),
        ),
      }),
    );
    expect(result).toMatchObject({
      status: "unavailable",
      pWinMillionths: null,
      reasons: ["INSUFFICIENT_CANDIDATE_SAMPLE"],
    });
  });

  it("keeps elapsed-time ties review-required instead of inventing a tie rule", () => {
    const result = calculatePairwiseRaceProbability(
      input({
        candidateObservations: observations(
          "candidate",
          Array.from({ length: 10 }, () => 1_000),
        ),
        opponentObservations: observations(
          "opponent",
          Array.from({ length: 10 }, () => 1_000),
        ),
      }),
    );
    expect(result).toMatchObject({
      status: "review_required",
      pWinMillionths: null,
      outcomePairCount: 100,
      tiedPairCount: 100,
      reasons: ["TIE_POLICY_UNRESOLVED"],
    });
  });

  it("rejects same-event leakage at or after the evidence cutoff", () => {
    expect(() =>
      calculatePairwiseRaceProbability(
        input({
          candidateObservations: [
            ...observations(
              "candidate",
              Array.from({ length: 9 }, (_, index) => 1_000 + index),
            ),
            {
              eventId: "target-event",
              eventAt: "2026-08-01T00:00:00Z",
              elapsedTimeMilliseconds: 1_100,
            },
          ],
        }),
      ),
    ).toThrow("must predate the evidence cutoff");
  });

  it("rejects duplicate facts, invalid context and self-comparison", () => {
    const duplicate = observations("candidate", [1_000, 1_100]);
    expect(() =>
      calculatePairwiseRaceProbability(
        input({ candidateObservations: [duplicate[0]!, duplicate[0]!] }),
      ),
    ).toThrow("Duplicate candidate event");
    expect(() =>
      calculatePairwiseRaceProbability(
        input({
          context: { ...input().context, distanceMeters: 0 },
        }),
      ),
    ).toThrow("Distance metres");
    expect(() =>
      calculatePairwiseRaceProbability(input({ opponentCoreId: "candidate" })),
    ).toThrow("must differ");
  });
});
