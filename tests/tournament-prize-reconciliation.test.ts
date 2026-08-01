import { describe, expect, it } from "vitest";
import { reconcileManualTournamentPrize } from "@/domain/tournament-prize-reconciliation";

const manual = {
  payoutId: "payout-1",
  occurredAt: "2026-07-31T10:00:00Z",
  tournamentId: "tournament-1",
  bracketId: "bracket-a",
  stage: "final" as const,
  assetCode: "USDC",
  amount: "10",
  externalReference: "receipt-1",
};

const imported = {
  transactionId: "tx-1",
  occurredAt: "2026-07-30T10:00:00Z",
  tournamentId: "tournament-1",
  bracketId: "bracket-a",
  stage: "final" as const,
  assetCode: "USDC",
  amount: "10.0",
  externalReference: "receipt-1",
  aggregateStatus: "included" as const,
};

describe("reconcileManualTournamentPrize", () => {
  it("holds likely duplicates for review without automatic exclusion", () => {
    expect(reconcileManualTournamentPrize(manual, [imported])).toMatchObject({
      status: "review_required",
      manualPayoutAggregateStatus: "included",
      duplicateOfImportedTransactionId: null,
      automaticExclusionAllowed: false,
      importedFactsMutable: false,
      candidates: [
        { importedTransactionId: "tx-1", strength: "reference_exact" },
      ],
    });
  });

  it("excludes only the manual side after an explicit duplicate decision", () => {
    expect(
      reconcileManualTournamentPrize(manual, [imported], {
        kind: "confirmed_duplicate",
        importedTransactionId: "tx-1",
        decidedAt: "2026-08-01T10:00:00Z",
        reason: "Owner matched the imported receipt.",
      }),
    ).toMatchObject({
      status: "confirmed_duplicate",
      manualPayoutAggregateStatus: "excluded",
      duplicateOfImportedTransactionId: "tx-1",
    });
  });

  it("preserves both facts after an explicit separate decision", () => {
    expect(
      reconcileManualTournamentPrize(manual, [imported], {
        kind: "confirmed_separate",
        decidedAt: "2026-08-01T10:00:00Z",
        reason: "Independent prize receipts.",
      }),
    ).toMatchObject({
      status: "confirmed_separate",
      manualPayoutAggregateStatus: "included",
      duplicateOfImportedTransactionId: null,
    });
  });

  it("refuses to target an already excluded imported fact", () => {
    expect(() =>
      reconcileManualTournamentPrize(
        manual,
        [{ ...imported, aggregateStatus: "excluded" }],
        {
          kind: "confirmed_duplicate",
          importedTransactionId: "tx-1",
          decidedAt: "2026-08-01T10:00:00Z",
          reason: "Attempted duplicate match.",
        },
      ),
    ).toThrow("included imported payout");
  });
});
