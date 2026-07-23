import { describe, expect, it } from "vitest";
import {
  buildPerformanceBenchmarks,
  elapsedBenchmarkPercentile,
  type BenchmarkObservation,
} from "@/domain/performance-benchmarks";

function observation(
  eventId: string,
  coreId: string,
  elapsedTimeMilliseconds: number,
  finishingPosition: number,
  inTheMoneyStatus: BenchmarkObservation["inTheMoneyStatus"],
  overrides: Partial<BenchmarkObservation> = {},
): BenchmarkObservation {
  return {
    eventId,
    eventAt: "2026-07-20T00:00:00Z",
    coreId,
    mode: "bike",
    distance: 1_000,
    gateCount: 4,
    historicalFormatLabel: "Synthetic format",
    eventDataStatus: "complete",
    elapsedTimeMilliseconds,
    finishingPosition,
    inTheMoneyStatus,
    ...overrides,
  };
}

describe("performance benchmark library", () => {
  it("keeps mode, exact distance, gate count and historical format separate", () => {
    const benchmarks = buildPerformanceBenchmarks([
      observation("bike-1000", "a", 50_000, 1, "yes", {
        eventDataStatus: "partial",
      }),
      observation("bike-1000", "b", 52_000, 2, "unknown", {
        eventDataStatus: "partial",
      }),
      observation("bike-1200", "a", 61_000, 1, "yes", {
        distance: 1_200,
        eventDataStatus: "partial",
      }),
      observation("horse-1000", "a", 58_000, 1, "yes", {
        mode: "horse",
        eventDataStatus: "partial",
      }),
      observation("bike-1000-six", "a", 49_000, 1, "yes", {
        gateCount: 6,
        eventDataStatus: "partial",
      }),
      observation("bike-1000-other", "a", 48_000, 1, "yes", {
        historicalFormatLabel: "Other format",
        eventDataStatus: "partial",
      }),
    ]);

    expect(benchmarks).toHaveLength(5);
    expect(
      benchmarks.map((benchmark) => [
        benchmark.mode,
        benchmark.distance,
        benchmark.gateCount,
        benchmark.historicalFormatLabel,
      ]),
    ).toEqual([
      ["bike", 1_000, 4, "Other format"],
      ["bike", 1_000, 4, "Synthetic format"],
      ["bike", 1_000, 6, "Synthetic format"],
      ["bike", 1_200, 4, "Synthetic format"],
      ["horse", 1_000, 4, "Synthetic format"],
    ]);
  });

  it("exposes transparent elapsed distributions and explicit in-the-money coverage", () => {
    const [benchmark] = buildPerformanceBenchmarks([
      observation("e1", "a", 40_000, 1, "yes"),
      observation("e1", "b", 50_000, 2, "yes"),
      observation("e1", "c", 60_000, 3, "no"),
      observation("e1", "d", 70_000, 4, "unknown"),
    ]);

    expect(benchmark).toMatchObject({
      entryCount: 4,
      eventCount: 1,
      winnerElapsed: {
        sampleCount: 1,
        fastestMilliseconds: 40_000,
      },
      inTheMoneyElapsed: {
        sampleCount: 2,
        fastestMilliseconds: 40_000,
        slowestMilliseconds: 50_000,
      },
      inTheMoneyCoverage: {
        knownCount: 3,
        unknownCount: 1,
        positiveCount: 2,
      },
      outcomeCoverage: {
        completeEventCount: 1,
        partialEventCount: 0,
      },
      analyticalStatus: "experimental",
    });
    expect(benchmark!.overallElapsed).toEqual({
      sampleCount: 4,
      fastestMilliseconds: 40_000,
      percentile10Milliseconds: 43_000,
      percentile25Milliseconds: 47_500,
      medianMilliseconds: 55_000,
      percentile75Milliseconds: 62_500,
      percentile90Milliseconds: 67_000,
      slowestMilliseconds: 70_000,
    });
  });

  it("does not infer in-the-money status from finishing position", () => {
    const [benchmark] = buildPerformanceBenchmarks([
      observation("e1", "a", 40_000, 1, "unknown"),
      observation("e1", "b", 50_000, 2, "unknown"),
      observation("e1", "c", 60_000, 3, "unknown"),
      observation("e1", "d", 70_000, 4, "unknown"),
    ]);

    expect(benchmark!.winnerElapsed?.sampleCount).toBe(1);
    expect(benchmark!.inTheMoneyElapsed).toBeNull();
    expect(benchmark!.inTheMoneyCoverage).toEqual({
      knownCount: 0,
      unknownCount: 4,
      positiveCount: 0,
    });
  });

  it("keeps partial event times but excludes their outcome evidence", () => {
    const [benchmark] = buildPerformanceBenchmarks([
      observation("partial", "a", 40_000, 1, "yes", {
        eventDataStatus: "partial",
      }),
      observation("partial", "b", 50_000, 2, "yes", {
        eventDataStatus: "partial",
      }),
    ]);

    expect(benchmark!.overallElapsed.sampleCount).toBe(2);
    expect(benchmark!.winnerElapsed).toBeNull();
    expect(benchmark!.inTheMoneyElapsed).toBeNull();
    expect(benchmark!.outcomeCoverage).toEqual({
      completeEventCount: 0,
      partialEventCount: 1,
    });
  });

  it("returns a higher-is-better faster-than-or-equal percentile", () => {
    const sample = [40_000, 50_000, 60_000, 70_000];

    expect(elapsedBenchmarkPercentile(40_000, sample)).toEqual({
      fasterThanOrEqualPercentage: 100,
      sampleCount: 4,
      direction: "higher_is_better",
    });
    expect(elapsedBenchmarkPercentile(55_000, sample)).toEqual({
      fasterThanOrEqualPercentage: 50,
      sampleCount: 4,
      direction: "higher_is_better",
    });
    expect(elapsedBenchmarkPercentile(75_000, sample)).toEqual({
      fasterThanOrEqualPercentage: 0,
      sampleCount: 4,
      direction: "higher_is_better",
    });
  });

  it("rejects duplicate entries, conflicting event contexts and malformed rows", () => {
    expect(() =>
      buildPerformanceBenchmarks([
        observation("duplicate", "a", 50_000, 1, "yes"),
        observation("duplicate", "a", 50_000, 1, "yes"),
      ]),
    ).toThrow(/Duplicate benchmark observation/);

    expect(() =>
      buildPerformanceBenchmarks([
        observation("conflict", "a", 50_000, 1, "yes"),
        observation("conflict", "b", 55_000, 2, "yes", {
          distance: 1_200,
        }),
      ]),
    ).toThrow(/Conflicting benchmark event context/);

    expect(() =>
      buildPerformanceBenchmarks([observation("invalid", "a", 0, 1, "yes")]),
    ).toThrow(/Invalid benchmark observation/);

    expect(() =>
      buildPerformanceBenchmarks([
        observation("incomplete-marked-complete", "a", 50_000, 1, "yes"),
      ]),
    ).toThrow(/Invalid complete benchmark event/);
  });

  it("is deterministic across input order and normalizes blank format labels to unknown", () => {
    const values = [
      observation("e2", "b", 52_000, 2, "no", {
        historicalFormatLabel: " ",
        eventDataStatus: "partial",
      }),
      observation("e1", "a", 50_000, 1, "yes", {
        historicalFormatLabel: null,
        eventDataStatus: "partial",
      }),
    ];

    expect(buildPerformanceBenchmarks([...values].reverse())).toEqual(
      buildPerformanceBenchmarks(values),
    );
    expect(
      buildPerformanceBenchmarks(values)[0]!.historicalFormatLabel,
    ).toBeNull();
  });
});
