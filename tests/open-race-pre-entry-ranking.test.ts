import { describe, expect, it } from "vitest";

import {
  rankOpenRacePreEntry,
  type OpenRacePreEntryRankingInput,
  type OpenRaceRankedCandidate,
  type OpenRaceRankedOpponent,
  type OpenRaceTimeProfile,
} from "../domain/open-race-pre-entry-ranking";

function profile(
  medianTimeMs: number,
  overrides: Partial<OpenRaceTimeProfile> = {},
): OpenRaceTimeProfile {
  return {
    optimisticTimeMs: medianTimeMs - 100,
    medianTimeMs,
    conservativeTimeMs: medianTimeMs + 100,
    sampleCount: 12,
    sampleStatus: "minimally_analytical",
    ...overrides,
  };
}

function candidate(
  coreId: string,
  medianTimeMs: number,
  overrides: Partial<OpenRaceRankedCandidate> = {},
): OpenRaceRankedCandidate {
  return {
    coreId,
    eligibilityStatus: "eligible",
    mode: "horse",
    distanceMeters: 1600,
    profile: profile(medianTimeMs),
    historicalStars: {
      goldReceived: 2,
      goldOpportunities: 10,
      blueReceived: 1,
      blueOpportunities: 12,
      evidenceStatus: "complete",
      rationale: ["Historical stars support but do not determine the rank."],
    },
    ...overrides,
  };
}

function opponent(
  coreId: string,
  medianTimeMs: number,
  overrides: Partial<OpenRaceRankedOpponent> = {},
): OpenRaceRankedOpponent {
  return {
    coreId,
    identityStatus: "confirmed",
    mode: "horse",
    distanceMeters: 1600,
    profile: profile(medianTimeMs),
    ...overrides,
  };
}

function input(
  overrides: Partial<OpenRacePreEntryRankingInput> = {},
): OpenRacePreEntryRankingInput {
  return {
    rankingId: "rank-1",
    evaluatedAt: "2026-07-23T10:00:00Z",
    dataCurrentThrough: "2026-07-22T00:00:00Z",
    freshness: "current",
    fieldStage: "forming",
    mode: "horse",
    distanceMeters: 1600,
    materialGapMs: 20,
    candidates: [candidate("fast", 10_000), candidate("slow", 10_200)],
    opponents: [opponent("opponent", 10_100)],
    ...overrides,
  };
}

describe("Open Race pre-entry ranking", () => {
  it("ranks eligible exact-distance candidates by time and exposes field margin", () => {
    const result = rankOpenRacePreEntry(input());
    expect(result).toMatchObject({
      status: "provisional",
      provisionalRecommendedCoreId: "fast",
      strongestOpponentCoreId: "opponent",
      currentRaceStarsUsed: false,
      raceEntryAllowed: false,
      finalActionableRecommendationAllowed: false,
    });
    expect(result.rankedCandidates[0]).toMatchObject({
      rank: 1,
      coreId: "fast",
      marginToStrongestOpponentMs: 100,
      starsAffectedRank: false,
    });
  });

  it("keeps historical stars explanatory even when they favour the slower core", () => {
    const result = rankOpenRacePreEntry(
      input({
        candidates: [
          candidate("fast", 10_000, {
            historicalStars: {
              goldReceived: 0,
              goldOpportunities: 10,
              blueReceived: 0,
              blueOpportunities: 12,
              evidenceStatus: "complete",
              rationale: ["No historical star support."],
            },
          }),
          candidate("starred", 10_200, {
            historicalStars: {
              goldReceived: 10,
              goldOpportunities: 10,
              blueReceived: 12,
              blueOpportunities: 12,
              evidenceStatus: "complete",
              rationale: ["Strong historical star support."],
            },
          }),
        ],
      }),
    );
    expect(result.rankedCandidates.map(({ coreId }) => coreId)).toEqual([
      "fast",
      "starred",
    ]);
    expect(
      result.rankedCandidates.every(
        ({ starsAffectedRank }) => !starsAffectedRank,
      ),
    ).toBe(true);
  });

  it("discloses partial historical stars without blocking a time-led rank", () => {
    const result = rankOpenRacePreEntry(
      input({
        candidates: [
          candidate("fast", 10_000, {
            historicalStars: {
              goldReceived: 1,
              goldOpportunities: 4,
              blueReceived: 0,
              blueOpportunities: 5,
              evidenceStatus: "partial",
              rationale: ["Historical star coverage is incomplete."],
            },
          }),
        ],
      }),
    );
    expect(result.status).toBe("provisional");
    expect(result.provisionalRecommendedCoreId).toBe("fast");
    expect(result.warnings).toEqual([
      "Partial historical star evidence is disclosed but does not alter the time rank.",
    ]);
  });

  it("returns insufficient evidence for stale, incomplete or unresolved fields", () => {
    const stale = rankOpenRacePreEntry(input({ freshness: "stale" }));
    expect(stale.provisionalRecommendedCoreId).toBeNull();

    const unresolved = rankOpenRacePreEntry(
      input({
        opponents: [
          opponent("unknown", 10_100, {
            identityStatus: "unresolved",
            profile: null,
          }),
        ],
      }),
    );
    expect(unresolved.status).toBe("insufficient_evidence");
    expect(unresolved.reviewReasons).toContain(
      "One or more entered opponents lack confirmed identity and exact-distance history.",
    );
  });

  it("preserves materially tied leaders instead of choosing by ID", () => {
    const result = rankOpenRacePreEntry(
      input({
        materialGapMs: 50,
        candidates: [candidate("a", 10_000), candidate("b", 10_030)],
      }),
    );
    expect(result.rankedCandidates.slice(0, 2).map(({ rank }) => rank)).toEqual(
      [1, 1],
    );
    expect(result.provisionalRecommendedCoreId).toBeNull();
  });

  it("raises an avoid signal only when the best candidate is slower across distributions", () => {
    const result = rankOpenRacePreEntry(
      input({
        candidates: [
          candidate("candidate", 10_500, {
            profile: profile(10_500, {
              optimisticTimeMs: 10_400,
              conservativeTimeMs: 10_600,
            }),
          }),
        ],
        opponents: [
          opponent("elite", 10_000, {
            profile: profile(10_000, {
              optimisticTimeMs: 9_900,
              conservativeTimeMs: 10_100,
            }),
          }),
        ],
      }),
    );
    expect(result.avoidSignal).toBe(true);
  });

  it("holds a hypothesis-only leader and validates the minimum-10 boundary", () => {
    const result = rankOpenRacePreEntry(
      input({
        candidates: [
          candidate("limited", 10_000, {
            profile: profile(10_000, {
              sampleCount: 8,
              sampleStatus: "hypothesis_only",
            }),
          }),
        ],
      }),
    );
    expect(result.status).toBe("insufficient_evidence");
    expect(result.reviewReasons).toContain(
      "The leading candidate has hypothesis-only time evidence.",
    );
    expect(() =>
      rankOpenRacePreEntry(
        input({
          candidates: [
            candidate("invalid", 10_000, {
              profile: profile(10_000, {
                sampleCount: 8,
                sampleStatus: "minimally_analytical",
              }),
            }),
          ],
        }),
      ),
    ).toThrow("sample status does not match sample count");
  });

  it("rejects locked fields, mode-distance mismatch and invalid star denominators", () => {
    expect(() =>
      rankOpenRacePreEntry(input({ fieldStage: "locked" as "forming" })),
    ).toThrow("only while the field is forming");
    expect(() =>
      rankOpenRacePreEntry(
        input({
          candidates: [candidate("wrong-mode", 10_000, { mode: "car" })],
        }),
      ),
    ).toThrow("does not match mode and exact distance");
    expect(() =>
      rankOpenRacePreEntry(
        input({
          candidates: [
            candidate("bad-stars", 10_000, {
              historicalStars: {
                goldReceived: 2,
                goldOpportunities: 1,
                blueReceived: 0,
                blueOpportunities: 1,
                evidenceStatus: "complete",
                rationale: ["Invalid numerator."],
              },
            }),
          ],
        }),
      ),
    ).toThrow("cannot exceed denominators");
  });

  it("rejects hidden top-level current-race star input", () => {
    expect(() =>
      rankOpenRacePreEntry({
        ...input(),
        currentBlueStarCoreId: "opponent",
      } as OpenRacePreEntryRankingInput),
    ).toThrow("cannot contain current-race star input");
  });
});
