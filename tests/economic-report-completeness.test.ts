import { describe, expect, it } from "vitest";
import {
  buildEconomicReport,
  type EconomicReportCoverageInput,
  type ReportLedgerRecordInput,
} from "@/domain/economic-report-completeness";

function record(
  overrides: Partial<ReportLedgerRecordInput> = {},
): ReportLedgerRecordInput {
  return {
    transactionId: "tx-1",
    occurredAt: "2026-07-15T00:00:00Z",
    assetCode: "DEZ",
    assetKind: "crypto",
    signedAmount: "10",
    operating: true,
    aggregateStatus: "included",
    ...overrides,
  };
}

function coverage(
  overrides: Partial<EconomicReportCoverageInput> = {},
): EconomicReportCoverageInput {
  return {
    reportScope: "activity_cashflow",
    periodStart: "2026-07-01T00:00:00Z",
    periodEnd: "2026-07-31T23:59:59Z",
    sourceCoverageStart: "2026-07-01T00:00:00Z",
    sourceCoverageEnd: "2026-07-31T23:59:59Z",
    dataCurrentThrough: "2026-07-31T20:00:00Z",
    lastImported: "2026-08-01T00:00:00Z",
    unclassifiedCount: 0,
    unresolvedReconciliationCount: 0,
    missingCostBasisCount: 0,
    openingBalanceKnown: false,
    manualExternalPayoutStatus: "confirmed_none",
    conversionCoverage: "not_requested",
    ...overrides,
  };
}

describe("Phase 2A economic reporting completeness", () => {
  it("aggregates exact income, expense and net independently by asset", () => {
    const report = buildEconomicReport(
      [
        record(),
        record({
          transactionId: "dez-fee",
          signedAmount: "-0.000000000000000001",
        }),
        record({
          transactionId: "eth-payout",
          assetCode: "ETH",
          signedAmount: "2.5000",
        }),
      ],
      coverage(),
    );

    expect(report.cashCryptoTotals).toEqual([
      {
        assetCode: "DEZ",
        assetKind: "crypto",
        income: "10",
        expense: "0.000000000000000001",
        net: "9.999999999999999999",
        includedTransactionCount: 2,
      },
      {
        assetCode: "ETH",
        assetKind: "crypto",
        income: "2.5",
        expense: "0",
        net: "2.5",
        includedTransactionCount: 1,
      },
    ]);
    expect(report).toMatchObject({
      status: "complete",
      combinedAssetTotalAvailable: false,
      lifetimeProfitClaimAllowed: false,
    });
  });

  it("keeps BGC separate from cash and crypto totals", () => {
    const report = buildEconomicReport(
      [
        record(),
        record({
          transactionId: "bgc-burn",
          assetCode: "BGC",
          assetKind: "game_credit",
          signedAmount: "25",
        }),
        record({
          transactionId: "bgc-arena",
          assetCode: "BGC",
          assetKind: "game_credit",
          signedAmount: "-4",
        }),
      ],
      coverage(),
    );

    expect(report.cashCryptoTotals).toHaveLength(1);
    expect(report.bgcTotals).toEqual([
      expect.objectContaining({
        assetCode: "BGC",
        assetKind: "game_credit",
        income: "25",
        expense: "4",
        net: "21",
      }),
    ]);
  });

  it("limits the BGC movement scope to BGC records", () => {
    const report = buildEconomicReport(
      [
        record(),
        record({
          transactionId: "bgc",
          assetCode: "BGC",
          assetKind: "game_credit",
          signedAmount: "4",
        }),
      ],
      coverage({ reportScope: "bgc_movement" }),
    );
    expect(report.cashCryptoTotals).toEqual([]);
    expect(report.bgcTotals[0]).toMatchObject({ net: "4" });
  });

  it("excludes non-operating movements from activity cashflow", () => {
    const report = buildEconomicReport(
      [
        record(),
        record({
          transactionId: "deposit",
          signedAmount: "1000",
          operating: false,
        }),
        record({
          transactionId: "transfer",
          signedAmount: "-50",
          operating: false,
        }),
      ],
      coverage(),
    );

    expect(report.cashCryptoTotals[0]).toMatchObject({
      income: "10",
      expense: "0",
      net: "10",
      includedTransactionCount: 1,
    });
  });

  it("omits excluded records and exposes their count", () => {
    const report = buildEconomicReport(
      [
        record(),
        record({
          transactionId: "duplicate",
          aggregateStatus: "excluded",
        }),
      ],
      coverage(),
    );
    expect(report.cashCryptoTotals[0]?.includedTransactionCount).toBe(1);
    expect(report.excludedTransactionCount).toBe(1);
  });

  it("marks incomplete coverage and unresolved evidence as partial", () => {
    const report = buildEconomicReport(
      [record()],
      coverage({
        sourceCoverageStart: "2026-07-02T00:00:00Z",
        dataCurrentThrough: null,
        unclassifiedCount: 2,
        unresolvedReconciliationCount: 1,
        manualExternalPayoutStatus: "unknown",
      }),
    );

    expect(report.status).toBe("partial");
    expect(report.warnings).toEqual([
      "SOURCE_COVERAGE_INCOMPLETE",
      "DATA_CUTOFF_UNKNOWN",
      "UNCLASSIFIED_ACTIVITY",
      "UNRESOLVED_RECONCILIATION",
      "MANUAL_EXTERNAL_PAYOUT_COVERAGE_UNKNOWN",
    ]);
  });

  it("requires cost basis only for core-trading completeness", () => {
    expect(
      buildEconomicReport(
        [record()],
        coverage({
          reportScope: "core_trading",
          missingCostBasisCount: 1,
        }),
      ),
    ).toMatchObject({
      status: "partial",
      warnings: ["COST_BASIS_MISSING"],
    });
    expect(
      buildEconomicReport(
        [record()],
        coverage({
          reportScope: "activity_cashflow",
          missingCostBasisCount: 1,
        }),
      ).warnings,
    ).not.toContain("COST_BASIS_MISSING");
  });

  it("requires an opening balance only for wallet-balance claims", () => {
    expect(
      buildEconomicReport(
        [record()],
        coverage({ reportScope: "wallet_balance" }),
      ),
    ).toMatchObject({
      status: "partial",
      warnings: ["OPENING_BALANCE_MISSING"],
    });
    expect(buildEconomicReport([record()], coverage()).status).toBe("complete");
  });

  it("distinguishes estimated conversion from missing conversion coverage", () => {
    expect(
      buildEconomicReport(
        [record()],
        coverage({ conversionCoverage: "complete_estimated" }),
      ),
    ).toMatchObject({
      status: "estimated",
      warnings: ["ESTIMATED_CONVERSION_USED"],
    });
    expect(
      buildEconomicReport(
        [record()],
        coverage({ conversionCoverage: "partial_missing" }),
      ),
    ).toMatchObject({
      status: "partial",
      warnings: ["CONVERSION_RATE_MISSING"],
    });
  });

  it("filters to the requested inclusive period", () => {
    const report = buildEconomicReport(
      [
        record({ transactionId: "before", occurredAt: "2026-06-30T23:59:59Z" }),
        record(),
        record({ transactionId: "after", occurredAt: "2026-08-01T00:00:00Z" }),
      ],
      coverage(),
    );
    expect(report.cashCryptoTotals[0]?.includedTransactionCount).toBe(1);
  });

  it("fails closed on invalid runtime identities, counts and BGC treatment", () => {
    expect(() =>
      buildEconomicReport(
        [record()],
        coverage({ reportScope: "unknown" as "activity_cashflow" }),
      ),
    ).toThrow("scope");
    expect(() =>
      buildEconomicReport([record()], coverage({ unclassifiedCount: -1 })),
    ).toThrow("non-negative");
    expect(() =>
      buildEconomicReport(
        [record({ assetCode: "BGC", assetKind: "crypto" })],
        coverage(),
      ),
    ).toThrow("separate game-credit");
    expect(() =>
      buildEconomicReport([record({ signedAmount: "1e3" })], coverage()),
    ).toThrow();
    expect(() =>
      buildEconomicReport(
        [record()],
        coverage({
          periodStart: "2026-08-01T00:00:00Z",
          periodEnd: "2026-07-01T00:00:00Z",
        }),
      ),
    ).toThrow("must not be after");
    expect(() =>
      buildEconomicReport(
        [record()],
        coverage({
          sourceCoverageStart: "2026-08-01T00:00:00Z",
          sourceCoverageEnd: "2026-07-01T00:00:00Z",
        }),
      ),
    ).toThrow("Source coverage start");
    expect(() =>
      buildEconomicReport(
        [record()],
        coverage({
          manualExternalPayoutStatus: "unsupported" as "confirmed_complete",
        }),
      ),
    ).toThrow("external-payout coverage");
  });
});
