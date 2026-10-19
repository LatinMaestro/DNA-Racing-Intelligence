import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OpenRaceWorkspace } from "@/components/open-race-workspace";
import { applyRacePredictionReconciliation } from "@/domain/race-prediction-reconciliation";
import { freezeRacePredictionSnapshot } from "@/domain/race-prediction-snapshot";
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
    eventStartsAt: "2026-07-24T00:00:00.000Z",
    eventIdentity: { status: "confirmed", eventId: "game-event-101" },
    probabilityContext: {
      mode: "bike",
      distanceMeters: 1_600,
      competition: "normal",
      format: "Synthetic",
      gateCount: 4,
      element: { status: "unknown", value: null },
    },
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
    eligibleCoreIds: ["owned:a"],
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
        coreId: "owned:a",
        medianTimeMs: 60_000,
        marginToStrongestOpponentMs: 0,
        starsAffectedRank: false,
        historicalStars: null,
      },
    ],
    strongestOpponentCoreId: "opponent-a",
    provisionalRecommendedCoreId: "owned:a",
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
    enteredCoreIds: ["owned:a", "opponent-a", "opponent-b", "opponent-c"],
    eventStartsAt: "2026-07-24T00:00:00.000Z",
    eventIdentity: { status: "confirmed", eventId: "game-event-101" },
    selectedOwnedCoreId: "owned:a",
    provisionalRecommendedCoreId: "owned:a",
    preEntryStatus: "provisional",
    status: "locked_for_observation",
    coreSwitchAllowed: false,
    replacementRecommendationAllowed: false,
  },
  observation: {
    observationId: "synthetic-observation",
    lockId: "synthetic-lock",
    gameEventId: "game-event-101",
    lockedAt: "2026-07-20T02:02:00.000Z",
    observedAt: "2026-07-20T02:03:00.000Z",
    gateCount: 4,
    enteredCoreIds: ["owned:a", "opponent-a", "opponent-b", "opponent-c"],
    selectedOwnedCoreId: "owned:a",
    gold: { status: "assigned", coreId: "opponent-a" },
    blue: { status: "assigned", coreId: "owned:a" },
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

const snapshot = freezeRacePredictionSnapshot({
  snapshotId: "snapshot-ui-1",
  eventId: "game-event-101",
  predictedAt: "2026-07-20T02:02:30.000Z",
  eventStartsAt: "2026-07-24T00:00:00.000Z",
  evidenceCutoff: "2026-07-20T00:00:00.000Z",
  modelVersion: "model-ui-v1",
  context: session.field.probabilityContext!,
  field: {
    fieldVersion: "field-v1",
    fieldCapturedAt: "2026-07-20T02:00:00.000Z",
    enteredCoreIds: ["owned:a", "opponent-a", "opponent-b", "opponent-c"],
  },
  sources: {
    sessionVersion: "session-v1",
    eligibilityVersion: "eligibility-v1",
    raceImportVersion: "race-import-v7",
    vaultSnapshotVersion: "vault-v3",
    historicalAggregateVersion: "aggregate-v4",
    historyGenerationVersion: "history-v1",
    historySourceIdentitySha256: "b".repeat(64),
    lockVersion: "lock-v1",
  },
  predictions: [
    {
      coreId: "owned:a",
      target: "win",
      status: "available",
      probabilityMillionths: 625_000,
      evidenceStatus: "complete",
      calculationId: "win-ui-1",
    },
    {
      coreId: "owned:a",
      target: "place",
      status: "unavailable",
      probabilityMillionths: null,
      evidenceStatus: "insufficient",
      calculationId: null,
    },
    {
      coreId: "owned:a",
      target: "blue_star",
      status: "review_required",
      probabilityMillionths: null,
      evidenceStatus: "partial",
      calculationId: null,
    },
    {
      coreId: "owned:a",
      target: "yellow_star",
      status: "unavailable",
      probabilityMillionths: null,
      evidenceStatus: "unavailable",
      calculationId: null,
    },
  ],
});

const reconciliation = applyRacePredictionReconciliation({
  reconciliationId: "reconciliation-ui-1",
  snapshot,
  acceptedResult: {
    eventId: "game-event-101",
    sourceEvidenceId: "accepted-result-ui-1",
    sourceVersion: "race-import-v8",
    acceptedAt: "2026-07-24T00:06:00.000Z",
    eventCompletedAt: "2026-07-24T00:05:00.000Z",
    outcomeStatus: "complete",
    starDataStatus: "complete",
    entries: snapshot.field.enteredCoreIds.map((coreId, index) => ({
      coreId,
      finishPosition: index + 1,
      goldStar: index === 0,
      blueStar: index === 0,
    })),
  },
  revision: 0,
  correctsSourceEvidenceId: null,
  previous: null,
}).reconciliation;

describe("Open Race workspace", () => {
  it.each([
    ["read_failed", "Open Race evidence temporarily unavailable"],
    ["integrity_failed", "Open Race evidence failed validation"],
  ] as const)(
    "renders %s without partial stages",
    (connectionStatus, heading) => {
      const html = renderToStaticMarkup(
        <OpenRaceWorkspace
          connectionStatus={connectionStatus}
          predictionConnectionStatus="workspace_unavailable"
          sessions={[]}
        />,
      );
      expect(html).toContain(heading);
      expect(html).toContain("Open Race evidence withheld");
      expect(html).not.toContain("Confirm field lock");
      expect(html).not.toContain("Predicted win");
    },
  );

  it("renders fail-closed identity and empty evidence states", () => {
    const html = renderToStaticMarkup(
      <OpenRaceWorkspace
        connectionStatus="identity_not_connected"
        sessions={[]}
      />,
    );
    expect(html).toContain("Owner identity not connected");
    expect(html).toContain("No accepted Open Race session");
    expect(html).toContain("Accepted provisional sessions expose field-lock");
    expect(html).toContain("Gate C not passed");
    expect(html).not.toContain("/search-core");
  });

  it("renders bound Stage A and diagnostic Stage B evidence without actions", () => {
    const html = renderToStaticMarkup(
      <OpenRaceWorkspace
        connectionStatus="read_model_connected"
        sessions={[session]}
      />,
    );
    expect(html).toContain("Provisional review leader: Core owned:a");
    expect(html).toContain("Committed core owned:a");
    expect(
      html.match(/href="\/search-core\?q=owned%3Aa&amp;coreId=owned%3Aa"/g),
    ).toHaveLength(2);
    expect(html.match(/View Core owned:a history/g)).toHaveLength(2);
    expect(html).toContain("Switching disabled");
    expect(html).toContain("Pending Authoritative Import");
    expect(html).toContain("Frozen pre-entry ranking unchanged");
    expect(html).toContain("Historical aggregates aggregate-v4");
    expect(html).toContain("Probability context");
    expect(html).toContain("Normal · Element Unknown");
    expect(html).toContain("Game event identity");
    expect(html).toContain("game-event-101");
    expect(html).toContain("Scheduled event time");
    expect(html).toContain("2026-07-24T00:00:00.000Z");
    expect(html).not.toContain("Enter race");
  });

  it("renders frozen prediction targets and accepted reconciliation separately", () => {
    const html = renderToStaticMarkup(
      <OpenRaceWorkspace
        connectionStatus="read_model_connected"
        predictionConnectionStatus="read_model_connected"
        predictionEvidence={[
          {
            requestId: "synthetic-request",
            status: "available",
            reason: null,
            items: [{ snapshot, latestReconciliation: reconciliation }],
          },
        ]}
        sessions={[session]}
      />,
    );
    expect(html).toContain("Frozen probability and star evidence");
    expect(html).toContain("Model model-ui-v1");
    expect(html).toContain("62.50%");
    expect(html).toContain("Yellow star (source: gold_star)");
    expect(html).toContain("Blue star");
    expect(html).toContain(
      "Accepted result Reconciled · revision 0 · outcome Complete · stars Complete.",
    );
    expect(html).toContain("No automatic promotion, race entry or game action");
  });

  it("labels legacy sessions without exact probability context as unavailable", () => {
    const html = renderToStaticMarkup(
      <OpenRaceWorkspace
        connectionStatus="read_model_connected"
        sessions={[
          {
            ...session,
            field: { ...session.field, probabilityContext: null },
          },
        ]}
      />,
    );
    expect(html).toContain("Unavailable — exact-context estimates withheld");
  });

  it("withholds prediction reconciliation when event identity is unavailable", () => {
    const html = renderToStaticMarkup(
      <OpenRaceWorkspace
        connectionStatus="read_model_connected"
        sessions={[
          {
            ...session,
            field: {
              ...session.field,
              eventIdentity: { status: "unavailable", eventId: null },
            },
          },
        ]}
      />,
    );
    expect(html).toContain("Unavailable — prediction reconciliation withheld");
  });

  it("withholds prediction freeze when the legacy schedule is unavailable", () => {
    const html = renderToStaticMarkup(
      <OpenRaceWorkspace
        connectionStatus="read_model_connected"
        sessions={[
          {
            ...session,
            field: { ...session.field, eventStartsAt: null },
          },
        ]}
      />,
    );
    expect(html).toContain("Unavailable — prediction freeze withheld");
  });

  it("offers evidence-only field lock confirmation for an accepted provisional session", () => {
    const provisional = {
      ...session,
      stage: "provisional_selection" as const,
      lock: null,
      observation: null,
      comparison: null,
    };
    const html = renderToStaticMarkup(
      <OpenRaceWorkspace
        connectionStatus="read_model_connected"
        sessions={[provisional]}
      />,
    );
    expect(html).toContain("Confirm committed field lock");
    expect(html).toContain('name="selectedOwnedCoreId"');
    expect(html).toContain('value="owned:a"');
    expect(html).toContain('name="userConfirmedCommittedEntry"');
    expect(html).toContain('name="raceSetToRun"');
    expect(html).toContain("does not enter a race");
    expect(html).not.toContain("Connect wallet");
  });

  it("offers diagnostic star recording only after field lock", () => {
    const locked = {
      ...session,
      stage: "locked_observation" as const,
      observation: null,
      comparison: null,
    };
    const html = renderToStaticMarkup(
      <OpenRaceWorkspace
        connectionStatus="read_model_connected"
        sessions={[locked as unknown as OpenRaceWorkspaceSession]}
      />,
    );
    expect(html).toContain("Record revealed stars");
    expect(html).toContain('name="gold"');
    expect(html).toContain('name="blue"');
    expect(html).toContain('value="core:owned:a"');
    expect(html).toContain('name="starsRevealedAfterLock"');
    expect(html).toContain('name="gameEventId"');
    expect(html).toContain('value="game-event-101"');
    expect(html).not.toContain('type="text" name="gameEventId"');
    expect(html).toContain("cannot change the frozen ranking");
    expect(html).not.toContain("Enter race");
  });

  it("does not offer a substitutable event identity when the locked identity is unavailable", () => {
    const locked = {
      ...session,
      stage: "locked_observation" as const,
      lock: {
        ...session.lock,
        eventIdentity: { status: "unavailable" as const, eventId: null },
      },
      observation: null,
      comparison: null,
    };
    const html = renderToStaticMarkup(
      <OpenRaceWorkspace
        connectionStatus="read_model_connected"
        sessions={[locked as unknown as OpenRaceWorkspaceSession]}
      />,
    );
    expect(html).toContain("Unavailable — prediction reconciliation withheld");
    expect(html).not.toContain('name="gameEventId"');
  });
});
