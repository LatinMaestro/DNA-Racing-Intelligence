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
const now = new Date("2026-07-23T00:00:00.000Z");

const bindings = {
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
} as const;

const evidence: OpenRaceWorkspaceEvidence = {
  bindings,
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

function repository(sessions: readonly OpenRaceWorkspaceEvidence[]) {
  return {
    status: "ready" as const,
    listSessionEvidenceByOwner: async () => ({
      sessions,
      latestAcceptedRaceImportAt: "2026-07-20T01:00:00.000Z",
      latestAcceptedVaultImportAt: "2026-07-20T01:00:00.000Z",
      latestAcceptedRaceImportVersion: "race-import-v7",
      latestAcceptedVaultSnapshotVersion: "vault-v3",
      latestPublishedHistoricalAggregateVersion: "aggregate-v4",
    }),
  };
}

describe("Open Race workspace service", () => {
  it("returns fail-closed connection states without reading evidence", async () => {
    await expect(
      loadOpenRaceWorkspacePageState({
        authenticatedOwnerId: null,
        configuredOwnerId: "owner",
        repository: unavailableOpenRaceWorkspaceRepository,
        now,
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
        now,
      }),
    ).resolves.toEqual({
      sessions: [],
      connectionStatus: "persistence_not_configured",
    });
  });

  it("denies a different owner before persistence", async () => {
    const listSessionEvidenceByOwner = vi.fn(
      repository([evidence]).listSessionEvidenceByOwner,
    );
    await expect(
      loadOpenRaceWorkspacePageState({
        authenticatedOwnerId: "other-owner",
        configuredOwnerId: "owner",
        repository: { status: "ready", listSessionEvidenceByOwner },
        now,
      }),
    ).rejects.toThrow("access denied");
    expect(listSessionEvidenceByOwner).not.toHaveBeenCalled();
  });

  it("composes the complete staged review without enabling an action", async () => {
    await expect(
      loadOpenRaceWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: repository([evidence]),
        now,
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
        bindings: {
          ...bindings,
          rankingVersion: null,
          lockVersion: null,
          observationVersion: null,
          comparisonVersion: null,
        },
        ranking: null,
        lock: null,
        observation: null,
        comparison: null,
      },
      {
        ...evidence,
        bindings: {
          ...bindings,
          lockVersion: null,
          observationVersion: null,
          comparisonVersion: null,
        },
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
        repository: repository([stagedEvidence]),
        now,
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
          evaluatedAt: "2026-07-20T01:59:59.999Z",
        },
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
          repository: repository([invalid]),
          now,
        }),
      ).rejects.toThrow();
    }
  });

  it("rejects duplicate request identities", async () => {
    await expect(
      loadOpenRaceWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: repository([evidence, evidence]),
        now,
      }),
    ).rejects.toThrow("unique");
  });

  it.each([
    ["3-day boundary", "2026-07-20T00:00:00.000Z", "current"],
    ["4-day boundary", "2026-07-19T00:00:00.000Z", "ageing"],
    ["7-day boundary", "2026-07-16T00:00:00.000Z", "ageing"],
    ["8-day boundary", "2026-07-15T00:00:00.000Z", "stale"],
  ] as const)(
    "derives freshness at the exact %s",
    async (_, cutoff, freshness) => {
      const stale = freshness === "stale";
      const stagedEvidence: OpenRaceWorkspaceEvidence = {
        ...evidence,
        bindings: stale
          ? {
              ...bindings,
              rankingVersion: null,
              lockVersion: null,
              observationVersion: null,
              comparisonVersion: null,
            }
          : bindings,
        field: {
          ...evidence.field,
          dataCurrentThrough: cutoff,
          freshness,
        },
        eligibility: {
          ...evidence.eligibility,
          vaultDataCurrentThrough: cutoff,
          freshness,
        },
        ranking: stale
          ? null
          : {
              ...evidence.ranking!,
              dataCurrentThrough: cutoff,
              freshness,
            },
        lock: stale ? null : evidence.lock,
        observation: stale ? null : evidence.observation,
        comparison: stale ? null : evidence.comparison,
      };
      const state = await loadOpenRaceWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: repository([stagedEvidence]),
        now,
      });
      expect(state.sessions[0]?.field.freshness).toBe(freshness);
      expect(state.sessions[0]?.eligibility.freshness).toBe(freshness);
      expect(state.sessions[0]?.ranking?.freshness ?? freshness).toBe(
        freshness,
      );
    },
  );

  it("rejects missing accepted-import evidence and stale version bindings", async () => {
    const missingImports = repository([evidence]);
    const staleVersion = repository([
      {
        ...evidence,
        bindings: { ...bindings, raceImportVersion: "stale-race-import" },
      },
    ]);
    await expect(
      loadOpenRaceWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          ...missingImports,
          listSessionEvidenceByOwner: async () => ({
            ...(await missingImports.listSessionEvidenceByOwner()),
            latestAcceptedRaceImportAt: null,
          }),
        },
        now,
      }),
    ).rejects.toThrow("Latest accepted Race Merge import is required");
    await expect(
      loadOpenRaceWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: staleVersion,
        now,
      }),
    ).rejects.toThrow("versions are stale");
  });

  it.each([
    [
      "non-canonical timestamps",
      { field: { ...evidence.field, capturedAt: "2026-07-20T02:00:00Z" } },
      "canonical UTC",
    ],
    [
      "future capture times",
      { field: { ...evidence.field, capturedAt: "2026-07-24T02:00:00.000Z" } },
      "cannot be in the future",
    ],
    [
      "post-import cutoffs",
      {
        field: {
          ...evidence.field,
          dataCurrentThrough: "2026-07-20T01:00:00.001Z",
        },
        ranking: {
          ...evidence.ranking!,
          dataCurrentThrough: "2026-07-20T01:00:00.001Z",
        },
      },
      "accepted import cutoffs",
    ],
    [
      "stored freshness drift",
      { field: { ...evidence.field, freshness: "stale" as const } },
      "server-derived freshness",
    ],
  ])("rejects %s", async (_, changes, message) => {
    await expect(
      loadOpenRaceWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: repository([{ ...evidence, ...changes }]),
        now,
      }),
    ).rejects.toThrow(message);
  });

  it("rejects stage-version disagreement", async () => {
    await expect(
      loadOpenRaceWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: repository([
          {
            ...evidence,
            bindings: { ...bindings, comparisonVersion: null },
          },
        ]),
        now,
      }),
    ).rejects.toThrow("comparison evidence and version must agree");
  });

  it.each([
    [
      "locked field capture",
      {
        lock: {
          ...evidence.lock!,
          fieldCapturedAt: "2026-07-20T01:59:00.000Z",
        },
      },
    ],
    [
      "locked ranking time",
      {
        lock: {
          ...evidence.lock!,
          rankingEvaluatedAt: "2026-07-20T02:00:30.000Z",
        },
      },
    ],
    [
      "ordered frozen ranking",
      {
        comparison: {
          ...evidence.comparison!,
          rankedCandidateCoreIds: ["owned-a", "unexpected"],
        },
      },
    ],
    [
      "entered field",
      {
        comparison: {
          ...evidence.comparison!,
          enteredCoreIds: ["owned-a", "opponent-a", "opponent-b"],
        },
      },
    ],
    [
      "observed signals",
      {
        comparison: {
          ...evidence.comparison!,
          gold: { status: "assigned" as const, coreId: "opponent-b" },
        },
      },
    ],
    [
      "observation status",
      {
        comparison: {
          ...evidence.comparison!,
          observationRecordStatus: "review_required" as const,
        },
      },
    ],
  ])("rejects drift in the %s binding", async (_, changes) => {
    await expect(
      loadOpenRaceWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: repository([{ ...evidence, ...changes }]),
        now,
      }),
    ).rejects.toThrow();
  });
});
