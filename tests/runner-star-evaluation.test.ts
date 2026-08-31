import { describe, expect, it } from "vitest";

import {
  evaluateRunnerStars,
  type RunnerStarRaceEvidence,
} from "@/domain/runner-star-evaluation";

function race(
  index: number,
  overrides: Partial<RunnerStarRaceEvidence> = {},
): RunnerStarRaceEvidence {
  return {
    eventId: `event-${index}`,
    eventAt: `2026-08-${String(index + 10).padStart(2, "0")}T00:00:00.000Z`,
    coreId: "prospect",
    mode: "bike",
    distanceMetres: 2_200,
    gateCount: 6,
    yellowStar: false,
    blueStar: false,
    eventYellowStarAssigned: true,
    eventBlueStarAssigned: true,
    starDataStatus: "complete",
    finishPosition: 4,
    opponents: [
      {
        coreId: "ordinary-opponent",
        exactDistanceRaceCountBeforeEvent: 20,
        performancePercentileBeforeEvent: 60,
        evidenceCurrentThrough: "2026-08-01T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

describe("opposition-adjusted runner star evaluation", () => {
  it("keeps Blue as first-place chance and Yellow/gold_star as top-three chance", () => {
    const result = evaluateRunnerStars([
      race(1, {
        yellowStar: true,
        blueStar: true,
        finishPosition: 2,
      }),
    ]);

    expect(result.yellowSourceField).toBe("gold_star");
    expect(result.yellow).toMatchObject({
      receivedCount: 1,
      conversionCount: 1,
      rawConversionRate: 1,
      rawConversionMayRank: false,
    });
    expect(result.blue).toMatchObject({
      receivedCount: 1,
      conversionCount: 0,
      rawConversionRate: 0,
      rawConversionMayRank: false,
    });
  });

  it("gives no positive adjusted credit to perfect weak-field star conversion", () => {
    const result = evaluateRunnerStars(
      [1, 2, 3].map((index) =>
        race(index, {
          yellowStar: true,
          blueStar: true,
          finishPosition: 1,
          opponents: [
            {
              coreId: `weak-${index}`,
              exactDistanceRaceCountBeforeEvent: 15,
              performancePercentileBeforeEvent: 30,
              evidenceCurrentThrough: "2026-08-01T00:00:00.000Z",
            },
          ],
        }),
      ),
    );

    expect(result.yellow).toMatchObject({
      rawAssignmentRate: 1,
      rawConversionRate: 1,
      weakFieldReceivedCount: 3,
      fieldAdjustedOpportunityPoints: 0,
      fieldAdjustedIndex: null,
    });
    expect(result.blue).toMatchObject({
      rawAssignmentRate: 1,
      rawConversionRate: 1,
      weakFieldReceivedCount: 3,
      fieldAdjustedOpportunityPoints: 0,
      fieldAdjustedIndex: null,
    });
    expect(result.support).toBe("neutral");
  });

  it("treats a marathon star over an elite Yankee Trek prior as strong support", () => {
    const result = evaluateRunnerStars([
      race(1, {
        yellowStar: true,
        blueStar: false,
        finishPosition: 3,
        opponents: [
          {
            coreId: "yankee-trek",
            exactDistanceRaceCountBeforeEvent: 80,
            performancePercentileBeforeEvent: 97,
            evidenceCurrentThrough: "2026-08-01T00:00:00.000Z",
          },
        ],
      }),
    ]);

    expect(result.support).toBe("strong_support");
    expect(result.yellow).toMatchObject({
      strongFieldReceivedCount: 1,
      eliteOpponentReceivedCount: 1,
      fieldAdjustedReceivedPoints: 0.94,
      fieldAdjustedIndex: 1,
    });
    expect(result.strongestStarredOpponents[0]).toMatchObject({
      signal: "yellow",
      opponentCoreId: "yankee-trek",
      opponentPerformancePercentile: 97,
      opponentExactDistanceRaceCount: 80,
    });
  });

  it("does not label a partly unknown field as weak negative evidence", () => {
    const result = evaluateRunnerStars([
      race(1, {
        opponents: [
          {
            coreId: "known-weak",
            exactDistanceRaceCountBeforeEvent: 20,
            performancePercentileBeforeEvent: 20,
            evidenceCurrentThrough: "2026-08-01T00:00:00.000Z",
          },
          {
            coreId: "unknown",
            exactDistanceRaceCountBeforeEvent: 0,
            performancePercentileBeforeEvent: null,
            evidenceCurrentThrough: null,
          },
        ],
      }),
    ]);

    expect(result.yellow.weakFieldNoStarOpportunityCount).toBe(0);
    expect(result.blue.weakFieldNoStarOpportunityCount).toBe(0);
    expect(result.support).toBe("neutral");
  });

  it("marks repeated missed stars in fully known weak fields as caution only", () => {
    const result = evaluateRunnerStars(
      [1, 2, 3].map((index) =>
        race(index, {
          opponents: [
            {
              coreId: `weak-${index}`,
              exactDistanceRaceCountBeforeEvent: 12,
              performancePercentileBeforeEvent: 40,
              evidenceCurrentThrough: "2026-08-01T00:00:00.000Z",
            },
          ],
        }),
      ),
    );

    expect(result.support).toBe("caution");
    expect(result.performanceRole).toBe("supporting_only");
    expect(result.reasons.at(-1)).toContain("cannot override direct time");
  });

  it("excludes Yellow from three-gate opportunities while retaining Blue", () => {
    const result = evaluateRunnerStars([
      race(1, {
        gateCount: 3,
        yellowStar: false,
        blueStar: true,
        finishPosition: 1,
      }),
    ]);

    expect(result.yellow.assignmentOpportunityCount).toBe(0);
    expect(result.blue.assignmentOpportunityCount).toBe(1);
  });

  it("rejects opponent quality that was not known strictly before the race", () => {
    expect(() =>
      evaluateRunnerStars([
        race(1, {
          opponents: [
            {
              coreId: "future-leak",
              exactDistanceRaceCountBeforeEvent: 20,
              performancePercentileBeforeEvent: 99,
              evidenceCurrentThrough: "2026-08-11T00:00:00.000Z",
            },
          ],
        }),
      ]),
    ).toThrow("strictly before the event");
  });
});
