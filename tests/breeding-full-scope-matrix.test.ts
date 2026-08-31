import { describe, expect, it } from "vitest";

import {
  buildBreedingAnalysisScopes,
  buildBreedingIntelligenceMatrix,
} from "@/domain/breeding-scope-matrix";

const standardDistances = Array.from(
  { length: 15 },
  (_, index) => 900 + index * 100,
);

describe("full breeding scope matrix", () => {
  it("enumerates every Bike, Car and Horse combination for every observed standard distance", () => {
    const scopes = buildBreedingAnalysisScopes(standardDistances);

    expect(scopes).toHaveLength(45);
    for (const mode of ["bike", "car", "horse"] as const) {
      for (const distanceMetres of standardDistances) {
        expect(scopes).toContainEqual({ mode, distanceMetres });
      }
    }
  });

  it("automatically expands when a newly observed distance appears", () => {
    const scopes = buildBreedingAnalysisScopes([...standardDistances, 2_400]);

    expect(scopes).toHaveLength(48);
    expect(scopes).toContainEqual({ mode: "bike", distanceMetres: 2_400 });
    expect(scopes).toContainEqual({ mode: "car", distanceMetres: 2_400 });
    expect(scopes).toContainEqual({ mode: "horse", distanceMetres: 2_400 });
  });

  it("builds a breeding board for every scope rather than only hand-picked distances", () => {
    const boards = buildBreedingIntelligenceMatrix({
      observedDistancesMetres: standardDistances,
      pairs: [],
    });

    expect(boards).toHaveLength(45);
    expect(boards.every((board) => board.action === "wait")).toBe(true);
    expect(
      new Set(boards.map((board) => `${board.mode}|${board.distanceMetres}`))
        .size,
    ).toBe(45);
  });

  it("deduplicates and sorts observed distances before building the matrix", () => {
    expect(buildBreedingAnalysisScopes([1_400, 900, 1_400, 1_000])).toEqual([
      { mode: "bike", distanceMetres: 900 },
      { mode: "bike", distanceMetres: 1_000 },
      { mode: "bike", distanceMetres: 1_400 },
      { mode: "car", distanceMetres: 900 },
      { mode: "car", distanceMetres: 1_000 },
      { mode: "car", distanceMetres: 1_400 },
      { mode: "horse", distanceMetres: 900 },
      { mode: "horse", distanceMetres: 1_000 },
      { mode: "horse", distanceMetres: 1_400 },
    ]);
  });

  it("rejects invalid observed distances instead of silently skipping them", () => {
    expect(() => buildBreedingAnalysisScopes([0, 1_000])).toThrow(
      /positive safe integer/u,
    );
  });
});
