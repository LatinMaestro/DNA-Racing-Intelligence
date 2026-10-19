import { describe, expect, it, vi } from "vitest";
import { applyRacePredictionReconciliation } from "@/domain/race-prediction-reconciliation";
import { freezeRacePredictionSnapshot } from "@/domain/race-prediction-snapshot";
import {
  composeOpenRacePredictionPageEvidence,
  loadOpenRacePredictionPageState,
} from "@/lib/open-race-prediction-page-service";
import type { OpenRaceWorkspaceSession } from "@/lib/open-race-workspace-service";

const enteredCoreIds = ["owned-a", "opponent-a", "opponent-b", "opponent-c"];

const session = {
  stage: "observation_compared",
  field: {
    requestId: "request-1",
    capturedAt: "2026-10-17T00:30:00.000Z",
    eventIdentity: { status: "confirmed", eventId: "event-1" },
    probabilityContext: {
      mode: "bike",
      distanceMeters: 1_600,
      competition: "normal",
      format: "4-gate",
      gateCount: 4,
      element: { status: "known", value: "Fire" },
    },
  },
  lock: {
    eventIdentity: { status: "confirmed", eventId: "event-1" },
    eventStartsAt: "2026-10-17T02:00:00.000Z",
    enteredCoreIds,
  },
  bindings: {
    sessionVersion: "session-v1",
    fieldVersion: "field-v1",
    eligibilityVersion: "eligibility-v1",
    historicalAggregateVersion: "aggregate-v1",
    raceImportVersion: "race-v1",
    vaultSnapshotVersion: "vault-v1",
    lockVersion: "lock-v1",
  },
} as unknown as OpenRaceWorkspaceSession;

const snapshot = freezeRacePredictionSnapshot({
  snapshotId: "snapshot-1",
  eventId: "event-1",
  predictedAt: "2026-10-17T01:00:00.000Z",
  eventStartsAt: "2026-10-17T02:00:00.000Z",
  evidenceCutoff: "2026-10-17T00:00:00.000Z",
  modelVersion: "model-v1",
  context: {
    mode: "bike",
    distanceMeters: 1_600,
    competition: "normal",
    format: "4-gate",
    gateCount: 4,
    element: { status: "known", value: "Fire" },
  },
  field: {
    fieldVersion: "field-v1",
    fieldCapturedAt: "2026-10-17T00:30:00.000Z",
    enteredCoreIds,
  },
  sources: {
    sessionVersion: "session-v1",
    eligibilityVersion: "eligibility-v1",
    raceImportVersion: "race-v1",
    vaultSnapshotVersion: "vault-v1",
    historicalAggregateVersion: "aggregate-v1",
    historyGenerationVersion: "history-v1",
    historySourceIdentitySha256: "a".repeat(64),
    lockVersion: "lock-v1",
  },
  predictions: [
    {
      coreId: "owned-a",
      target: "win",
      status: "available",
      probabilityMillionths: 625_000,
      evidenceStatus: "complete",
      calculationId: "win-1",
    },
    {
      coreId: "owned-a",
      target: "place",
      status: "unavailable",
      probabilityMillionths: null,
      evidenceStatus: "insufficient",
      calculationId: null,
    },
    {
      coreId: "owned-a",
      target: "blue_star",
      status: "review_required",
      probabilityMillionths: null,
      evidenceStatus: "partial",
      calculationId: null,
    },
    {
      coreId: "owned-a",
      target: "yellow_star",
      status: "unavailable",
      probabilityMillionths: null,
      evidenceStatus: "unavailable",
      calculationId: null,
    },
  ],
});

const reconciliation = applyRacePredictionReconciliation({
  reconciliationId: "reconciliation-1",
  snapshot,
  acceptedResult: {
    eventId: "event-1",
    sourceEvidenceId: "accepted-result-1",
    sourceVersion: "race-v2",
    acceptedAt: "2026-10-17T02:05:00.000Z",
    eventCompletedAt: "2026-10-17T02:04:00.000Z",
    outcomeStatus: "complete",
    starDataStatus: "complete",
    entries: enteredCoreIds.map((coreId, index) => ({
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

describe("Open Race prediction page service", () => {
  it("joins exact-version frozen evidence and the latest accepted result", () => {
    expect(
      composeOpenRacePredictionPageEvidence(
        [session],
        [snapshot],
        [reconciliation],
      ),
    ).toEqual([
      {
        requestId: "request-1",
        status: "available",
        reason: null,
        items: [{ snapshot, latestReconciliation: reconciliation }],
      },
    ]);
  });

  it("withholds a snapshot from a different exact field version", () => {
    const changed = {
      ...session,
      bindings: { ...session.bindings, fieldVersion: "field-v2" },
    };
    expect(
      composeOpenRacePredictionPageEvidence([changed], [snapshot], []),
    ).toEqual([
      {
        requestId: "request-1",
        status: "unavailable",
        reason: "FROZEN_PREDICTION_UNAVAILABLE",
        items: [],
      },
    ]);
  });

  it("denies another owner before reading prediction persistence", async () => {
    const listSnapshotsByOwner = vi.fn(async () => [snapshot]);
    const listReconciliationsByOwner = vi.fn(async () => [reconciliation]);
    await expect(
      loadOpenRacePredictionPageState({
        authenticatedOwnerId: "other-owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          publishSnapshotByOwner: vi.fn(),
          listSnapshotsByOwner,
          publishReconciliationByOwner: vi.fn(),
          listReconciliationsByOwner,
        },
        sessions: [session],
      }),
    ).rejects.toThrow("access denied");
    expect(listSnapshotsByOwner).not.toHaveBeenCalled();
    expect(listReconciliationsByOwner).not.toHaveBeenCalled();
  });

  it("uses one bounded owner read for each persisted evidence family", async () => {
    const listSnapshotsByOwner = vi.fn(async () => [snapshot]);
    const listReconciliationsByOwner = vi.fn(async () => [reconciliation]);
    await expect(
      loadOpenRacePredictionPageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          publishSnapshotByOwner: vi.fn(),
          listSnapshotsByOwner,
          publishReconciliationByOwner: vi.fn(),
          listReconciliationsByOwner,
        },
        sessions: [session],
      }),
    ).resolves.toMatchObject({
      connectionStatus: "read_model_connected",
      evidence: [{ status: "available" }],
    });
    expect(listSnapshotsByOwner).toHaveBeenCalledOnce();
    expect(listSnapshotsByOwner).toHaveBeenCalledWith("owner");
    expect(listReconciliationsByOwner).toHaveBeenCalledOnce();
    expect(listReconciliationsByOwner).toHaveBeenCalledWith("owner");
  });
  it.each(["snapshots", "reconciliations"] as const)(
    "withholds all frozen evidence when the %s repository read fails",
    async (failedSource) => {
      const listSnapshotsByOwner = vi.fn(async () => {
        if (failedSource === "snapshots") {
          throw new Error("private prediction storage detail");
        }
        return [snapshot];
      });
      const listReconciliationsByOwner = vi.fn(async () => {
        if (failedSource === "reconciliations") {
          throw new Error("private accepted-result detail");
        }
        return [reconciliation];
      });
      await expect(
        loadOpenRacePredictionPageState({
          authenticatedOwnerId: "owner",
          configuredOwnerId: "owner",
          repository: {
            status: "ready",
            publishSnapshotByOwner: vi.fn(),
            listSnapshotsByOwner,
            publishReconciliationByOwner: vi.fn(),
            listReconciliationsByOwner,
          },
          sessions: [session],
        }),
      ).resolves.toEqual({ connectionStatus: "read_failed", evidence: [] });
      expect(listSnapshotsByOwner).toHaveBeenCalledOnce();
      expect(listReconciliationsByOwner).toHaveBeenCalledOnce();
    },
  );

  it.each(["snapshot", "reconciliation"] as const)(
    "withholds all evidence when the %s read-model is ambiguous",
    async (family) => {
      await expect(
        loadOpenRacePredictionPageState({
          authenticatedOwnerId: "owner",
          configuredOwnerId: "owner",
          repository: {
            status: "ready",
            publishSnapshotByOwner: vi.fn(),
            listSnapshotsByOwner: async () =>
              family === "snapshot" ? [snapshot, snapshot] : [snapshot],
            publishReconciliationByOwner: vi.fn(),
            listReconciliationsByOwner: async () =>
              family === "reconciliation"
                ? [reconciliation, reconciliation]
                : [reconciliation],
          },
          sessions: [session],
        }),
      ).resolves.toEqual({ connectionStatus: "integrity_failed", evidence: [] });
    },
  );
});
