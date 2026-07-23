import { describe, expect, it } from "vitest";
import {
  validateManualLedgerEntry,
  type ManualLedgerEntryInput,
} from "@/domain/manual-ledger";

function entry(
  overrides: Partial<ManualLedgerEntryInput> = {},
): ManualLedgerEntryInput {
  return {
    entryId: "manual-1",
    occurredAt: "2026-07-20T00:00:00Z",
    assetCode: "DEZ",
    assetKind: "crypto",
    amount: "12.3400",
    category: "income",
    subcategory: "other_income",
    accountLabel: "DNA wallet",
    costBasisStatus: "not_applicable",
    ...overrides,
  };
}

describe("Phase 2A manual ledger validation", () => {
  it("normalizes exact positive input and derives category direction", () => {
    const income = validateManualLedgerEntry(entry());
    expect(income).toMatchObject({
      amount: "12.34",
      completeness: "complete",
      postings: [
        {
          signedAmount: "12.34",
          assetCode: "DEZ",
          operating: true,
        },
      ],
    });

    const expense = validateManualLedgerEntry(
      entry({
        category: "expense",
        subcategory: "other_expense",
        amount: "0.000000000000000001",
      }),
    );
    expect(expense.postings[0]?.signedAmount).toBe("-0.000000000000000001");
  });

  it("preserves very large exact amounts without binary floating point", () => {
    const validated = validateManualLedgerEntry(
      entry({ amount: "123456789012345678901234567890.123456789" }),
    );
    expect(validated.amount).toBe("123456789012345678901234567890.123456789");
    expect(validated.postings[0]?.signedAmount).toBe(validated.amount);
  });

  it("creates balanced non-operating postings for an internal transfer", () => {
    const transfer = validateManualLedgerEntry(
      entry({
        category: "transfer",
        subcategory: "internal_transfer",
        accountLabel: null,
        fromAccountLabel: "Wallet A",
        toAccountLabel: "Wallet B",
      }),
    );

    expect(transfer.postings).toEqual([
      {
        postingId: "manual-1:from",
        accountLabel: "Wallet A",
        assetCode: "DEZ",
        assetKind: "crypto",
        signedAmount: "-12.34",
        category: "transfer",
        subcategory: "internal_transfer",
        operating: false,
      },
      {
        postingId: "manual-1:to",
        accountLabel: "Wallet B",
        assetCode: "DEZ",
        assetKind: "crypto",
        signedAmount: "12.34",
        category: "transfer",
        subcategory: "internal_transfer",
        operating: false,
      },
    ]);
  });

  it("keeps deposits, withdrawals and opening balances outside operating P/L", () => {
    const categories = [
      ["deposit", "deposit", "12.34"],
      ["withdrawal", "withdrawal", "-12.34"],
      ["opening_balance", "opening_balance", "12.34"],
    ] as const;

    for (const [category, subcategory, expected] of categories) {
      const validated = validateManualLedgerEntry(
        entry({ category, subcategory }),
      );
      expect(validated.postings[0]).toMatchObject({
        signedAmount: expected,
        operating: false,
      });
    }
  });

  it("requires explicit direction for adjustments", () => {
    expect(() =>
      validateManualLedgerEntry(
        entry({ category: "adjustment", subcategory: "adjustment" }),
      ),
    ).toThrow("requires a credit or debit direction");

    const debit = validateManualLedgerEntry(
      entry({
        category: "adjustment",
        subcategory: "adjustment",
        direction: "debit",
      }),
    );
    expect(debit.postings[0]).toMatchObject({
      signedAmount: "-12.34",
      operating: false,
    });
  });

  it("keeps BGC limited to its separate game-credit uses", () => {
    const burn = validateManualLedgerEntry(
      entry({
        assetCode: "BGC",
        assetKind: "game_credit",
        category: "income",
        subcategory: "burn_bgc_credit",
        coreIds: ["core-burnt"],
      }),
    );
    expect(burn.postings[0]).toMatchObject({
      assetCode: "BGC",
      assetKind: "game_credit",
      signedAmount: "12.34",
    });

    expect(() =>
      validateManualLedgerEntry(
        entry({
          assetCode: "BGC",
          assetKind: "game_credit",
          subcategory: "other_income",
        }),
      ),
    ).toThrow("separate in-game-credit ledger");
    expect(() =>
      validateManualLedgerEntry(
        entry({ assetCode: "BGC", assetKind: "crypto" }),
      ),
    ).toThrow("BGC must remain");
    expect(() =>
      validateManualLedgerEntry(
        entry({
          assetCode: "DEZ",
          assetKind: "crypto",
          category: "expense",
          subcategory: "arena_fee_bgc",
        }),
      ),
    ).toThrow("requires the BGC");
  });

  it("requires tournament provenance but permits an unallocated vault-level payout", () => {
    expect(() =>
      validateManualLedgerEntry(
        entry({ subcategory: "manual_tournament_payout" }),
      ),
    ).toThrow("requires a tournament");

    const payout = validateManualLedgerEntry(
      entry({
        subcategory: "manual_tournament_payout",
        tournamentId: "tournament-2026-01",
        coreIds: [],
      }),
    );
    expect(payout).toMatchObject({
      tournamentId: "tournament-2026-01",
      warnings: ["UNALLOCATED_TOURNAMENT_PAYOUT"],
      completeness: "partial",
    });
  });

  it("records sale proceeds without fabricating profit when cost basis is missing", () => {
    const sale = validateManualLedgerEntry(
      entry({
        subcategory: "core_sale",
        coreIds: ["core-sold"],
        costBasisStatus: "missing",
      }),
    );

    expect(sale.postings[0]?.signedAmount).toBe("12.34");
    expect(sale.warnings).toEqual(["CORE_SALE_COST_BASIS_MISSING"]);
    expect(sale.completeness).toBe("partial");
  });

  it("fails closed on invalid amounts, category pairs and account data", () => {
    for (const amount of ["0", "-1", "1e3", "NaN", ""]) {
      expect(() => validateManualLedgerEntry(entry({ amount }))).toThrow();
    }
    expect(() =>
      validateManualLedgerEntry(
        entry({ category: "expense", subcategory: "other_income" }),
      ),
    ).toThrow("incompatible");
    expect(() =>
      validateManualLedgerEntry(
        entry({
          category: "transfer",
          subcategory: "internal_transfer",
          accountLabel: null,
          fromAccountLabel: "Same wallet",
          toAccountLabel: "Same wallet",
        }),
      ),
    ).toThrow("must be different");
    expect(() =>
      validateManualLedgerEntry(entry({ coreIds: ["same-core", "same-core"] })),
    ).toThrow("must be unique");
  });

  it("normalizes deterministic core IDs and retains optional audit metadata", () => {
    const validated = validateManualLedgerEntry(
      entry({
        coreIds: ["core-z", "core-a"],
        externalReference: " reference-1 ",
        note: " owner evidence ",
      }),
    );
    expect(validated.coreIds).toEqual(["core-a", "core-z"]);
    expect(validated.externalReference).toBe("reference-1");
    expect(validated.note).toBe("owner evidence");
  });
});
