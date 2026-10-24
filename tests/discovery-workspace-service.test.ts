import { describe, expect, it, vi } from "vitest";
import type { DiscoveryExactDistanceBenchmarkEvidence } from "@/domain/discovery-benchmark";
import type { DiscoveryProbeCandidateInput } from "@/domain/discovery-probe-plan";
import {
  createDiscoveryProbeRepository,
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
const publication = {
  refreshId: "a1450000-0000-4000-8000-000000000030",
  raceDatasetVersionId: "a1450000-0000-4000-8000-000000000020",
  sourceVersionSetSha256: "b".repeat(64),
  payloadSha256: "c".repeat(64),
  benchmarkCount: 1,
  refreshedAt: "2026-07-20T01:00:00.000Z",
  publishedAt: "2026-07-20T02:00:00.000Z",
};

function evidence(
  overrides: Partial<{
    candidates: readonly DiscoveryProbeCandidateInput[];
    benchmarks: readonly DiscoveryExactDistanceBenchmarkEvidence[];
    publication: typeof publication | null;
    lastImportedAt: string | null;
  }> = {},
) {
  return {
    candidates: [candidate],
    benchmarks: [benchmark],
    publication,
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
      publication: null,
      connectionStatus: "identity_not_connected",
      acceptedHistoryCoverage: {
        status: "not_used",
        generationId: null,
        ownedCoreCount: 0,
        selectedCoreCount: 0,
        omittedCoreCount: 0,
        acceptedRowCount: 0,
        maximumRows: 10_000,
      },
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
      publication: null,
      connectionStatus: "persistence_not_configured",
      acceptedHistoryCoverage: {
        status: "not_used",
        generationId: null,
        ownedCoreCount: 0,
        selectedCoreCount: 0,
        omittedCoreCount: 0,
        acceptedRowCount: 0,
        maximumRows: 10_000,
      },
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
      publication,
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
          decisionGuidance: "continue_targeted_probe",
          decisionReason: "competitive_winner_range",
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
    ["2026-07-13T00:00:00.000Z", "stale", "high"],
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
        candidates: [
          {
            freshness,
            reviewPriority,
            actionable: freshness !== "stale",
            recommendedInitialProbeSize: 3,
            decisionGuidance: "continue_targeted_probe",
          },
        ],
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
      evidence({ publication: null }),
      evidence({ publication: { ...publication, payloadSha256: "invalid" } }),
      evidence({
        publication: { ...publication, benchmarkCount: 2 },
      }),
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
  it("derives Tournament relevance only from explicit exact-mode configuration", async () => {
    const repository = createDiscoveryProbeRepository({
      vaultRepository: {
        status: "ready",
        listCoresByOwner: async () => [
          {
            sourceCoreId: "owned-core",
            displayName: "Owned Core",
            coreClass: "Genesis",
            element: "Fire",
            fNumber: 1,
            sex: "female",
            inMyVault: true,
            meEligible: false,
            version: 1,
            updatedAt: null,
          },
        ],
      },
      performanceRepository: {
        status: "ready",
        listProfilesByOwner: async () => ({
          profiles: [],
          lastImportedAt: null,
        }),
      },
      lineageRepository: {
        status: "ready",
        listHypothesesByOwner: async () =>
          [1_200, 1_400, 1_600].map((distanceMetres) => ({
            coreId: "owned-core",
            coreName: "Owned Core",
            meEligible: false,
            mode: "bike" as const,
            distanceMetres,
            lineageRelationship: "parent" as const,
            lineageRaceCount: 10,
            dataCurrentThrough: "2026-07-20T00:00:00.000Z",
            lastImportedAt: "2026-07-20T01:00:00.000Z",
          })),
      },
      benchmarkRepository: {
        status: "ready",
        listBenchmarksByOwner: async () => ({
          benchmarks: [],
          publication: null,
        }),
      },
      tournamentRepository: {
        status: "ready",
        listCandidateEvidenceByOwner: async () => ({
          brackets: [
            {
              tournamentId: "bike-cup",
              tournamentLabel: "Bike Cup",
              bracketId: "bike-sprint",
              splitLabel: "Bike Sprint",
              mode: "bike",
              eligibleDistancesMetres: [1_200],
              discoveryRelevance: "priority",
              qualificationMetricLabel: "Points",
              configurationVersion: "config-v1",
              candidateSnapshotVersion: "snapshot-v1",
              candidates: [],
            },
            {
              tournamentId: "bike-series",
              tournamentLabel: "Bike Series",
              bracketId: "bike-middle",
              splitLabel: "Bike Middle",
              mode: "bike",
              eligibleDistancesMetres: [1_400],
              discoveryRelevance: "eligible",
              qualificationMetricLabel: "Points",
              configurationVersion: "config-v1",
              candidateSnapshotVersion: "snapshot-v1",
              candidates: [],
            },
            {
              tournamentId: "horse-cup",
              tournamentLabel: "Horse Cup",
              bracketId: "horse-distance",
              splitLabel: "Horse Distance",
              mode: "horse",
              eligibleDistancesMetres: [1_600],
              discoveryRelevance: "priority",
              qualificationMetricLabel: "Points",
              configurationVersion: "config-v1",
              candidateSnapshotVersion: "snapshot-v1",
              candidates: [],
            },
          ],
          lastImportedAt: null,
        }),
      },
    });

    expect(repository.status).toBe("ready");
    if (repository.status !== "ready")
      throw new Error("repository unavailable");

    await expect(
      repository.listCandidateEvidenceByOwner("owner"),
    ).resolves.toMatchObject({
      candidates: [
        { distanceMetres: 1_200, tournamentRelevance: "priority" },
        { distanceMetres: 1_400, tournamentRelevance: "eligible" },
        { distanceMetres: 1_600, tournamentRelevance: "none" },
      ],
    });
  });

  it("filters only under-supported population hypotheses at the repository boundary", async () => {
    const repository = createDiscoveryProbeRepository({
      vaultRepository: {
        status: "ready",
        listCoresByOwner: async () => [
          {
            sourceCoreId: "owned-core",
            displayName: "Owned Core",
            coreClass: "Genesis",
            element: "Fire",
            fNumber: 1,
            sex: "female",
            inMyVault: true,
            meEligible: false,
            version: 1,
            updatedAt: null,
          },
        ],
      },
      performanceRepository: {
        status: "ready",
        listProfilesByOwner: async () => ({
          profiles: [],
          lastImportedAt: null,
        }),
      },
      lineageRepository: {
        status: "ready",
        listHypothesesByOwner: async () => [
          {
            coreId: "owned-core",
            coreName: "Owned Core",
            meEligible: false,
            mode: "bike",
            distanceMetres: 1_200,
            lineageRelationship: "population_pattern",
            lineageRaceCount: 9,
            dataCurrentThrough: "2026-07-20T00:00:00.000Z",
            lastImportedAt: "2026-07-20T01:00:00.000Z",
          },
          {
            coreId: "owned-core",
            coreName: "Owned Core",
            meEligible: false,
            mode: "bike",
            distanceMetres: 1_400,
            lineageRelationship: "population_pattern",
            lineageRaceCount: 10,
            dataCurrentThrough: "2026-07-20T00:00:00.000Z",
            lastImportedAt: "2026-07-20T01:00:00.000Z",
          },
          {
            coreId: "owned-core",
            coreName: "Owned Core",
            meEligible: false,
            mode: "bike",
            distanceMetres: 1_600,
            lineageRelationship: "parent",
            lineageRaceCount: 1,
            dataCurrentThrough: "2026-07-20T00:00:00.000Z",
            lastImportedAt: "2026-07-20T01:00:00.000Z",
          },
        ],
      },
      benchmarkRepository: {
        status: "ready",
        listBenchmarksByOwner: async () => ({
          benchmarks: [],
          publication: null,
        }),
      },
      tournamentRepository: { status: "not_configured" },
    });

    expect(repository.status).toBe("ready");
    if (repository.status !== "ready")
      throw new Error("repository unavailable");

    await expect(
      repository.listCandidateEvidenceByOwner("owner"),
    ).resolves.toMatchObject({
      candidates: [
        {
          distanceMetres: 1_400,
          lineageRelationship: "population_pattern",
          lineageRaceCount: 10,
        },
        {
          distanceMetres: 1_600,
          lineageRelationship: "parent",
          lineageRaceCount: 1,
        },
      ],
    });
  });

  it("uses bounded accepted history when the materialized profile projection is empty", async () => {
    const generationId = "a".repeat(64);
    const observationSetSha256 = "b".repeat(64);
    const repository = createDiscoveryProbeRepository({
      vaultRepository: {
        status: "ready",
        listCoresByOwner: async () => [
          {
            sourceCoreId: "10457",
            displayName: "Accepted Core",
            coreClass: "Genesis",
            element: "Earth",
            fNumber: 5,
            sex: "female",
            inMyVault: true,
            meEligible: null,
            version: 1,
            updatedAt: null,
          },
        ],
      },
      performanceRepository: {
        status: "ready",
        listProfilesByOwner: async () => ({
          profiles: [],
          lastImportedAt: null,
          publication: null,
        }),
      },
      lineageRepository: {
        status: "ready",
        listHypothesesByOwner: async () => [],
      },
      benchmarkRepository: {
        status: "ready",
        listBenchmarksByOwner: async () => ({
          benchmarks: [],
          publication: null,
        }),
      },
      tournamentRepository: { status: "not_configured" },
      acceptedHistoryNow: now,
      acceptedHistoryRepository: {
        readActiveGeneration: async () =>
          ({
            generationId,
            observationSetSha256,
            publishedAt: "2026-07-20T01:00:00.000Z",
            observationCount: 2,
          }) as never,
        readActiveRows: async () => [],
        readSelectedCoreRows: async (_ownerId, selection) => {
          expect(selection).toEqual({
            generationId,
            observationSetSha256,
            coreIds: ["10457"],
            maximumRows: 10_000,
          });
          return {
            status: "ready" as const,
            rows: [0, 1].map((index) => ({
              generationId,
              ordinal: index,
              naturalKey: `core-result:10457:bike:race-${index}`,
              rowSha256: `${index}`.repeat(64),
              payload: {
                sourceType: "joined_core_race_history_result",
                publishedCellStatus: "accepted",
                sourceRaceId: `race-${index}`,
                eventAt: `2026-07-${18 + index}T00:00:00.000Z`,
                sourceCoreId: "10457",
                mode: "bike",
                distanceMetres: 1_400,
                elapsedMilliseconds: 80_000 + index * 1_000,
              },
            })) as never,
          };
        },
      },
    });

    expect(repository.status).toBe("ready");
    if (repository.status !== "ready") throw new Error("Discovery not ready");
    const result = await repository.listCandidateEvidenceByOwner("owner");

    expect(result.candidates).toEqual([
      expect.objectContaining({
        coreId: "10457",
        mode: "bike",
        distanceMetres: 1_400,
        directRaceCount: 2,
        maidenState: "unknown",
      }),
    ]);
    expect(result.lastImportedAt).toBe("2026-07-20T01:00:00.000Z");
    expect(result.acceptedHistoryCoverage).toEqual({
      status: "ready",
      generationId,
      ownedCoreCount: 1,
      selectedCoreCount: 1,
      omittedCoreCount: 0,
      acceptedRowCount: 2,
      maximumRows: 10_000,
    });
  });
});
