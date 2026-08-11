import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TournamentWorkspace } from "@/components/tournament-workspace";
import { rankTournamentCandidates } from "@/domain/tournament-candidate-ranking";

describe("Tournament workspace", () => {
  it("renders unavailable evidence without a fake opportunity", () => {
    const html = renderToStaticMarkup(
      <TournamentWorkspace
        brackets={[]}
        connectionStatus="persistence_not_configured"
        lastImportedAt={null}
      />,
    );

    expect(html).toContain("Tournament read model not connected");
    expect(html).toContain("No accepted tournament evidence");
    expect(html).toContain("Tournament entry unavailable");
    expect(html).toContain("Gate C not passed");
    expect(html).not.toContain("Recommended entry");
  });

  it("renders split and group labels, version binding, ties and Maiden preservation", () => {
    const common = {
      leaderboardGroupId: "synthetic-group",
      leaderboardGroupLabel: "Elite Group",
      configurationVersion: "config-v3",
      candidateSnapshotVersion: "snapshot-v9",
      eligibility: "eligible" as const,
      metricStatus: "complete" as const,
      metricRank: 2,
      metricEvidenceLabel: "Qualification points",
      timeEvidence: "competitive" as const,
      historicalStarSupport: "supports" as const,
      evidenceConfidence: "medium" as const,
      maidenState: "eligible" as const,
      dataCurrentThrough: "2026-07-20T00:00:00.000Z",
      lastImported: "2026-07-21T00:00:00.000Z",
      freshness: "current" as const,
    };
    const bracket = rankTournamentCandidates({
      tournamentId: "synthetic-tournament",
      tournamentLabel: "Synthetic Tournament",
      bracketId: "synthetic-split",
      splitLabel: "Horse Sprint Split",
      mode: "horse",
      eligibleDistancesMetres: [1_200, 1_600],
      discoveryRelevance: "priority",
      qualificationMetricLabel: "Qualification points",
      configurationVersion: "config-v3",
      candidateSnapshotVersion: "snapshot-v9",
      candidates: [
        {
          ...common,
          coreId: "synthetic-core",
          maidenModeDisposition: "preferred_here",
        },
        {
          ...common,
          coreId: "preserved-core",
          maidenModeDisposition: "preserve_for_stronger_mode",
        },
      ],
    });
    const html = renderToStaticMarkup(
      <TournamentWorkspace
        brackets={[bracket]}
        connectionStatus="read_model_connected"
        lastImportedAt="2026-07-21T00:00:00.000Z"
      />,
    );

    expect(html).toContain("Synthetic Tournament");
    expect(html).toContain("Horse Sprint Split");
    expect(html).toContain("Elite Group");
    expect(html).toContain("Configuration config-v3");
    expect(html).toContain("Candidate snapshot snapshot-v9");
    expect(html).toContain("Group rank 2");
    expect(html).toContain("Preserve Me");
    expect(html).toContain("equal metric ranks remain ties");
    expect(html).toContain("50% race gate is a hard cap");
    expect(html).toContain("Historical tournament evidence connected");
  });
});
