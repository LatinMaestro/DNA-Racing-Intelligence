import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LifecycleWorkspace } from "@/components/lifecycle-workspace";
import { rankLifecycleActions } from "@/domain/lifecycle-action-ranking";
import { core, ranking } from "./lifecycle-fixture";

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

  it("renders version-bound historical review and missing-basis warning", () => {
    const result = rankLifecycleActions(
      ranking({
        cores: [
          core(
            "synthetic-core",
            { sell: 9_000 },
            { costBasisStatus: "missing" },
          ),
        ],
      }),
    );
    const html = renderToStaticMarkup(
      <LifecycleWorkspace
        connectionStatus="read_model_connected"
        ranking={result}
      />,
    );
    expect(html).toContain("Historical lifecycle evidence connected");
    expect(html).toContain("Configuration lifecycle-config-v2");
    expect(html).toContain("Candidates candidate-v7");
    expect(html).toContain("Lineage lineage-v5");
    expect(html).toContain("Core synthetic-core · Morphed");
    expect(html).toContain("Strategic review only; not an instruction.");
    expect(html).toContain(
      "Cost basis is unavailable; sale proceeds cannot be described as profit.",
    );
    expect(html).toContain("No final recommendation");
  });

  it("renders held Genesis burn rather than an action", () => {
    const result = rankLifecycleActions(
      ranking({
        cores: [
          core(
            "genesis",
            { burn: 10_000 },
            {
              coreClass: "Genesis",
              racingState: "weak",
              breedingState: "not_supported",
              lineageState: "not_supported",
              nonStarNegativeEvidencePresent: true,
            },
          ),
        ],
      }),
    );
    const html = renderToStaticMarkup(
      <LifecycleWorkspace
        connectionStatus="read_model_connected"
        ranking={result}
      />,
    );
    expect(html).toContain("Held actions:");
    expect(html).toContain("Burn");
    expect(html).not.toContain("1. Burn");
  });
});
