import { describe, expect, it } from "vitest";
import {
  estimateHistoricalMatingExpectation,
  type HistoricalMatingOutcome,
} from "../domain/breeder-mating-expectation";

const scope = { mode: "bike" as const, distanceMetres: 1400 };
const asOf = "2026-07-01T00:00:00.000Z";

function observation(input: {
  index: number;
  parentA?: number;
  parentB?: number;
  child: number;
  createdAt?: string;
  distanceMetres?: number;
}): HistoricalMatingOutcome {
  return {
    offspringCoreId: `child-${input.index}`,
    scope: {
      mode: "bike",
      distanceMetres: input.distanceMetres ?? 1400,
    },
    parentAQualityPercentile: input.parentA ?? 90,
    parentBQualityPercentile: input.parentB ?? 90,
    offspringQualityPercentile: input.child,
    offspringCreatedAt:
      input.createdAt ??
      `2026-05-${String(input.index + 1).padStart(2, "0")}T00:00:00.000Z`,
  };
}

describe("historical mating expectation", () => {
  it("learns normal offspring regression rather than assuming the parent mean", () => {
    const historicalMatings = Array.from({ length: 20 }, (_, index) =>
      observation({ index, child: 66 + (index % 9) }),
    );

    const result = estimateHistoricalMatingExpectation({
      scope,
      parentAQualityPercentile: 90,
      parentBQualityPercentile: 90,
      asOf,
      historicalMatings,
    });

    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.typicalOffspringQualityPercentile).toBeLessThan(80);
    expect(result.typicalOffspringQualityPercentile).not.toBe(90);
  });

  it("is invariant to father/mother argument ordering", () => {
    const historicalMatings = Array.from({ length: 20 }, (_, index) =>
      observation({
        index,
        parentA: 60 + (index % 3),
        parentB: 92 - (index % 3),
        child: 65 + index / 2,
      }),
    );

    const left = estimateHistoricalMatingExpectation({
      scope,
      parentAQualityPercentile: 61,
      parentBQualityPercentile: 91,
      asOf,
      historicalMatings,
    });
    const right = estimateHistoricalMatingExpectation({
      scope,
      parentAQualityPercentile: 91,
      parentBQualityPercentile: 61,
      asOf,
      historicalMatings,
    });

    expect(left).toEqual(right);
  });

  it("excludes future offspring from a historical expectation", () => {
    const earlier = Array.from({ length: 12 }, (_, index) =>
      observation({ index, child: 60 + index }),
    );
    const future = Array.from({ length: 20 }, (_, index) =>
      observation({
        index: index + 30,
        child: 99,
        createdAt: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      }),
    );

    const result = estimateHistoricalMatingExpectation({
      scope,
      parentAQualityPercentile: 90,
      parentBQualityPercentile: 90,
      asOf,
      historicalMatings: [...earlier, ...future],
    });

    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.historicalMatingCount).toBe(12);
    expect(result.typicalOffspringQualityPercentile).toBeLessThan(90);
  });

  it("fails closed when too few earlier comparable matings exist", () => {
    const result = estimateHistoricalMatingExpectation({
      scope,
      parentAQualityPercentile: 90,
      parentBQualityPercentile: 90,
      asOf,
      historicalMatings: Array.from({ length: 8 }, (_, index) =>
        observation({ index, child: 70 }),
      ),
    });

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.historicalMatingCount).toBe(8);
  });

  it("does not let one exceptional outlier define the typical outcome", () => {
    const historicalMatings = [
      ...Array.from({ length: 19 }, (_, index) =>
        observation({ index, child: 68 + (index % 5) }),
      ),
      observation({ index: 19, child: 100 }),
    ];

    const result = estimateHistoricalMatingExpectation({
      scope,
      parentAQualityPercentile: 90,
      parentBQualityPercentile: 90,
      asOf,
      historicalMatings,
    });

    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.typicalOffspringQualityPercentile).toBeLessThan(75);
    expect(result.strongerTailQualityPercentile).toBeGreaterThanOrEqual(
      result.typicalOffspringQualityPercentile,
    );
  });

  it("keeps exact-distance populations separate", () => {
    const historicalMatings = [
      ...Array.from({ length: 12 }, (_, index) =>
        observation({ index, child: 70 }),
      ),
      ...Array.from({ length: 20 }, (_, index) =>
        observation({
          index: index + 30,
          child: 99,
          distanceMetres: 2200,
        }),
      ),
    ];

    const result = estimateHistoricalMatingExpectation({
      scope,
      parentAQualityPercentile: 90,
      parentBQualityPercentile: 90,
      asOf,
      historicalMatings,
    });

    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.historicalMatingCount).toBe(12);
    expect(result.typicalOffspringQualityPercentile).toBe(70);
  });
});
