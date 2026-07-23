import { describe, expect, it } from "vitest";

import {
  compareOpenRaceStars,
  type OpenRaceStarComparisonInput,
} from "../domain/open-race-star-comparison";

function input(
  overrides: Partial<OpenRaceStarComparisonInput> = {},
): OpenRaceStarComparisonInput {
  return {
    comparisonId: "comparison-1",
    lockId: "lock-1",
    observationId: "observation-1",
    rankingEvaluatedAt: "2026-07-23T10:01:00Z",
    lockedAt: "2026-07-23T10:03:00Z",
    observedAt: "2026-07-23T10:04:00Z",
    comparedAt: "2026-07-23T10:05:00Z",
    gateCount: 4,
    enteredCoreIds: ["owned-1", "owned-2", "opponent-1", "opponent-2"],
    rankedCandidateCoreIds: ["owned-1", "owned-2"],
    provisionalRecommendedCoreId: "owned-1",
    selectedOwnedCoreId: "owned-1",
    gold: { status: "assigned", coreId: "owned-1" },
    blue: { status: "assigned", coreId: "opponent-1" },
    observationRecordStatus: "recorded",
    ...overrides,
  };
}

describe("Open Race star comparison", () => {
  it("compares revealed stars with the frozen pre-entry decision only", () => {
    expect(compareOpenRaceStars(input())).toMatchObject({
      selectedCoreSignal: "gold_only",
      provisionalLeaderSignal: "gold_only",
      diagnosticStatus: "observation_compared",
      frozenPreEntryRanking: true,
      rankingChanged: false,
      observationOnly: true,
      predictionSuccessClaimAllowed: false,
      completedOutcomeClaimAllowed: false,
      replacementRecommendationAllowed: false,
      recommendation: null,
    });
  });

  it("compares a user-selected alternative without changing the prior leader", () => {
    const result = compareOpenRaceStars(
      input({
        selectedOwnedCoreId: "owned-2",
        enteredCoreIds: ["owned-2", "opponent-1", "opponent-2", "opponent-3"],
        gold: { status: "assigned", coreId: "opponent-1" },
        blue: { status: "assigned", coreId: "owned-2" },
      }),
    );
    expect(result.selectedCoreSignal).toBe("blue_only");
    expect(result.provisionalLeaderSignal).toBe("not_entered");
    expect(result.provisionalRecommendedCoreId).toBe("owned-1");
    expect(result.rankingChanged).toBe(false);
  });

  it("supports a frozen ranking with no resolved provisional leader", () => {
    const result = compareOpenRaceStars(
      input({ provisionalRecommendedCoreId: null }),
    );
    expect(result.provisionalLeaderSignal).toBe("no_provisional_leader");
    expect(result.recommendation).toBeNull();
  });

  it("holds incomplete and anomalous observations for review", () => {
    const incomplete = compareOpenRaceStars(
      input({ blue: { status: "not_observed" } }),
    );
    expect(incomplete.diagnosticStatus).toBe("review_required");
    expect(incomplete.issues).toContain(
      "The revealed star observation is incomplete.",
    );

    const ineligibleGold = compareOpenRaceStars(
      input({
        gateCount: 3,
        enteredCoreIds: ["owned-1", "owned-2", "opponent-1"],
        gold: { status: "assigned", coreId: "owned-1" },
      }),
    );
    expect(ineligibleGold.issues).toContain(
      "Gold is not applicable at three gates or fewer.",
    );
  });

  it("propagates a review-required observation without resolving it", () => {
    const result = compareOpenRaceStars(
      input({ observationRecordStatus: "review_required" }),
    );
    expect(result.diagnosticStatus).toBe("review_required");
    expect(result.issues[0]).toContain("requires review");
  });

  it("requires the provisional leader to match the frozen ranking", () => {
    expect(() =>
      compareOpenRaceStars(input({ provisionalRecommendedCoreId: "owned-2" })),
    ).toThrow("must match the first frozen");
  });

  it("requires the committed core in the frozen ranking and rejects Blue not-applicable", () => {
    expect(() =>
      compareOpenRaceStars(input({ selectedOwnedCoreId: "opponent-1" })),
    ).toThrow("must be present in the frozen pre-entry ranking");
    expect(() =>
      compareOpenRaceStars(
        input({
          blue: { status: "not_applicable" },
        }),
      ),
    ).toThrow("Blue cannot be not applicable");
  });

  it("requires chronological ranking, lock, observation and comparison", () => {
    expect(() =>
      compareOpenRaceStars(input({ lockedAt: "2026-07-23T10:00:00Z" })),
    ).toThrow("cannot predate the pre-entry ranking");
    expect(() =>
      compareOpenRaceStars(input({ observedAt: "2026-07-23T10:02:00Z" })),
    ).toThrow("cannot predate field lock");
    expect(() =>
      compareOpenRaceStars(input({ comparedAt: "2026-07-23T10:03:30Z" })),
    ).toThrow("cannot predate star observation");
  });

  it("rejects outcomes, replacement advice and reranking fields", () => {
    expect(() =>
      compareOpenRaceStars({
        ...input(),
        raceResult: "owned-1 won",
      } as OpenRaceStarComparisonInput),
    ).toThrow("cannot contain outcomes");
    expect(() =>
      compareOpenRaceStars({
        ...input(),
        newRanking: ["owned-2", "owned-1"],
      } as OpenRaceStarComparisonInput),
    ).toThrow("cannot contain outcomes");
  });
});
