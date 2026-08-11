import { describe, expect, it } from "vitest";
import { attachDiscoveryBenchmarks } from "@/domain/discovery-benchmark";
import { buildDiscoveryProbePlan } from "@/domain/discovery-probe-plan";

const candidate = buildDiscoveryProbePlan([
  {
    coreId: "core-a",
    coreName: "Core A",
    mode: "bike",
    distanceMetres: 1400,
    directRaceCount: 4,
    directTimeEvidence: {
      bestMilliseconds: 51_000,
      medianMilliseconds: 52_000,
      meanMilliseconds: 52_500,
      standardDeviationMilliseconds: 700,
    },
    lineageRelationship: null,
    lineageResolved: true,
    lineageRaceCount: 0,
    tournamentRelevance: "none",
    maidenState: "not_eligible",
    freshness: "current",
    dataCurrentThrough: "2026-07-20T00:00:00.000Z",
  },
]);

const benchmark = {
  mode: "bike" as const,
  distanceMetres: 1400,
  dataCurrentThrough: "2026-07-20T00:00:00.000Z",
  raceEntryCount: 100,
  winningEntryCount: 25,
  topThreeEntryCount: 60,
  winningP25Milliseconds: 49_000,
  winningMedianMilliseconds: 50_000,
  winningP75Milliseconds: 51_500,
  topThreeP25Milliseconds: 50_000,
  topThreeMedianMilliseconds: 52_500,
  topThreeP75Milliseconds: 54_000,
  refreshedAt: "2026-07-20T01:00:00.000Z",
};

describe("Discovery exact-distance benchmarks", () => {
  it("classifies direct evidence against the same mode and exact distance", () => {
    const [result] = attachDiscoveryBenchmarks(candidate, [benchmark]);
    expect(result).toMatchObject({
      benchmarkAssessment: "winning_range",
      benchmarkEvidence: {
        mode: "bike",
        distanceMetres: 1400,
        winningMedianMilliseconds: 50_000,
        topThreeMedianMilliseconds: 52_500,
      },
    });
  });

  it("does not borrow a benchmark from another exact distance", () => {
    const [result] = attachDiscoveryBenchmarks(candidate, [
      { ...benchmark, distanceMetres: 1600 },
    ]);
    expect(result).toMatchObject({
      benchmarkAssessment: "not_available",
      benchmarkEvidence: null,
    });
  });

  it("labels clearly slower direct evidence outside the historical top-three range", () => {
    const slow = buildDiscoveryProbePlan([
      {
        coreId: "slow",
        coreName: "Slow",
        mode: "bike",
        distanceMetres: 1400,
        directRaceCount: 4,
        directTimeEvidence: {
          bestMilliseconds: 55_000,
          medianMilliseconds: 56_000,
          meanMilliseconds: 56_200,
          standardDeviationMilliseconds: 500,
        },
        lineageRelationship: null,
        lineageResolved: true,
        lineageRaceCount: 0,
        tournamentRelevance: "none",
        maidenState: "not_eligible",
        freshness: "current",
        dataCurrentThrough: "2026-07-20T00:00:00.000Z",
      },
    ]);
    expect(attachDiscoveryBenchmarks(slow, [benchmark])[0]).toMatchObject({
      benchmarkAssessment: "outside_top_three_range",
    });
  });

  it("rejects duplicate benchmark cells", () => {
    expect(() =>
      attachDiscoveryBenchmarks(candidate, [benchmark, benchmark]),
    ).toThrow("Duplicate Discovery exact-distance benchmark");
  });
});
