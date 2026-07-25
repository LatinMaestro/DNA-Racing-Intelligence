import { describe, expect, it, vi } from "vitest";
import { createManualTournamentPayout } from "@/domain/manual-tournament-payout";
import { reconcileManualTournamentPrize } from "@/domain/tournament-prize-reconciliation";
import {
  decideManualTournamentPayoutReconciliation,
  recordManualTournamentPayout,
  unavailableManualTournamentPayoutWriteRepository,
  type ManualTournamentPayoutWriteRepository,
} from "@/lib/manual-tournament-payout-write-service";

const payoutInput = {
  payoutId: "synthetic-payout",
  occurredAt: "2026-07-20T00:00:00.000Z",
  tournamentId: "synthetic-tournament",
  bracketId: "synthetic-bracket",
  stage: "overall_prize" as const,
  amount: "1.25",
  assetCode: "eth",
  assetKind: "crypto" as const,
  assetDecimalPlaces: 18,
  receivingAccountLabel: "Synthetic wallet",
  externalReference: "synthetic-reference",
  allocationMethod: "equal" as const,
  allocations: [{ coreId: "core-b" }, { coreId: "core-a" }],
};

const importedCandidate = {
  transactionId: "synthetic-imported-payout",
  occurredAt: "2026-07-20T12:00:00.000Z",
  tournamentId: "synthetic-tournament",
  bracketId: "synthetic-bracket",
  stage: "final" as const,
  assetCode: "ETH",
  amount: "1.25",
  externalReference: "synthetic-reference",
  aggregateStatus: "included" as const,
};

function readyRepository(
  overrides: Partial<
    Extract<ManualTournamentPayoutWriteRepository, { status: "ready" }>
  > = {},
): Extract<ManualTournamentPayoutWriteRepository, { status: "ready" }> {
  return {
    status: "ready",
    loadImportedCandidatesByOwner: async () => [],
    savePayoutByOwner: async () => ({ status: "created" }),
    loadPayoutByOwner: async () => null,
    saveReconciliationDecisionByOwner: async () => ({ status: "created" }),
    ...overrides,
  };
}

function storedPayout() {
  const payout = createManualTournamentPayout(payoutInput);
  const reconciliation = reconcileManualTournamentPrize(
    {
      payoutId: payout.payoutId,
      occurredAt: payout.occurredAt,
      tournamentId: payout.tournamentId,
      bracketId: payout.bracketId,
      stage: payout.stage,
      assetCode: payout.assetCode,
      amount: payout.amount,
      externalReference: payout.externalReference,
    },
    [importedCandidate],
  );
  return { payout, reconciliation, revision: 0 };
}

describe("Manual tournament payout write service", () => {
  it("fails closed before validation or persistence", async () => {
    await expect(
      recordManualTournamentPayout({
        authenticatedOwnerId: null,
        configuredOwnerId: "owner",
        repository: unavailableManualTournamentPayoutWriteRepository,
        payout: payoutInput,
      }),
    ).resolves.toEqual({ status: "identity_not_connected" });
    await expect(
      recordManualTournamentPayout({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: unavailableManualTournamentPayoutWriteRepository,
        payout: payoutInput,
      }),
    ).resolves.toEqual({ status: "persistence_not_configured" });
  });

  it("denies another owner before reading candidate economics", async () => {
    const loadImportedCandidatesByOwner = vi.fn(async () => []);
    await expect(
      recordManualTournamentPayout({
        authenticatedOwnerId: "another-owner",
        configuredOwnerId: "owner",
        repository: readyRepository({ loadImportedCandidatesByOwner }),
        payout: payoutInput,
      }),
    ).rejects.toThrow("access denied");
    expect(loadImportedCandidatesByOwner).not.toHaveBeenCalled();
  });

  it("records exact allocated payout evidence with conservative duplicate review", async () => {
    let capturedFingerprint = "";
    const result = await recordManualTournamentPayout({
      authenticatedOwnerId: "owner",
      configuredOwnerId: "owner",
      repository: readyRepository({
        loadImportedCandidatesByOwner: async (ownerId, query) => {
          expect(ownerId).toBe("owner");
          expect(query).toEqual({
            tournamentId: "synthetic-tournament",
            occurredAt: "2026-07-20T00:00:00.000Z",
            assetCode: "ETH",
            amount: "1.25",
          });
          return [importedCandidate];
        },
        savePayoutByOwner: async (
          ownerId,
          payout,
          reconciliation,
          fingerprint,
        ) => {
          expect(ownerId).toBe("owner");
          expect(payout).toMatchObject({
            payoutId: "synthetic-payout",
            assetCode: "ETH",
            amount: "1.25",
            allocationStatus: "explicit_core_allocations",
            allocatedAmount: "1.25",
            unallocatedAmount: "0",
            duplicateReviewRequired: true,
            operatingIncome: true,
          });
          expect(payout.allocations).toEqual([
            {
              coreId: "core-a",
              amount: "0.625",
              percentage: null,
              points: null,
            },
            {
              coreId: "core-b",
              amount: "0.625",
              percentage: null,
              points: null,
            },
          ]);
          expect(reconciliation).toMatchObject({
            status: "review_required",
            manualPayoutAggregateStatus: "included",
            duplicateOfImportedTransactionId: null,
            importedFactsMutable: false,
            automaticExclusionAllowed: false,
          });
          capturedFingerprint = fingerprint;
          return { status: "created" };
        },
      }),
      payout: payoutInput,
    });

    expect(capturedFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result).toMatchObject({
      status: "recorded",
      payoutId: "synthetic-payout",
      fingerprint: capturedFingerprint,
      reconciliationStatus: "review_required",
      aggregateStatus: "included",
      candidateCount: 1,
      allocationStatus: "explicit_core_allocations",
    });
  });

  it("replays only the exact canonical payout fingerprint", async () => {
    let fingerprint = "";
    const recorded = await recordManualTournamentPayout({
      authenticatedOwnerId: "owner",
      configuredOwnerId: "owner",
      repository: readyRepository({
        savePayoutByOwner: async (
          _ownerId,
          _payout,
          _reconciliation,
          value,
        ) => {
          fingerprint = value;
          return { status: "created" };
        },
      }),
      payout: { ...payoutInput, externalReference: null },
    });
    expect(recorded.status).toBe("recorded");

    await expect(
      recordManualTournamentPayout({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({
          savePayoutByOwner: async () => ({
            status: "already_exists",
            fingerprint,
          }),
        }),
        payout: { ...payoutInput, externalReference: null },
      }),
    ).resolves.toMatchObject({ status: "replayed", fingerprint });

    await expect(
      recordManualTournamentPayout({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({
          savePayoutByOwner: async () => ({
            status: "conflict",
            fingerprint: "a".repeat(64),
          }),
        }),
        payout: { ...payoutInput, externalReference: null },
      }),
    ).rejects.toThrow("conflicts");
  });

  it("records an explicit duplicate decision without mutating imported facts", async () => {
    const result = await decideManualTournamentPayoutReconciliation({
      authenticatedOwnerId: "owner",
      configuredOwnerId: "owner",
      repository: readyRepository({
        loadPayoutByOwner: async () => storedPayout(),
        loadImportedCandidatesByOwner: async () => [importedCandidate],
        saveReconciliationDecisionByOwner: async (
          ownerId,
          decision,
          fingerprint,
        ) => {
          expect(ownerId).toBe("owner");
          expect(decision).toMatchObject({
            payoutId: "synthetic-payout",
            expectedRevision: 0,
            decision: {
              kind: "confirmed_duplicate",
              importedTransactionId: "synthetic-imported-payout",
              decidedAt: "2026-07-21T00:00:00.000Z",
              reason: "Synthetic duplicate confirmation.",
            },
            reconciliation: {
              status: "confirmed_duplicate",
              manualPayoutAggregateStatus: "excluded",
              duplicateOfImportedTransactionId: "synthetic-imported-payout",
              importedFactsMutable: false,
              automaticExclusionAllowed: false,
            },
          });
          expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
          return { status: "created" };
        },
      }),
      payoutId: "synthetic-payout",
      expectedRevision: 0,
      decision: {
        kind: "confirmed_duplicate",
        importedTransactionId: "synthetic-imported-payout",
        decidedAt: "2026-07-21T00:00:00Z",
        reason: " Synthetic duplicate confirmation. ",
      },
    });
    expect(result).toMatchObject({
      status: "recorded",
      reconciliationStatus: "confirmed_duplicate",
      aggregateStatus: "excluded",
    });
  });

  it("keeps a confirmed separate external prize included", async () => {
    await expect(
      decideManualTournamentPayoutReconciliation({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({
          loadPayoutByOwner: async () => storedPayout(),
          loadImportedCandidatesByOwner: async () => [importedCandidate],
        }),
        payoutId: "synthetic-payout",
        expectedRevision: 0,
        decision: {
          kind: "confirmed_separate",
          decidedAt: "2026-07-21T00:00:00.000Z",
          reason: "Separate external tournament prize.",
        },
      }),
    ).resolves.toMatchObject({
      status: "recorded",
      reconciliationStatus: "confirmed_separate",
      aggregateStatus: "included",
    });
  });

  it("rejects missing payouts, stale revisions and invalid duplicate targets", async () => {
    await expect(
      decideManualTournamentPayoutReconciliation({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository(),
        payoutId: "missing",
        expectedRevision: 0,
        decision: {
          kind: "confirmed_separate",
          decidedAt: "2026-07-21T00:00:00.000Z",
          reason: "Synthetic decision.",
        },
      }),
    ).rejects.toThrow("not found");

    await expect(
      decideManualTournamentPayoutReconciliation({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({
          loadPayoutByOwner: async () => storedPayout(),
        }),
        payoutId: "synthetic-payout",
        expectedRevision: 1,
        decision: {
          kind: "confirmed_separate",
          decidedAt: "2026-07-21T00:00:00.000Z",
          reason: "Synthetic decision.",
        },
      }),
    ).rejects.toThrow("revision is stale");

    await expect(
      decideManualTournamentPayoutReconciliation({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({
          loadPayoutByOwner: async () => storedPayout(),
          loadImportedCandidatesByOwner: async () => [importedCandidate],
        }),
        payoutId: "synthetic-payout",
        expectedRevision: 0,
        decision: {
          kind: "confirmed_duplicate",
          importedTransactionId: "not-a-candidate",
          decidedAt: "2026-07-21T00:00:00.000Z",
          reason: "Synthetic invalid target.",
        },
      }),
    ).rejects.toThrow("detected imported candidate");
  });

  it("keeps BGC outside manual tournament payouts", async () => {
    await expect(
      recordManualTournamentPayout({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository(),
        payout: { ...payoutInput, assetCode: "BGC" },
      }),
    ).rejects.toThrow("asset identity is invalid");
  });
});
