import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  ownerId: vi.fn(async (): Promise<string | null> => null),
}));

vi.mock("../lib/clerk-owner-session", () => ({
  authenticatedClerkOwnerId: session.ownerId,
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
});
