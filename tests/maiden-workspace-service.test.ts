import { describe, expect, it, vi } from "vitest";
import type {
  MaidenAllocationBracketInput,
  MaidenAllocationCandidateInput,
} from "@/domain/maiden-vault-allocation";
import {
  loadMaidenWorkspacePageState,
  type MaidenAllocationEvidence,
  unavailableMaidenAllocationRepository,
} from "@/lib/maiden-workspace-service";

const now = new Date("2026-07-28T00:00:00.000Z");
const publication = {
  sourceEvidenceSha256: "a".repeat(64),
  snapshotSha256: "b".repeat(64),
  materializedAt: "2026-07-28T00:00:00.000Z",
} as const;

function envelope(evidence: MaidenAllocationEvidence) {
  return { evidence, ...publication };
}
const versions = {
  configurationVersion: "config-v3",
  candidateSnapshotVersion: "snapshot-v9",
  projectionVersion: "projection-v4",
} as const;
const bracket: MaidenAllocationBracketInput = {
  tournamentId: "synthetic-maiden",
  tournamentLabel: "Synthetic Maiden",
  bracketId: "synthetic-bracket",
  bracketLabel: "Synthetic Bracket",
  mode: "bike",
  ...versions,
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
  ...versions,
  projectionBasis: "time_led_chronological",
  projectedValueBasisPoints: 8_500,
  suitability: "preserve_me",
  lifecycleState: "eligible",
  evidenceConfidence: "moderate",
  timeEvidence: "competitive",
  historicalStarSupport: "supports",
  crossModeEvidenceComplete: true,
  dataCurrentThrough: "2026-07-25T00:00:00.000Z",
  lastImported: "2020-01-01T00:00:00.000Z",
  freshness: "stale",
};

function repository(
  candidates: readonly MaidenAllocationCandidateInput[] = [candidate],
  lastImportedAt: string | null = "2026-07-28T00:00:00.000Z",
) {
  return {
    status: "ready" as const,
    loadAllocationEvidenceByOwner: async () =>
      envelope({ brackets: [bracket], candidates, lastImportedAt }),
  };
}

describe("Maiden workspace service", () => {
  it("returns identity and persistence states without reading evidence", async () => {
    await expect(
      loadMaidenWorkspacePageState({
        authenticatedOwnerId: null,
        configuredOwnerId: "owner",
        repository: unavailableMaidenAllocationRepository,
        now,
      }),
    ).resolves.toEqual({
      allocation: null,
      lastImportedAt: null,
      sourceEvidenceSha256: null,
      snapshotSha256: null,
      materializedAt: null,
      connectionStatus: "identity_not_connected",
    });
    await expect(
      loadMaidenWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: unavailableMaidenAllocationRepository,
        now,
      }),
    ).resolves.toEqual({
      allocation: null,
      lastImportedAt: null,
      sourceEvidenceSha256: null,
      snapshotSha256: null,
      materializedAt: null,
      connectionStatus: "persistence_not_configured",
    });
  });

  it("denies a different owner before persistence", async () => {
    const loadAllocationEvidenceByOwner = vi.fn(async () =>
      envelope({
        brackets: [bracket],
        candidates: [candidate],
        lastImportedAt: "2026-07-28T00:00:00.000Z",
      }),
    );
    await expect(
      loadMaidenWorkspacePageState({
        authenticatedOwnerId: "other-owner",
        configuredOwnerId: "owner",
        repository: { status: "ready", loadAllocationEvidenceByOwner },
        now,
      }),
    ).rejects.toThrow("access denied");
    expect(loadAllocationEvidenceByOwner).not.toHaveBeenCalled();
  });

  it("derives freshness and accepted import identity server-side", async () => {
    await expect(
      loadMaidenWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: repository(),
        now,
      }),
    ).resolves.toMatchObject({
      connectionStatus: "read_model_connected",
      lastImportedAt: "2026-07-28T00:00:00.000Z",
      sourceEvidenceSha256: publication.sourceEvidenceSha256,
      snapshotSha256: publication.snapshotSha256,
      materializedAt: publication.materializedAt,
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
            lastImported: "2026-07-28T00:00:00.000Z",
            freshness: "current",
          },
        ],
      },
    });
  });

  it.each([
    [3, "current", "provisionally_allocated"],
    [4, "ageing", "provisionally_allocated"],
    [7, "ageing", "provisionally_allocated"],
    [8, "stale", "evidence_incomplete"],
  ] as const)(
    "derives the %s-day cutoff boundary as %s",
    async (ageDays, freshness, status) => {
      const dataCurrentThrough = new Date(
        now.getTime() - ageDays * 86_400_000,
      ).toISOString();
      await expect(
        loadMaidenWorkspacePageState({
          authenticatedOwnerId: "owner",
          configuredOwnerId: "owner",
          repository: repository([
            {
              ...candidate,
              suitability: "review_candidate",
              dataCurrentThrough,
            },
          ]),
          now,
        }),
      ).resolves.toMatchObject({
        allocation: { candidates: [{ freshness, status }] },
      });
    },
  );

  it("defers every candidate when no accepted import exists", async () => {
    await expect(
      loadMaidenWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: repository(
          [{ ...candidate, suitability: "review_candidate" }],
          null,
        ),
        now,
      }),
    ).resolves.toMatchObject({
      lastImportedAt: null,
      allocation: {
        assignments: [],
        candidates: [
          {
            freshness: "unknown",
            lastImported: null,
            status: "evidence_incomplete",
          },
        ],
      },
    });
  });

  it("accepts an empty read model but rejects orphaned candidates", async () => {
    await expect(
      loadMaidenWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          loadAllocationEvidenceByOwner: async () => null,
        },
        now,
      }),
    ).resolves.toEqual({
      allocation: null,
      lastImportedAt: null,
      sourceEvidenceSha256: null,
      snapshotSha256: null,
      materializedAt: null,
      connectionStatus: "read_model_connected",
    });

    await expect(
      loadMaidenWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          loadAllocationEvidenceByOwner: async () =>
            envelope({ brackets: [], candidates: [], lastImportedAt: null }),
        },
        now,
      }),
    ).resolves.toMatchObject({
      allocation: null,
      connectionStatus: "read_model_connected",
    });

    await expect(
      loadMaidenWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          loadAllocationEvidenceByOwner: async () =>
            envelope({
              brackets: [],
              candidates: [candidate],
              lastImportedAt: null,
            }),
        },
        now,
      }),
    ).rejects.toThrow("require configured brackets");
  });

  it("reports accepted owner Vault eligibility without inventing a Maiden allocation", async () => {
    const listCoresByOwner = vi.fn(async () => [
      {
        sourceCoreId: "10457",
        displayName: "Core 10457",
        coreClass: "Genesis" as const,
        element: "Fire" as const,
        fNumber: 1,
        sex: "male" as const,
        inMyVault: true,
        meEligible: true,
        version: 1,
        updatedAt: null,
      },
      {
        sourceCoreId: "10458",
        displayName: "Core 10458",
        coreClass: "Morphed" as const,
        element: "Water" as const,
        fNumber: 2,
        sex: "female" as const,
        inMyVault: true,
        meEligible: false,
        version: 1,
        updatedAt: null,
      },
      {
        sourceCoreId: "10459",
        displayName: "Core 10459",
        coreClass: "Freak" as const,
        element: "Earth" as const,
        fNumber: 3,
        sex: "male" as const,
        inMyVault: true,
        meEligible: null,
        version: null,
        updatedAt: null,
        source: "accepted_owner_api_snapshot" as const,
      },
    ]);
    await expect(
      loadMaidenWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          loadAllocationEvidenceByOwner: async () => null,
        },
        vaultRepository: { status: "ready", listCoresByOwner },
        now,
      }),
    ).resolves.toMatchObject({
      allocation: null,
      eligibilitySummary: {
        ownedCoreCount: 3,
        knownEligibleCount: 1,
        knownNotEligibleCount: 1,
        unknownEligibilityCount: 1,
      },
    });
    expect(listCoresByOwner).toHaveBeenCalledWith("owner", {
      scope: "vault",
      query: null,
      element: null,
      coreClass: null,
      sex: null,
      fNumber: null,
    });
  });

  it("rejects future, post-import, malformed and non-canonical evidence", async () => {
    const cases = [
      repository([candidate], "2026-07-29T00:00:00.000Z"),
      repository([
        { ...candidate, dataCurrentThrough: "2026-07-29T00:00:00.000Z" },
      ]),
      repository(
        [
          {
            ...candidate,
            dataCurrentThrough: "2026-07-27T00:00:00.000Z",
          },
        ],
        "2026-07-26T00:00:00.000Z",
      ),
      repository([candidate], "not-a-timestamp"),
      repository(
        [{ ...candidate, dataCurrentThrough: "2026-07-25T00:00:00Z" }],
        "2026-07-28T00:00:00.000Z",
      ),
    ];
    for (const item of cases) {
      await expect(
        loadMaidenWorkspacePageState({
          authenticatedOwnerId: "owner",
          configuredOwnerId: "owner",
          repository: item,
          now,
        }),
      ).rejects.toThrow();
    }
  });

  it("rejects malformed repositories and invalid server time", async () => {
    await expect(
      loadMaidenWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: { status: "unsupported" } as never,
        now,
      }),
    ).rejects.toThrow("repository status");
    await expect(
      loadMaidenWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: repository(),
        now: new Date("invalid"),
      }),
    ).rejects.toThrow("now must be valid");
  });
});
