import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TournamentCoreSelectionPanel } from "@/components/tournament-core-selection-panel";
import { rankTournamentCandidates } from "@/domain/tournament-candidate-ranking";

const bracket = rankTournamentCandidates({
  tournamentId: "tour-1",
  tournamentLabel: "Season 12 Cup",
  bracketId: "bike-a",
  splitLabel: "Bike Fire",
  mode: "bike",
  eligibleDistancesMetres: [1200],
  discoveryRelevance: "priority",
  qualificationMetricLabel: "median_time",
  configurationVersion: "config-v1",
  candidateSnapshotVersion: "snapshot-v1",
  candidates: [
    {
      coreId: "10457",
      leaderboardGroupId: "fire",
      leaderboardGroupLabel: "Fire",
      configurationVersion: "config-v1",
      candidateSnapshotVersion: "snapshot-v1",
      eligibility: "eligible",
      metricStatus: "complete",
      metricRank: 1,
      metricEvidenceLabel: "median_time",
      timeEvidence: "strong",
      historicalStarSupport: "supports",
      evidenceConfidence: "high",
      maidenState: "not_eligible",
      maidenModeDisposition: "not_applicable",
      dataCurrentThrough: "2026-09-22T00:00:00.000Z",
      lastImported: "2026-09-23T00:00:00.000Z",
      freshness: "ageing",
    },
    {
      coreId: "20001",
      leaderboardGroupId: "fire",
      leaderboardGroupLabel: "Fire",
      configurationVersion: "config-v1",
      candidateSnapshotVersion: "snapshot-v1",
      eligibility: "ineligible",
      metricStatus: "unavailable",
      metricRank: null,
      metricEvidenceLabel: null,
      timeEvidence: "unknown",
      historicalStarSupport: "unavailable",
      evidenceConfidence: "unknown",
      maidenState: "unknown",
      maidenModeDisposition: "unresolved",
      dataCurrentThrough: null,
      lastImported: "2026-09-23T00:00:00.000Z",
      freshness: "unknown",
    },
  ],
});

describe("Tournament Core selection panel", () => {
  it("renders the truthful empty-configuration state", () => {
    const html = renderToStaticMarkup(
      <TournamentCoreSelectionPanel
        brackets={[]}
        saveAction={async () => undefined}
        selectedBracket={null}
        selectionState={{
          connectionStatus: "identity_not_connected",
          selection: null,
        }}
      />,
    );
    expect(html).toContain("No accepted Tournament configuration exists");
    expect(html).not.toContain("Save selected Cores");
  });

  it("renders a picked whole-Vault table and reloads saved advisory choices", () => {
    const html = renderToStaticMarkup(
      <TournamentCoreSelectionPanel
        brackets={[bracket]}
        saveAction={async () => undefined}
        selectedBracket={{ tournamentId: "tour-1", bracketId: "bike-a" }}
        selectionState={{
          connectionStatus: "connected",
          selection: {
            tournamentId: "tour-1",
            bracketId: "bike-a",
            configurationVersion: "config-v1",
            candidateSnapshotVersion: "snapshot-v1",
            coreIds: ["10457"],
            updatedAt: "2026-10-27T12:00:00.000Z",
          },
        }}
      />,
    );
    expect(html).toContain("2 distinct Vault candidates");
    expect(html).toContain("Review rank");
    expect(html).toContain("Time evidence");
    expect(html).toContain(
      'aria-label="Select Core 10457" type="checkbox" name="coreId" checked=""',
    );
    expect(html).toContain(
      'aria-label="Select Core 20001" disabled="" type="checkbox"',
    );
    expect(html).toContain("1 Cores saved");
    expect(html).toContain("never enter a race");
  });
});
