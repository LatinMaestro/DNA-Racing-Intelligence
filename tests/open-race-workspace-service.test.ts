import { describe, expect, it, vi } from "vitest";
import type { OpenRaceWorkspaceEvidence } from "@/lib/open-race-workspace-service";
import {
  loadOpenRaceWorkspacePageState,
  unavailableOpenRaceWorkspaceRepository,
} from "@/lib/open-race-workspace-service";

const profile = {
  optimisticTimeMs: 59_000,
  medianTimeMs: 60_000,
  conservativeTimeMs: 61_000,
  sampleCount: 12,
  sampleStatus: "minimally_analytical" as const,
};
const opponents = ["opponent-a", "opponent-b", "opponent-c"];

const evidence: OpenRaceWorkspaceEvidence = {
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
    opponents: opponents.map((coreId) => ({
      coreId,
      identityStatus: "confirmed" as const,
    })),
    restrictions: [],
  },
  eligibility: {
    evaluationId: "synthetic-eligibility",
    evaluatedAt: "2026-07-20T02:00:00.000Z",
    vaultDataCurrentThrough: "2026-07-20T00:00:00.000Z",
    freshness: "current",
    rules: {
      ruleSetId: "synthetic-rules",
      evidenceStatus: "confirmed",
      allowedClasses: null,
      allowedElements: null,
      minimumFNumber: null,
      maximumFNumber: null,
      maidenRequirement: "not_restricted",
    },
    cores: [
      {
        coreId: "owned-a",
        activeOwnership: "confirmed",
        availability: "available",
        coreClass: "Genesis",
        element: "Fire",
        fNumber: 1,
        maidenState: "not_eligible",
        attributeEvidence: "complete",
      },
    ],
  },
  ranking: {
    rankingId: "synthetic-ranking",
    evaluatedAt: "2026-07-20T02:01:00.000Z",
    dataCurrentThrough: "2026-07-20T00:00:00.000Z",
    freshness: "current",
    fieldStage: "forming",
    mode: "bike",
    distanceMeters: 1_600,
    materialGapMs: 50,
    candidates: [
      {
        coreId: "owned-a",
        eligibilityStatus: "eligible",
        mode: "bike",
        distanceMeters: 1_600,
        profile,
        historicalStars: {
          goldReceived: 2,
          goldOpportunities: 10,
          blueReceived: 3,
          blueOpportunities: 12,
          evidenceStatus: "complete",
          rationale: ["Synthetic historical support."],
        },
      },
    ],
    opponents: opponents.map((coreId) => ({
      coreId,
      identityStatus: "confirmed" as const,
      mode: "bike" as const,
      distanceMeters: 1_600,
      profile,
    })),
  },
  lock: {
    lockId: "synthetic-lock",
    requestId: "synthetic-request",
    preEntryRankingId: "synthetic-ranking",
    fieldCapturedAt: "2026-07-20T02:00:00.000Z",
    rankingEvaluatedAt: "2026-07-20T02:01:00.000Z",
    lockedAt: "2026-07-20T02:02:00.000Z",
    fieldStage: "forming",
    gateCount: 4,
    availableGates: 0,
    enteredCoreIds: ["owned-a", ...opponents],
    selectedOwnedCoreId: "owned-a",
    provisionalRecommendedCoreId: "owned-a",
    preEntryStatus: "provisional",
    userConfirmedCommittedEntry: true,
    allGatesFilled: true,
    raceSetToRun: true,
  },
  observation: {
    observationId: "synthetic-observation",
    lockId: "synthetic-lock",
    gameEventId: null,
    lockedAt: "2026-07-20T02:02:00.000Z",
    observedAt: "2026-07-20T02:03:00.000Z",
    fieldStage: "locked_observation",
    gateCount: 4,
    enteredCoreIds: ["owned-a", ...opponents],
    selectedOwnedCoreId: "owned-a",
    gold: { status: "assigned", coreId: "opponent-a" },
    blue: { status: "assigned", coreId: "owned-a" },
    note: "Synthetic observation.",
  },
  comparison: {
    comparisonId: "synthetic-comparison",
    lockId: "synthetic-lock",
    observationId: "synthetic-observation",
    rankingEvaluatedAt: "2026-07-20T02:01:00.000Z",
    lockedAt: "2026-07-20T02:02:00.000Z",
    observedAt: "2026-07-20T02:03:00.000Z",
    comparedAt: "2026-07-20T02:04:00.000Z",
    gateCount: 4,
    enteredCoreIds: ["owned-a", ...opponents],
    rankedCandidateCoreIds: ["owned-a"],
    provisionalRecommendedCoreId: "owned-a",
    selectedOwnedCoreId: "owned-a",
    gold: { status: "assigned", coreId: "opponent-a" },
    blue: { status: "assigned", coreId: "owned-a" },
    observationRecordStatus: "recorded",
  },
};

describe("Open Race workspace service", () => {
  it("returns fail-closed connection states without reading evidence", async () => {
    await expect(
      loadOpenRaceWorkspacePageState({
        authenticatedOwnerId: null,
        configuredOwnerId: "owner",
        repository: unavailableOpenRaceWorkspaceRepository,
      }),
    ).resolves.toEqual({
      sessions: [],
      connectionStatus: "identity_not_connected",
    });
    await expect(
      loadOpenRaceWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: unavailableOpenRaceWorkspaceRepository,
      }),
    ).resolves.toEqual({
      sessions: [],
      connectionStatus: "persistence_not_configured",
    });
  });

  it("denies a different owner before persistence", async () => {
    const listSessionEvidenceByOwner = vi.fn(async () => [evidence]);
    await expect(
      loadOpenRaceWorkspacePageState({
        authenticatedOwnerId: "other-owner",
        configuredOwnerId: "owner",
        repository: { status: "ready", listSessionEvidenceByOwner },
      }),
    ).rejects.toThrow("access denied");
    expect(listSessionEvidenceByOwner).not.toHaveBeenCalled();
  });

  it("composes the complete staged review without enabling an action", async () => {
    await expect(
      loadOpenRaceWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          listSessionEvidenceByOwner: async () => [evidence],
        },
      }),
    ).resolves.toMatchObject({
      connectionStatus: "read_model_connected",
      sessions: [
        {
          stage: "observation_compared",
          mutationAllowed: false,
          liveGameConnection: false,
          gateCPassed: false,
          ranking: {
            currentRaceStarsUsed: false,
            replacementRecommendationAllowed: false,
            raceEntryAllowed: false,
            finalActionableRecommendationAllowed: false,
          },
          lock: {
            coreSwitchAllowed: false,
            replacementRecommendationAllowed: false,
          },
          observation: {
            observationOnly: true,
            completedRaceResult: false,
            reconciliationStatus: "pending_authoritative_import",
          },
          comparison: {
            frozenPreEntryRanking: true,
            rankingChanged: false,
            predictionSuccessClaimAllowed: false,
            recommendation: null,
          },
        },
      ],
    });
  });

  it("supports forming and provisional stages without later evidence", async () => {
    const inputs: readonly OpenRaceWorkspaceEvidence[] = [
      {
        ...evidence,
        ranking: null,
        lock: null,
        observation: null,
        comparison: null,
      },
      {
        ...evidence,
        lock: null,
        observation: null,
        comparison: null,
      },
    ];
    const expectedStages = ["field_forming", "provisional_selection"];
    for (const [index, stagedEvidence] of inputs.entries()) {
      const state = await loadOpenRaceWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          listSessionEvidenceByOwner: async () => [stagedEvidence],
        },
      });
      expect(state.sessions[0]?.stage).toBe(expectedStages[index]);
      expect(state.sessions[0]?.observation).toBeNull();
    }
  });

  it("rejects cross-field and out-of-order evidence", async () => {
    const invalidSessions: readonly OpenRaceWorkspaceEvidence[] = [
      { ...evidence, observation: null, comparison: evidence.comparison },
      {
        ...evidence,
        ranking: { ...evidence.ranking!, distanceMeters: 1_800 },
      },
      {
        ...evidence,
        ranking: {
          ...evidence.ranking!,
          candidates: [
            { ...evidence.ranking!.candidates[0]!, coreId: "not-eligible" },
          ],
        },
      },
      {
        ...evidence,
        observation: { ...evidence.observation!, lockId: "different-lock" },
      },
      {
        ...evidence,
        comparison: {
          ...evidence.comparison!,
          rankedCandidateCoreIds: ["different-core"],
        },
      },
    ];
    for (const invalid of invalidSessions) {
      await expect(
        loadOpenRaceWorkspacePageState({
          authenticatedOwnerId: "owner",
          configuredOwnerId: "owner",
          repository: {
            status: "ready",
            listSessionEvidenceByOwner: async () => [invalid],
          },
        }),
      ).rejects.toThrow();
    }
  });

  it("rejects duplicate request identities", async () => {
    await expect(
      loadOpenRaceWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          listSessionEvidenceByOwner: async () => [evidence, evidence],
        },
      }),
    ).rejects.toThrow("unique");
  });
});
