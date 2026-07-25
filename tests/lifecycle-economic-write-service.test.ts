import { describe, expect, it, vi } from "vitest";
import type { BurnCreditEvidence } from "@/domain/burn-credit-reconciliation";
import type { CoreBurnEventInput } from "@/domain/core-burn-event";
import type { CoreSaleEvidenceInput } from "@/domain/core-sale-evidence";
import {
  recordActualBurnCredit,
  recordCoreBurnEvidence,
  recordCoreSaleEvidence,
  unavailableLifecycleEconomicWriteRepository,
  type LifecycleEconomicWriteRepository,
  type ValidatedCoreBurnRecord,
} from "@/lib/lifecycle-economic-write-service";

const sale: CoreSaleEvidenceInput = {
  saleId: "synthetic-sale",
  coreId: "synthetic-core",
  occurredAt: "2026-07-20T00:00:00Z",
  recordedAt: "2026-07-21T00:00:00Z",
  evidenceSource: "manual",
  evidenceStatus: "confirmed",
  ownershipAtSale: "confirmed_active",
  proceeds: { asset: "dez", amount: "100.1250" },
  sellingFees: [{ asset: "DEZ", amount: "2.125" }],
  acquisitionCost: { asset: "DEZ", amount: "70" },
  externalReference: "synthetic-sale-reference",
  recommendationReferenceId: "synthetic-lifecycle-review",
};

const burn: CoreBurnEventInput = {
  burnId: "synthetic-burn",
  coreId: "synthetic-core",
  coreClass: "Morphed",
  occurredAt: "2026-07-20T00:00:00Z",
  recordedAt: "2026-07-21T00:00:00Z",
  evidenceSource: "manual",
  evidenceStatus: "confirmed",
  ownershipAtBurn: "confirmed_active",
  reason: "Synthetic confirmed in-game burn evidence.",
  recommendationReferenceId: "synthetic-lifecycle-review",
};

const credit: BurnCreditEvidence = {
  creditId: "synthetic-credit",
  coreId: "synthetic-core",
  burnId: "synthetic-burn",
  occurredAt: "2026-07-20T00:01:00Z",
  asset: "bgc",
  amount: "125.500",
  evidenceSource: "manual",
  evidenceStatus: "confirmed",
  externalReference: null,
};

function burnRecord(
  overrides: Partial<ValidatedCoreBurnRecord> = {},
): ValidatedCoreBurnRecord {
  return {
    input: {
      ...burn,
      occurredAt: "2026-07-20T00:00:00.000Z",
      recordedAt: "2026-07-21T00:00:00.000Z",
    },
    assessment: {
      burnId: "synthetic-burn",
      coreId: "synthetic-core",
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
    ...overrides,
  };
}

function readyRepository(
  overrides: Partial<
    Extract<LifecycleEconomicWriteRepository, { status: "ready" }>
  > = {},
): Extract<LifecycleEconomicWriteRepository, { status: "ready" }> {
  return {
    status: "ready",
    saveSaleByOwner: async () => ({ status: "created" }),
    saveBurnByOwner: async () => ({ status: "created" }),
    loadBurnByOwner: async () => ({
      record: burnRecord(),
      fingerprint: "b".repeat(64),
    }),
    loadBurnCreditByOwner: async () => null,
    loadBurnCreditsForBurnByOwner: async () => [],
    saveBurnCreditByOwner: async () => ({ status: "created" }),
    ...overrides,
  };
}

describe("Lifecycle economic write service", () => {
  it("fails closed before validation or persistence", async () => {
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

  it("denies another owner before any lifecycle evidence read or write", async () => {
    const saveSaleByOwner = vi.fn(async () => ({ status: "created" as const }));
    await expect(
      recordCoreSaleEvidence({
        authenticatedOwnerId: "another-owner",
        configuredOwnerId: "owner",
        repository: readyRepository({ saveSaleByOwner }),
        sale,
      }),
    ).rejects.toThrow("access denied");
    expect(saveSaleByOwner).not.toHaveBeenCalled();
  });

  it("records canonical exact sale evidence without executing or inferring value", async () => {
    let fingerprint = "";
    const result = await recordCoreSaleEvidence({
      authenticatedOwnerId: "owner",
      configuredOwnerId: "owner",
      repository: readyRepository({
        saveSaleByOwner: async (ownerId, record, value) => {
          expect(ownerId).toBe("owner");
          expect(record.input).toMatchObject({
            occurredAt: "2026-07-20T00:00:00.000Z",
            proceeds: { asset: "DEZ", amount: "100.125" },
          });
          expect(record.assessment).toMatchObject({
            status: "postable_review",
            realisedResult: {
              status: "available",
              asset: "DEZ",
              signedAmount: "28",
            },
            saleExecutionAllowed: false,
            ownershipMutationAllowed: false,
            marketValueInferred: false,
          });
          fingerprint = value;
          return { status: "created" };
        },
      }),
      sale,
    });
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result).toMatchObject({
      status: "recorded",
      saleId: "synthetic-sale",
      fingerprint,
      evidenceStatus: "postable_review",
      realisedResultStatus: "available",
    });
  });

  it("keeps a sale without cost basis partial and replays only its exact evidence", async () => {
    let fingerprint = "";
    const withoutCost = { ...sale, acquisitionCost: null };
    const first = await recordCoreSaleEvidence({
      authenticatedOwnerId: "owner",
      configuredOwnerId: "owner",
      repository: readyRepository({
        saveSaleByOwner: async (_ownerId, _record, value) => {
          fingerprint = value;
          return { status: "created" };
        },
      }),
      sale: withoutCost,
    });
    expect(first).toMatchObject({
      realisedResultStatus: "missing_cost_basis",
    });
    await expect(
      recordCoreSaleEvidence({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({
          saveSaleByOwner: async () => ({
            status: "already_exists",
            fingerprint,
          }),
        }),
        sale: withoutCost,
      }),
    ).resolves.toMatchObject({ status: "replayed", fingerprint });
    await expect(
      recordCoreSaleEvidence({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({
          saveSaleByOwner: async () => ({
            status: "conflict",
            fingerprint: "a".repeat(64),
          }),
        }),
        sale: withoutCost,
      }),
    ).rejects.toThrow("conflicts");
  });

  it("records confirmed spliced-core burn evidence without mutating ownership or ledger", async () => {
    await expect(
      recordCoreBurnEvidence({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({
          saveBurnByOwner: async (_ownerId, record, fingerprint) => {
            expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
            expect(record.assessment).toMatchObject({
              status: "confirmed_event_review",
              activeVaultProjection: "remove_after_review",
              historicalLineageRetained: true,
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
      burnId: "synthetic-burn",
      evidenceStatus: "confirmed_event_review",
      activeVaultProjection: "remove_after_review",
    });
  });

  it("permanently rejects Genesis before saving burn evidence", async () => {
    const saveBurnByOwner = vi.fn(async () => ({ status: "created" as const }));
    await expect(
      recordCoreBurnEvidence({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({ saveBurnByOwner }),
        burn: { ...burn, coreClass: "Genesis" },
      }),
    ).rejects.toThrow("Genesis cores cannot be burned");
    expect(saveBurnByOwner).not.toHaveBeenCalled();
  });

  it("records only an actual confirmed BGC credit linked to stored burn evidence", async () => {
    await expect(
      recordActualBurnCredit({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({
          saveBurnCreditByOwner: async (ownerId, record, fingerprint) => {
            expect(ownerId).toBe("owner");
            expect(record.credit).toMatchObject({
              asset: "BGC",
              amount: "125.5",
              occurredAt: "2026-07-20T00:01:00.000Z",
            });
            expect(record.reconciliation).toMatchObject({
              status: "matched_actual_credit",
              actualBgcAmount: "125.5",
              ledgerPostingProposed: true,
              creditPredicted: false,
              burnEventMutated: false,
            });
            expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
            return { status: "created" };
          },
        }),
        credit,
      }),
    ).resolves.toMatchObject({
      status: "recorded",
      creditId: "synthetic-credit",
      reconciliationStatus: "matched_actual_credit",
      ledgerPostingProposed: true,
    });
  });

  it("holds multiple confirmed burn credits for review without proposing a posting", async () => {
    await expect(
      recordActualBurnCredit({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({
          loadBurnCreditsForBurnByOwner: async () => [
            { ...credit, creditId: "prior-credit", amount: "100" },
          ],
        }),
        credit,
      }),
    ).resolves.toMatchObject({
      status: "recorded",
      reconciliationStatus: "review_required",
      ledgerPostingProposed: false,
    });
  });

  it("replays an exact burn credit before loading burn scope and blocks conflicts", async () => {
    const loadBurnByOwner = vi.fn(async () => ({
      record: burnRecord(),
      fingerprint: "b".repeat(64),
    }));
    const initial = await recordActualBurnCredit({
      authenticatedOwnerId: "owner",
      configuredOwnerId: "owner",
      repository: readyRepository(),
      credit,
    });
    const fingerprint = "fingerprint" in initial ? initial.fingerprint : "";
    await expect(
      recordActualBurnCredit({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({
          loadBurnByOwner,
          loadBurnCreditByOwner: async () => ({
            record: {
              credit: { ...credit, asset: "BGC", amount: "125.5" },
              reconciliation: {
                burnId: "synthetic-burn",
                coreId: "synthetic-core",
                status: "matched_actual_credit",
                matchedCreditId: "synthetic-credit",
                actualBgcAmount: "125.5",
                reviewItems: [],
                ledgerPostingProposed: true,
                automaticExclusionAllowed: false,
                creditPredicted: false,
                strategicRecommendationUsed: false,
                burnEventMutated: false,
              },
            },
            fingerprint,
          }),
        }),
        credit,
      }),
    ).resolves.toMatchObject({
      status: "replayed",
      reconciliationStatus: "matched_actual_credit",
    });
    expect(loadBurnByOwner).not.toHaveBeenCalled();

    await expect(
      recordActualBurnCredit({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({
          loadBurnCreditByOwner: async () => ({
            record: {
              credit,
              reconciliation: {
                burnId: "synthetic-burn",
                coreId: "synthetic-core",
                status: "review_required",
                matchedCreditId: null,
                actualBgcAmount: null,
                reviewItems: [],
                ledgerPostingProposed: false,
                automaticExclusionAllowed: false,
                creditPredicted: false,
                strategicRecommendationUsed: false,
                burnEventMutated: false,
              },
            },
            fingerprint: "a".repeat(64),
          }),
        }),
        credit,
      }),
    ).rejects.toThrow("conflicts");
  });

  it("requires a durable matching burn and never predicts missing credit", async () => {
    await expect(
      recordActualBurnCredit({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository(),
        credit: { ...credit, burnId: null },
      }),
    ).rejects.toThrow("requires a durable burn ID");
    await expect(
      recordActualBurnCredit({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({ loadBurnByOwner: async () => null }),
        credit,
      }),
    ).rejects.toThrow("was not found");
  });
});
