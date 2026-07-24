import { describe, expect, it, vi } from "vitest";
import type { DiscoveryProbeCandidateInput } from "@/domain/discovery-probe-plan";
import {
  loadDiscoveryWorkspacePageState,
  unavailableDiscoveryProbeRepository,
} from "@/lib/discovery-workspace-service";

const candidate: DiscoveryProbeCandidateInput = {
  coreId: "synthetic-core",
  mode: "bike",
  distanceMetres: 1_400,
  directRaceCount: 4,
  lineageRelationship: "parent",
  lineageResolved: true,
  lineageRaceCount: 12,
  tournamentRelevance: "priority",
  maidenState: "not_eligible",
  freshness: "current",
  dataCurrentThrough: "2026-07-20T00:00:00.000Z",
};

describe("Discovery workspace service", () => {
  it("returns identity and persistence states without reading evidence", async () => {
    await expect(
      loadDiscoveryWorkspacePageState({
        authenticatedOwnerId: null,
        configuredOwnerId: "owner",
        repository: unavailableDiscoveryProbeRepository,
      }),
    ).resolves.toEqual({
      candidates: [],
      lastImportedAt: null,
      connectionStatus: "identity_not_connected",
    });
    await expect(
      loadDiscoveryWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: unavailableDiscoveryProbeRepository,
      }),
    ).resolves.toEqual({
      candidates: [],
      lastImportedAt: null,
      connectionStatus: "persistence_not_configured",
    });
  });

  it("denies a different owner before persistence", async () => {
    const listCandidateEvidenceByOwner = vi.fn(async () => ({
      candidates: [candidate],
      lastImportedAt: "2026-07-20T01:00:00.000Z",
    }));
    await expect(
      loadDiscoveryWorkspacePageState({
        authenticatedOwnerId: "other-owner",
        configuredOwnerId: "owner",
        repository: { status: "ready", listCandidateEvidenceByOwner },
      }),
    ).rejects.toThrow("access denied");
    expect(listCandidateEvidenceByOwner).not.toHaveBeenCalled();
  });

  it("builds a deterministic non-actionable plan from compact owner evidence", async () => {
    await expect(
      loadDiscoveryWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          listCandidateEvidenceByOwner: async (ownerId) => {
            expect(ownerId).toBe("owner");
            return {
              candidates: [candidate],
              lastImportedAt: "2026-07-20T01:00:00.000Z",
            };
          },
        },
      }),
    ).resolves.toMatchObject({
      connectionStatus: "read_model_connected",
      lastImportedAt: "2026-07-20T01:00:00.000Z",
      candidates: [
        {
          coreId: "synthetic-core",
          observationsToMinimum: 6,
          reviewPriority: "high",
          actionable: false,
          automaticEntryAllowed: false,
          automaticStopAllowed: false,
        },
      ],
    });
  });

  it("rejects invalid candidate evidence and import timestamps", async () => {
    for (const evidence of [
      { candidates: [candidate, candidate], lastImportedAt: null },
      { candidates: [candidate], lastImportedAt: "invalid" },
    ]) {
      await expect(
        loadDiscoveryWorkspacePageState({
          authenticatedOwnerId: "owner",
          configuredOwnerId: "owner",
          repository: {
            status: "ready",
            listCandidateEvidenceByOwner: async () => evidence,
          },
        }),
      ).rejects.toThrow();
    }
  });
});
