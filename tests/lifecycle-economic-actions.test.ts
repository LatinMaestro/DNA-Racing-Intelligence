import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  ownerId: vi.fn(async (): Promise<string | null> => null),
}));

vi.mock("../lib/clerk-owner-session", () => ({
  authenticatedClerkOwnerId: session.ownerId,
}));

import {
  recordActualBurnCreditFeedbackAction,
  recordActualBurnCreditAction,
  recordCoreBurnEvidenceFeedbackAction,
  recordCoreBurnEvidenceAction,
  recordCoreSaleEvidenceFeedbackAction,
  recordCoreSaleEvidenceAction,
} from "../app/(private)/lifecycle/actions";

const sale = {
  saleId: "synthetic-sale",
  coreId: "synthetic-core",
  occurredAt: "2026-07-20T00:00:00.000Z",
  recordedAt: "2026-07-21T00:00:00.000Z",
  evidenceSource: "manual" as const,
  evidenceStatus: "confirmed" as const,
  ownershipAtSale: "confirmed_active" as const,
  proceeds: { asset: "DEZ", amount: "100" },
  sellingFees: [{ asset: "DEZ", amount: "2" }],
  acquisitionCost: null,
  externalReference: null,
  recommendationReferenceId: null,
};

const burn = {
  burnId: "synthetic-burn",
  coreId: "synthetic-core",
  coreClass: "Morphed" as const,
  occurredAt: "2026-07-20T00:00:00.000Z",
  recordedAt: "2026-07-21T00:00:00.000Z",
  evidenceSource: "manual" as const,
  evidenceStatus: "confirmed" as const,
  ownershipAtBurn: "confirmed_active" as const,
  reason: "Synthetic completed burn evidence.",
  recommendationReferenceId: null,
};

const credit = {
  creditId: "synthetic-credit",
  coreId: "synthetic-core",
  burnId: "synthetic-burn",
  occurredAt: "2026-07-20T00:01:00.000Z",
  asset: "BGC",
  amount: "125",
  evidenceSource: "manual" as const,
  evidenceStatus: "confirmed" as const,
  externalReference: null,
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("lifecycle economic Server Actions", () => {
  it("resolves Clerk identity inside the request and fails closed when signed out", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce(null);

    await expect(recordCoreSaleEvidenceAction(sale)).resolves.toEqual({
      status: "identity_not_connected",
    });
    expect(session.ownerId).toHaveBeenCalledWith({
      environment: {
        publishableKey: undefined,
        secretKey: undefined,
      },
    });
  });

  it("rejects a signed-in non-owner before persistence access", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce("other-owner");

    await expect(recordCoreSaleEvidenceAction(sale)).rejects.toThrow(
      "access denied",
    );
  });

  it("keeps sale, burn and actual BGC-credit persistence unavailable", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId
      .mockResolvedValueOnce("owner-1")
      .mockResolvedValueOnce("owner-1")
      .mockResolvedValueOnce("owner-1");

    await expect(recordCoreSaleEvidenceAction(sale)).resolves.toEqual({
      status: "persistence_not_configured",
    });
    await expect(recordCoreBurnEvidenceAction(burn)).resolves.toEqual({
      status: "persistence_not_configured",
    });
    await expect(recordActualBurnCreditAction(credit)).resolves.toEqual({
      status: "persistence_not_configured",
    });
  });

  it("rechecks the authenticated owner independently for every operation", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId
      .mockResolvedValueOnce("owner-1")
      .mockResolvedValueOnce("owner-1")
      .mockResolvedValueOnce("owner-1");

    await recordCoreSaleEvidenceAction(sale);
    await recordCoreBurnEvidenceAction(burn);
    await recordActualBurnCreditAction(credit);

    expect(session.ownerId).toHaveBeenCalledTimes(3);
  });

  it("returns reviewed feedback without enabling sale, burn or credit persistence", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId
      .mockResolvedValueOnce("owner-1")
      .mockResolvedValueOnce("owner-1")
      .mockResolvedValueOnce("owner-1");

    const results = await Promise.all([
      recordCoreSaleEvidenceFeedbackAction(sale),
      recordCoreBurnEvidenceFeedbackAction(burn),
      recordActualBurnCreditFeedbackAction(credit),
    ]);

    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result).toMatchObject({
        title: "Evidence recording is unavailable",
        tone: "warning",
        submittedValuesEchoed: false,
        rawErrorEchoed: false,
      });
    }
  });
});
