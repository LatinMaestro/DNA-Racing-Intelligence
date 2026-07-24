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

  it("renders configured-metric evidence and Maiden preservation", () => {
    const bracket = rankTournamentCandidates({
      tournamentId: "synthetic-tournament",
      bracketId: "synthetic-bracket",
      candidates: [
        {
          coreId: "synthetic-core",
          leaderboardGroupId: "synthetic-group",
          eligibility: "eligible",
          metricStatus: "complete",
          metricRank: 2,
          metricEvidenceLabel: "Synthetic metric",
          timeEvidence: "competitive",
          historicalStarSupport: "supports",
          evidenceConfidence: "medium",
          maidenState: "eligible",
          maidenModeDisposition: "preserve_for_stronger_mode",
          dataCurrentThrough: "2026-07-20T00:00:00.000Z",
          lastImported: "2026-07-20T01:00:00.000Z",
          freshness: "current",
        },
      ],
    });
    const html = renderToStaticMarkup(
      <TournamentWorkspace
        brackets={[bracket]}
        connectionStatus="read_model_connected"
        lastImportedAt="2026-07-20T01:00:00.000Z"
      />,
    );

    expect(html).toContain("Tournament synthetic-tournament");
    expect(html).toContain("Bracket synthetic-bracket");
    expect(html).toContain("Core synthetic-core");
    expect(html).toContain("Rank 2");
    expect(html).toContain("Preserve Me");
    expect(html).toContain("50% race gate is a hard cap");
    expect(html).toContain("Historical tournament evidence connected");
  });
});
