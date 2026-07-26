import { describe, expect, it } from "vitest";
import {
  validateManualLedgerEntry,
  type ManualLedgerEntryInput,
} from "../domain/manual-ledger";

const base = {
  entryId: "manual-entry-1",
  occurredAt: "2026-07-26T10:00:00+10:00",
  assetCode: "eth",
  assetKind: "crypto" as const,
  amount: "1.2500",
  category: "income" as const,
  subcategory: "other_income",
  accountLabel: "Owner wallet",
} satisfies ManualLedgerEntryInput;

describe("Manual ledger posting hardening", () => {
  it("canonicalizes an exact operating credit", () => {
    expect(validateManualLedgerEntry(base)).toMatchObject({
      occurredAt: "2026-07-26T00:00:00.000Z",
      assetCode: "ETH",
      amount: "1.25",
      completeness: "complete",
      postings: [
        {
          postingId: "manual-entry-1:primary",
          accountLabel: "Owner wallet",
          signedAmount: "1.25",
          operating: true,
        },
      ],
    });
  });

  it("creates exact balanced non-operating transfer postings", () => {
    const transfer = validateManualLedgerEntry({
      ...base,
      category: "transfer",
      subcategory: "internal_transfer",
      accountLabel: null,
      fromAccountLabel: "Wallet A",
      toAccountLabel: "Wallet B",
    });

    expect(transfer.postings).toEqual([
      {
        postingId: "manual-entry-1:from",
        accountLabel: "Wallet A",
        assetCode: "ETH",
        assetKind: "crypto",
        signedAmount: "-1.25",
        category: "transfer",
        subcategory: "internal_transfer",
        operating: false,
      },
      {
        postingId: "manual-entry-1:to",
        accountLabel: "Wallet B",
        assetCode: "ETH",
        assetKind: "crypto",
        signedAmount: "1.25",
        category: "transfer",
        subcategory: "internal_transfer",
        operating: false,
      },
    ]);
  });

  it("requires distinct transfer accounts and rejects single-posting evidence", () => {
    expect(() =>
      validateManualLedgerEntry({
        ...base,
        category: "transfer",
        subcategory: "internal_transfer",
        accountLabel: null,
        fromAccountLabel: "Wallet A",
        toAccountLabel: "Wallet A",
      }),
    ).toThrow("must be different");

    expect(() =>
      validateManualLedgerEntry({
        ...base,
        category: "transfer",
        subcategory: "internal_transfer",
        fromAccountLabel: "Wallet A",
        toAccountLabel: "Wallet B",
      }),
    ).toThrow("single posting");
  });

  it("uses an explicit direction for a non-operating adjustment", () => {
    expect(
      validateManualLedgerEntry({
        ...base,
        category: "adjustment",
        subcategory: "adjustment",
        direction: "debit",
      }).postings,
    ).toEqual([
      expect.objectContaining({
        signedAmount: "-1.25",
        operating: false,
      }),
    ]);

    expect(() =>
      validateManualLedgerEntry({
        ...base,
        category: "adjustment",
        subcategory: "adjustment",
      }),
    ).toThrow("requires a credit or debit direction");
  });

  it("rejects direction conflicts for fixed-direction categories", () => {
    expect(() =>
      validateManualLedgerEntry({ ...base, direction: "debit" }),
    ).toThrow("must be credit");
  });

  it("keeps BGC structurally separate from cash and crypto", () => {
    expect(() =>
      validateManualLedgerEntry({
        ...base,
        assetCode: "BGC",
      }),
    ).toThrow("separate game-credit asset");

    expect(
      validateManualLedgerEntry({
        ...base,
        assetCode: "BGC",
        assetKind: "game_credit",
        category: "opening_balance",
        subcategory: "opening_balance",
      }),
    ).toMatchObject({
      assetCode: "BGC",
      assetKind: "game_credit",
    });
  });

  it("marks sale proceeds partial when cost basis is not known", () => {
    expect(
      validateManualLedgerEntry({
        ...base,
        subcategory: "core_sale",
        costBasisStatus: "missing",
      }),
    ).toMatchObject({
      completeness: "partial",
      costBasisStatus: "missing",
      warnings: ["CORE_SALE_COST_BASIS_MISSING"],
    });
  });

  it("rejects invalid exact amounts, duplicate cores and transfer fields", () => {
    expect(() => validateManualLedgerEntry({ ...base, amount: "0" })).toThrow(
      "greater than zero",
    );
    expect(() =>
      validateManualLedgerEntry({
        ...base,
        coreIds: ["core-1", "core-1"],
      }),
    ).toThrow("must be unique");
    expect(() =>
      validateManualLedgerEntry({
        ...base,
        fromAccountLabel: "Unexpected",
      }),
    ).toThrow("cannot contain transfer");
  });
});
