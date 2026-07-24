import { describe, expect, it, vi } from "vitest";
import type {
  LifecycleAction,
  LifecycleActionRankingInput,
} from "@/domain/lifecycle-action-ranking";
import {
  loadLifecycleWorkspacePageState,
  unavailableLifecycleRankingRepository,
} from "@/lib/lifecycle-workspace-service";

const actions: readonly LifecycleAction[] = [
  "race",
  "discover",
  "reserve_maiden",
  "breed",
  "hold",
  "sell",
  "burn",
];
const evidence: LifecycleActionRankingInput = {
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
};

describe("Lifecycle workspace service", () => {
  it("returns identity and persistence states without reading evidence", async () => {
    await expect(
      loadLifecycleWorkspacePageState({
        authenticatedOwnerId: null,
        configuredOwnerId: "owner",
        repository: unavailableLifecycleRankingRepository,
      }),
    ).resolves.toEqual({
      ranking: null,
      connectionStatus: "identity_not_connected",
    });
    await expect(
      loadLifecycleWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: unavailableLifecycleRankingRepository,
      }),
    ).resolves.toEqual({
      ranking: null,
      connectionStatus: "persistence_not_configured",
    });
  });

  it("denies a different owner before persistence", async () => {
    const loadRankingEvidenceByOwner = vi.fn(async () => evidence);
    await expect(
      loadLifecycleWorkspacePageState({
        authenticatedOwnerId: "other-owner",
        configuredOwnerId: "owner",
        repository: { status: "ready", loadRankingEvidenceByOwner },
      }),
    ).rejects.toThrow("access denied");
    expect(loadRankingEvidenceByOwner).not.toHaveBeenCalled();
  });

  it("builds a non-executable ranking and permanently holds Genesis burn", async () => {
    const state = await loadLifecycleWorkspacePageState({
      authenticatedOwnerId: "owner",
      configuredOwnerId: "owner",
      repository: {
        status: "ready",
        loadRankingEvidenceByOwner: async () => evidence,
      },
    });
    expect(state).toMatchObject({
      connectionStatus: "read_model_connected",
      ranking: {
        noStarEvidenceCanCauseBurn: false,
        sourceFactsMutated: false,
        cores: [
          {
            coreId: "synthetic-core",
            leadingAction: "race",
            finalRecommendationAllowed: false,
            saleExecutionAllowed: false,
            burnExecutionAllowed: false,
            ledgerMutationAllowed: false,
          },
        ],
      },
    });
    expect(state.ranking?.cores[0]?.heldActions).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "burn" })]),
    );
  });

  it("accepts an empty read model and rejects malformed domain evidence", async () => {
    await expect(
      loadLifecycleWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          loadRankingEvidenceByOwner: async () => null,
        },
      }),
    ).resolves.toMatchObject({
      ranking: null,
      connectionStatus: "read_model_connected",
    });

    await expect(
      loadLifecycleWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          loadRankingEvidenceByOwner: async () => ({
            ...evidence,
            freshness: "invalid" as LifecycleActionRankingInput["freshness"],
          }),
        },
      }),
    ).rejects.toThrow("freshness");
  });
});
