import { describe, expect, it } from "vitest";

import {
  buildCoreEconomicProfile,
  type CoreEconomicProfileCoverageInput,
  type CoreEconomicRecordInput,
} from "@/domain/core-economic-profile";

const coverage: CoreEconomicProfileCoverageInput = {
  coreId: "core-1",
  periodStart: "2026-01-01T00:00:00Z",
  periodEnd: "2026-12-31T23:59:59Z",
  sourceCoverage: "complete_recorded_period",
  costBasisByAsset: [{ assetCode: "DEZ", status: "known_same_asset" }],
  dataCurrentThrough: "2026-07-30T00:00:00Z",
  lastImported: "2026-07-31T00:00:00Z",
};

function record(
  overrides: Partial<CoreEconomicRecordInput> = {},
): CoreEconomicRecordInput {
  return {
    transactionId: "tx-1",
    occurredAt: "2026-07-10T00:00:00Z",
    assetCode: "DEZ",
    assetKind: "crypto",
    signedAmount: "-0.01",
    category: "open_race_entry_fee",
    aggregateStatus: "included",
    reconciliationStatus: "reconciled",
    allocationStatus: "explicit_allocations",
    coreAllocations: [{ coreId: coverage.coreId, signedAmount: "-0.01" }],
    relatedCoreIds: [],
    ...overrides,
  };
}

describe("core economic profile", () => {
  it("aggregates exact explicitly allocated activity for one core", () => {
    const result = buildCoreEconomicProfile(
      [
        record(),
        record({
          transactionId: "payout",
          signedAmount: "0.025",
          category: "open_race_payout",
          coreAllocations: [{ coreId: coverage.coreId, signedAmount: "0.025" }],
        }),
        record({
          transactionId: "breeding",
          signedAmount: "2.5",
          category: "breeding_fee_earned",
          coreAllocations: [{ coreId: coverage.coreId, signedAmount: "2.5" }],
        }),
        record({
          transactionId: "purchase",
          signedAmount: "-10",
          category: "core_purchase",
          coreAllocations: [{ coreId: coverage.coreId, signedAmount: "-10" }],
        }),
        record({
          transactionId: "sale",
          signedAmount: "15",
          category: "core_sale",
          coreAllocations: [{ coreId: coverage.coreId, signedAmount: "15" }],
        }),
        record({
          transactionId: "selling-fee",
          signedAmount: "-1",
          category: "selling_fee",
          coreAllocations: [{ coreId: coverage.coreId, signedAmount: "-1" }],
        }),
      ],
      coverage,
    );

    expect(result.cashCryptoTotals).toEqual([
      expect.objectContaining({
        assetCode: "DEZ",
        openRaceEntryFees: "0.01",
        openRacePayouts: "0.025",
        breedingIncome: "2.5",
        acquisitionCosts: "10",
        saleProceeds: "15",
        sellingFees: "1",
        recordedNet: "6.515",
        realisedTradingResult: "4",
        allocatedTransactionCount: 6,
      }),
    ]);
    expect(result.status).toBe("complete_recorded_period");
    expect(result.lifetimeProfitClaimAllowed).toBe(false);
  });

  it("uses only the selected core's exact share of a split transaction", () => {
    const result = buildCoreEconomicProfile(
      [
        record({
          transactionId: "shared-payout",
          signedAmount: "10",
          category: "manual_tournament_payout",
          coreAllocations: [
            { coreId: "core-1", signedAmount: "4" },
            { coreId: "core-2", signedAmount: "6" },
          ],
        }),
      ],
      coverage,
    );

    expect(result.cashCryptoTotals[0]?.tournamentPayouts).toBe("4");
    expect(result.cashCryptoTotals[0]?.recordedNet).toBe("4");
  });

  it("keeps related shared activity visible but out of core totals", () => {
    const result = buildCoreEconomicProfile(
      [
        record(),
        record({
          transactionId: "shared",
          signedAmount: "12",
          category: "manual_tournament_payout",
          allocationStatus: "related_unallocated",
          coreAllocations: [],
          relatedCoreIds: ["core-1", "core-2"],
        }),
      ],
      coverage,
    );

    expect(result.allocatedTransactionCount).toBe(1);
    expect(result.relatedUnallocatedTransactionCount).toBe(1);
    expect(result.warnings).toContain("RELATED_SHARED_ACTIVITY_UNALLOCATED");
    expect(result.cashCryptoTotals[0]?.recordedNet).toBe("-0.01");
  });

  it("does not fabricate trading profit when cost basis is missing", () => {
    const result = buildCoreEconomicProfile(
      [
        record({
          transactionId: "sale",
          signedAmount: "15",
          category: "core_sale",
          coreAllocations: [{ coreId: "core-1", signedAmount: "15" }],
        }),
      ],
      {
        ...coverage,
        costBasisByAsset: [
          { assetCode: "DEZ", status: "missing_or_unconvertible" },
        ],
      },
    );

    expect(result.cashCryptoTotals[0]?.saleProceeds).toBe("15");
    expect(result.cashCryptoTotals[0]?.realisedTradingResult).toBeNull();
    expect(result.warnings).toContain("COST_BASIS_MISSING");
    expect(result.status).toBe("partial");
  });

  it("keeps actual burn BGC separate from cash and crypto", () => {
    const result = buildCoreEconomicProfile(
      [
        record({
          transactionId: "burn-credit",
          assetCode: "BGC",
          assetKind: "game_credit",
          signedAmount: "25",
          category: "burn_bgc_credit",
          coreAllocations: [{ coreId: "core-1", signedAmount: "25" }],
        }),
      ],
      { ...coverage, costBasisByAsset: [] },
    );

    expect(result.cashCryptoTotals).toEqual([]);
    expect(result.bgcTotals[0]?.burnBgcCredits).toBe("25");
    expect(result.combinedAssetTotalAvailable).toBe(false);
  });

  it("retains excluded allocations without adding them to totals", () => {
    const result = buildCoreEconomicProfile(
      [
        record(),
        record({ transactionId: "excluded", aggregateStatus: "excluded" }),
        record({
          transactionId: "other-core",
          coreAllocations: [{ coreId: "core-2", signedAmount: "-0.01" }],
        }),
      ],
      coverage,
    );

    expect(result.allocatedTransactionCount).toBe(1);
    expect(result.excludedAllocatedTransactionCount).toBe(1);
  });

  it("requires exact allocations to equal the source transaction", () => {
    expect(() =>
      buildCoreEconomicProfile(
        [
          record({
            signedAmount: "10",
            category: "manual_tournament_payout",
            coreAllocations: [
              { coreId: "core-1", signedAmount: "4" },
              { coreId: "core-2", signedAmount: "5" },
            ],
          }),
        ],
        coverage,
      ),
    ).toThrow("must equal the transaction");
    expect(() =>
      buildCoreEconomicProfile(
        [
          record({
            coreAllocations: [
              { coreId: "core-1", signedAmount: "-0.005" },
              { coreId: "core-1", signedAmount: "-0.005" },
            ],
          }),
        ],
        coverage,
      ),
    ).toThrow("Allocation core IDs must be unique");
  });

  it("fails closed on contradictory allocation states and directions", () => {
    expect(() =>
      buildCoreEconomicProfile(
        [
          record({
            allocationStatus: "related_unallocated",
            coreAllocations: [],
            relatedCoreIds: [],
          }),
        ],
        coverage,
      ),
    ).toThrow("unallocated core evidence is inconsistent");
    expect(() =>
      buildCoreEconomicProfile([record({ signedAmount: "0.01" })], coverage),
    ).toThrow("category direction is invalid");
  });

  it("supports allocated BGC breeding spend without mixing it into cash", () => {
    const result = buildCoreEconomicProfile(
      [
        record({
          transactionId: "arena-spend",
          assetCode: "BGC",
          assetKind: "game_credit",
          signedAmount: "-5",
          category: "breeding_expense",
          coreAllocations: [{ coreId: "core-1", signedAmount: "-5" }],
        }),
      ],
      coverage,
    );

    expect(result.cashCryptoTotals).toEqual([]);
    expect(result.bgcTotals[0]?.breedingExpenses).toBe("5");
    expect(result.bgcTotals[0]?.recordedNet).toBe("-5");
  });

  it("limits core-profile BGC to actual burn credits and breeding spend", () => {
    expect(() =>
      buildCoreEconomicProfile(
        [
          record({
            assetCode: "BGC",
            assetKind: "game_credit",
          }),
        ],
        coverage,
      ),
    ).toThrow("actual burn credits and breeding spend");
    expect(() =>
      buildCoreEconomicProfile(
        [
          record({
            assetCode: "DEZ",
            category: "burn_bgc_credit",
            signedAmount: "1",
            coreAllocations: [{ coreId: "core-1", signedAmount: "1" }],
          }),
        ],
        coverage,
      ),
    ).toThrow("actual burn credits and breeding spend");
  });

  it("does not combine a sale with cost basis recorded in another asset", () => {
    const result = buildCoreEconomicProfile(
      [
        record({
          transactionId: "sale",
          signedAmount: "15",
          category: "core_sale",
          coreAllocations: [{ coreId: "core-1", signedAmount: "15" }],
        }),
        record({
          transactionId: "eth-purchase",
          assetCode: "ETH",
          signedAmount: "-0.01",
          category: "core_purchase",
          coreAllocations: [{ coreId: "core-1", signedAmount: "-0.01" }],
        }),
      ],
      {
        ...coverage,
        costBasisByAsset: [
          { assetCode: "DEZ", status: "missing_or_unconvertible" },
          { assetCode: "ETH", status: "known_same_asset" },
        ],
      },
    );

    expect(
      result.cashCryptoTotals.find((total) => total.assetCode === "DEZ")
        ?.realisedTradingResult,
    ).toBeNull();
    expect(result.warnings).toContain("COST_BASIS_MISSING");
  });

  it("marks coverage, cutoff and reconciliation gaps partial", () => {
    const result = buildCoreEconomicProfile(
      [record({ reconciliationStatus: "review_required" })],
      {
        ...coverage,
        sourceCoverage: "unknown",
        dataCurrentThrough: null,
      },
    );

    expect(result.status).toBe("partial");
    expect(result.warnings).toEqual([
      "SOURCE_COVERAGE_INCOMPLETE",
      "UNRESOLVED_RECONCILIATION",
      "DATA_CUTOFF_UNKNOWN",
    ]);
  });
});
