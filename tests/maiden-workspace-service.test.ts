import { describe, expect, it, vi } from "vitest";
import type {
  MaidenAllocationBracketInput,
  MaidenAllocationCandidateInput,
} from "@/domain/maiden-vault-allocation";
import {
  loadMaidenWorkspacePageState,
  unavailableMaidenAllocationRepository,
} from "@/lib/maiden-workspace-service";

const bracket: MaidenAllocationBracketInput = {
  tournamentId: "synthetic-maiden",
  bracketId: "synthetic-bracket",
  mode: "bike",
  reviewCapacity: 1,
  availability: "upcoming",
  ruleStatus: "confirmed",
};
const candidate: MaidenAllocationCandidateInput = {
  candidateId: "synthetic-candidate",
  coreId: "synthetic-core",
  tournamentId: "synthetic-maiden",
  bracketId: "synthetic-bracket",
  mode: "bike",
  projectedValueBasisPoints: 8_500,
  suitability: "preserve_me",
  lifecycleState: "eligible",
  evidenceConfidence: "moderate",
  dataCurrentThrough: "2026-07-20T00:00:00.000Z",
  lastImported: "2026-07-20T01:00:00.000Z",
  freshness: "current",
};

describe("Maiden workspace service", () => {
  it("returns identity and persistence states without reading evidence", async () => {
    await expect(
      loadMaidenWorkspacePageState({
        authenticatedOwnerId: null,
        configuredOwnerId: "owner",
        repository: unavailableMaidenAllocationRepository,
      }),
    ).resolves.toEqual({
      allocation: null,
      lastImportedAt: null,
      connectionStatus: "identity_not_connected",
    });
    await expect(
      loadMaidenWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: unavailableMaidenAllocationRepository,
      }),
    ).resolves.toEqual({
      allocation: null,
      lastImportedAt: null,
      connectionStatus: "persistence_not_configured",
    });
  });

  it("denies a different owner before persistence", async () => {
    const loadAllocationEvidenceByOwner = vi.fn(async () => ({
      brackets: [bracket],
      candidates: [candidate],
      lastImportedAt: "2026-07-20T01:00:00.000Z",
    }));
    await expect(
      loadMaidenWorkspacePageState({
        authenticatedOwnerId: "other-owner",
        configuredOwnerId: "owner",
        repository: { status: "ready", loadAllocationEvidenceByOwner },
      }),
    ).rejects.toThrow("access denied");
    expect(loadAllocationEvidenceByOwner).not.toHaveBeenCalled();
  });

  it("builds a non-actionable allocation that preserves ME", async () => {
    await expect(
      loadMaidenWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          loadAllocationEvidenceByOwner: async (ownerId) => {
            expect(ownerId).toBe("owner");
            return {
              brackets: [bracket],
              candidates: [candidate],
              lastImportedAt: "2026-07-20T01:00:00.000Z",
            };
          },
        },
      }),
    ).resolves.toMatchObject({
      connectionStatus: "read_model_connected",
      allocation: {
        assignments: [],
        entitlementMutationsPerformed: false,
        actionableRecommendationAllowed: false,
        maidenCommitmentAllowed: false,
        automaticEntryAllowed: false,
        candidates: [
          {
            coreId: "synthetic-core",
            status: "preserve_me",
          },
        ],
      },
    });
  });

  it("accepts an empty read model but rejects orphaned candidates and bad timestamps", async () => {
    await expect(
      loadMaidenWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          loadAllocationEvidenceByOwner: async () => ({
            brackets: [],
            candidates: [],
            lastImportedAt: null,
          }),
        },
      }),
    ).resolves.toMatchObject({
      allocation: null,
      connectionStatus: "read_model_connected",
    });

    for (const evidence of [
      { brackets: [], candidates: [candidate], lastImportedAt: null },
      {
        brackets: [bracket],
        candidates: [candidate],
        lastImportedAt: "invalid",
      },
    ]) {
      await expect(
        loadMaidenWorkspacePageState({
          authenticatedOwnerId: "owner",
          configuredOwnerId: "owner",
          repository: {
            status: "ready",
            loadAllocationEvidenceByOwner: async () => evidence,
          },
        }),
      ).rejects.toThrow();
    }
  });
});
