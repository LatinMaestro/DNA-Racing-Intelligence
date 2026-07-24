import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MaidenWorkspace } from "@/components/maiden-workspace";
import { allocateMaidenVaultOpportunities } from "@/domain/maiden-vault-allocation";

describe("Maiden workspace", () => {
  it("renders unavailable evidence without a fake opportunity", () => {
    const html = renderToStaticMarkup(
      <MaidenWorkspace
        allocation={null}
        connectionStatus="persistence_not_configured"
        lastImportedAt={null}
      />,
    );

    expect(html).toContain("Maiden read model not connected");
    expect(html).toContain("No accepted Maiden evidence");
    expect(html).toContain("Maiden commitment unavailable");
    expect(html).toContain("Gates C and D not passed");
    expect(html).not.toContain("Recommended commitment");
  });

  it("renders preserve-ME evidence without authorising commitment", () => {
    const allocation = allocateMaidenVaultOpportunities(
      [
        {
          tournamentId: "synthetic-maiden",
          bracketId: "synthetic-bracket",
          mode: "horse",
          reviewCapacity: 1,
          availability: "upcoming",
          ruleStatus: "confirmed",
        },
      ],
      [
        {
          candidateId: "synthetic-candidate",
          coreId: "synthetic-core",
          tournamentId: "synthetic-maiden",
          bracketId: "synthetic-bracket",
          mode: "horse",
          projectedValueBasisPoints: 8_500,
          suitability: "preserve_me",
          lifecycleState: "eligible",
          evidenceConfidence: "moderate",
          dataCurrentThrough: "2026-07-20T00:00:00.000Z",
          lastImported: "2026-07-20T01:00:00.000Z",
          freshness: "current",
        },
      ],
    );
    const html = renderToStaticMarkup(
      <MaidenWorkspace
        allocation={allocation}
        connectionStatus="read_model_connected"
        lastImportedAt="2026-07-20T01:00:00.000Z"
      />,
    );

    expect(html).toContain("Core synthetic-core");
    expect(html).toContain("horse · synthetic-maiden");
    expect(html).toContain("Preserve Me");
    expect(html).toContain("85%");
    expect(html).toContain("Current Maiden review evidence connected");
    expect(html).toContain("no entitlement mutation");
  });
});
