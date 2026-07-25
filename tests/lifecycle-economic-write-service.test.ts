import { describe, expect, it, vi } from "vitest";
import {
  recordBurnCreditEvidence,
  recordCoreBurnEvidence,
  recordCoreSaleEvidence,
  unavailableLifecycleEconomicWriteRepository,
  type LifecycleEconomicWriteRepository,
} from "@/lib/lifecycle-economic-write-service";

const sale = {
  saleId: "sale-1",
  coreId: "core-1",
  occurredAt: "2026-07-20T00:00:00.000Z",
  recordedAt: "2026-07-21T00:00:00.000Z",
  evidenceSource: "manual" as const,
  evidenceStatus: "confirmed" as const,
  ownershipAtSale: "confirmed_active" as const,
  proceeds: { asset: "ETH", amount: "2" },
  sellingFees: [{ asset: "ETH", amount: "0.1" }],
  acquisitionCost: { asset: "ETH", amount: "1.25" },
  externalReference: "sale-reference",
  recommendationReferenceId: null,
};

const burn = {
  burnId: "burn-1",
  coreId: "core-1",
  coreClass: "Morphed" as const,
  occurredAt: "2026-07-20T00:00:00.000Z",
  recordedAt: "2026-07-21T00:00:00.000Z",
  evidenceSource: "manual" as const,
  evidenceStatus: "confirmed" as const,
  ownershipAtBurn: "confirmed_active" as const,
  reason: "Synthetic confirmed burn.",
  recommendationReferenceId: null,
};

function readyRepository(
  overrides: Partial<
    Extract<LifecycleEconomicWriteRepository, { status: "ready" }>
  > = {},
): Extract<LifecycleEconomicWriteRepository, { status: "ready" }> {
  return {
    status: "ready",
    saveSaleByOwner: async () => ({ status: "created" }),
    saveBurnByOwner: async () => ({ status: "created" }),
    loadBurnByOwner: async () => null,
    loadBurnCreditsByOwner: async () => [],
    saveBurnCreditByOwner: async () => ({ status: "created" }),
    ...overrides,
  };
}

describe("Lifecycle economic write service", () => {
  it("fails closed without owner identity or persistence", async () => {
    await expect(
      recordCoreSaleEvidence({
        authenticatedOwnerId: null,
        configuredOwnerId: "owner",
        repository: unavailableLifecycleEconomicWriteRepository,
        sale,
      }),
    ).resolves.toEqual({ status: "identity_not_connected" });
    await expect(
      recordCoreBurnEvidence({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: unavailableLifecycleEconomicWriteRepository,
        burn,
      }),
    ).resolves.toEqual({ status: "persistence_not_configured" });
  });

  it("denies another owner before economic persistence", async () => {
    const saveSaleByOwner = vi.fn(async () => ({ status: "created" as const }));
    await expect(
      recordCoreSaleEvidence({
        authenticatedOwnerId: "other",
        configuredOwnerId: "owner",
        repository: readyRepository({ saveSaleByOwner }),
        sale,
      }),
    ).rejects.toThrow("access denied");
    expect(saveSaleByOwner).not.toHaveBeenCalled();
  });

  it("records exact sale evidence and keeps ownership immutable", async () => {
    const result = await recordCoreSaleEvidence({
      authenticatedOwnerId: "owner",
      configuredOwnerId: "owner",
      repository: readyRepository({
        saveSaleByOwner: async (ownerId, input, assessment, fingerprint) => {
          expect(ownerId).toBe("owner");
          expect(input.saleId).toBe("sale-1");
          expect(assessment).toMatchObject({
            status: "postable_review",
            realisedResult: {
              status: "available",
              asset: "ETH",
              signedAmount: "0.65",
            },
            ownershipMutationAllowed: false,
            saleExecutionAllowed: false,
          });
          expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
          return { status: "created" };
        },
      }),
      sale,
    });
    expect(result).toMatchObject({
      status: "recorded",
      evidenceStatus: "postable_review",
      realisedResult: "available",
      ownershipMutationAllowed: false,
    });
  });

  it("keeps missing or unlike cost basis unavailable", async () => {
    await expect(
      recordCoreSaleEvidence({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository(),
        sale: { ...sale, acquisitionCost: null },
      }),
    ).resolves.toMatchObject({ realisedResult: "missing_cost_basis" });
    await expect(
      recordCoreSaleEvidence({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository(),
        sale: {
          ...sale,
          acquisitionCost: { asset: "DEZ", amount: "10" },
        },
      }),
    ).resolves.toMatchObject({ realisedResult: "asset_mismatch" });
  });

  it("records confirmed burn evidence without execution or predicted credit", async () => {
    await expect(
      recordCoreBurnEvidence({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({
          saveBurnByOwner: async (_ownerId, _input, assessment) => {
            expect(assessment).toMatchObject({
              status: "confirmed_event_review",
              activeVaultProjection: "remove_after_review",
              historicalLineageRetained: true,
              burnCreditAmount: null,
              burnCreditPredicted: false,
              burnExecutionAllowed: false,
              ownershipMutationAllowed: false,
              ledgerMutationAllowed: false,
            });
            return { status: "created" };
          },
        }),
        burn,
      }),
    ).resolves.toMatchObject({
      status: "recorded",
      evidenceStatus: "confirmed_event_review",
      activeVaultProjection: "remove_after_review",
      ownershipMutationAllowed: false,
      burnCreditPredicted: false,
    });
  });

  it("permanently rejects Genesis burn evidence", async () => {
    await expect(
      recordCoreBurnEvidence({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository(),
        burn: { ...burn, coreClass: "Genesis" },
      }),
    ).rejects.toThrow("Genesis cores cannot be burned");
  });

  it("records only an actual unambiguous BGC credit proposal", async () => {
    const result = await recordBurnCreditEvidence({
      authenticatedOwnerId: "owner",
      configuredOwnerId: "owner",
      repository: readyRepository({
        loadBurnByOwner: async () => ({
          occurredAt: burn.occurredAt,
          result: {
            burnId: burn.burnId,
            coreId: burn.coreId,
            status: "confirmed_event_review",
            reviewReasons: [],
            activeVaultProjection: "remove_after_review",
            historicalLineageRetained: true,
            burnCreditAmount: null,
            burnCreditPredicted: false,
            recommendationWasExecutionEvidence: false,
            burnExecutionAllowed: false,
            ownershipMutationAllowed: false,
            ledgerMutationAllowed: false,
          },
        }),
        saveBurnCreditByOwner: async (
          ownerId,
          credit,
          reconciliation,
          fingerprint,
        ) => {
          expect(ownerId).toBe("owner");
          expect(credit).toMatchObject({
            creditId: "credit-1",
            burnId: "burn-1",
            coreId: "core-1",
            asset: "BGC",
            amount: "12.5",
          });
          expect(reconciliation).toMatchObject({
            status: "matched_actual_credit",
            actualBgcAmount: "12.5",
            ledgerPostingProposed: true,
            creditPredicted: false,
            burnEventMutated: false,
          });
          expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
          return { status: "created" };
        },
      }),
      credit: {
        creditId: "credit-1",
        burnId: "burn-1",
        coreId: "core-1",
        occurredAt: "2026-07-21T00:00:00.000Z",
        asset: "bgc",
        amount: "12.5",
        evidenceSource: "manual",
        evidenceStatus: "confirmed",
        externalReference: null,
      },
    });
    expect(result).toMatchObject({
      reconciliationStatus: "matched_actual_credit",
      ledgerPostingProposed: true,
      ledgerMutationAllowed: false,
      creditPredicted: false,
    });
  });

  it("holds ambiguous or mismatched credits and rejects missing burns", async () => {
    const stored = {
      occurredAt: burn.occurredAt,
      result: {
        burnId: burn.burnId,
        coreId: burn.coreId,
        status: "confirmed_event_review" as const,
        reviewReasons: [],
        activeVaultProjection: "remove_after_review" as const,
        historicalLineageRetained: true as const,
        burnCreditAmount: null,
        burnCreditPredicted: false as const,
        recommendationWasExecutionEvidence: false as const,
        burnExecutionAllowed: false as const,
        ownershipMutationAllowed: false as const,
        ledgerMutationAllowed: false as const,
      },
    };
    await expect(
      recordBurnCreditEvidence({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({
          loadBurnByOwner: async () => stored,
          loadBurnCreditsByOwner: async () => [
            {
              creditId: "credit-existing",
              burnId: "burn-1",
              coreId: "core-1",
              occurredAt: "2026-07-21T00:00:00.000Z",
              asset: "BGC",
              amount: "10",
              evidenceSource: "manual",
              evidenceStatus: "confirmed",
              externalReference: null,
            },
          ],
        }),
        credit: {
          creditId: "credit-2",
          burnId: "burn-1",
          coreId: "core-1",
          occurredAt: "2026-07-21T00:00:00.000Z",
          asset: "BGC",
          amount: "12",
          evidenceSource: "manual",
          evidenceStatus: "confirmed",
          externalReference: null,
        },
      }),
    ).resolves.toMatchObject({
      reconciliationStatus: "review_required",
      ledgerPostingProposed: false,
    });
    await expect(
      recordBurnCreditEvidence({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository(),
        credit: {
          creditId: "credit-2",
          burnId: "burn-missing",
          coreId: "core-1",
          occurredAt: "2026-07-21T00:00:00.000Z",
          asset: "BGC",
          amount: "12",
          evidenceSource: "manual",
          evidenceStatus: "confirmed",
          externalReference: null,
        },
      }),
    ).rejects.toThrow("Referenced burn was not found");
  });

  it("replays exact evidence and blocks conflicting durable identities", async () => {
    let fingerprint = "";
    await recordCoreBurnEvidence({
      authenticatedOwnerId: "owner",
      configuredOwnerId: "owner",
      repository: readyRepository({
        saveBurnByOwner: async (_ownerId, _input, _result, value) => {
          fingerprint = value;
          return { status: "created" };
        },
      }),
      burn,
    });
    await expect(
      recordCoreBurnEvidence({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({
          saveBurnByOwner: async () => ({
            status: "already_exists",
            fingerprint,
          }),
        }),
        burn,
      }),
    ).resolves.toMatchObject({ status: "replayed", fingerprint });
    await expect(
      recordCoreBurnEvidence({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({
          saveBurnByOwner: async () => ({
            status: "conflict",
            fingerprint: "f".repeat(64),
          }),
        }),
        burn,
      }),
    ).rejects.toThrow("conflicts");
  });
});
