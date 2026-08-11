import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiscoveryWorkspace } from "@/components/discovery-workspace";
import { buildDiscoveryProbePlan } from "@/domain/discovery-probe-plan";

describe("Discovery workspace", () => {
  it("renders unavailable evidence without inventing candidates", () => {
    const html = renderToStaticMarkup(
      <DiscoveryWorkspace
        candidates={[]}
        connectionStatus="persistence_not_configured"
        lastImportedAt={null}
      />,
    );

    expect(html).toContain("Discovery read model not connected");
    expect(html).toContain("No current Discovery candidates");
    expect(html).not.toContain("Recommended core");
  });

  it("renders bounded owner probe guidance for an owned core", () => {
    const candidates = buildDiscoveryProbePlan([
      {
        coreId: "synthetic-core",
        coreName: "Synthetic Core",
        mode: "horse",
        distanceMetres: 1_600,
        directRaceCount: 4,
        lineageRelationship: null,
        lineageResolved: true,
        lineageRaceCount: 0,
        tournamentRelevance: "none",
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
    expect(html).toContain("Synthetic Core");
    expect(html).toContain("Core ID synthetic-core");
    expect(html).toContain("3 races");
    expect(html).toContain("Continue Targeted Probe");
    expect(html).toContain("Direct imported results");
    expect(html).toContain("Maiden Commitment Review Required");
    expect(html).toContain("Owned-core Discovery planner connected");
  });

  it.each([
    ["parent", "Parent hypothesis"],
    ["full_sibling", "Full Sibling hypothesis"],
    ["half_sibling", "Half Sibling hypothesis"],
    ["offspring", "Offspring hypothesis"],
    ["wider_lineage", "Wider Lineage hypothesis"],
  ] as const)(
    "labels zero-race %s evidence without treating lineage as direct evidence",
    (lineageRelationship, expectedLabel) => {
      const candidates = buildDiscoveryProbePlan([
        {
          coreId: "untested-core",
          coreName: "Untested Core",
          mode: "bike",
          distanceMetres: 1_400,
          directRaceCount: 0,
          lineageRelationship,
          lineageResolved: true,
          lineageRaceCount: 18,
          tournamentRelevance: "none",
          maidenState: "not_eligible",
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

      expect(html).toContain("0 races");
      expect(html).toContain(`${expectedLabel} · 18 lineage races`);
      expect(html).toContain("3 races");
      expect(html).toContain("Lineage or population evidence");
    },
  );

  it("labels population evidence as supporting races rather than lineage", () => {
    const candidates = buildDiscoveryProbePlan([
      {
        coreId: "population-core",
        coreName: "Population Core",
        mode: "car",
        distanceMetres: 1_800,
        directRaceCount: 0,
        lineageRelationship: "population_pattern",
        lineageResolved: true,
        lineageRaceCount: 42,
        tournamentRelevance: "none",
        maidenState: "not_eligible",
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

    expect(html).toContain("Population Pattern hypothesis · 42 supporting races");
    expect(html).not.toContain("42 lineage races");
    expect(html).toContain("3 races");
    expect(html).toContain("Lineage or population evidence");
  });
});
