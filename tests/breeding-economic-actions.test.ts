import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  ownerId: vi.fn(async (): Promise<string | null> => null),
}));

vi.mock("../lib/clerk-owner-session", () => ({
  authenticatedClerkOwnerId: session.ownerId,
}));

import {
  assignOffspringCostBasisAction,
  assignOffspringCostBasisFormAction,
  recordBreedingEconomicEvidenceAction,
  recordBreedingEconomicEvidenceFormAction,
} from "../app/(private)/breeding/actions";

const versions = {
  expectedAssetRegistryVersion: "asset-registry-v1",
  expectedEconomicVersion: "economic-v1",
};

const evidenceInput = {
  evidence: {
    evidenceId: "evidence-1",
    breedingEventId: "breeding-1",
    source: "manual_confirmed" as const,
    lifecycle: "completed" as const,
    occurredAt: "2026-07-26T02:00:00.000Z",
    parentCoreIds: ["parent-a", "parent-b"] as const,
    offspringCoreId: "offspring-1",
    evidenceNote: "Synthetic completed breeding evidence.",
    entries: [
      {
        transactionId: "transaction-1",
        category: "dna_base_fee" as const,
        direction: "debit" as const,
        assetCode: "DEZ",
        assetKind: "crypto" as const,
        amount: "2.5",
        externalReference: null,
      },
    ],
  },
  ...versions,
};

const assignmentInput = {
  assignment: {
    assignmentId: "assignment-1",
    offspringCoreId: "offspring-1",
    breedingEventId: "breeding-1",
    breedingOccurredAt: "2026-07-26T02:00:00.000Z",
    requestedAt: "2026-07-26T03:00:00.000Z",
    ownershipStatus: "confirmed_owned" as const,
    breedingEventStatus: "completed" as const,
    costs: [
      {
        transactionId: "transaction-1",
        category: "dna_base_fee" as const,
        source: "manual_confirmed" as const,
        evidenceStatus: "confirmed" as const,
        assetCode: "DEZ",
        assetKind: "crypto" as const,
        amount: "2.5",
      },
    ],
    refunds: [],
  },
  ...versions,
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("breeding economic Server Actions", () => {
  it("resolves Clerk identity inside the request and fails closed when signed out", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce(null);

    await expect(
      recordBreedingEconomicEvidenceAction(evidenceInput),
    ).resolves.toEqual({ status: "identity_not_connected" });
    expect(session.ownerId).toHaveBeenCalledWith({
      environment: { publishableKey: undefined, secretKey: undefined },
    });
  });

  it("rejects a signed-in non-owner before persistence access", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce("other-owner");

    await expect(
      recordBreedingEconomicEvidenceAction(evidenceInput),
    ).rejects.toThrow("access denied");
  });

  it("keeps breeding evidence and cost-basis persistence unavailable", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId
      .mockResolvedValueOnce("owner-1")
      .mockResolvedValueOnce("owner-1");

    await expect(
      recordBreedingEconomicEvidenceAction(evidenceInput),
    ).resolves.toEqual({ status: "persistence_not_configured" });
    await expect(
      assignOffspringCostBasisAction(assignmentInput),
    ).resolves.toEqual({ status: "persistence_not_configured" });
  });

  it("does not let serialized input replace server-owned capabilities", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce("owner-1");

    const hostileInput = {
      ...evidenceInput,
      authenticatedOwnerId: "other-owner",
      configuredOwnerId: "other-owner",
      repository: { status: "ready" },
      assetRegistry: { status: "ready", version: "browser-controlled" },
      serverNow: "2099-01-01T00:00:00.000Z",
    } as unknown as Parameters<typeof recordBreedingEconomicEvidenceAction>[0];

    await expect(
      recordBreedingEconomicEvidenceAction(hostileInput),
    ).resolves.toEqual({ status: "persistence_not_configured" });
  });

  it("rechecks the authenticated owner independently for both operations", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValue("owner-1");

    await recordBreedingEconomicEvidenceAction(evidenceInput);
    await assignOffspringCostBasisAction(assignmentInput);

    expect(session.ownerId).toHaveBeenCalledTimes(2);
  });

  it("keeps both strict FormData actions unavailable before parsing", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValue("owner-1");

    await expect(
      recordBreedingEconomicEvidenceFormAction(new FormData()),
    ).resolves.toMatchObject({
      status: "persistence_not_configured",
      submittedValuesEchoed: false,
      rawErrorEchoed: false,
    });
    await expect(
      assignOffspringCostBasisFormAction(new FormData()),
    ).resolves.toMatchObject({
      status: "persistence_not_configured",
      submittedValuesEchoed: false,
      rawErrorEchoed: false,
    });
  });

  it("denies a non-owner FormData action before parser access", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce("other-owner");

    await expect(
      recordBreedingEconomicEvidenceFormAction(new FormData()),
    ).resolves.toMatchObject({
      status: "identity_not_connected",
      title: "Owner verification required",
      submittedValuesEchoed: false,
      rawErrorEchoed: false,
    });
  });
});
