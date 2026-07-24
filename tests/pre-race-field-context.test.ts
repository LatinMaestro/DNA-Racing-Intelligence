import { describe, expect, it } from "vitest";
import {
  buildHistoricalFieldContext,
  type HistoricalFieldRequest,
} from "@/domain/pre-race-field-context";
import type { PerformanceObservation } from "@/domain/core-performance";
import type { StarProfileEvent } from "@/domain/star-signals";

const request: HistoricalFieldRequest = {
  eventId: "target-event",
  eventAt: "2026-07-20T12:00:00Z",
  enteredCoreId: "owned-core",
  opponentCoreIds: ["opponent-b", "opponent-a"],
  mode: "bike",
  distance: 1_000,
};

function observation(
  eventId: string,
  eventAt: string,
  coreId: string,
  elapsedTimeMilliseconds: number,
  overrides: Partial<PerformanceObservation> = {},
): PerformanceObservation {
  return {
    eventId,
    eventAt,
    coreId,
    mode: "bike",
    distance: 1_000,
    elapsedTimeMilliseconds,
    ...overrides,
  };
}

function starEvent(
  eventId: string,
  eventAt: string,
  goldCoreId: string,
  blueCoreId: string,
): StarProfileEvent {
  return {
    eventId,
    eventAt,
    mode: "bike",
    distance: 1_000,
    gateCount: 4,
    entries: [
      {
        coreId: goldCoreId,
        goldStar: true,
        blueStar: goldCoreId === blueCoreId,
        starDataStatus: "complete",
      },
      {
        coreId: blueCoreId,
        goldStar: false,
        blueStar: true,
        starDataStatus: "complete",
      },
      {
        coreId: "other-core",
        goldStar: false,
        blueStar: false,
        starDataStatus: "complete",
      },
      {
        coreId: "fourth-core",
        goldStar: false,
        blueStar: false,
        starDataStatus: "complete",
      },
    ],
  };
}

describe("Phase 2 historical pre-race field context", () => {
  it("uses only exact-mode-distance evidence strictly before the event", () => {
    const context = buildHistoricalFieldContext(
      request,
      [
        observation("a-old-1", "2026-07-10T00:00:00Z", "opponent-a", 50_000),
        observation("a-old-2", "2026-07-15T00:00:00Z", "opponent-a", 54_000),
        observation("b-old", "2026-07-18T00:00:00Z", "opponent-b", 60_000),
        observation("wrong-mode", "2026-07-19T00:00:00Z", "opponent-a", 1_000, {
          mode: "car",
        }),
        observation(
          "wrong-distance",
          "2026-07-19T00:00:00Z",
          "opponent-a",
          1_000,
          { distance: 1_200 },
        ),
      ],
      [
        starEvent(
          "prior-star",
          "2026-07-19T00:00:00Z",
          "opponent-a",
          "opponent-b",
        ),
      ],
    );

    expect(context.evidenceCutoff).toEqual({
      timestamp: request.eventAt,
      comparison: "strictly_before",
    });
    expect(context.opponents).toMatchObject([
      {
        coreId: "opponent-a",
        priorExactDistanceRaceCount: 2,
        priorBestMilliseconds: 50_000,
        priorMedianMilliseconds: 52_000,
        latestPriorRaceAt: "2026-07-15T00:00:00Z",
        priorStarProfile: {
          goldReceivedRate: { numerator: 1, denominator: 1 },
        },
      },
      {
        coreId: "opponent-b",
        priorExactDistanceRaceCount: 1,
        priorBestMilliseconds: 60_000,
        priorMedianMilliseconds: 60_000,
        latestPriorRaceAt: "2026-07-18T00:00:00Z",
        priorStarProfile: {
          blueReceivedRate: { numerator: 1, denominator: 1 },
        },
      },
    ]);
    expect(context.coverage).toEqual({
      opponentCount: 2,
      opponentsWithPriorExactDistanceHistory: 2,
      opponentsWithoutPriorExactDistanceHistory: 0,
      status: "complete",
    });
    expect(context.fieldTimeSummary).toEqual({
      fastestKnownPriorBestMilliseconds: 50_000,
      medianKnownOpponentMedianMilliseconds: 56_000,
    });
  });

  it("excludes the target event, simultaneous events and every future event", () => {
    const context = buildHistoricalFieldContext(
      request,
      [
        observation("prior", "2026-07-19T23:59:59Z", "opponent-a", 60_000),
        observation(
          "target-event",
          "2026-07-20T12:00:00Z",
          "opponent-a",
          1_000,
        ),
        observation(
          "same-time-other-event",
          "2026-07-20T12:00:00Z",
          "opponent-b",
          1_000,
        ),
        observation("future", "2026-07-21T00:00:00Z", "opponent-a", 1_000),
      ],
      [
        starEvent(
          "prior-star",
          "2026-07-19T23:59:59Z",
          "opponent-a",
          "opponent-b",
        ),
        starEvent(
          "target-event",
          "2026-07-20T12:00:00Z",
          "opponent-a",
          "opponent-b",
        ),
        starEvent(
          "future-star",
          "2026-07-21T00:00:00Z",
          "opponent-a",
          "opponent-b",
        ),
      ],
    );

    expect(context.opponents).toMatchObject([
      { coreId: "opponent-a", priorExactDistanceRaceCount: 1 },
      { coreId: "opponent-b", priorExactDistanceRaceCount: 0 },
    ]);
    expect(context.excludedEvidence).toEqual({
      sameOrFuturePerformanceObservationCount: 3,
      sameOrFutureStarEventCount: 2,
    });
    expect(context.warnings).toContain("SAME_OR_FUTURE_EVIDENCE_EXCLUDED");
  });

  it("does not use the entered core's history as opponent field quality", () => {
    const context = buildHistoricalFieldContext(
      request,
      [
        observation(
          "owned-history",
          "2026-07-10T00:00:00Z",
          "owned-core",
          1_000,
        ),
        observation(
          "opponent-history",
          "2026-07-10T00:00:00Z",
          "opponent-a",
          55_000,
        ),
      ],
      [
        {
          eventId: "opponent-a-star-history",
          eventAt: "2026-07-11T00:00:00Z",
          mode: "bike",
          distance: 1_000,
          gateCount: 4,
          entries: [
            {
              coreId: "opponent-a",
              goldStar: true,
              blueStar: true,
              starDataStatus: "complete",
            },
            {
              coreId: "unrelated-1",
              goldStar: false,
              blueStar: false,
              starDataStatus: "complete",
            },
            {
              coreId: "unrelated-2",
              goldStar: false,
              blueStar: false,
              starDataStatus: "complete",
            },
            {
              coreId: "unrelated-3",
              goldStar: false,
              blueStar: false,
              starDataStatus: "complete",
            },
          ],
        },
      ],
    );

    expect(context.fieldTimeSummary.fastestKnownPriorBestMilliseconds).toBe(
      55_000,
    );
    expect(context.coverage.status).toBe("partial");
    expect(context.warnings).toContain("PARTIAL_STAR_HISTORY");
  });

  it("keeps missing opponent history and star evidence explicit", () => {
    const context = buildHistoricalFieldContext(request, [], []);

    expect(context.coverage).toEqual({
      opponentCount: 2,
      opponentsWithPriorExactDistanceHistory: 0,
      opponentsWithoutPriorExactDistanceHistory: 2,
      status: "unavailable",
    });
    expect(context.fieldTimeSummary).toEqual({
      fastestKnownPriorBestMilliseconds: null,
      medianKnownOpponentMedianMilliseconds: null,
    });
    expect(context.warnings).toEqual([
      "OPPONENT_HISTORY_UNAVAILABLE",
      "STAR_HISTORY_UNAVAILABLE",
      "QUALITY_BAND_UNCLASSIFIED",
    ]);
  });

  it("supports an empty historical field without inventing opponent quality", () => {
    const context = buildHistoricalFieldContext(
      { ...request, opponentCoreIds: [] },
      [],
      [],
    );

    expect(context.coverage.status).toBe("unavailable");
    expect(context.qualityBand).toBe("unclassified");
    expect(context.warnings).toEqual([
      "NO_OPPONENTS",
      "OPPONENT_HISTORY_UNAVAILABLE",
      "QUALITY_BAND_UNCLASSIFIED",
    ]);
  });

  it("remains deterministic across input and opponent ordering", () => {
    const observations = [
      observation("a", "2026-07-10T00:00:00Z", "opponent-a", 50_000),
      observation("b", "2026-07-11T00:00:00Z", "opponent-b", 60_000),
    ];
    const events = [
      starEvent("star-a", "2026-07-12T00:00:00Z", "opponent-a", "opponent-b"),
    ];

    expect(buildHistoricalFieldContext(request, observations, events)).toEqual(
      buildHistoricalFieldContext(
        {
          ...request,
          opponentCoreIds: [...request.opponentCoreIds].reverse(),
        },
        [...observations].reverse(),
        [...events].reverse(),
      ),
    );
  });

  it("fails closed on invalid fields and duplicate evidence", () => {
    expect(() =>
      buildHistoricalFieldContext(
        {
          ...request,
          opponentCoreIds: ["opponent-a", "opponent-a"],
        },
        [],
        [],
      ),
    ).toThrow("Historical field request is invalid");

    expect(() =>
      buildHistoricalFieldContext(
        request,
        [
          observation(
            "duplicate",
            "2026-07-10T00:00:00Z",
            "opponent-a",
            50_000,
          ),
          observation(
            "duplicate",
            "2026-07-11T00:00:00Z",
            "opponent-a",
            51_000,
          ),
        ],
        [],
      ),
    ).toThrow("Duplicate performance observation");

    const duplicateStar = starEvent(
      "duplicate-star",
      "2026-07-21T00:00:00Z",
      "opponent-a",
      "opponent-b",
    );
    expect(() =>
      buildHistoricalFieldContext(request, [], [duplicateStar, duplicateStar]),
    ).toThrow("Duplicate star event");

    expect(() =>
      buildHistoricalFieldContext(
        { ...request, eventAt: "not-a-date" },
        [],
        [],
      ),
    ).toThrow("must be a valid timestamp");
  });

  it("never classifies field strength without a time-frozen benchmark", () => {
    const context = buildHistoricalFieldContext(
      request,
      [
        observation(
          "implausibly-fast",
          "2026-07-10T00:00:00Z",
          "opponent-a",
          1,
        ),
      ],
      [],
    );

    expect(context.qualityBand).toBe("unclassified");
    expect(context.warnings).toContain("QUALITY_BAND_UNCLASSIFIED");
  });
});
