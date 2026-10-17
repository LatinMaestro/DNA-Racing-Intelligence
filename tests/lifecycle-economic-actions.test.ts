import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { assessCoreBurnEvent } from "../domain/core-burn-event";

const session = vi.hoisted(() => ({
  ownerId: vi.fn(async (): Promise<string | null> => null),
}));
const persistence = vi.hoisted(() => ({
  factory: vi.fn((): unknown => ({ status: "not_configured" })),
}));
const vaultCatalogue = vi.hoisted(() => ({
  factory: vi.fn((): unknown => ({ status: "not_configured" })),
}));

vi.mock("../lib/clerk-owner-session", () => ({
  authenticatedClerkOwnerId: session.ownerId,
}));
vi.mock("../lib/neon-lifecycle-economic-write-repository", () => ({
  neonLifecycleEconomicPersistenceFromEnvironment: persistence.factory,
}));
vi.mock("../lib/neon-owner-vault-catalogue-repository", () => ({
  neonOwnerVaultCatalogueRepositoryFromEnvironment: vaultCatalogue.factory,
}));

import {
  recordBurnCreditEvidenceAction,
  recordBurnCreditFormAction,
  recordCoreBurnEvidenceAction,
  recordCoreBurnFormAction,
  recordCoreSaleEvidenceAction,
  recordCoreSaleFormAction,
} from "../app/(private)/lifecycle/actions";

const saleInput = {
  sale: {
    saleId: "sale-1",
    coreId: "core-1",
    occurredAt: "2026-07-26T02:00:00.000Z",
    recordedAt: "2026-07-26T02:05:00.000Z",
    evidenceSource: "manual" as const,
    evidenceStatus: "confirmed" as const,
    ownershipAtSale: "confirmed_active" as const,
    proceeds: { asset: "ETH", amount: "1.25" },
    sellingFees: [{ asset: "ETH", amount: "0.01" }],
    acquisitionCost: null,
    externalReference: null,
    recommendationReferenceId: null,
  },
  expectedAssetRegistryVersion: "asset-registry-v1",
  expectedLifecycleVersion: "lifecycle-v1",
};

const burnInput = {
  burn: {
    burnId: "burn-1",
    coreId: "core-1",
    coreClass: "Morphed" as const,
    occurredAt: "2026-07-26T03:00:00.000Z",
    recordedAt: "2026-07-26T03:05:00.000Z",
    evidenceSource: "manual" as const,
    evidenceStatus: "confirmed" as const,
    ownershipAtBurn: "confirmed_active" as const,
    reason: "Synthetic confirmed burn evidence.",
    recommendationReferenceId: null,
  },
  expectedLifecycleVersion: "lifecycle-v1",
};

const creditInput = {
  credit: {
    creditId: "credit-1",
    coreId: "core-1",
    burnId: "burn-1",
    occurredAt: "2026-07-26T04:00:00.000Z",
    asset: "BGC",
    amount: "5",
    evidenceSource: "manual" as const,
    evidenceStatus: "confirmed" as const,
    externalReference: null,
  },
  expectedAssetRegistryVersion: "asset-registry-v1",
  expectedLifecycleVersion: "lifecycle-v1",
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("Lifecycle economic Server Actions", () => {
  it("resolves Clerk identity inside the request and fails closed when signed out", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce(null);

    await expect(recordCoreSaleEvidenceAction(saleInput)).resolves.toEqual({
      status: "identity_not_connected",
    });
    expect(session.ownerId).toHaveBeenCalledWith({
      environment: { publishableKey: undefined, secretKey: undefined },
    });
  });

  it("rejects a signed-in non-owner before persistence access", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce("other-owner");

    await expect(recordCoreBurnEvidenceAction(burnInput)).rejects.toThrow(
      "access denied",
    );
  });

  it("keeps sale, burn and actual BGC credit persistence unavailable", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValue("owner-1");

    await expect(recordCoreSaleEvidenceAction(saleInput)).resolves.toEqual({
      status: "persistence_not_configured",
    });
    await expect(recordCoreBurnEvidenceAction(burnInput)).resolves.toEqual({
      status: "persistence_not_configured",
    });
    await expect(recordBurnCreditEvidenceAction(creditInput)).resolves.toEqual({
      status: "persistence_not_configured",
    });
  });

  it("does not let serialized input replace server-owned capabilities", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce("owner-1");

    const hostileInput = {
      ...creditInput,
      authenticatedOwnerId: "other-owner",
      configuredOwnerId: "other-owner",
      repository: { status: "ready" },
      assetRegistry: { status: "ready", version: "browser-controlled" },
      serverNow: "2099-01-01T00:00:00.000Z",
    } as unknown as Parameters<typeof recordBurnCreditEvidenceAction>[0];

    await expect(recordBurnCreditEvidenceAction(hostileInput)).resolves.toEqual(
      {
        status: "persistence_not_configured",
      },
    );
  });

  it("rechecks the owner for every lifecycle operation", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValue("owner-1");

    await recordCoreSaleEvidenceAction(saleInput);
    await recordCoreBurnEvidenceAction(burnInput);
    await recordBurnCreditEvidenceAction(creditInput);

    expect(session.ownerId).toHaveBeenCalledTimes(3);
  });

  it("keeps all strict FormData actions unavailable before parsing", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValue("owner-1");

    const results = await Promise.all([
      recordCoreSaleFormAction(new FormData()),
      recordCoreBurnFormAction(new FormData()),
      recordBurnCreditFormAction(new FormData()),
    ]);

    for (const result of results) {
      expect(result).toMatchObject({
        status: "persistence_not_configured",
        submittedValuesEchoed: false,
        rawErrorEchoed: false,
      });
    }
  });

  it("denies a non-owner FormData action before parser access", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce("other-owner");

    await expect(
      recordCoreSaleFormAction(new FormData()),
    ).resolves.toMatchObject({
      status: "identity_not_connected",
      title: "Owner verification required",
      submittedValuesEchoed: false,
      rawErrorEchoed: false,
    });
  });

  it("records strict forms from owner-scoped lifecycle and active-Vault evidence", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    vi.stubEnv("DATABASE_URL", "postgresql://synthetic.invalid/db");
    vi.stubEnv("DNA_DATABASE_OWNER_ID", "91500000-0000-4000-8000-000000000001");
    vi.stubEnv("DNA_DATABASE_RUNTIME_ROLE", "dna_app_runtime");
    session.ownerId.mockResolvedValue("owner-1");

    const storedBurnRecord = {
      input: burnInput.burn,
      result: assessCoreBurnEvent(burnInput.burn),
    };
    const storedBurn = {
      record: storedBurnRecord,
      fingerprint: createHash("sha256")
        .update(JSON.stringify(storedBurnRecord))
        .digest("hex"),
    };
    const saveSaleByOwner = vi.fn(async () => ({
      status: "created" as const,
      lifecycleVersion: "8",
    }));
    const saveBurnByOwner = vi.fn(async () => ({
      status: "created" as const,
      lifecycleVersion: "8",
    }));
    const saveBurnCreditByOwner = vi.fn(async () => ({
      status: "created" as const,
      lifecycleVersion: "8",
    }));
    const loadBurnByOwner = vi.fn(async () => storedBurn);
    const repository = {
      status: "ready" as const,
      saveSaleByOwner,
      saveBurnByOwner,
      saveBurnCreditByOwner,
      loadBurnByOwner,
      loadBurnCreditByOwner: vi.fn(async () => null),
      loadBurnCreditsByOwner: vi.fn(async () => []),
    };
    const readyPersistence = {
      status: "ready" as const,
      repository,
      loadContextByOwner: vi.fn(async () => ({
        assetRegistry: {
          status: "ready" as const,
          version: "a".repeat(64),
          assets: [
            { code: "ETH", kind: "crypto" as const, precision: 18 },
            { code: "BGC", kind: "game_credit" as const, precision: 8 },
          ],
        },
        lifecycleVersion: "7",
      })),
    };
    persistence.factory.mockReturnValue(readyPersistence);
    const listCoresByOwner = vi.fn(async () => [
      {
        sourceCoreId: "core-1",
        displayName: "Synthetic core",
        coreClass: "Morphed" as const,
        element: "Fire" as const,
        fNumber: 1,
        sex: "male" as const,
        inMyVault: true,
        meEligible: false,
        version: 1,
        updatedAt: "2026-07-20T00:00:00.000Z",
      },
    ]);
    vaultCatalogue.factory.mockReturnValue({
      status: "ready" as const,
      listCoresByOwner,
    });

    const sale = new FormData();
    sale.set("coreId", "core-1");
    sale.set("occurredAt", "2026-07-26T10:00:00+10:00");
    sale.set("proceedsAsset", "ETH");
    sale.set("proceedsAmount", "1.25");
    await expect(recordCoreSaleFormAction(sale)).resolves.toMatchObject({
      status: "recorded",
      submittedValuesEchoed: false,
    });

    const burn = new FormData();
    burn.set("coreId", "core-1");
    burn.set("coreClass", "Morphed");
    burn.set("occurredAt", "2026-07-26T11:00:00+10:00");
    burn.set("reason", "Confirmed completed burn.");
    await expect(recordCoreBurnFormAction(burn)).resolves.toMatchObject({
      status: "recorded",
      submittedValuesEchoed: false,
    });

    const credit = new FormData();
    credit.set("burnId", "burn-1");
    credit.set("coreId", "core-1");
    credit.set("occurredAt", "2026-07-26T14:00:00+10:00");
    credit.set("amount", "5");
    await expect(recordBurnCreditFormAction(credit)).resolves.toMatchObject({
      status: "recorded",
      submittedValuesEchoed: false,
    });

    expect(listCoresByOwner).toHaveBeenCalledTimes(2);
    expect(saveSaleByOwner).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({
        input: expect.objectContaining({ coreId: "core-1" }),
      }),
      expect.stringMatching(/^[a-f0-9]{64}$/),
      "7",
    );
    expect(saveBurnByOwner).toHaveBeenCalledTimes(1);
    expect(loadBurnByOwner).toHaveBeenCalledTimes(2);
    expect(saveBurnCreditByOwner).toHaveBeenCalledTimes(1);
  });
});
