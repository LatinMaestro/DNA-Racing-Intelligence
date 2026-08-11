import { describe, expect, it } from "vitest";

import {
  discoveryHypothesisIsEligible,
  MINIMUM_ANALYTICAL_EXACT_DISTANCE_RACES,
} from "@/domain/discovery-hypothesis-governance";

describe("Discovery hypothesis governance", () => {
  it("requires the existing ten-race analytical minimum for population fallback evidence", () => {
    expect(MINIMUM_ANALYTICAL_EXACT_DISTANCE_RACES).toBe(10);
    expect(
      discoveryHypothesisIsEligible({
        relationship: "population_pattern",
        supportingRaceCount: 9,
      }),
    ).toBe(false);
    expect(
      discoveryHypothesisIsEligible({
        relationship: "population_pattern",
        supportingRaceCount: 10,
      }),
    ).toBe(true);
  });

  it.each([
    "parent",
    "grandparent",
    "full_sibling",
    "half_sibling",
    "offspring",
    "wider_lineage",
  ] as const)(
    "does not impose the population threshold on %s evidence",
    (relationship) => {
      expect(
        discoveryHypothesisIsEligible({ relationship, supportingRaceCount: 1 }),
      ).toBe(true);
    },
  );

  it("fails closed on malformed supporting counts", () => {
    for (const supportingRaceCount of [-1, 1.5, Number.NaN]) {
      expect(() =>
        discoveryHypothesisIsEligible({
          relationship: "population_pattern",
          supportingRaceCount,
        }),
      ).toThrow("supporting race count");
    }
  });
});
