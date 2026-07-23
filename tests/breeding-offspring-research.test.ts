import { describe, expect, it } from "vitest";

import {
  buildParentOffspringResearchDataset,
  type ParentOffspringObservationInput,
  type ParentOffspringResearchInput,
  type ParentResearchSnapshot,
} from "../domain/breeding-offspring-research";

function parent(
  coreId: "parent-a" | "parent-b",
  overrides: Partial<ParentResearchSnapshot> = {},
): ParentResearchSnapshot {
  return {
    coreId,
    mode: "Car",
    exactDistanceM: 1000,
    raceCount: coreId === "parent-a" ? 12 : 8,
    medianElapsedMs: coreId === "parent-a" ? 60_000 : 61_000,
    goldReceived: 2,
    goldOpportunities: coreId === "parent-a" ? 10 : 8,
    blueReceived: 1,
    blueOpportunities: 8,
    dataCurrentThrough: "2026-06-30T00:00:00Z",
    lastImported: "2026-07-01T00:00:00Z",
    freshness: "current",
    ...overrides,
  };
}

function observation(
  overrides: Partial<ParentOffspringObservationInput> = {},
): ParentOffspringObservationInput {
  return {
    observationId: "breeding-1",
    parentCoreIds: ["parent-a", "parent-b"],
    breedingAt: "2026-07-02T00:00:00Z",
    mode: "Car",
    exactDistanceM: 1000,
    parentSnapshots: [parent("parent-a"), parent("parent-b")],
    outcomes: [
      {
        eventId: "event-1",
        offspringCoreId: "offspring-1",
        eventAt: "2026-07-10T00:00:00Z",
        elapsedMs: 59_000,
        goldStar: true,
        blueStar: false,
        goldEligible: true,
        starDataStatus: "complete",
      },
    ],
    ...overrides,
  };
}

function input(
  overrides: Partial<ParentOffspringResearchInput> = {},
): ParentOffspringResearchInput {
  return {
    holdoutStartsAt: "2026-07-05T00:00:00Z",
    observations: [observation()],
    ...overrides,
  };
}

describe("parent-offspring research dataset", () => {
  it("builds leakage-safe rows while preserving exact evidence", () => {
    const result = buildParentOffspringResearchDataset(input());
    expect(result.trainingRowCount).toBe(1);
    expect(result.holdoutRowCount).toBe(0);
    expect(result.rows[0]).toEqual(
      expect.objectContaining({
        partition: "training",
        mode: "Car",
        exactDistanceM: 1000,
      }),
    );
    expect(
      result.rows[0]?.parentFeatures.map((item) => item.sampleStatus),
    ).toEqual(["minimally_analytical", "hypothesis_only"]);
    expect(result.historicalStarsUsedAsInheritedTrait).toBe(false);
    expect(result.predictiveLiftClaimed).toBe(false);
    expect(result.exceptionalOffspringProbabilityProduced).toBe(false);
    expect(result.recommendationAllowed).toBe(false);
  });

  it("partitions observations chronologically by breeding time", () => {
    const result = buildParentOffspringResearchDataset(
      input({
        observations: [
          observation({
            breedingAt: "2026-07-06T00:00:00Z",
            parentSnapshots: [parent("parent-a"), parent("parent-b")],
          }),
        ],
      }),
    );
    expect(result.holdoutRowCount).toBe(1);
    expect(result.rows[0]?.partition).toBe("holdout");
  });

  it("excludes parent features that reach or follow breeding", () => {
    const result = buildParentOffspringResearchDataset(
      input({
        observations: [
          observation({
            parentSnapshots: [
              parent("parent-a", {
                dataCurrentThrough: "2026-07-02T00:00:00Z",
                lastImported: "2026-07-02T01:00:00Z",
              }),
              parent("parent-b"),
            ],
          }),
        ],
      }),
    );
    expect(result.rows).toHaveLength(0);
    expect(result.exclusions[0]?.reasons).toContain(
      "PARENT_FEATURE_AFTER_BREEDING",
    );
  });

  it("excludes stale parent evidence and exact-cell mismatch", () => {
    const result = buildParentOffspringResearchDataset(
      input({
        observations: [
          observation({
            parentSnapshots: [
              parent("parent-a", { freshness: "stale" }),
              parent("parent-b", { exactDistanceM: 1200 }),
            ],
          }),
        ],
      }),
    );
    expect(result.exclusions[0]?.reasons).toEqual(
      expect.arrayContaining(["PARENT_FEATURE_STALE", "PARENT_CELL_MISMATCH"]),
    );
  });

  it("excludes outcomes that are not strictly after breeding", () => {
    const result = buildParentOffspringResearchDataset(
      input({
        observations: [
          observation({
            outcomes: [
              {
                ...observation().outcomes[0]!,
                eventAt: "2026-07-02T00:00:00Z",
              },
            ],
          }),
        ],
      }),
    );
    expect(result.exclusions[0]?.reasons).toContain(
      "OUTCOME_NOT_AFTER_BREEDING",
    );
  });

  it("keeps incomplete offspring star evidence out of research rows", () => {
    const result = buildParentOffspringResearchDataset(
      input({
        observations: [
          observation({
            outcomes: [
              {
                ...observation().outcomes[0]!,
                goldStar: null,
                blueStar: null,
                starDataStatus: "partial",
              },
            ],
          }),
        ],
      }),
    );
    expect(result.exclusions[0]?.reasons).toContain(
      "OUTCOME_STAR_DATA_INCOMPLETE",
    );
  });

  it("rejects star values attached to incomplete evidence", () => {
    expect(() =>
      buildParentOffspringResearchDataset(
        input({
          observations: [
            observation({
              outcomes: [
                {
                  ...observation().outcomes[0]!,
                  starDataStatus: "partial",
                },
              ],
            }),
          ],
        }),
      ),
    ).toThrow("cannot carry star observations");
  });

  it("rejects Gold on an ineligible offspring event", () => {
    expect(() =>
      buildParentOffspringResearchDataset(
        input({
          observations: [
            observation({
              outcomes: [
                {
                  ...observation().outcomes[0]!,
                  goldEligible: false,
                },
              ],
            }),
          ],
        }),
      ),
    ).toThrow("Gold-ineligible");
  });

  it("requires internally consistent star denominators", () => {
    expect(() =>
      buildParentOffspringResearchDataset(
        input({
          observations: [
            observation({
              parentSnapshots: [
                parent("parent-a", {
                  goldReceived: 3,
                  goldOpportunities: 2,
                }),
                parent("parent-b"),
              ],
            }),
          ],
        }),
      ),
    ).toThrow("inconsistent");
  });

  it("rejects duplicate authoritative event evidence", () => {
    expect(() =>
      buildParentOffspringResearchDataset(
        input({
          observations: [
            observation(),
            observation({
              observationId: "breeding-2",
              breedingAt: "2026-07-03T00:00:00Z",
            }),
          ],
        }),
      ),
    ).toThrow("event IDs must be unique");
  });

  it("requires ordered parent identity to match feature snapshots", () => {
    expect(() =>
      buildParentOffspringResearchDataset(
        input({
          observations: [
            observation({
              parentSnapshots: [parent("parent-b"), parent("parent-a")],
            }),
          ],
        }),
      ),
    ).toThrow("ordered parent IDs");
  });
});
