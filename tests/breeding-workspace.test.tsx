import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BreedingWorkspace } from "@/components/breeding-workspace";
import { rankBreedingPairs } from "@/domain/breeding-pair-ranking";

describe("Breeding workspace", () => {
  it("renders unavailable evidence without a fake pair", () => {
    const html = renderToStaticMarkup(
      <BreedingWorkspace
        connectionStatus="persistence_not_configured"
        rankings={[]}
      />,
    );

    expect(html).toContain("Breeding read model not connected");
    expect(html).toContain("No accepted breeding rankings");
    expect(html).toContain("Breeding execution unavailable");
    expect(html).toContain("Gate E not passed");
    expect(html).not.toContain("Recommended pair");
  });

  it("renders separate bound rankings and confirmed offspring rules", () => {
    const versions = {
      rulesetVersion: "rules-v3",
      candidateSnapshotVersion: "candidates-v9",
      projectionVersion: "offspring-v4",
    } as const;
    const ranking = rankBreedingPairs({
      rankingId: "synthetic-ranking",
      rankingLabel: "Synthetic Horse 1,600 m",
      ...versions,
      arenaSnapshotVersion: "arena-v5",
      evaluatedAt: "2026-07-20T02:00:00.000Z",
      dataCurrentThrough: "2026-07-20T00:00:00.000Z",
      lastImported: "2026-07-20T01:00:00.000Z",
      freshness: "current",
      arenaDataCurrentThrough: "2026-07-20T00:00:00.000Z",
      arenaLastImported: "2026-07-20T01:00:00.000Z",
      arenaFreshness: "current",
      eliteWeightBasisPoints: 6_000,
      vaultFitWeightBasisPoints: 4_000,
      candidates: [
        {
          pairId: "synthetic-pair",
          parents: [
            {
              coreId: "synthetic-parent-a",
              ownership: "owned",
              coreClass: "Genesis",
              element: "Metal",
              fNumber: 3,
            },
            {
              coreId: "synthetic-parent-b",
              ownership: "arena",
              coreClass: "Morphed",
              element: "Earth",
              fNumber: 8,
            },
          ],
          source: "owned_arena",
          mode: "Horse",
          exactDistanceM: 1_600,
          ...versions,
          arenaSnapshotVersion: "arena-v5",
          ruleStatus: "eligible",
          familyStatus: "eligible",
          sexCompatibilityStatus: "compatible",
          cycleStatus: "available",
          spliceCapacityStatus: "available",
          availabilityStatus: "confirmed",
          arenaListingExpiresAt: "2026-07-25T00:00:00.000Z",
          evidenceConfidence: "moderate",
          distributionStatus: "supported",
          chronologicalValidationStatus: "supported",
          usesStarFeatures: false,
          starLiftStatus: "not_evaluated",
          exceptionalUpsideBasisPoints: 1_200,
          strongerOrExceptionalBasisPoints: 6_000,
          vaultFitBasisPoints: 7_000,
        },
      ],
    });
    const html = renderToStaticMarkup(
      <BreedingWorkspace
        connectionStatus="read_model_connected"
        rankings={[ranking]}
      />,
    );

    expect(html).toContain("Synthetic Horse 1,600 m");
    expect(html).toContain("Elite upside");
    expect(html).toContain("Vault gap");
    expect(html).toContain("Balanced");
    expect(html.match(/Pair synthetic-pair/g)).toHaveLength(3);
    expect(html).toContain("Horse · 1,600 m");
    expect(html).toContain("synthetic-parent-a + synthetic-parent-b");
    expect(html).toContain("Freak · Earth · F11");
    expect(html).toContain("Owned Arena");
    expect(html).toContain("Rules rules-v3");
    expect(html).toContain("Candidates candidates-v9");
    expect(html).toContain("Projection offspring-v4");
    expect(html).toContain("Arena snapshot arena-v5");
    expect(html).toContain("Imported Arena listing expiry");
    expect(html).toContain("Historical breeding evidence connected");
    expect(html).toContain("Find accepted pairs");
    expect(html).toContain("Compare parents and evidence");
    expect(html).toContain(
      "coreId=synthetic-parent-a&amp;mode=horse&amp;distance=1600#selected-core",
    );
    expect(html).toContain("itemised costs are not supplied");
    const before = JSON.stringify(ranking);
    const selected = renderToStaticMarkup(
      <BreedingWorkspace
        connectionStatus="read_model_connected"
        rankings={[ranking]}
        filters={{ mode: "horse", distance: 1600 }}
        selectedParents={["synthetic-parent-b", "synthetic-parent-a"]}
      />,
    );
    expect(selected.match(/Pair synthetic-pair/g)).toHaveLength(3);
    expect(selected).toContain("1. Pair synthetic-pair");
    const wrongDistance = renderToStaticMarkup(
      <BreedingWorkspace
        connectionStatus="read_model_connected"
        rankings={[ranking]}
        filters={{ mode: "horse", distance: 1800 }}
      />,
    );
    expect(wrongDistance).toContain("No accepted pairs match these filters");
    expect(wrongDistance).not.toContain("1. Pair synthetic-pair");
    const sameParent = renderToStaticMarkup(
      <BreedingWorkspace
        connectionStatus="read_model_connected"
        rankings={[ranking]}
        selectedParents={["synthetic-parent-a", "synthetic-parent-a"]}
      />,
    );
    expect(sameParent).not.toContain("1. Pair synthetic-pair");
    expect(JSON.stringify(ranking)).toBe(before);
  });
});
