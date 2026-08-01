import { describe, expect, it } from "vitest";

import {
  buildVaultPerformanceSummary,
  type VaultPerformanceCoverageInput,
  type VaultPerformanceRecordInput,
} from "@/domain/vault-performance-summary";

const coverage: VaultPerformanceCoverageInput = {
  periodStart: "2026-07-01T00:00:00Z",
  periodEnd: "2026-07-31T23:59:59Z",
  sourceCoverage: "complete_recorded_period",
  manualTournamentPayoutStatus: "confirmed_complete",
  costBasisByAsset: [{ assetCode: "ETH", status: "known_same_asset" }],
  dataCurrentThrough: "2026-07-22T12:00:00Z",
  lastImported: "2026-07-23T01:00:00Z",
  freshnessState: "current",
};

function record(
  overrides: Partial<VaultPerformanceRecordInput> = {},
): VaultPerformanceRecordInput {
  return {
    transactionId: "tx-1",
    occurredAt: "2026-07-10T12:00:00Z",
    assetCode: "DEZ",
    assetKind: "crypto",
    signedAmount: "2",
    category: "open_race_payout",
    operating: true,
    aggregateStatus: "included",
    classificationStatus: "confirmed",
    reconciliationStatus: "reconciled",
    ...overrides,
  };
}

describe("Vault Performance summary", () => {
  it("calculates exact asset-separated operating summaries", () => {
    const summary = buildVaultPerformanceSummary(
      [
        record({
          transactionId: "open-fee",
          signedAmount: "-0.1",
          category: "open_race_entry_fee",
        }),
        record({ transactionId: "open-prize", signedAmount: "0.35" }),
        record({
          transactionId: "qualification-fee",
          assetCode: "ETH",
          signedAmount: "-0.02",
          category: "qualification_entry_fee",
        }),
        record({
          transactionId: "manual-prize",
          assetCode: "ETH",
          signedAmount: "0.5",
          category: "manual_tournament_payout",
        }),
        record({
          transactionId: "breed-income",
          assetCode: "USD",
          assetKind: "fiat",
          signedAmount: "20",
          category: "breeding_fee_earned",
        }),
        record({
          transactionId: "breed-cost",
          assetCode: "USD",
          assetKind: "fiat",
          signedAmount: "-8.75",
          category: "breeding_expense",
        }),
      ],
      coverage,
    );

    expect(summary.status).toBe("complete_recorded_period");
    expect(summary.cashCryptoTotals).toEqual([
      expect.objectContaining({
        assetCode: "DEZ",
        openRaceEntryFees: "0.1",
        openRacePayouts: "0.35",
        openRacingNet: "0.25",
        totalRecordedOperatingCashflow: "0.25",
      }),
      expect.objectContaining({
        assetCode: "ETH",
        qualificationEntryFees: "0.02",
        manualTournamentPayouts: "0.5",
        tournamentRecordedNet: "0.48",
      }),
      expect.objectContaining({
        assetCode: "USD",
        breedingIncome: "20",
        breedingExpenses: "8.75",
        breedingNet: "11.25",
      }),
    ]);
    expect(summary.combinedAssetTotalAvailable).toBe(false);
  });

  it("keeps BGC separate from cash and crypto totals", () => {
    const summary = buildVaultPerformanceSummary(
      [
        record({
          transactionId: "bgc-open",
          assetCode: "BGC",
          assetKind: "game_credit",
          signedAmount: "100",
          category: "opening_balance",
          operating: false,
        }),
        record({
          transactionId: "bgc-burn",
          assetCode: "BGC",
          assetKind: "game_credit",
          signedAmount: "12.5",
          category: "burn_bgc_credit",
        }),
        record({
          transactionId: "bgc-arena",
          assetCode: "BGC",
          assetKind: "game_credit",
          signedAmount: "-3",
          category: "arena_bgc_spend",
        }),
      ],
      coverage,
    );

    expect(summary.cashCryptoTotals).toEqual([]);
    expect(summary.bgcTotals).toEqual([
      expect.objectContaining({
        burnBgcCredits: "12.5",
        arenaBgcSpend: "3",
        netBgcMovement: "9.5",
        totalRecordedOperatingCashflow: "9.5",
        nonOperatingMovement: "100",
      }),
    ]);
    expect(summary.bgcIncludedInCashCryptoProfit).toBe(false);
  });

  it("excludes transfers, deposits and withdrawals from operating cashflow", () => {
    const summary = buildVaultPerformanceSummary(
      [
        record({
          transactionId: "deposit",
          assetCode: "ETH",
          signedAmount: "2",
          category: "deposit",
          operating: false,
        }),
        record({
          transactionId: "transfer",
          assetCode: "ETH",
          signedAmount: "-0.5",
          category: "internal_transfer",
          operating: false,
        }),
        record({
          transactionId: "race",
          assetCode: "ETH",
          signedAmount: "0.1",
        }),
      ],
      coverage,
    );

    expect(summary.cashCryptoTotals[0]).toEqual(
      expect.objectContaining({
        totalRecordedOperatingCashflow: "0.1",
        nonOperatingMovement: "1.5",
      }),
    );
    expect(summary.nonOperatingTransactionCount).toBe(2);
  });

  it("withholds realised trading result when same-asset cost basis is missing", () => {
    const summary = buildVaultPerformanceSummary(
      [
        record({
          transactionId: "sale",
          assetCode: "DEZ",
          signedAmount: "50",
          category: "core_sale",
        }),
      ],
      { ...coverage, costBasisByAsset: [] },
    );

    expect(summary.cashCryptoTotals[0]?.realisedCoreTradingResult).toBeNull();
    expect(summary.status).toBe("partial");
    expect(summary.warnings).toContain("CORE_SALE_COST_BASIS_MISSING");
  });

  it("calculates realised trading result only with same-asset evidence", () => {
    const summary = buildVaultPerformanceSummary(
      [
        record({
          transactionId: "purchase",
          assetCode: "ETH",
          signedAmount: "-1.25",
          category: "core_purchase",
        }),
        record({
          transactionId: "sale",
          assetCode: "ETH",
          signedAmount: "2",
          category: "core_sale",
        }),
        record({
          transactionId: "fee",
          assetCode: "ETH",
          signedAmount: "-0.05",
          category: "selling_fee",
        }),
      ],
      coverage,
    );

    expect(summary.cashCryptoTotals[0]?.realisedCoreTradingResult).toBe("0.7");
  });

  it("keeps excluded evidence out of all included totals", () => {
    const summary = buildVaultPerformanceSummary(
      [
        record({ transactionId: "included", signedAmount: "1" }),
        record({
          transactionId: "excluded",
          signedAmount: "99",
          aggregateStatus: "excluded",
        }),
      ],
      coverage,
    );

    expect(summary.includedTransactionCount).toBe(1);
    expect(summary.excludedTransactionCount).toBe(1);
    expect(summary.cashCryptoTotals[0]?.openRacePayouts).toBe("1");
  });

  it("downgrades incomplete, stale and unresolved reports", () => {
    const summary = buildVaultPerformanceSummary(
      [
        record({
          transactionId: "unclassified",
          classificationStatus: "unclassified",
          reconciliationStatus: "review_required",
        }),
      ],
      {
        ...coverage,
        sourceCoverage: "partial",
        manualTournamentPayoutStatus: "unknown",
        dataCurrentThrough: null,
        freshnessState: "stale",
      },
    );

    expect(summary.status).toBe("partial");
    expect(summary.warnings).toEqual(
      expect.arrayContaining([
        "SOURCE_COVERAGE_INCOMPLETE",
        "MANUAL_TOURNAMENT_PAYOUT_COVERAGE_UNKNOWN",
        "UNCLASSIFIED_ACTIVITY",
        "UNRESOLVED_RECONCILIATION",
        "DATA_CUTOFF_UNKNOWN",
        "IMPORTED_DATA_STALE",
      ]),
    );
    expect(summary.lifetimeProfitClaimAllowed).toBe(false);
  });

  it("fails closed on duplicate identities and invalid runtime enums", () => {
    expect(() =>
      buildVaultPerformanceSummary(
        [record(), record({ signedAmount: "3" })],
        coverage,
      ),
    ).toThrow("transaction IDs must be unique");

    expect(() =>
      buildVaultPerformanceSummary(
        [
          record({
            category:
              "unknown_category" as VaultPerformanceRecordInput["category"],
          }),
        ],
        coverage,
      ),
    ).toThrow("category is invalid");
  });

  it("rejects BGC leakage, category direction errors and inverted periods", () => {
    expect(() =>
      buildVaultPerformanceSummary(
        [
          record({
            assetCode: "BGC",
            assetKind: "game_credit",
            category: "open_race_payout",
          }),
        ],
        coverage,
      ),
    ).toThrow("category does not match its asset");

    expect(() =>
      buildVaultPerformanceSummary(
        [
          record({
            signedAmount: "1",
            category: "open_race_entry_fee",
          }),
        ],
        coverage,
      ),
    ).toThrow("debit direction is invalid");

    expect(() =>
      buildVaultPerformanceSummary([], {
        ...coverage,
        periodStart: coverage.periodEnd,
        periodEnd: coverage.periodStart,
      }),
    ).toThrow("period is inverted");
  });
});
