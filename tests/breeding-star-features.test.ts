import { describe, expect, it } from "vitest";

import {
  buildBreedingStarFeatures,
  type BreedingStarFeatureInput,
  type BreedingStarProfile,
} from "../domain/breeding-star-features";

function profile(
  evidenceCoreId: string,
  subjectParentId: "parent-a" | "parent-b",
  overrides: Partial<BreedingStarProfile> = {},
): BreedingStarProfile {
  return {
    subjectParentId,
    evidenceCoreId,
    relationship:
      evidenceCoreId === subjectParentId ? "direct_parent" : "grandparent",
    mode: "Car",
    exactDistanceM: 1000,
    raceCount: 12,
    goldReceived: 3,
    goldOpportunities: 10,
    blueReceived: 2,
    blueOpportunities: 10,
    strongFieldGoldReceived: 2,
    strongFieldGoldOpportunities: 6,
    strongFieldBlueReceived: 1,
    strongFieldBlueOpportunities: 6,
    dataCurrentThrough: "2026-06-30T00:00:00Z",
    lastImported: "2026-07-01T00:00:00Z",
    freshness: "current",
    evidenceStatus: "complete",
    ...overrides,
  };
}

function input(
  overrides: Partial<BreedingStarFeatureInput> = {},
): BreedingStarFeatureInput {
  return {
    researchPairId: "pair-1",
    parentCoreIds: ["parent-a", "parent-b"],
    breedingAt: "2026-07-10T00:00:00Z",
    mode: "Car",
    exactDistanceM: 1000,
    minimumOutlierOpportunities: 5,
    populationBenchmarks: {
      goldRateBasisPoints: 2000,
      blueRateBasisPoints: 1500,
      strongFieldGoldRateBasisPoints: 2500,
      strongFieldBlueRateBasisPoints: 1500,
      dataCurrentThrough: "2026-06-29T00:00:00Z",
    },
    profiles: [
      profile("parent-a", "parent-a"),
      profile("parent-b", "parent-b", {
        raceCount: 8,
        goldOpportunities: 8,
        blueOpportunities: 8,
      }),
      profile("grand-a", "parent-a"),
    ],
    ...overrides,
  };
}

describe("breeding star features", () => {
  it("preserves direct parent counts, denominators and sample status", () => {
    const result = buildBreedingStarFeatures(input());
    expect(result.readyForChronologicalTest).toBe(true);
    expect(result.parentFeatures[0]?.directProfile?.gold).toEqual({
      received: 3,
      opportunities: 10,
      rateBasisPoints: 3000,
    });
    expect(result.parentFeatures[1]?.directProfile?.sampleStatus).toBe(
      "hypothesis_only",
    );
    expect(result.starTraitsAssumedInherited).toBe(false);
    expect(result.offspringQualityPredicted).toBe(false);
    expect(result.recommendationAllowed).toBe(false);
  });

  it("counts lineage outliers only when their denominator is sufficient", () => {
    const result = buildBreedingStarFeatures(
      input({
        profiles: [
          profile("parent-a", "parent-a"),
          profile("parent-b", "parent-b"),
          profile("large", "parent-a", {
            goldReceived: 3,
            goldOpportunities: 6,
          }),
          profile("small", "parent-a", {
            raceCount: 4,
            goldReceived: 2,
            goldOpportunities: 4,
            blueReceived: 1,
            blueOpportunities: 4,
            strongFieldGoldReceived: 1,
            strongFieldGoldOpportunities: 4,
            strongFieldBlueReceived: 1,
            strongFieldBlueOpportunities: 4,
          }),
        ],
      }),
    );
    expect(result.parentFeatures[0]?.lineageProfilesUsed).toBe(2);
    expect(result.parentFeatures[0]?.lineageGoldOutlierCount).toBe(1);
  });

  it("keeps zero-opportunity rates explicit rather than negative", () => {
    const result = buildBreedingStarFeatures(
      input({
        profiles: [
          profile("parent-a", "parent-a", {
            goldReceived: 0,
            goldOpportunities: 0,
            strongFieldGoldReceived: 0,
            strongFieldGoldOpportunities: 0,
          }),
          profile("parent-b", "parent-b"),
        ],
      }),
    );
    expect(
      result.parentFeatures[0]?.directProfile?.gold.rateBasisPoints,
    ).toBeNull();
  });

  it("excludes stale, incomplete and mismatched evidence with reasons", () => {
    const result = buildBreedingStarFeatures(
      input({
        profiles: [
          profile("parent-a", "parent-a"),
          profile("parent-b", "parent-b", { freshness: "stale" }),
          profile("grand-a", "parent-a", {
            evidenceStatus: "partial",
            exactDistanceM: 1200,
          }),
        ],
      }),
    );
    expect(result.readyForChronologicalTest).toBe(false);
    expect(result.exclusions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reasons: ["EVIDENCE_NOT_CURRENT"] }),
        expect.objectContaining({
          reasons: expect.arrayContaining([
            "CELL_MISMATCH",
            "EVIDENCE_NOT_COMPLETE",
          ]),
        }),
      ]),
    );
  });

  it("excludes features whose evidence reaches breeding time", () => {
    const result = buildBreedingStarFeatures(
      input({
        profiles: [
          profile("parent-a", "parent-a", {
            dataCurrentThrough: "2026-07-10T00:00:00Z",
            lastImported: "2026-07-10T01:00:00Z",
          }),
          profile("parent-b", "parent-b"),
        ],
      }),
    );
    expect(result.exclusions[0]?.reasons).toContain("FEATURE_AFTER_BREEDING");
  });

  it("requires population benchmarks to predate breeding", () => {
    expect(() =>
      buildBreedingStarFeatures(
        input({
          populationBenchmarks: {
            ...input().populationBenchmarks,
            dataCurrentThrough: "2026-07-10T00:00:00Z",
          },
        }),
      ),
    ).toThrow("benchmarks must predate breeding");
  });

  it("rejects inconsistent star numerators and denominators", () => {
    expect(() =>
      buildBreedingStarFeatures(
        input({
          profiles: [
            profile("parent-a", "parent-a", {
              goldReceived: 3,
              goldOpportunities: 2,
            }),
            profile("parent-b", "parent-b"),
          ],
        }),
      ),
    ).toThrow("internally inconsistent");
  });

  it("requires strong-field opportunities to be overall subsets", () => {
    expect(() =>
      buildBreedingStarFeatures(
        input({
          profiles: [
            profile("parent-a", "parent-a", {
              goldOpportunities: 5,
              strongFieldGoldOpportunities: 6,
            }),
            profile("parent-b", "parent-b"),
          ],
        }),
      ),
    ).toThrow("must be subsets");
  });

  it("rejects a lineage profile assigned to an unknown parent", () => {
    expect(() =>
      buildBreedingStarFeatures({
        ...input(),
        profiles: [
          ...input().profiles,
          profile("grand-x", "parent-a", {
            subjectParentId: "parent-x",
          }),
        ],
      }),
    ).toThrow("supplied parent");
  });

  it("rejects duplicate profile identities", () => {
    expect(() =>
      buildBreedingStarFeatures(
        input({
          profiles: [
            profile("parent-a", "parent-a"),
            profile("parent-a", "parent-a"),
            profile("parent-b", "parent-b"),
          ],
        }),
      ),
    ).toThrow("identities must be unique");
  });

  it("requires a direct profile to use the subject parent identity", () => {
    expect(() =>
      buildBreedingStarFeatures(
        input({
          profiles: [
            profile("wrong", "parent-a", {
              relationship: "direct_parent",
            }),
            profile("parent-b", "parent-b"),
          ],
        }),
      ),
    ).toThrow("direct-parent profile");
  });
});
