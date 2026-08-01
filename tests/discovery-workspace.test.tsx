import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiscoveryWorkspace } from "@/components/discovery-workspace";
import { buildDiscoveryProbePlan } from "@/domain/discovery-probe-plan";

describe("Discovery workspace", () => {
  it("renders unavailable evidence without a fake recommendation", () => {
    const html = renderToStaticMarkup(
      <DiscoveryWorkspace
        candidates={[]}
        connectionStatus="persistence_not_configured"
        lastImportedAt={null}
      />,
    );

    expect(html).toContain("Discovery read model not connected");
    expect(html).toContain("No accepted Discovery candidates");
    expect(html).toContain("Race entry unavailable");
    expect(html).toContain("Gate C not passed");
    expect(html).not.toContain("Recommended core");
  });

  it("renders exact-distance coverage and warnings as review evidence", () => {
    const candidates = buildDiscoveryProbePlan([
      {
        coreId: "synthetic-core",
        mode: "horse",
        distanceMetres: 1_600,
        directRaceCount: 4,
        lineageRelationship: "full_sibling",
        lineageResolved: true,
        lineageRaceCount: 10,
        tournamentRelevance: "priority",
        maidenState: "eligible",
        freshness: "current",
        dataCurrentThrough: "2026-07-20T00:00:00.000Z",
      },
    ]);
    const html = renderToStaticMarkup(
      <DiscoveryWorkspace
        candidates={candidates}
        connectionStatus="read_model_connected"
        lastImportedAt="2026-07-20T01:00:00.000Z"
      />,
    );

    expect(html).toContain("horse · 1,600 m");
    expect(html).toContain("Core synthetic-core");
    expect(html).toContain("6");
    expect(html).toContain("Full Sibling");
    expect(html).toContain("Maiden Commitment Review Required");
    expect(html).toContain("Historical Discovery evidence connected");
  });
});
