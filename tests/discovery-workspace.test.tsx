import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiscoveryWorkspace } from "@/components/discovery-workspace";
import { attachDiscoveryBenchmarks } from "@/domain/discovery-benchmark";
import { deriveDiscoveryDecisionGuidance } from "@/domain/discovery-decision-guidance";
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

  it("renders bounded owner probe guidance with direct, star and benchmark evidence", () => {
    const candidates = deriveDiscoveryDecisionGuidance(
      attachDiscoveryBenchmarks(
        buildDiscoveryProbePlan([
          {
            coreId: "synthetic-core",
            coreName: "Synthetic Core",
            mode: "horse",
            distanceMetres: 1_600,
            directRaceCount: 4,
            directTimeEvidence: {
              bestMilliseconds: 94_125,
              medianMilliseconds: 95_500,
              meanMilliseconds: 95_750,
              standardDeviationMilliseconds: 825,
            },
            starEvidence: {
              completeStarDataRaceCount: 3,
              goldEligibleRaceCount: 3,
              goldAssignmentOpportunityCount: 2,
              goldReceivedCount: 1,
              blueAssignmentOpportunityCount: 3,
              blueReceivedCount: 1,
            },
            lineageRelationship: null,
            lineageResolved: true,
            lineageRaceCount: 0,
            tournamentRelevance: "priority",
            maidenState: "eligible",
            freshness: "current",
            dataCurrentThrough: "2026-07-20T00:00:00.000Z",
          },
        ]),
        [
          {
            mode: "horse",
            distanceMetres: 1_600,
            dataCurrentThrough: "2026-07-20T00:00:00.000Z",
            raceEntryCount: 120,
            winningEntryCount: 30,
            topThreeEntryCount: 80,
            winningP25Milliseconds: 93_000,
            winningMedianMilliseconds: 94_500,
            winningP75Milliseconds: 95_000,
            topThreeP25Milliseconds: 94_000,
            topThreeMedianMilliseconds: 96_000,
            topThreeP75Milliseconds: 97_500,
            refreshedAt: "2026-07-20T01:00:00.000Z",
          },
        ],
      ),
    );
    const html = renderToStaticMarkup(
      <DiscoveryWorkspace
        candidates={candidates}
        connectionStatus="read_model_connected"
        lastImportedAt="2026-07-20T01:00:00.000Z"
        publication={{
          refreshId: "a1450000-0000-4000-8000-000000000030",
          raceDatasetVersionId: "a1450000-0000-4000-8000-000000000020",
          sourceVersionSetSha256: "b".repeat(64),
          payloadSha256: "c".repeat(64),
          benchmarkCount: 1,
          refreshedAt: "2026-07-20T01:00:00.000Z",
          publishedAt: "2026-07-20T02:00:00.000Z",
        }}
      />,
    );

    expect(html).toContain("Search the whole Vault");
    expect(html).toContain("<table");
    expect(html).toContain("Horse");
    expect(html).toContain("1,600 m");
    expect(html).toContain("Synthetic Core");
    expect(html).toContain("synthetic-core");
    expect(html).toContain("3 races");
    expect(html).toContain("Continue Targeted Probe");
    expect(html).toContain(
      "Direct time reaches the historical winner range; continue a bounded exact-distance probe.",
    );
    expect(html).toContain("No automatic entry or stop is allowed");
    expect(html).toContain("Direct imported results");
    expect(html).toContain("Winning Range");
    expect(html).toContain("Best 94.125 s · Median 95.500 s");
    expect(html).toContain("Mean 95.750 s · σ 0.825 s");
    expect(html).toContain(
      "Median 94.500 s · 75th percentile 95.000 s · 30 winners",
    );
    expect(html).toContain(
      "Median 96.000 s · 75th percentile 97.500 s · 80 top-three results",
    );
    expect(html).toContain("1/2 (50%) · 3 Yellow-eligible races");
    expect(html).toContain("1/3 (33%)");
    expect(html).toContain("descriptive historical distributions");
    expect(html).toContain(
      "raw conversion does not improve priority without opposition-quality evidence",
    );
    expect(html).toContain("Priority");
    expect(html).toContain("Maiden Commitment Review Required");
    expect(html).toContain("Owned-core Discovery planner connected");
    expect(html).toContain("Accepted refresh");
    expect(html).toContain("a1450000-0000-4000-8000-000000000030");
    expect(html).toContain("Race dataset version");
    expect(html).toContain("a1450000-0000-4000-8000-000000000020");
    expect(html).toContain("Benchmarks accepted");
    expect(html).toContain("Accepted aggregate payload SHA-256");
    expect(html).toContain("c".repeat(64));
    expect(html).toContain("Accepted source-version SHA-256");
    expect(html).toContain("b".repeat(64));
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
      const candidates = deriveDiscoveryDecisionGuidance(
        attachDiscoveryBenchmarks(
          buildDiscoveryProbePlan([
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
          ]),
          [],
        ),
      );
      const html = renderToStaticMarkup(
        <DiscoveryWorkspace
          candidates={candidates}
          connectionStatus="read_model_connected"
          lastImportedAt="2026-07-20T01:00:00.000Z"
        />,
      );

      expect(html).toContain("0/10");
      expect(html).toContain(`${expectedLabel} · 18 supporting races`);
      expect(html).toContain("Not yet available");
      expect(html).toContain("3 races");
      expect(html).toContain("No automatic entry or stop is allowed");
    },
  );

  it("labels population evidence as supporting races rather than lineage", () => {
    const candidates = deriveDiscoveryDecisionGuidance(
      attachDiscoveryBenchmarks(
        buildDiscoveryProbePlan([
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
        ]),
        [],
      ),
    );
    const html = renderToStaticMarkup(
      <DiscoveryWorkspace
        candidates={candidates}
        connectionStatus="read_model_connected"
        lastImportedAt="2026-07-20T01:00:00.000Z"
      />,
    );

    expect(html).toContain(
      "Population Pattern hypothesis · 42 supporting races",
    );
    expect(html).not.toContain("42 lineage races");
    expect(html).toContain("3 races");
    expect(html).toContain("No automatic entry or stop is allowed");
  });

  it("discloses historical-only preview with the existing as-of probe calculation", () => {
    const candidates = deriveDiscoveryDecisionGuidance(
      attachDiscoveryBenchmarks(
        buildDiscoveryProbePlan([
          {
            coreId: "synthetic-stale-core",
            coreName: "Historical Core",
            mode: "car",
            distanceMetres: 1_200,
            directRaceCount: 3,
            directTimeEvidence: {
              bestMilliseconds: 58_000,
              medianMilliseconds: 59_000,
              meanMilliseconds: 59_100,
              standardDeviationMilliseconds: 800,
            },
            starEvidence: null,
            lineageRelationship: null,
            lineageResolved: true,
            lineageRaceCount: 0,
            tournamentRelevance: "none",
            maidenState: "not_eligible",
            freshness: "stale",
            dataCurrentThrough: "2026-07-10T00:00:00.000Z",
          },
        ]),
        [],
      ),
    );
    const html = renderToStaticMarkup(
      <DiscoveryWorkspace
        candidates={candidates}
        connectionStatus="read_model_connected"
        lastImportedAt="2026-07-20T01:00:00.000Z"
      />,
    );

    expect(candidates[0]?.decisionActionable).toBe(false);
    expect(html).toContain("Historical snapshot preview only");
    expect(html).toContain("3/10");
    expect(html).toContain("3 races");
    expect(html).toContain("Stale");
    expect(html).toContain("Do not enter races, spend assets or stop testing");
  });
});
