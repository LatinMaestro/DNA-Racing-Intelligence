import { describe, expect, it } from "vitest";
import {
  detectDuplicateCandidates,
  normalizeLedgerEvidence,
  reconcileLedger,
  type LedgerEvidenceInput,
} from "@/domain/ledger-reconciliation";

function transaction(
  overrides: Partial<LedgerEvidenceInput> = {},
): LedgerEvidenceInput {
  return {
    transactionId: "tx-1",
    sourceType: "manual_entry",
    occurredAt: "2026-07-20T04:00:00+10:00",
    assetCode: "dez",
    signedAmount: "12.3400",
    category: "income",
    subcategory: "manual_tournament_payout",
    tournamentId: "tournament-1",
    coreIds: ["core-1"],
    ...overrides,
  };
}

describe("Phase 2A ledger duplicate and reconciliation controls", () => {
  it("normalizes exact evidence without binary floating point", () => {
    expect(normalizeLedgerEvidence(transaction())).toMatchObject({
      occurredAt: "2026-07-19T18:00:00.000Z",
      utcDate: "2026-07-19",
      assetCode: "DEZ",
      signedAmount: "12.34",
      coreIds: ["core-1"],
    });
  });

  it("detects strong reference and stable-key candidates but never auto-excludes", () => {
    const candidates = detectDuplicateCandidates([
      transaction({
        transactionId: "imported",
        sourceType: "race_import",
        sourceStableKey: "race-1:payout",
        externalReference: "evidence-1",
      }),
      transaction({
        transactionId: "manual",
        sourceStableKey: "race-1:payout",
        externalReference: "evidence-1",
      }),
    ]);

    expect(candidates).toEqual([
      expect.objectContaining({
        candidateId: "imported::manual",
        reasons: [
          "SAME_SOURCE_STABLE_KEY",
          "SAME_EXTERNAL_REFERENCE",
          "SAME_DATE_AMOUNT_AND_CONTEXT",
        ],
        reviewPriority: "high",
        automaticExclusionAllowed: false,
      }),
    ]);
  });

  it("keeps unlike assets, amounts and opposite directions separate", () => {
    expect(
      detectDuplicateCandidates([
        transaction({ transactionId: "dez" }),
        transaction({ transactionId: "eth", assetCode: "ETH" }),
        transaction({ transactionId: "amount", signedAmount: "12.35" }),
        transaction({ transactionId: "debit", signedAmount: "-12.34" }),
      ]),
    ).toEqual([]);
  });

  it("treats same-day amount-only matches as low-priority review evidence", () => {
    expect(
      detectDuplicateCandidates([
        transaction({ transactionId: "first" }),
        transaction({
          transactionId: "second",
          category: "income",
          subcategory: "breeding_fee_earned",
          tournamentId: null,
          coreIds: [],
        }),
      ]),
    ).toEqual([
      expect.objectContaining({
        candidateId: "first::second",
        reasons: ["SAME_DATE_AND_AMOUNT"],
        reviewPriority: "low",
        automaticExclusionAllowed: false,
      }),
    ]);
  });

  it("marks a reviewed duplicate through a recoverable overlay", () => {
    const result = reconcileLedger(
      [
        transaction({ transactionId: "survivor" }),
        transaction({ transactionId: "duplicate" }),
      ],
      [
        {
          actionId: "action-1",
          actionType: "mark_duplicate",
          targetTransactionId: "duplicate",
          survivingTransactionId: "survivor",
          recordedAt: "2026-07-21T00:00:00Z",
          reason: "Owner confirmed manual payout duplicates imported evidence.",
        },
      ],
    );

    expect(result.transactions).toEqual([
      expect.objectContaining({
        aggregateStatus: "included",
        exclusionReason: null,
      }),
      expect.objectContaining({
        aggregateStatus: "excluded",
        exclusionReason: "confirmed_duplicate",
        survivingTransactionId: "survivor",
      }),
    ]);
    expect(result.generatedReversals).toEqual([]);
  });

  it("restores an excluded or duplicate transaction without deleting audit history", () => {
    const result = reconcileLedger(
      [
        transaction({ transactionId: "survivor" }),
        transaction({ transactionId: "duplicate" }),
      ],
      [
        {
          actionId: "action-1",
          actionType: "mark_duplicate",
          targetTransactionId: "duplicate",
          survivingTransactionId: "survivor",
          recordedAt: "2026-07-21T00:00:00Z",
          reason: "Initial review.",
        },
        {
          actionId: "action-2",
          actionType: "restore",
          targetTransactionId: "duplicate",
          recordedAt: "2026-07-22T00:00:00Z",
          reason: "External evidence proves the payments are distinct.",
        },
      ],
    );

    expect(result.transactions[1]).toMatchObject({
      aggregateStatus: "included",
      exclusionReason: null,
      survivingTransactionId: null,
    });
    expect(result.auditActions).toHaveLength(2);
  });

  it("reverses with an exact compensating record and retains the original fact", () => {
    const result = reconcileLedger(
      [transaction({ signedAmount: "-0.000000000000000001" })],
      [
        {
          actionId: "action-reverse",
          actionType: "reverse",
          targetTransactionId: "tx-1",
          reversalTransactionId: "reversal-1",
          recordedAt: "2026-07-22T02:00:00Z",
          reason: "Incorrect manual expense.",
        },
      ],
    );

    expect(result.transactions[0]).toMatchObject({
      aggregateStatus: "included",
      exclusionReason: null,
      reversedByTransactionId: "reversal-1",
    });
    expect(result.generatedReversals).toEqual([
      expect.objectContaining({
        transactionId: "reversal-1",
        sourceType: "reversal",
        signedAmount: "0.000000000000000001",
        sourceStableKey: "reversal:tx-1",
      }),
    ]);
  });

  it("fails closed on unsupported runtime values and malformed evidence", () => {
    expect(() =>
      normalizeLedgerEvidence(
        transaction({ sourceType: "unknown" as "manual_entry" }),
      ),
    ).toThrow("source type");
    expect(() =>
      normalizeLedgerEvidence(transaction({ signedAmount: "0" })),
    ).toThrow("zero amount");
    expect(() =>
      normalizeLedgerEvidence(transaction({ signedAmount: "1e3" })),
    ).toThrow("plain base-10");
    expect(() =>
      reconcileLedger(
        [transaction()],
        [
          {
            actionId: "invalid",
            actionType: "remove" as "exclude",
            targetTransactionId: "tx-1",
            recordedAt: "2026-07-22T00:00:00Z",
            reason: "Unsupported action.",
          },
        ],
      ),
    ).toThrow("action type");
  });

  it("rejects unsafe duplicate, action-order and reversal states", () => {
    expect(() =>
      reconcileLedger(
        [
          transaction({ transactionId: "one" }),
          transaction({
            transactionId: "other-asset",
            assetCode: "ETH",
          }),
        ],
        [
          {
            actionId: "bad-duplicate",
            actionType: "mark_duplicate",
            targetTransactionId: "one",
            survivingTransactionId: "other-asset",
            recordedAt: "2026-07-22T00:00:00Z",
            reason: "These cannot be the same asset.",
          },
        ],
      ),
    ).toThrow("matching asset");

    expect(() =>
      reconcileLedger(
        [
          transaction({ transactionId: "excluded-survivor" }),
          transaction({ transactionId: "duplicate" }),
        ],
        [
          {
            actionId: "exclude-survivor",
            actionType: "exclude",
            targetTransactionId: "excluded-survivor",
            recordedAt: "2026-07-20T00:00:00Z",
            reason: "Excluded pending evidence.",
          },
          {
            actionId: "bad-survivor",
            actionType: "mark_duplicate",
            targetTransactionId: "duplicate",
            survivingTransactionId: "excluded-survivor",
            recordedAt: "2026-07-21T00:00:00Z",
            reason: "Cannot survive while excluded.",
          },
        ],
      ),
    ).toThrow("active and unreversed");

    expect(() =>
      reconcileLedger(
        [transaction()],
        [
          {
            actionId: "exclude",
            actionType: "exclude",
            targetTransactionId: "tx-1",
            recordedAt: "2026-07-21T00:00:00Z",
            reason: "Review.",
          },
          {
            actionId: "reverse",
            actionType: "reverse",
            targetTransactionId: "tx-1",
            reversalTransactionId: "reversal-1",
            recordedAt: "2026-07-22T00:00:00Z",
            reason: "Must restore before changing state.",
          },
        ],
      ),
    ).toThrow("must be restored");

    expect(() =>
      reconcileLedger(
        [transaction()],
        [
          {
            actionId: "restore-active",
            actionType: "restore",
            targetTransactionId: "tx-1",
            recordedAt: "2026-07-22T00:00:00Z",
            reason: "No exclusion exists.",
          },
        ],
      ),
    ).toThrow("Only an excluded");
  });
});
