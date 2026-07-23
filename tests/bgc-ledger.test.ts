import { describe, expect, it } from "vitest";

import {
  buildBgcLedgerSummary,
  type BgcLedgerCoverageInput,
  type BgcLedgerRecordInput,
} from "@/domain/bgc-ledger";

const coverage: BgcLedgerCoverageInput = {
  periodStart: "2026-07-01T00:00:00Z",
  periodEnd: "2026-07-31T23:59:59Z",
  sourceCoverage: "complete_recorded_period",
  openingBalanceCoverage: "complete",
  dataCurrentThrough: "2026-07-31T12:00:00Z",
  lastImported: "2026-07-31T13:00:00Z",
};

function record(
  overrides: Partial<BgcLedgerRecordInput> = {},
): BgcLedgerRecordInput {
  return {
    recordId: "record-1",
    transactionId: "transaction-1",
    occurredAt: "2026-07-10T00:00:00Z",
    accountLabel: "Game account",
    signedAmount: "25",
    category: "burn_credit",
    aggregateStatus: "included",
    reconciliationStatus: "reconciled",
    ...overrides,
  };
}

describe("BGC ledger", () => {
  it("derives exact BGC movement and balance from sufficient coverage", () => {
    const result = buildBgcLedgerSummary(
      [
        record({
          recordId: "opening",
          transactionId: "opening",
          occurredAt: coverage.periodStart,
          signedAmount: "100",
          category: "opening_balance",
        }),
        record(),
        record({
          recordId: "spend",
          transactionId: "spend",
          signedAmount: "-7.5",
          category: "arena_fee_spend",
        }),
        record({
          recordId: "adjustment",
          transactionId: "adjustment",
          signedAmount: "-0.5",
          category: "adjustment",
        }),
      ],
      coverage,
    );

    expect(result).toEqual(
      expect.objectContaining({
        assetCode: "BGC",
        openingBalance: "100",
        earned: "25",
        spent: "7.5",
        adjustments: "-0.5",
        netMovement: "17",
        derivedBalance: "117",
        separateReferenceUsdEquivalent: "117",
        includedInCashCryptoProfit: false,
        status: "complete_recorded_period",
      }),
    );
  });

  it("keeps balanced internal transfers out of vault movement", () => {
    const result = buildBgcLedgerSummary(
      [
        record({
          recordId: "opening-a",
          transactionId: "opening-a",
          occurredAt: coverage.periodStart,
          signedAmount: "20",
          category: "opening_balance",
          accountLabel: "A",
        }),
        record({
          recordId: "opening-b",
          transactionId: "opening-b",
          occurredAt: coverage.periodStart,
          signedAmount: "10",
          category: "opening_balance",
          accountLabel: "B",
        }),
        record({
          recordId: "transfer-out",
          transactionId: "transfer",
          signedAmount: "-5",
          category: "internal_transfer",
          accountLabel: "A",
        }),
        record({
          recordId: "transfer-in",
          transactionId: "transfer",
          signedAmount: "5",
          category: "internal_transfer",
          accountLabel: "B",
        }),
      ],
      coverage,
    );

    expect(result.netMovement).toBe("0");
    expect(result.derivedBalance).toBe("30");
    expect(result.transferPostingCount).toBe(2);
    expect(result.accounts).toEqual([
      expect.objectContaining({
        accountLabel: "A",
        internalTransferNet: "-5",
        derivedBalance: "15",
      }),
      expect.objectContaining({
        accountLabel: "B",
        internalTransferNet: "5",
        derivedBalance: "15",
      }),
    ]);
  });

  it("rejects incomplete or unbalanced internal transfers", () => {
    expect(() =>
      buildBgcLedgerSummary(
        [
          record({
            category: "internal_transfer",
            signedAmount: "-5",
          }),
        ],
        coverage,
      ),
    ).toThrow("two distinct balanced");
    expect(() =>
      buildBgcLedgerSummary(
        [
          record({
            recordId: "out",
            transactionId: "transfer",
            category: "internal_transfer",
            signedAmount: "-5",
            accountLabel: "A",
          }),
          record({
            recordId: "in",
            transactionId: "transfer",
            category: "internal_transfer",
            signedAmount: "4",
            accountLabel: "B",
          }),
        ],
        coverage,
      ),
    ).toThrow("two distinct balanced");
  });

  it("withholds a derived balance when opening or movement coverage is incomplete", () => {
    const result = buildBgcLedgerSummary([record()], {
      ...coverage,
      sourceCoverage: "partial",
      openingBalanceCoverage: "missing",
    });

    expect(result.earned).toBe("25");
    expect(result.netMovement).toBe("25");
    expect(result.derivedBalance).toBeNull();
    expect(result.separateReferenceUsdEquivalent).toBeNull();
    expect(result.status).toBe("partial");
    expect(result.warnings).toEqual([
      "SOURCE_COVERAGE_INCOMPLETE",
      "OPENING_BALANCE_INCOMPLETE",
    ]);
  });

  it("withholds a balance for unresolved evidence or an unknown cutoff", () => {
    const result = buildBgcLedgerSummary(
      [
        record({
          recordId: "opening",
          transactionId: "opening",
          occurredAt: coverage.periodStart,
          signedAmount: "0",
          category: "opening_balance",
        }),
        record({ reconciliationStatus: "review_required" }),
      ],
      { ...coverage, dataCurrentThrough: null },
    );

    expect(result.derivedBalance).toBeNull();
    expect(result.warnings).toEqual([
      "UNRESOLVED_RECONCILIATION",
      "DATA_CUTOFF_UNKNOWN",
    ]);
  });

  it("does not assume an unrecorded account opening balance is zero", () => {
    const result = buildBgcLedgerSummary([record()], coverage);

    expect(result.earned).toBe("25");
    expect(result.derivedBalance).toBeNull();
    expect(result.warnings).toContain("OPENING_BALANCE_INCOMPLETE");
  });

  it("allows one non-negative opening balance per account", () => {
    expect(() =>
      buildBgcLedgerSummary(
        [
          record({
            recordId: "opening-1",
            transactionId: "opening-1",
            occurredAt: coverage.periodStart,
            signedAmount: "0",
            category: "opening_balance",
          }),
          record({
            recordId: "opening-2",
            transactionId: "opening-2",
            occurredAt: coverage.periodStart,
            signedAmount: "1",
            category: "opening_balance",
          }),
        ],
        coverage,
      ),
    ).toThrow("only one active opening balance");
    expect(() =>
      buildBgcLedgerSummary(
        [
          record({
            occurredAt: coverage.periodStart,
            signedAmount: "-1",
            category: "opening_balance",
          }),
        ],
        coverage,
      ),
    ).toThrow("cannot be negative");
  });

  it("enforces actual burn-credit and arena-spend direction", () => {
    expect(() =>
      buildBgcLedgerSummary([record({ signedAmount: "-1" })], coverage),
    ).toThrow("category direction is invalid");
    expect(() =>
      buildBgcLedgerSummary(
        [record({ category: "arena_fee_spend", signedAmount: "1" })],
        coverage,
      ),
    ).toThrow("category direction is invalid");
  });

  it("retains excluded movement counts without adding excluded amounts", () => {
    const result = buildBgcLedgerSummary(
      [
        record(),
        record({
          recordId: "excluded",
          transactionId: "excluded",
          aggregateStatus: "excluded",
        }),
      ],
      coverage,
    );

    expect(result.earned).toBe("25");
    expect(result.includedMovementCount).toBe(1);
    expect(result.excludedMovementCount).toBe(1);
  });

  it("fails closed on duplicate record IDs and invalid runtime enums", () => {
    expect(() => buildBgcLedgerSummary([record(), record()], coverage)).toThrow(
      "record IDs must be unique",
    );
    expect(() =>
      buildBgcLedgerSummary(
        [record({ category: "predicted_credit" as "burn_credit" })],
        coverage,
      ),
    ).toThrow("category is invalid");
  });

  it("uses the owner-confirmed one-to-one USD reference only as a separate view", () => {
    const result = buildBgcLedgerSummary(
      [
        record({
          recordId: "opening",
          transactionId: "opening",
          occurredAt: coverage.periodStart,
          signedAmount: "10",
          category: "opening_balance",
        }),
      ],
      coverage,
    );

    expect(result.referenceUsdPerBgc).toBe("1");
    expect(result.separateReferenceUsdEquivalent).toBe("10");
    expect(result.includedInCashCryptoProfit).toBe(false);
  });
});
