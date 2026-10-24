import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BreedingWorkspace } from "@/components/breeding-workspace";
import { rankBreedingPairs } from "@/domain/breeding-pair-ranking";

describe("Breeding workspace", () => {
  it.each([
    ["read_failed", "Breeding evidence temporarily unavailable"],
    ["integrity_failed", "Breeding evidence failed validation"],
  ] as const)(
    "renders the %s fail-closed state",
    (connectionStatus, heading) => {
      const html = renderToStaticMarkup(
        <BreedingWorkspace connectionStatus={connectionStatus} rankings={[]} />,
      );

      expect(html).toContain(heading);
      expect(html).toContain("Breeding rankings withheld");
      expect(html).toContain(
        "Unknown does not mean that no accepted analysis exists",
      );
      expect(html).not.toContain("No accepted breeding rankings");
      expect(html).toContain("Breeding execution unavailable");
      expect(html).not.toContain("Recommended pair");
    },
  );

  it("renders unavailable evidence without a fake pair", () => {
    const html = renderToStaticMarkup(
      <BreedingWorkspace
        connectionStatus="persistence_not_configured"
        rankings={[]}
      />,
    );

    expect(html).toContain("Breeding read model not connected");
    expect(html).toContain("Breeding rankings withheld");
    expect(html).not.toContain("No accepted breeding rankings");
    expect(html).toContain("Breeding execution unavailable");
    expect(html).toContain("Gate E not passed");
    expect(html).not.toContain("Recommended pair");
  });

  it("reserves the empty claim for a verified connected snapshot", () => {
    const html = renderToStaticMarkup(
      <BreedingWorkspace
        connectionStatus="read_model_connected"
        rankings={[]}
      />,
    );

    expect(html).toContain("No accepted breeding rankings");
    expect(html).toContain("accepted snapshot contains no rankings");
    expect(html).not.toContain("Breeding rankings withheld");
  });

  it("renders accepted Vault breeding inputs without inventing pair readiness", () => {
    const html = renderToStaticMarkup(
      <BreedingWorkspace
        connectionStatus="read_model_connected"
        rankings={[]}
        vaultInventory={{
          ownedCoreCount: 214,
          sexCounts: { male: 102, female: 112 },
          elementCounts: { Metal: 50, Fire: 54, Earth: 55, Water: 55 },
          classCounts: {
            Genesis: 20,
            Morphed: 80,
            Freak: 70,
            "X-Class": 44,
          },
          minimumFNumber: 1,
          maximumFNumber: 27,
          coverage: "accepted_owner_api_snapshot",
          generationId: "84000000-0000-4000-8000-000000000601",
          oldestObservedAt: "2026-07-20T00:00:00.000Z",
          newestObservedAt: "2026-07-21T00:00:00.000Z",
        }}
      />,
    );

    expect(html).toContain("Current Vault breeding inputs");
    expect(html).toContain("214");
    expect(html).toContain("102 male");
    expect(html).toContain("112 female");
    expect(html).toContain("Metal 50");
    expect(html).toContain("F1–F27");
    expect(html).toContain("X-Class 44");
    expect(html).toContain("do not prove family compatibility");
    expect(html).toContain("No accepted breeding rankings");
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
        generationId="84000000-0000-4000-8000-000000000501"
        payloadSha256={"a".repeat(64)}
        publishedAt="2026-07-20T03:00:00.000Z"
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
    expect(html).toContain("Accepted generation");
    expect(html).toContain("84000000-0000-4000-8000-000000000501");
    expect(html).toContain("Payload SHA-256");
    expect(html).toContain("a".repeat(64));
    expect(html).toContain("20 July 2026, 3:00 am");
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
