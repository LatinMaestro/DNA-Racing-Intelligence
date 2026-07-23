import { describe, expect, it } from "vitest";
import {
  auditEconomicReconciliation,
  type EconomicAuditRecord,
  type EconomicReconciliationAuditInput,
} from "@/domain/economic-reconciliation-audit";

function record(
  overrides: Partial<EconomicAuditRecord> = {},
): EconomicAuditRecord {
  return {
    transactionId: "dez-prize",
    assetCode: "DEZ",
    assetKind: "crypto",
    signedAmount: "10",
    category: "operating",
    sourceType: "race_import",
    aggregateStatus: "included",
    duplicateOfTransactionId: null,
    tournamentId: null,
    coreSale: false,
    acquisitionCostKnown: false,
    ...overrides,
  };
}

function input(
  overrides: Partial<EconomicReconciliationAuditInput> = {},
): EconomicReconciliationAuditInput {
  return {
    records: [
      record(),
      record({
        transactionId: "dez-fee",
        signedAmount: "-0.25",
      }),
      record({
        transactionId: "bgc-burn",
        assetCode: "BGC",
        assetKind: "game_credit",
        signedAmount: "5",
        sourceType: "manual_entry",
      }),
    ],
    reportedTotals: [
      {
        assetCode: "BGC",
        assetKind: "game_credit",
        operatingIncome: "5",
        operatingExpense: "0",
        operatingNet: "5",
      },
      {
        assetCode: "DEZ",
        assetKind: "crypto",
        operatingIncome: "10",
        operatingExpense: "0.25",
        operatingNet: "9.75",
      },
    ],
    combinedAssetTotalClaimed: false,
    bgcIncludedInCashCryptoClaimed: false,
    reportStatusClaimed: "complete",
    unclassifiedCount: 0,
    unresolvedReconciliationCount: 0,
    conversionUsed: false,
    conversionCoverage: "not_requested",
    manualExternalPayoutCoverage: "confirmed_none",
    ...overrides,
  };
}

describe("Phase 9 economic reconciliation audit", () => {
  it("recalculates exact totals separately by asset", () => {
    const audit = auditEconomicReconciliation(input());

    expect(audit.status).toBe("reconciled_contract");
    expect(audit.calculatedTotals).toEqual(input().reportedTotals);
    expect(audit).toMatchObject({
      dependableTotalsEstablished: false,
      gateCStatus: "not_assessed",
      automaticLedgerMutationAllowed: false,
    });
  });

  it("retains exact decimal precision without binary floating point", () => {
    const audit = auditEconomicReconciliation(
      input({
        records: [
          record({ signedAmount: "0.100000000000000001" }),
          record({
            transactionId: "second",
            signedAmount: "0.200000000000000002",
          }),
        ],
        reportedTotals: [
          {
            assetCode: "DEZ",
            assetKind: "crypto",
            operatingIncome: "0.300000000000000003",
            operatingExpense: "0",
            operatingNet: "0.300000000000000003",
          },
        ],
      }),
    );

    expect(audit.status).toBe("reconciled_contract");
  });

  it("blocks a mismatch between ledger and reported totals", () => {
    const audit = auditEconomicReconciliation(
      input({
        reportedTotals: [
          {
            assetCode: "DEZ",
            assetKind: "crypto",
            operatingIncome: "11",
            operatingExpense: "0.25",
            operatingNet: "10.75",
          },
        ],
      }),
    );

    expect(audit.status).toBe("blocked");
    expect(audit.issues).toContainEqual(
      expect.objectContaining({ code: "REPORTED_TOTAL_MISMATCH" }),
    );
  });

  it("blocks inclusion of transfers and other non-operating movements", () => {
    const audit = auditEconomicReconciliation(
      input({
        records: [
          record({
            transactionId: "transfer",
            category: "transfer",
            signedAmount: "100",
          }),
        ],
        reportedTotals: [],
        reportStatusClaimed: "partial",
      }),
    );

    expect(audit.issues).toContainEqual(
      expect.objectContaining({
        code: "NON_OPERATING_INCLUDED",
        transactionId: "transfer",
      }),
    );
  });

  it("blocks mixing BGC or unlike assets into one claimed total", () => {
    const audit = auditEconomicReconciliation(
      input({
        combinedAssetTotalClaimed: true,
        bgcIncludedInCashCryptoClaimed: true,
      }),
    );

    expect(audit.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "BGC_MIXED_WITH_CASH_CRYPTO",
        "COMBINED_ASSET_TOTAL",
      ]),
    );
  });

  it("requires valid duplicate links without auto-excluding evidence", () => {
    const audit = auditEconomicReconciliation(
      input({
        records: [
          record({
            aggregateStatus: "excluded",
            duplicateOfTransactionId: "missing",
          }),
        ],
        reportedTotals: [],
        reportStatusClaimed: "partial",
      }),
    );

    expect(audit.issues).toContainEqual(
      expect.objectContaining({ code: "DUPLICATE_LINK_INVALID" }),
    );
    expect(audit.automaticLedgerMutationAllowed).toBe(false);
  });

  it("requires duplicate evidence to match the survivor and remain excluded", () => {
    const audit = auditEconomicReconciliation(
      input({
        records: [
          record({ transactionId: "survivor" }),
          record({
            transactionId: "candidate",
            assetCode: "ETH",
            duplicateOfTransactionId: "survivor",
            aggregateStatus: "included",
          }),
        ],
        reportedTotals: [
          {
            assetCode: "DEZ",
            assetKind: "crypto",
            operatingIncome: "10",
            operatingExpense: "0",
            operatingNet: "10",
          },
          {
            assetCode: "ETH",
            assetKind: "crypto",
            operatingIncome: "10",
            operatingExpense: "0",
            operatingNet: "10",
          },
        ],
        reportStatusClaimed: "partial",
      }),
    );

    expect(audit.issues).toContainEqual(
      expect.objectContaining({
        code: "DUPLICATE_LINK_INVALID",
        transactionId: "candidate",
      }),
    );
  });

  it("requires manual tournament payouts to remain linked and covered", () => {
    const audit = auditEconomicReconciliation(
      input({
        records: [
          record({
            sourceType: "manual_tournament_payout",
          }),
        ],
        reportedTotals: [
          {
            assetCode: "DEZ",
            assetKind: "crypto",
            operatingIncome: "10",
            operatingExpense: "0",
            operatingNet: "10",
          },
        ],
        manualExternalPayoutCoverage: "unknown",
      }),
    );

    expect(audit.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "MANUAL_PAYOUT_UNLINKED",
        "COMPLETE_STATUS_UNSUPPORTED",
      ]),
    );
  });

  it("keeps realised sale result incomplete without cost basis", () => {
    const audit = auditEconomicReconciliation(
      input({
        records: [
          record({
            coreSale: true,
            acquisitionCostKnown: false,
          }),
        ],
        reportedTotals: [
          {
            assetCode: "DEZ",
            assetKind: "crypto",
            operatingIncome: "10",
            operatingExpense: "0",
            operatingNet: "10",
          },
        ],
      }),
    );

    expect(audit.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "CORE_SALE_COST_BASIS_MISSING",
        "COMPLETE_STATUS_UNSUPPORTED",
      ]),
    );
  });

  it("rejects an unsupported complete status with unresolved coverage", () => {
    const audit = auditEconomicReconciliation(
      input({
        unclassifiedCount: 1,
        unresolvedReconciliationCount: 1,
      }),
    );
    expect(audit.issues).toContainEqual(
      expect.objectContaining({ code: "COMPLETE_STATUS_UNSUPPORTED" }),
    );
  });

  it("requires conversion use and coverage declarations to agree", () => {
    const audit = auditEconomicReconciliation(
      input({
        conversionUsed: true,
        conversionCoverage: "not_requested",
        reportStatusClaimed: "partial",
      }),
    );
    expect(audit.issues).toContainEqual(
      expect.objectContaining({
        code: "CONVERSION_COVERAGE_INCONSISTENT",
      }),
    );
  });
});
