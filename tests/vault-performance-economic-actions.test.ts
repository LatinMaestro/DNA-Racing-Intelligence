import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  ownerId: vi.fn(async (): Promise<string | null> => null),
}));

vi.mock("../lib/clerk-owner-session", () => ({
  authenticatedClerkOwnerId: session.ownerId,
}));

import {
  decideManualTournamentPayoutReconciliationFeedbackAction,
  decideManualTournamentPayoutReconciliationAction,
  recordManualLedgerFormAction,
  recordManualLedgerEntryFeedbackAction,
  recordManualLedgerEntryAction,
  recordManualTournamentPayoutFormAction,
  recordManualTournamentPayoutFeedbackAction,
  recordManualTournamentPayoutAction,
  reverseManualLedgerEntryFeedbackAction,
  reverseManualLedgerEntryAction,
} from "../app/(private)/vault-performance/actions";

const manualEntry = {
  entryId: "manual-entry-1",
  occurredAt: "2026-07-26T02:00:00.000Z",
  assetCode: "ETH",
  assetKind: "crypto" as const,
  amount: "1.25",
  category: "income" as const,
  subcategory: "other_income" as const,
};

const payout = {
  payoutId: "payout-1",
  occurredAt: "2026-07-26T02:00:00.000Z",
  tournamentId: "tournament-1",
  stage: "final" as const,
  amount: "2",
  assetCode: "ETH",
  assetKind: "crypto" as const,
  assetDecimalPlaces: 18,
  allocationMethod: "vault_unallocated" as const,
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("Vault Performance economic Server Actions", () => {
  it("resolves Clerk identity inside every request and fails closed when signed out", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce(null);

    await expect(recordManualLedgerEntryAction(manualEntry)).resolves.toEqual({
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

    await expect(recordManualLedgerEntryAction(manualEntry)).rejects.toThrow(
      "access denied",
    );
  });

  it("keeps manual ledger entry and reversal persistence unavailable", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId
      .mockResolvedValueOnce("owner-1")
      .mockResolvedValueOnce("owner-1");

    await expect(recordManualLedgerEntryAction(manualEntry)).resolves.toEqual({
      status: "persistence_not_configured",
    });
    await expect(
      reverseManualLedgerEntryAction({
        reversalId: "reversal-1",
        originalEntryId: "manual-entry-1",
        reversedAt: "2026-07-26T03:00:00.000Z",
        reason: "Correct synthetic evidence.",
      }),
    ).resolves.toEqual({ status: "persistence_not_configured" });
  });

  it("keeps manual tournament payout and reconciliation persistence unavailable", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId
      .mockResolvedValueOnce("owner-1")
      .mockResolvedValueOnce("owner-1");

    await expect(recordManualTournamentPayoutAction(payout)).resolves.toEqual({
      status: "persistence_not_configured",
    });
    await expect(
      decideManualTournamentPayoutReconciliationAction({
        payoutId: "payout-1",
        expectedRevision: 0,
        decision: {
          kind: "confirmed_separate",
          decidedAt: "2026-07-26T04:00:00.000Z",
          reason: "Separate synthetic payout.",
        },
      }),
    ).resolves.toEqual({ status: "persistence_not_configured" });
  });

  it("rechecks the authenticated owner independently for every operation", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId
      .mockResolvedValueOnce("owner-1")
      .mockResolvedValueOnce("owner-1")
      .mockResolvedValueOnce("owner-1")
      .mockResolvedValueOnce("owner-1");

    await recordManualLedgerEntryAction(manualEntry);
    await reverseManualLedgerEntryAction({
      reversalId: "reversal-1",
      originalEntryId: "manual-entry-1",
      reversedAt: "2026-07-26T03:00:00.000Z",
      reason: "Correct synthetic evidence.",
    });
    await recordManualTournamentPayoutAction(payout);
    await decideManualTournamentPayoutReconciliationAction({
      payoutId: "payout-1",
      expectedRevision: 0,
      decision: {
        kind: "confirmed_separate",
        decidedAt: "2026-07-26T04:00:00.000Z",
        reason: "Separate synthetic payout.",
      },
    });

    expect(session.ownerId).toHaveBeenCalledTimes(4);
  });

  it("returns reviewed fail-closed feedback for every disabled operation", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId
      .mockResolvedValueOnce("owner-1")
      .mockResolvedValueOnce("owner-1")
      .mockResolvedValueOnce("owner-1")
      .mockResolvedValueOnce("owner-1");

    const results = await Promise.all([
      recordManualLedgerEntryFeedbackAction(manualEntry),
      reverseManualLedgerEntryFeedbackAction({
        reversalId: "reversal-1",
        originalEntryId: "manual-entry-1",
        reversedAt: "2026-07-26T03:00:00.000Z",
        reason: "Correct synthetic evidence.",
      }),
      recordManualTournamentPayoutFeedbackAction(payout),
      decideManualTournamentPayoutReconciliationFeedbackAction({
        payoutId: "payout-1",
        expectedRevision: 0,
        decision: {
          kind: "confirmed_separate",
          decidedAt: "2026-07-26T04:00:00.000Z",
          reason: "Separate synthetic payout.",
        },
      }),
    ]);

    expect(results).toHaveLength(4);
    for (const result of results) {
      expect(result).toMatchObject({
        title: "Evidence recording is unavailable",
        tone: "warning",
        submittedValuesEchoed: false,
        rawErrorEchoed: false,
      });
    }
  });

  it("keeps both strict FormData actions unavailable before parsing", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId
      .mockResolvedValueOnce("owner-1")
      .mockResolvedValueOnce("owner-1");

    const results = await Promise.all([
      recordManualLedgerFormAction(new FormData()),
      recordManualTournamentPayoutFormAction(new FormData()),
    ]);

    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result).toMatchObject({
        title: "Evidence recording is unavailable",
        submittedValuesEchoed: false,
        rawErrorEchoed: false,
      });
    }
  });

  it("denies a non-owner FormData action before parser access", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce("other-owner");

    await expect(
      recordManualLedgerFormAction(new FormData()),
    ).resolves.toMatchObject({
      title: "Owner verification required",
      submittedValuesEchoed: false,
      rawErrorEchoed: false,
    });
  });
});
