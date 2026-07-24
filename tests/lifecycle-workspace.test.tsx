import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LifecycleWorkspace } from "@/components/lifecycle-workspace";
import {
  rankLifecycleActions,
  type LifecycleAction,
} from "@/domain/lifecycle-action-ranking";

const actions: readonly LifecycleAction[] = [
  "race",
  "discover",
  "reserve_maiden",
  "breed",
  "hold",
  "sell",
  "burn",
];

describe("Lifecycle workspace", () => {
  it("renders unavailable evidence without a disposal claim", () => {
    const html = renderToStaticMarkup(
      <LifecycleWorkspace
        connectionStatus="persistence_not_configured"
        ranking={null}
      />,
    );

    expect(html).toContain("Lifecycle read model not connected");
    expect(html).toContain("No accepted lifecycle evidence");
    expect(html).toContain("Sale unavailable");
    expect(html).toContain("Burn unavailable");
    expect(html).not.toContain("Recommended disposal");
  });

  it("renders review order while holding Genesis burn", () => {
    const ranking = rankLifecycleActions({
      rankingId: "synthetic-ranking",
      evaluatedAt: "2026-07-23T00:00:00.000Z",
      dataCurrentThrough: "2026-07-20T00:00:00.000Z",
      lastImported: "2026-07-21T00:00:00.000Z",
      freshness: "current",
      cores: [
        {
          coreId: "synthetic-core",
          coreClass: "Genesis",
          activeOwnership: true,
          protectionStatus: "clear",
          evidenceCoverage: "complete",
          maidenState: "not_eligible",
          discoveryState: "complete",
          marketEvidence: "confirmed",
          nonStarNegativeEvidencePresent: false,
          actionEvidence: actions.map((action) => ({
            action,
            supportStatus: "supported",
            scoreBasisPoints: action === "race" ? 9_000 : 1_000,
            evidenceReasons: [`Synthetic ${action} evidence.`],
          })),
        },
      ],
    });
    const html = renderToStaticMarkup(
      <LifecycleWorkspace
        connectionStatus="read_model_connected"
        ranking={ranking}
      />,
    );

    expect(html).toContain("Core synthetic-core");
    expect(html).toContain("1. Race");
    expect(html).toContain("90%");
    expect(html).toContain("Historical lifecycle evidence connected");
    expect(html).not.toContain(">Burn<");
  });
});
