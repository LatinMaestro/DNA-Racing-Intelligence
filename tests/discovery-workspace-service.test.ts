import { describe, expect, it, vi } from "vitest";
import type { DiscoveryExactDistanceBenchmarkEvidence } from "@/domain/discovery-benchmark";
import type { DiscoveryProbeCandidateInput } from "@/domain/discovery-probe-plan";
import {
  loadDiscoveryWorkspacePageState,
  unavailableDiscoveryProbeRepository,
} from "@/lib/discovery-workspace-service";

const now = new Date("2026-07-21T00:00:00.000Z");
const candidate: DiscoveryProbeCandidateInput = {
  coreId: "synthetic-core",
  coreName: "Synthetic Core",
  mode: "bike",
  distanceMetres: 1_400,
  directRaceCount: 4,
  directTimeEvidence: {
    bestMilliseconds: 51_000,
    medianMilliseconds: 52_000,
    meanMilliseconds: 52_500,
    standardDeviationMilliseconds: 800,
  },
  lineageRelationship: "parent",
  lineageResolved: true,
  lineageRaceCount: 12,
  tournamentRelevance: "priority",
  maidenState: "not_eligible",
  freshness: "stale",
  dataCurrentThrough: "2026-07-20T00:00:00.000Z",
};
const benchmark: DiscoveryExactDistanceBenchmarkEvidence = {
  mode: "bike",
  distanceMetres: 1_400,
  dataCurrentThrough: "2026-07-20T00:00:00.000Z",
  raceEntryCount: 100,
  winningEntryCount: 25,
  topThreeEntryCount: 60,
  winningP25Milliseconds: 49_000,
  winningMedianMilliseconds: 50_000,
  winningP75Milliseconds: 51_500,
  topThreeP25Milliseconds: 50_000,
  topThreeMedianMilliseconds: 52_500,
  topThreeP75Milliseconds: 54_000,
  refreshedAt: "2026-07-20T01:00:00.000Z",
};

function evidence(
  overrides: Partial<{
    candidates: readonly DiscoveryProbeCandidateInput[];
    benchmarks: readonly DiscoveryExactDistanceBenchmarkEvidence[];
    lastImportedAt: string | null;
  }> = {},
) {
  return {
    candidates: [candidate],
    benchmarks: [benchmark],
    lastImportedAt: "2026-07-20T01:00:00.000Z",
    ...overrides,
  };
}

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
    const listCandidateEvidenceByOwner = vi.fn(async () => evidence());
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

  it("derives current freshness and attaches exact-distance benchmark context", async () => {
    await expect(
      loadDiscoveryWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          listCandidateEvidenceByOwner: async (ownerId) => {
            expect(ownerId).toBe("owner");
            return evidence();
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
          coreName: "Synthetic Core",
          observationsToMinimum: 6,
          recommendedInitialProbeSize: 3,
          reviewPriority: "high",
          freshness: "current",
          actionable: true,
          benchmarkAssessment: "winning_range",
          benchmarkEvidence: {
            winningMedianMilliseconds: 50_000,
            topThreeMedianMilliseconds: 52_500,
          },
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
            listCandidateEvidenceByOwner: async () =>
              evidence({
                candidates: [
                  {
                    ...candidate,
                    freshness: "current",
                    dataCurrentThrough,
                  },
                ],
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
          listCandidateEvidenceByOwner: async () =>
            evidence({ lastImportedAt: null }),
        },
        now,
      }),
    ).resolves.toMatchObject({
      lastImportedAt: null,
      candidates: [
        {
          freshness: "unknown",
          reviewPriority: "defer",
          recommendedInitialProbeSize: 0,
          actionable: false,
        },
      ],
    });
  });

  it("rejects inconsistent timestamps, duplicate candidates and repository evidence", async () => {
    const invalidEvidence = [
      evidence({ candidates: [candidate, candidate], lastImportedAt: null }),
      evidence({ lastImportedAt: "invalid" }),
      evidence({
        candidates: [
          {
            ...candidate,
            dataCurrentThrough: "2026-07-20T02:00:00.000Z",
          },
        ],
      }),
      evidence({ lastImportedAt: "2026-07-22T00:00:00.000Z" }),
      { candidates: [candidate], lastImportedAt: null } as never,
    ];

    for (const invalid of invalidEvidence) {
      await expect(
        loadDiscoveryWorkspacePageState({
          authenticatedOwnerId: "owner",
          configuredOwnerId: "owner",
          repository: {
            status: "ready",
            listCandidateEvidenceByOwner: async () => invalid,
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
