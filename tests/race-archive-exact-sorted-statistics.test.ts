import { describe, expect, it } from "vitest";

import { exactSortedRaceArchiveStatistics } from "../lib/race-archive-exact-sorted-statistics";

function values(values: readonly number[]): AsyncIterable<number> {
  return (async function* () {
    for (const value of values) yield value;
  })();
}

function percentileCont(sorted: readonly number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === undefined || upper === undefined)
    throw new Error("fixture percentile missing");
  if (lowerIndex === upperIndex) return lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

function residentReference(input: readonly number[]) {
  const sorted = [...input].sort((left, right) => left - right);
  const mean =
    sorted.reduce((total, value) => total + value, 0) / sorted.length;
  const trimCount = sorted.length < 10 ? 0 : Math.floor(sorted.length * 0.1);
  const trimmed =
    trimCount === 0
      ? sorted
      : sorted.slice(trimCount, sorted.length - trimCount);
  const p25 = percentileCont(sorted, 0.25);
  const median = percentileCont(sorted, 0.5);
  const p75 = percentileCont(sorted, 0.75);
  const variance =
    sorted.reduce((total, value) => total + (value - mean) ** 2, 0) /
    sorted.length;
  return {
    count: sorted.length,
    best: sorted[0],
    p25,
    median,
    p75,
    mean,
    trimmedMean:
      trimmed.reduce((total, value) => total + value, 0) / trimmed.length,
    populationStandardDeviation: Math.sqrt(variance),
    interquartileRange: p75 - p25,
  };
}

describe("exact sorted Race archive statistics", () => {
  it.each([
    [1_000],
    [1_000, 1_100],
    [900, 1_000, 1_100, 1_200],
    [900, 900, 1_000, 1_000, 1_100, 1_100, 1_200],
    [800, 900, 1_000, 1_100, 1_200, 1_300, 1_400, 1_500, 1_600, 1_700],
    [
      800, 850, 900, 950, 1_000, 1_050, 1_100, 1_150, 1_200, 1_250, 1_300,
      1_350, 1_400, 1_450, 1_500,
    ],
  ])(
    "matches resident percentile, trim and population-variance semantics for %j",
    async (...fixture: number[]) => {
      const sorted = [...fixture].sort((left, right) => left - right);
      const result = await exactSortedRaceArchiveStatistics({
        readValues: () => values(sorted),
        expectedCount: sorted.length,
        maximumValues: 1_000,
      });
      expect(result).toEqual(residentReference(sorted));
    },
  );

  it("fails closed when values are not sorted", async () => {
    await expect(
      exactSortedRaceArchiveStatistics({
        readValues: () => values([1_000, 900, 1_100]),
        expectedCount: 3,
        maximumValues: 10,
      }),
    ).rejects.toThrow("Race archive exact statistics values are not sorted.");
  });

  it("fails closed when exact count coverage changes", async () => {
    await expect(
      exactSortedRaceArchiveStatistics({
        readValues: () => values([900, 1_000]),
        expectedCount: 3,
        maximumValues: 10,
      }),
    ).rejects.toThrow("Race archive exact statistics count changed.");

    await expect(
      exactSortedRaceArchiveStatistics({
        readValues: () => values([900, 1_000, 1_100, 1_200]),
        expectedCount: 3,
        maximumValues: 10,
      }),
    ).rejects.toThrow(
      "Race archive exact statistics count exceeded its expectation.",
    );
  });

  it("fails closed when the replay used for exact population variance changes", async () => {
    let read = 0;
    await expect(
      exactSortedRaceArchiveStatistics({
        readValues() {
          read += 1;
          return values(read === 1 ? [900, 1_000, 1_100] : [900, 1_000, 1_200]);
        },
        expectedCount: 3,
        maximumValues: 10,
      }),
    ).rejects.toThrow("Race archive exact statistics replay changed.");
  });

  it("enforces positive integer values and the declared input bound", async () => {
    await expect(
      exactSortedRaceArchiveStatistics({
        readValues: () => values([900, 0, 1_100]),
        expectedCount: 3,
        maximumValues: 10,
      }),
    ).rejects.toThrow("value must be a positive safe integer");

    await expect(
      exactSortedRaceArchiveStatistics({
        readValues: () => values([900, 1_000, 1_100]),
        expectedCount: 3,
        maximumValues: 2,
      }),
    ).rejects.toThrow("expectedCount is outside its bound");
  });
});
