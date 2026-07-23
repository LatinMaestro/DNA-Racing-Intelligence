import { describe, expect, it } from "vitest";

import {
  buildQualificationMetricEvidence,
  type QualificationCandidateEvidenceInput,
  type QualificationMetricEvidenceInput,
  type QualificationObservationInput,
} from "@/domain/qualification-metric-evidence";

function observation(
  overrides: Partial<QualificationObservationInput> = {},
): QualificationObservationInput {
  return {
    eventId: "event-1",
    eventAt: "2026-07-10T00:00:00Z",
    mode: "horse",
    distanceMetres: 1600,
    gateCount: 4,
    elapsedTimeMs: 60_000,
    finishPosition: 1,
    ...overrides,
  };
}

function candidate(
  coreId: string,
  observations: readonly QualificationObservationInput[],
  overrides: Partial<QualificationCandidateEvidenceInput> = {},
): QualificationCandidateEvidenceInput {
  return {
    coreId,
    leaderboardGroupId: "fire",
    observations,
    historicalStarRationale: null,
    dataCurrentThrough: "2026-07-20T00:00:00Z",
    lastImported: "2026-07-21T00:00:00Z",
    freshness: "current",
    ...overrides,
  };
}

function evidence(overrides: Partial<QualificationMetricEvidenceInput> = {}) {
  return buildQualificationMetricEvidence({
    bracketId: "horse-top-2",
    mode: "horse",
    exactDistancesMetres: [1600],
    gateCount: 4,
    minimumRaceCount: 1,
    metric: { kind: "fastest_single_time" },
    candidates: [
      candidate("core-a", [observation()]),
      candidate("core-b", [
        observation({ eventId: "event-2", elapsedTimeMs: 61_000 }),
      ]),
    ],
    ...overrides,
  });
}

describe("qualification metric evidence", () => {
  it("ranks fastest-time evidence lower-is-better within a leaderboard", () => {
    const result = evidence();

    expect(
      result.candidates.map((item) => [item.coreId, item.experimentalRank]),
    ).toEqual([
      ["core-a", 1],
      ["core-b", 2],
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        gateCRequired: true,
        actionableRecommendationAllowed: false,
        currentQualifyingFieldAvailable: false,
      }),
    );
  });

  it("calculates median and average time as exact rationals", () => {
    const observations = [
      observation({ eventId: "one", elapsedTimeMs: 60_000 }),
      observation({ eventId: "two", elapsedTimeMs: 60_001 }),
    ];
    const median = evidence({
      metric: { kind: "median_time" },
      candidates: [candidate("core-a", observations)],
    });
    const average = evidence({
      metric: { kind: "average_time" },
      candidates: [candidate("core-a", observations)],
    });

    expect(median.candidates[0]?.metricValue).toEqual({
      kind: "time_rational_ms",
      numerator: "120001",
      denominator: 2,
      direction: "lower_is_better",
    });
    expect(average.candidates[0]?.metricValue).toEqual(
      median.candidates[0]?.metricValue,
    );
  });

  it("supports wins, Top-X and best-finish evidence", () => {
    const observations = [
      observation({ eventId: "one", finishPosition: 1 }),
      observation({ eventId: "two", finishPosition: 2 }),
      observation({ eventId: "three", finishPosition: 4 }),
    ];
    expect(
      evidence({
        metric: { kind: "wins" },
        candidates: [candidate("core-a", observations)],
      }).candidates[0]?.metricValue,
    ).toEqual({
      kind: "count",
      value: 1,
      direction: "higher_is_better",
    });
    expect(
      evidence({
        metric: { kind: "top_x_finishes", topX: 2 },
        candidates: [candidate("core-a", observations)],
      }).candidates[0]?.metricValue,
    ).toEqual({
      kind: "count",
      value: 2,
      direction: "higher_is_better",
    });
    expect(
      evidence({
        metric: { kind: "best_finish" },
        candidates: [candidate("core-a", observations)],
      }).candidates[0]?.metricValue,
    ).toEqual({
      kind: "finish_position",
      value: 1,
      direction: "lower_is_better",
    });
  });

  it("sums decimal points exactly", () => {
    const result = evidence({
      metric: { kind: "points", pointsByFinish: ["3.58", "3.46", "0", "0"] },
      candidates: [
        candidate("core-a", [
          observation({ eventId: "one", finishPosition: 1 }),
          observation({ eventId: "two", finishPosition: 2 }),
        ]),
      ],
    });

    expect(result.candidates[0]?.metricValue).toEqual({
      kind: "points",
      exactValue: "7.04",
      direction: "higher_is_better",
    });
  });

  it("keeps separate leaderboard groups in separate rankings", () => {
    const result = evidence({
      candidates: [
        candidate("fire-a", [observation()]),
        candidate(
          "water-a",
          [observation({ eventId: "water", elapsedTimeMs: 70_000 })],
          { leaderboardGroupId: "water" },
        ),
      ],
    });

    expect(
      result.candidates.map((item) => [
        item.leaderboardGroupId,
        item.experimentalRank,
      ]),
    ).toEqual([
      ["fire", 1],
      ["water", 1],
    ]);
  });

  it("rejects the same core in multiple leaderboard groups", () => {
    expect(() =>
      evidence({
        candidates: [
          candidate("core-a", [observation()]),
          candidate("core-a", [observation({ eventId: "other" })], {
            leaderboardGroupId: "water",
          }),
        ],
      }),
    ).toThrow("exactly one leaderboard group");
  });

  it("marks below-minimum and incomplete evidence partial", () => {
    const result = evidence({
      minimumRaceCount: 3,
      candidates: [
        candidate("core-a", [
          observation({ elapsedTimeMs: null, finishPosition: null }),
          observation({ eventId: "event-2" }),
        ]),
      ],
    });

    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        acceptedRaceCount: 2,
        metricStatus: "partial",
        warnings: [
          "BELOW_MINIMUM_RACE_COUNT",
          "CURRENT_FIELD_UNAVAILABLE",
          "GATE_C_NOT_PASSED",
          "TIME_EVIDENCE_INCOMPLETE",
        ],
      }),
    );
  });

  it("preserves historical star rationale without using it in the metric", () => {
    const result = evidence({
      candidates: [
        candidate("core-a", [observation()], {
          historicalStarRationale: "2 Blue stars from 4 opportunities",
        }),
      ],
    });

    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        historicalStarRationale: "2 Blue stars from 4 opportunities",
        metricValue: expect.objectContaining({
          kind: "time_rational_ms",
        }),
      }),
    );
  });

  it("keeps custom metrics unavailable for explicit review", () => {
    const result = evidence({
      metric: { kind: "custom", description: "Owner-defined scoring" },
      candidates: [candidate("core-a", [observation()])],
    });

    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        metricStatus: "unavailable",
        metricValue: null,
        experimentalRank: null,
        warnings: expect.arrayContaining(["CUSTOM_METRIC_UNAVAILABLE"]),
      }),
    );
  });

  it("rejects cross-mode, unconfigured-distance and future evidence", () => {
    expect(() =>
      evidence({
        candidates: [candidate("core-a", [observation({ mode: "bike" })])],
      }),
    ).toThrow("mode does not match");
    expect(() =>
      evidence({
        candidates: [
          candidate("core-a", [observation({ distanceMetres: 1800 })]),
        ],
      }),
    ).toThrow("distance is not configured");
    expect(() =>
      evidence({
        candidates: [
          candidate("core-a", [
            observation({ eventAt: "2026-07-22T00:00:00Z" }),
          ]),
        ],
      }),
    ).toThrow("cannot exceed the data cutoff");
  });

  it("rejects impossible finish positions and duplicate event evidence", () => {
    expect(() =>
      evidence({
        candidates: [candidate("core-a", [observation({ finishPosition: 5 })])],
      }),
    ).toThrow("cannot exceed gate count");
    expect(() =>
      evidence({
        candidates: [candidate("core-a", [observation(), observation()])],
      }),
    ).toThrow("event IDs must be unique");
  });

  it("surfaces snapshot freshness independently from the metric", () => {
    const result = evidence({
      candidates: [
        candidate("core-a", [observation()], {
          dataCurrentThrough: null,
          lastImported: null,
          freshness: "stale",
        }),
      ],
    });

    expect(result.candidates[0]?.warnings).toEqual([
      "CURRENT_FIELD_UNAVAILABLE",
      "DATA_CUTOFF_UNKNOWN",
      "GATE_C_NOT_PASSED",
      "IMPORTED_DATA_STALE",
      "LAST_IMPORTED_UNKNOWN",
    ]);
  });
});
