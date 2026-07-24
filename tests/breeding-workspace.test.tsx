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

  it("renders three separate rankings and exact pair evidence", () => {
    const ranking = rankBreedingPairs({
      rankingId: "synthetic-ranking",
      evaluatedAt: "2026-07-20T02:00:00.000Z",
      dataCurrentThrough: "2026-07-20T00:00:00.000Z",
      lastImported: "2026-07-20T01:00:00.000Z",
      freshness: "current",
      eliteWeightBasisPoints: 6_000,
      vaultFitWeightBasisPoints: 4_000,
      candidates: [
        {
          pairId: "synthetic-pair",
          parentCoreIds: ["synthetic-parent-a", "synthetic-parent-b"],
          source: "owned_owned",
          mode: "Horse",
          exactDistanceM: 1_600,
          ruleStatus: "eligible",
          availabilityStatus: "confirmed",
          evidenceConfidence: "moderate",
          distributionStatus: "supported",
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

    expect(html).toContain("Elite upside");
    expect(html).toContain("Vault gap");
    expect(html).toContain("Balanced");
    expect(html.match(/Pair synthetic-pair/g)).toHaveLength(3);
    expect(html).toContain("Horse · 1,600 m");
    expect(html).toContain("synthetic-parent-a + synthetic-parent-b");
  });
});
