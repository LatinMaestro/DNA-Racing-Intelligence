import { describe, expect, it, vi } from "vitest";
import type { BreedingEconomicEvidenceInput } from "@/domain/breeding-economic-evidence";
import type { OffspringCostBasisInput } from "@/domain/offspring-cost-basis";
import {
  assignOffspringCostBasis,
  recordBreedingEconomicEvidence,
  unavailableBreedingEconomicAssetRegistry,
  unavailableBreedingEconomicWriteRepository,
  type BreedingEconomicAssetRegistry,
  type BreedingEconomicWriteRepository,
} from "@/lib/breeding-economic-write-service";

type CostBasisRequest = Omit<
  OffspringCostBasisInput,
  "previouslyAssignedTransactionIds"
>;

const assetRegistry: BreedingEconomicAssetRegistry = {
  status: "ready",
  version: "assets-v1",
  assets: [
    { code: "DEZ", kind: "crypto", precision: 8 },
    { code: "BGC", kind: "game_credit", precision: 2 },
  ],
};

const controls = {
  assetRegistry,
  expectedAssetRegistryVersion: "assets-v1",
  expectedEconomicVersion: "economic-v1",
  serverNow: "2026-07-22T00:00:00Z",
} as const;

const evidence: BreedingEconomicEvidenceInput = {
  evidenceId: " synthetic-evidence ",
  breedingEventId: "synthetic-breeding",
  source: "manual_confirmed",
  lifecycle: "completed",
  occurredAt: "2026-07-20T00:00:00Z",
  parentCoreIds: ["parent-b", "parent-a"],
  offspringCoreId: " offspring ",
  evidenceNote: " Confirmed completed breeding. ",
  entries: [
    {
      transactionId: "fee-b",
      category: "arena_fee_bgc",
      direction: "debit",
      assetCode: "bgc",
      assetKind: "game_credit",
      amount: "10.00",
      externalReference: null,
    },
    {
      transactionId: "fee-a",
      category: "dna_base_fee",
      direction: "debit",
      assetCode: "dez",
      assetKind: "crypto",
      amount: "2.500",
      externalReference: " synthetic-reference ",
    },
  ],
};

const assignment: CostBasisRequest = {
  assignmentId: " synthetic-assignment ",
  offspringCoreId: "offspring",
  breedingEventId: "synthetic-breeding",
  breedingOccurredAt: "2026-07-20T00:00:00Z",
  requestedAt: "2026-07-21T00:00:00Z",
  ownershipStatus: "confirmed_owned",
  breedingEventStatus: "completed",
  costs: [
    {
      transactionId: "fee-a",
      category: "dna_base_fee",
      source: "manual_confirmed",
      evidenceStatus: "confirmed",
      assetCode: "dez",
      assetKind: "crypto",
      amount: "2.500",
    },
    {
      transactionId: "fee-b",
      category: "arena_fee_bgc",
      source: "manual_confirmed",
      evidenceStatus: "confirmed",
      assetCode: "bgc",
      assetKind: "game_credit",
      amount: "10.00",
    },
  ],
  refunds: [],
};

function readyRepository(
  overrides: Partial<
    Extract<BreedingEconomicWriteRepository, { status: "ready" }>
  > = {},
): Extract<BreedingEconomicWriteRepository, { status: "ready" }> {
  return {
    status: "ready",
    loadEvidenceByOwner: async () => null,
    saveEvidenceByOwner: async () => ({
      status: "created",
      economicVersion: "economic-v2",
    }),
    loadCostBasisByOwner: async () => null,
    loadAssignedTransactionIdsByOwner: async () => [],
    saveCostBasisByOwner: async () => ({
      status: "created",
      economicVersion: "economic-v2",
    }),
    ...overrides,
  };
}

describe("breeding economic write service", () => {
  it("fails closed before validation or persistence", async () => {
    await expect(
      recordBreedingEconomicEvidence({
        ...controls,
        authenticatedOwnerId: null,
        configuredOwnerId: "owner",
        repository: unavailableBreedingEconomicWriteRepository,
        evidence,
      }),
    ).resolves.toEqual({ status: "identity_not_connected" });
    await expect(
      assignOffspringCostBasis({
        ...controls,
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: unavailableBreedingEconomicWriteRepository,
        assignment,
      }),
    ).resolves.toEqual({ status: "persistence_not_configured" });
  });

  it("denies another owner before repository access", async () => {
    const loadEvidenceByOwner = vi.fn(async () => null);
    await expect(
      recordBreedingEconomicEvidence({
        ...controls,
        authenticatedOwnerId: "another-owner",
        configuredOwnerId: "owner",
        repository: readyRepository({ loadEvidenceByOwner }),
        evidence,
      }),
    ).rejects.toThrow("access denied");
    expect(loadEvidenceByOwner).not.toHaveBeenCalled();
  });

  it("requires exact authoritative asset-registry evidence", async () => {
    await expect(
      recordBreedingEconomicEvidence({
        ...controls,
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository(),
        assetRegistry: unavailableBreedingEconomicAssetRegistry,
        evidence,
      }),
    ).resolves.toEqual({ status: "asset_registry_not_configured" });
    await expect(
      recordBreedingEconomicEvidence({
        ...controls,
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository(),
        expectedAssetRegistryVersion: "assets-v2",
        evidence,
      }),
    ).rejects.toThrow("registry changed");
    await expect(
      recordBreedingEconomicEvidence({
        ...controls,
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository(),
        evidence: {
          ...evidence,
          entries: [
            {
              ...evidence.entries[0]!,
              assetKind: "crypto",
            },
          ],
        },
      }),
    ).rejects.toThrow("metadata does not match");
    await expect(
      recordBreedingEconomicEvidence({
        ...controls,
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository(),
        evidence: {
          ...evidence,
          entries: [
            {
              ...evidence.entries[0]!,
              amount: "10.001",
            },
          ],
        },
      }),
    ).rejects.toThrow("authoritative precision");
  });

  it("rejects future evidence and optimistic-version drift", async () => {
    await expect(
      recordBreedingEconomicEvidence({
        ...controls,
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository(),
        evidence: { ...evidence, occurredAt: "2026-07-23T00:00:00Z" },
      }),
    ).rejects.toThrow("future");
    await expect(
      recordBreedingEconomicEvidence({
        ...controls,
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({
          saveEvidenceByOwner: async () => ({
            status: "version_conflict",
            economicVersion: "economic-v3",
          }),
        }),
        evidence,
      }),
    ).rejects.toThrow("refresh");
  });

  it("records canonical review-only completed economics", async () => {
    let fingerprint = "";
    const result = await recordBreedingEconomicEvidence({
      ...controls,
      authenticatedOwnerId: "owner",
      configuredOwnerId: "owner",
      repository: readyRepository({
        saveEvidenceByOwner: async (ownerId, record, value) => {
          expect(ownerId).toBe("owner");
          expect(record.input).toMatchObject({
            evidenceId: "synthetic-evidence",
            occurredAt: "2026-07-20T00:00:00.000Z",
            parentCoreIds: ["parent-a", "parent-b"],
            offspringCoreId: "offspring",
          });
          expect(record.input.entries).toEqual([
            expect.objectContaining({
              transactionId: "fee-a",
              assetCode: "DEZ",
              amount: "2.5",
              externalReference: "synthetic-reference",
            }),
            expect.objectContaining({
              transactionId: "fee-b",
              assetCode: "BGC",
              amount: "10",
            }),
          ]);
          expect(record.assessment).toMatchObject({
            status: "postable_review",
            ledgerMutationAllowed: false,
            walletOrGameTransactionAllowed: false,
          });
          fingerprint = value;
          return { status: "created", economicVersion: "economic-v2" };
        },
      }),
      evidence,
    });
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result).toMatchObject({
      status: "recorded",
      evidenceId: "synthetic-evidence",
      evidenceStatus: "postable_review",
      postingCount: 2,
      ledgerMutationAllowed: false,
    });
  });

  it("replays exact evidence before reclassification and blocks conflicts", async () => {
    let fingerprint = "";
    const first = await recordBreedingEconomicEvidence({
      ...controls,
      authenticatedOwnerId: "owner",
      configuredOwnerId: "owner",
      repository: readyRepository({
        saveEvidenceByOwner: async (_ownerId, _record, value) => {
          fingerprint = value;
          return { status: "created", economicVersion: "economic-v2" };
        },
      }),
      evidence,
    });
    const load = vi.fn(async () => ({
      fingerprint,
      economicVersion: "economic-v2",
      record: {
        assets: [],
        input: evidence,
        assessment: {
          ...evidence,
          status: "postable_review" as const,
          postings: [{}, {}] as never,
          totalsByAsset: [],
          holdReasons: [],
          arenaListingTreatedAsIncome: false as const,
          assetsCombined: false as const,
          ledgerMutationAllowed: false as const,
          walletOrGameTransactionAllowed: false as const,
        },
      },
    }));
    await expect(
      recordBreedingEconomicEvidence({
        ...controls,
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({ loadEvidenceByOwner: load }),
        evidence,
      }),
    ).resolves.toMatchObject({ status: "replayed", fingerprint });
    expect(load).toHaveBeenCalledOnce();
    await expect(
      recordBreedingEconomicEvidence({
        ...controls,
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({
          loadEvidenceByOwner: async () => ({
            fingerprint: "a".repeat(64),
            economicVersion: "economic-v2",
            record: load.mock.results[0]!.value as never,
          }),
        }),
        evidence,
      }),
    ).rejects.toThrow("conflicts");
    expect(first.status).toBe("recorded");
  });

  it("holds Arena and incomplete evidence without saving an economic record", async () => {
    const saveEvidenceByOwner = vi.fn(async () => ({
      status: "created" as const,
      economicVersion: "economic-v2",
    }));
    await expect(
      recordBreedingEconomicEvidence({
        ...controls,
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({ saveEvidenceByOwner }),
        evidence: {
          ...evidence,
          source: "arena_listing",
          lifecycle: "unknown",
          occurredAt: null,
          entries: [],
        },
      }),
    ).resolves.toMatchObject({
      status: "held",
      evidenceStatus: "non_transaction_evidence",
      postingCount: 0,
    });
    expect(saveEvidenceByOwner).not.toHaveBeenCalled();
  });

  it("assigns confirmed actual costs using repository-derived duplicate evidence", async () => {
    let fingerprint = "";
    const result = await assignOffspringCostBasis({
      ...controls,
      authenticatedOwnerId: "owner",
      configuredOwnerId: "owner",
      repository: readyRepository({
        loadAssignedTransactionIdsByOwner: async (ownerId, transactionIds) => {
          expect(ownerId).toBe("owner");
          expect(transactionIds).toEqual(["fee-a", "fee-b"]);
          return [];
        },
        saveCostBasisByOwner: async (_ownerId, record, value) => {
          expect(record.request).toMatchObject({
            assignmentId: "synthetic-assignment",
            breedingOccurredAt: "2026-07-20T00:00:00.000Z",
          });
          expect(record.request.costs[0]).toMatchObject({
            transactionId: "fee-a",
            assetCode: "DEZ",
            amount: "2.5",
          });
          expect(record.assessment).toMatchObject({
            status: "assignment_review",
            originalAssetsCombined: false,
            marketValueAssigned: false,
            realisedGainCalculated: false,
            assignmentMutationAllowed: false,
          });
          fingerprint = value;
          return { status: "created", economicVersion: "economic-v2" };
        },
      }),
      assignment,
    });
    expect(result).toMatchObject({
      status: "recorded",
      assignmentId: "synthetic-assignment",
      fingerprint,
      assignmentStatus: "assignment_review",
      originalAssetsCombined: false,
      marketValueAssigned: false,
    });
  });

  it("holds a transaction already assigned to another offspring", async () => {
    const saveCostBasisByOwner = vi.fn(async () => ({
      status: "created" as const,
      economicVersion: "economic-v2",
    }));
    await expect(
      assignOffspringCostBasis({
        ...controls,
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({
          loadAssignedTransactionIdsByOwner: async () => ["fee-a"],
          saveCostBasisByOwner,
        }),
        assignment,
      }),
    ).resolves.toMatchObject({
      status: "held",
      assignmentStatus: "held_for_duplicate",
    });
    expect(saveCostBasisByOwner).not.toHaveBeenCalled();
  });

  it("replays an exact assignment before duplicate lookup and blocks conflicts", async () => {
    let fingerprint = "";
    await assignOffspringCostBasis({
      ...controls,
      authenticatedOwnerId: "owner",
      configuredOwnerId: "owner",
      repository: readyRepository({
        saveCostBasisByOwner: async (_ownerId, _record, value) => {
          fingerprint = value;
          return { status: "created", economicVersion: "economic-v2" };
        },
      }),
      assignment,
    });
    const loadAssigned = vi.fn(async () => ["fee-a"]);
    const stored = {
      fingerprint,
      economicVersion: "economic-v2",
      record: {
        assets: [],
        request: assignment,
        assessment: {
          ...assignment,
          previouslyAssignedTransactionIds: [],
          status: "assignment_review" as const,
          components: [],
          totalsByAsset: [],
          holdReasons: [],
          originalAssetsCombined: false as const,
          marketValueAssigned: false as const,
          realisedGainCalculated: false as const,
          assignmentMutationAllowed: false as const,
        },
      },
    };
    await expect(
      assignOffspringCostBasis({
        ...controls,
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({
          loadCostBasisByOwner: async () => stored,
          loadAssignedTransactionIdsByOwner: loadAssigned,
        }),
        assignment,
      }),
    ).resolves.toMatchObject({ status: "replayed", fingerprint });
    expect(loadAssigned).not.toHaveBeenCalled();
    await expect(
      assignOffspringCostBasis({
        ...controls,
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({
          loadCostBasisByOwner: async () => ({
            ...stored,
            fingerprint: "f".repeat(64),
          }),
        }),
        assignment,
      }),
    ).rejects.toThrow("conflicts");
  });
});
