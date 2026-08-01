import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OpenRaceWorkspace } from "@/components/open-race-workspace";
import type { OpenRaceWorkspaceSession } from "@/lib/open-race-workspace-service";

const session = {
  stage: "observation_compared",
  field: {
    requestId: "synthetic-request",
    capturedAt: "2026-07-20T02:00:00.000Z",
    dataCurrentThrough: "2026-07-20T00:00:00.000Z",
    lastImported: "2026-07-20T01:00:00.000Z",
    freshness: "current",
    mode: "bike",
    distanceMeters: 1_600,
    gateCount: 4,
    availableGates: 1,
    raceFormat: "Synthetic",
    entryFee: { amount: "0.01", asset: "ETH" },
    opponentCoreIds: ["opponent-a", "opponent-b", "opponent-c"],
    restrictions: [],
    status: "ready_for_provisional_selection",
    reviewReasons: [],
    fieldStage: "forming",
    currentRaceStarsAccepted: false,
    historicalSnapshotOnly: true,
    liveGameConnection: false,
  },
  eligibility: {
    evaluationId: "synthetic-eligibility",
    evaluatedAt: "2026-07-20T02:00:00.000Z",
    vaultDataCurrentThrough: "2026-07-20T00:00:00.000Z",
    freshness: "current",
    eligibleCoreIds: ["owned-a"],
    excludedCores: [],
    status: "confirmed",
    reviewReasons: [],
  },
  ranking: {
    rankingId: "synthetic-ranking",
    evaluatedAt: "2026-07-20T02:01:00.000Z",
    dataCurrentThrough: "2026-07-20T00:00:00.000Z",
    freshness: "current",
    mode: "bike",
    distanceMeters: 1_600,
    status: "provisional",
    rankedCandidates: [
      {
        rank: 1,
        coreId: "owned-a",
        medianTimeMs: 60_000,
        marginToStrongestOpponentMs: 0,
        starsAffectedRank: false,
        historicalStars: null,
      },
    ],
    strongestOpponentCoreId: "opponent-a",
    provisionalRecommendedCoreId: "owned-a",
    avoidSignal: false,
    reviewReasons: [],
    warnings: [],
    currentRaceStarsUsed: false,
    replacementRecommendationAllowed: false,
    raceEntryAllowed: false,
    finalActionableRecommendationAllowed: false,
  },
  lock: {
    lockId: "synthetic-lock",
    requestId: "synthetic-request",
    preEntryRankingId: "synthetic-ranking",
    lockedAt: "2026-07-20T02:02:00.000Z",
    gateCount: 4,
    enteredCoreIds: ["owned-a", "opponent-a", "opponent-b", "opponent-c"],
    selectedOwnedCoreId: "owned-a",
    provisionalRecommendedCoreId: "owned-a",
    preEntryStatus: "provisional",
    status: "locked_for_observation",
    coreSwitchAllowed: false,
    replacementRecommendationAllowed: false,
  },
  observation: {
    observationId: "synthetic-observation",
    lockId: "synthetic-lock",
    gameEventId: null,
    lockedAt: "2026-07-20T02:02:00.000Z",
    observedAt: "2026-07-20T02:03:00.000Z",
    gateCount: 4,
    enteredCoreIds: ["owned-a", "opponent-a", "opponent-b", "opponent-c"],
    selectedOwnedCoreId: "owned-a",
    gold: { status: "assigned", coreId: "opponent-a" },
    blue: { status: "assigned", coreId: "owned-a" },
    selectedCoreSignal: "blue",
    goldApplicable: true,
    recordStatus: "recorded",
    reconciliationStatus: "pending_authoritative_import",
    issues: [],
    observationOnly: true,
    completedRaceResult: false,
  },
  comparison: {
    comparisonId: "synthetic-comparison",
    lockId: "synthetic-lock",
    observationId: "synthetic-observation",
    comparedAt: "2026-07-20T02:04:00.000Z",
    diagnosticStatus: "aligned",
    selectedCoreSignal: "blue",
    frozenPreEntryRanking: true,
    rankingChanged: false,
    predictionSuccessClaimAllowed: false,
    recommendation: null,
    notes: [],
  },
  bindings: {
    sessionVersion: "session-v1",
    fieldVersion: "field-v1",
    eligibilityVersion: "eligibility-v1",
    historicalAggregateVersion: "aggregate-v4",
    raceImportVersion: "race-import-v7",
    vaultSnapshotVersion: "vault-v3",
    rankingVersion: "ranking-v1",
    lockVersion: "lock-v1",
    observationVersion: "observation-v1",
    comparisonVersion: "comparison-v1",
  },
  mutationAllowed: false,
  liveGameConnection: false,
  gateCPassed: false,
} as unknown as OpenRaceWorkspaceSession;

describe("Open Race workspace", () => {
  it("renders fail-closed identity and empty evidence states", () => {
    const html = renderToStaticMarkup(
      <OpenRaceWorkspace
        connectionStatus="identity_not_connected"
        sessions={[]}
      />,
    );
    expect(html).toContain("Owner identity not connected");
    expect(html).toContain("No accepted Open Race session");
    expect(html).toContain("Stage A capture unavailable");
    expect(html).toContain("Gate C not passed");
  });

  it("renders bound Stage A and diagnostic Stage B evidence without actions", () => {
    const html = renderToStaticMarkup(
      <OpenRaceWorkspace
        connectionStatus="read_model_connected"
        sessions={[session]}
      />,
    );
    expect(html).toContain("Provisional review leader: Core owned-a");
    expect(html).toContain("Committed core owned-a");
    expect(html).toContain("Switching disabled");
    expect(html).toContain("Pending Authoritative Import");
    expect(html).toContain("Frozen pre-entry ranking unchanged");
    expect(html).toContain("Historical aggregates aggregate-v4");
    expect(html).not.toContain("Enter race");
  });
});
