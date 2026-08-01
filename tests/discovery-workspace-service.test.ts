import { describe, expect, it, vi } from "vitest";
import type { DiscoveryProbeCandidateInput } from "@/domain/discovery-probe-plan";
import {
  loadDiscoveryWorkspacePageState,
  unavailableDiscoveryProbeRepository,
} from "@/lib/discovery-workspace-service";

const now = new Date("2026-07-21T00:00:00.000Z");
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
  freshness: "stale",
  dataCurrentThrough: "2026-07-20T00:00:00.000Z",
};

describe("Discovery workspace service", () => {
  it("returns identity and persistence states without reading evidence", async () => {
    await expect(
      loadDiscoveryWorkspacePageState({
        authenticatedOwnerId: null,
        configuredOwnerId: "owner",
        repository: unavailableDiscoveryProbeRepository,
        now,
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
        now,
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
        now,
      }),
    ).rejects.toThrow("access denied");
    expect(listCandidateEvidenceByOwner).not.toHaveBeenCalled();
  });

  it("derives current freshness instead of trusting a stored label", async () => {
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
        now,
      }),
    ).resolves.toMatchObject({
      connectionStatus: "read_model_connected",
      lastImportedAt: "2026-07-20T01:00:00.000Z",
      candidates: [
        {
          coreId: "synthetic-core",
          observationsToMinimum: 6,
          reviewPriority: "high",
          freshness: "current",
          actionable: false,
          automaticEntryAllowed: false,
          automaticStopAllowed: false,
        },
      ],
    });
  });

  it.each([
    ["2026-07-18T00:00:00.000Z", "current", "high"],
    ["2026-07-17T00:00:00.000Z", "ageing", "high"],
    ["2026-07-14T00:00:00.000Z", "ageing", "high"],
    ["2026-07-13T00:00:00.000Z", "stale", "defer"],
  ] as const)(
    "derives the %s cutoff boundary as %s",
    async (dataCurrentThrough, freshness, reviewPriority) => {
      await expect(
        loadDiscoveryWorkspacePageState({
          authenticatedOwnerId: "owner",
          configuredOwnerId: "owner",
          repository: {
            status: "ready",
            listCandidateEvidenceByOwner: async () => ({
              candidates: [
                {
                  ...candidate,
                  freshness: "current",
                  dataCurrentThrough,
                },
              ],
              lastImportedAt: "2026-07-20T01:00:00.000Z",
            }),
          },
          now,
        }),
      ).resolves.toMatchObject({
        candidates: [{ freshness, reviewPriority }],
      });
    },
  );

  it("defers evidence when no accepted import timestamp exists", async () => {
    await expect(
      loadDiscoveryWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          listCandidateEvidenceByOwner: async () => ({
            candidates: [candidate],
            lastImportedAt: null,
          }),
        },
        now,
      }),
    ).resolves.toMatchObject({
      lastImportedAt: null,
      candidates: [{ freshness: "unknown", reviewPriority: "defer" }],
    });
  });

  it("rejects inconsistent timestamps, duplicate candidates and repository evidence", async () => {
    const invalidEvidence = [
      { candidates: [candidate, candidate], lastImportedAt: null },
      { candidates: [candidate], lastImportedAt: "invalid" },
      {
        candidates: [
          {
            ...candidate,
            dataCurrentThrough: "2026-07-20T02:00:00.000Z",
          },
        ],
        lastImportedAt: "2026-07-20T01:00:00.000Z",
      },
      {
        candidates: [candidate],
        lastImportedAt: "2026-07-22T00:00:00.000Z",
      },
    ];

    for (const evidence of invalidEvidence) {
      await expect(
        loadDiscoveryWorkspacePageState({
          authenticatedOwnerId: "owner",
          configuredOwnerId: "owner",
          repository: {
            status: "ready",
            listCandidateEvidenceByOwner: async () => evidence,
          },
          now,
        }),
      ).rejects.toThrow();
    }

    await expect(
      loadDiscoveryWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: { status: "unexpected" } as never,
        now,
      }),
    ).rejects.toThrow("repository status");
  });
});
