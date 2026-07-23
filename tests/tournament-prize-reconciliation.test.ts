import { describe, expect, it } from "vitest";

import {
  reconcileManualTournamentPrize,
  type ImportedTournamentPrizeInput,
  type ManualExternalTournamentPrizeInput,
} from "@/domain/tournament-prize-reconciliation";

const manual: ManualExternalTournamentPrizeInput = {
  payoutId: "manual-1",
  occurredAt: "2026-07-10T10:00:00Z",
  tournamentId: "horse-maiden",
  bracketId: "top-two",
  stage: "overall_prize",
  assetCode: "DEZ",
  amount: "125.500",
  externalReference: "tx-abc",
};

function imported(
  overrides: Partial<ImportedTournamentPrizeInput> = {},
): ImportedTournamentPrizeInput {
  return {
    transactionId: "race-prize-1",
    occurredAt: "2026-07-10T11:00:00Z",
    tournamentId: "horse-maiden",
    bracketId: "top-two",
    stage: "final",
    assetCode: "dez",
    amount: "125.5",
    externalReference: "tx-abc",
    aggregateStatus: "included",
    ...overrides,
  };
}

describe("manual tournament prize reconciliation", () => {
  it("detects an exact external-reference candidate without auto-excluding it", () => {
    const result = reconcileManualTournamentPrize(manual, [imported()]);

    expect(result).toEqual(
      expect.objectContaining({
        status: "review_required",
        manualPayoutAggregateStatus: "included",
        duplicateOfImportedTransactionId: null,
        automaticExclusionAllowed: false,
        importedFactsMutable: false,
      }),
    );
    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        importedTransactionId: "race-prize-1",
        strength: "reference_exact",
      }),
    );
  });

  it("detects same-asset amount/date/tournament candidates without a reference", () => {
    const result = reconcileManualTournamentPrize(
      { ...manual, externalReference: null },
      [imported({ externalReference: null })],
    );

    expect(result.candidates[0]?.strength).toBe("amount_date_tournament");
    expect(result.status).toBe("review_required");
  });

  it("does not match a different asset, amount or tournament", () => {
    const result = reconcileManualTournamentPrize(
      { ...manual, externalReference: null },
      [
        imported({ externalReference: null, assetCode: "ETH" }),
        imported({
          transactionId: "race-prize-2",
          externalReference: null,
          amount: "125.6",
        }),
        imported({
          transactionId: "race-prize-3",
          externalReference: null,
          tournamentId: "other-tournament",
        }),
      ],
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: "clear",
        candidates: [],
        manualPayoutAggregateStatus: "included",
      }),
    );
  });

  it("surfaces a shared external reference with incompatible economic facts", () => {
    const result = reconcileManualTournamentPrize(manual, [
      imported({ amount: "100" }),
    ]);

    expect(result.status).toBe("review_required");
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toContain("EXTERNAL_REFERENCE_CONFLICT");
  });

  it("treats a shared reference linked to another tournament as a conflict", () => {
    const result = reconcileManualTournamentPrize(manual, [
      imported({ tournamentId: "different-tournament" }),
    ]);

    expect(result.candidates).toEqual([]);
    expect(result.warnings).toContain("EXTERNAL_REFERENCE_CONFLICT");
  });

  it("excludes only the manual payout after a reasoned duplicate confirmation", () => {
    const result = reconcileManualTournamentPrize(manual, [imported()], {
      kind: "confirmed_duplicate",
      importedTransactionId: "race-prize-1",
      decidedAt: "2026-07-11T00:00:00Z",
      reason: "Wallet reference confirms the same payment.",
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "confirmed_duplicate",
        manualPayoutAggregateStatus: "excluded",
        duplicateOfImportedTransactionId: "race-prize-1",
        importedFactsMutable: false,
      }),
    );
  });

  it("preserves both payments after a reasoned separate confirmation", () => {
    const result = reconcileManualTournamentPrize(manual, [imported()], {
      kind: "confirmed_separate",
      decidedAt: "2026-07-11T00:00:00Z",
      reason: "The wallet prize was additional to the race payout.",
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "confirmed_separate",
        manualPayoutAggregateStatus: "included",
        duplicateOfImportedTransactionId: null,
      }),
    );
  });

  it("cannot confirm a duplicate against an undetected or excluded target", () => {
    expect(() =>
      reconcileManualTournamentPrize(manual, [imported()], {
        kind: "confirmed_duplicate",
        importedTransactionId: "missing",
        decidedAt: "2026-07-11T00:00:00Z",
        reason: "Unsupported target.",
      }),
    ).toThrow("detected imported candidate");

    expect(() =>
      reconcileManualTournamentPrize(
        manual,
        [imported({ aggregateStatus: "excluded" })],
        {
          kind: "confirmed_duplicate",
          importedTransactionId: "race-prize-1",
          decidedAt: "2026-07-11T00:00:00Z",
          reason: "Already excluded target.",
        },
      ),
    ).toThrow("included imported payout");
  });

  it("keeps a vault-level overall prize unallocated", () => {
    const result = reconcileManualTournamentPrize(
      { ...manual, externalReference: null },
      [],
    );

    expect(result.vaultLevelAllocationRequired).toBe(false);
    expect(result.manualPayoutAggregateStatus).toBe("included");
  });

  it("uses exact decimals and validates the candidate window", () => {
    const result = reconcileManualTournamentPrize(
      { ...manual, externalReference: null, amount: "0.100000000000000001" },
      [
        imported({
          externalReference: null,
          amount: "0.100000000000000001",
        }),
      ],
    );
    expect(result.candidates).toHaveLength(1);

    expect(() => reconcileManualTournamentPrize(manual, [], null, 32)).toThrow(
      "0 to 31 days",
    );
  });

  it("requires unique imported transaction identities and positive amounts", () => {
    expect(() =>
      reconcileManualTournamentPrize(manual, [imported(), imported()]),
    ).toThrow("transaction IDs must be unique");

    expect(() =>
      reconcileManualTournamentPrize({ ...manual, amount: "0" }, []),
    ).toThrow("must be positive");
  });

  it("rejects a reconciliation decision that predates the manual payout", () => {
    expect(() =>
      reconcileManualTournamentPrize(manual, [imported()], {
        kind: "confirmed_separate",
        decidedAt: "2026-07-09T00:00:00Z",
        reason: "Impossible audit order.",
      }),
    ).toThrow("cannot predate");
  });
});
