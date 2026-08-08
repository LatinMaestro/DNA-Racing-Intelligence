import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  ownerId: vi.fn(async (): Promise<string | null> => null),
}));

vi.mock("../lib/clerk-owner-session", () => ({
  authenticatedClerkOwnerId: session.ownerId,
}));

import {
  decideManualTournamentPayoutReconciliationAction,
  recordManualLedgerEntryAction,
  recordManualTournamentPayoutAction,
  reverseManualLedgerEntryAction,
} from "../app/(private)/vault-performance/actions";

const evidence = {
  expectedAssetRegistryVersion: "asset-registry-v1",
  expectedActiveImportSnapshotHash: "a".repeat(64),
  expectedCandidateSetHash: "b".repeat(64),
  expectedCandidateTransactionIds: [] as string[],
};

const manualEntryInput = {
  entry: {
    entryId: "manual-entry-1",
    occurredAt: "2026-07-26T02:00:00.000Z",
    assetCode: "ETH",
    assetKind: "crypto" as const,
    amount: "1.25",
    category: "income" as const,
    subcategory: "other_income" as const,
  },
  expectedAssetRegistryVersion: "asset-registry-v1",
  expectedLedgerVersion: "ledger-v1",
};

const payoutInput = {
  payout: {
    payoutId: "payout-1",
    occurredAt: "2026-07-26T02:00:00.000Z",
    tournamentId: "tournament-1",
    stage: "final" as const,
    amount: "2",
    assetCode: "ETH",
    assetKind: "crypto" as const,
    assetDecimalPlaces: 18,
    allocationMethod: "vault_unallocated" as const,
  },
  ...evidence,
  expectedLedgerVersion: "ledger-v1",
  expectedTournamentEvidenceId: "tournament-evidence-v1",
  expectedTournamentConfigurationVersion: "tournament-config-v1",
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("Vault Performance economic Server Actions", () => {
  it("resolves Clerk identity inside the request and fails closed when signed out", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce(null);

    await expect(
      recordManualLedgerEntryAction(manualEntryInput),
    ).resolves.toEqual({ status: "identity_not_connected" });
    expect(session.ownerId).toHaveBeenCalledWith({
      environment: { publishableKey: undefined, secretKey: undefined },
    });
  });

  it("rejects a signed-in non-owner before persistence access", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce("other-owner");

    await expect(
      recordManualLedgerEntryAction(manualEntryInput),
    ).rejects.toThrow("access denied");
  });

  it("keeps entry and append-only reversal persistence unavailable", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId
      .mockResolvedValueOnce("owner-1")
      .mockResolvedValueOnce("owner-1");

    await expect(
      recordManualLedgerEntryAction(manualEntryInput),
    ).resolves.toEqual({ status: "persistence_not_configured" });
    await expect(
      reverseManualLedgerEntryAction({
        reversalId: "reversal-1",
        originalEntryId: "manual-entry-1",
        reversedAt: "2026-07-26T03:00:00.000Z",
        reason: "Correct synthetic evidence.",
        expectedAssetRegistryVersion: "asset-registry-v1",
        expectedLedgerVersion: "ledger-v1",
      }),
    ).resolves.toEqual({ status: "persistence_not_configured" });
  });

  it("does not let serialized input replace server-owned capabilities", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce("owner-1");

    const hostileInput = {
      ...manualEntryInput,
      authenticatedOwnerId: "other-owner",
      configuredOwnerId: "other-owner",
      repository: { status: "ready" },
      assetRegistry: { status: "ready", version: "browser-controlled" },
      serverNow: "2099-01-01T00:00:00.000Z",
    } as unknown as Parameters<typeof recordManualLedgerEntryAction>[0];

    await expect(recordManualLedgerEntryAction(hostileInput)).resolves.toEqual({
      status: "persistence_not_configured",
    });
  });

  it("keeps payout and reconciliation persistence unavailable", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId
      .mockResolvedValueOnce("owner-1")
      .mockResolvedValueOnce("owner-1");

    await expect(
      recordManualTournamentPayoutAction(payoutInput),
    ).resolves.toEqual({ status: "persistence_not_configured" });
    await expect(
      decideManualTournamentPayoutReconciliationAction({
        payoutId: "payout-1",
        expectedRevision: 0,
        decision: {
          kind: "confirmed_separate",
          decidedAt: "2026-07-26T04:00:00.000Z",
          reason: "Separate synthetic payout.",
        },
        ...evidence,
      }),
    ).resolves.toEqual({ status: "persistence_not_configured" });
  });

  it("rechecks the owner for each operation", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValue("owner-1");

    await recordManualLedgerEntryAction(manualEntryInput);
    await reverseManualLedgerEntryAction({
      reversalId: "reversal-1",
      originalEntryId: "manual-entry-1",
      reversedAt: "2026-07-26T03:00:00.000Z",
      reason: "Correct synthetic evidence.",
      expectedAssetRegistryVersion: "asset-registry-v1",
      expectedLedgerVersion: "ledger-v1",
    });
    await recordManualTournamentPayoutAction(payoutInput);
    await decideManualTournamentPayoutReconciliationAction({
      payoutId: "payout-1",
      expectedRevision: 0,
      decision: {
        kind: "confirmed_separate",
        decidedAt: "2026-07-26T04:00:00.000Z",
        reason: "Separate synthetic payout.",
      },
      ...evidence,
    });

    expect(session.ownerId).toHaveBeenCalledTimes(4);
  });
});
