import { describe, expect, it } from "vitest";

import {
  buildTournamentCampaignEconomics,
  type CampaignEconomicRecordInput,
  type TournamentCampaignCoverageInput,
} from "@/domain/tournament-campaign-economics";

const coverage: TournamentCampaignCoverageInput = {
  tournamentId: "maiden-horse-2026",
  periodStart: "2026-07-01T00:00:00Z",
  periodEnd: "2026-07-31T23:59:59Z",
  sourceCoverage: "complete_recorded_period",
  manualExternalPayoutStatus: "confirmed_complete",
  dataCurrentThrough: "2026-07-30T12:00:00Z",
  lastImported: "2026-07-31T01:00:00Z",
};

function record(
  overrides: Partial<CampaignEconomicRecordInput> = {},
): CampaignEconomicRecordInput {
  return {
    transactionId: "tx-1",
    occurredAt: "2026-07-10T12:00:00Z",
    tournamentId: coverage.tournamentId,
    bracketId: "top-2",
    assetCode: "DEZ",
    assetKind: "crypto",
    signedAmount: "-0.01",
    category: "qualification_entry_fee",
    operating: true,
    aggregateStatus: "included",
    classificationStatus: "confirmed",
    reconciliationStatus: "reconciled",
    allocationStatus: "explicit_core_link",
    coreIds: ["core-1"],
    ...overrides,
  };
}

describe("tournament campaign economics", () => {
  it("calculates exact campaign components and net by original asset", () => {
    const result = buildTournamentCampaignEconomics(
      [
        record(),
        record({
          transactionId: "tx-2",
          signedAmount: "0.004",
          category: "qualification_race_payout",
        }),
        record({
          transactionId: "tx-3",
          signedAmount: "0.02",
          category: "tournament_round_payout",
        }),
        record({
          transactionId: "tx-4",
          signedAmount: "0.1",
          category: "tournament_final_payout",
        }),
        record({
          transactionId: "tx-5",
          signedAmount: "1.25",
          category: "manual_tournament_payout",
          allocationStatus: "vault_unallocated",
          coreIds: [],
        }),
        record({
          transactionId: "tx-6",
          signedAmount: "-0.005",
          category: "campaign_expense",
        }),
      ],
      coverage,
    );

    expect(result.cashCryptoTotals).toEqual([
      {
        assetCode: "DEZ",
        assetKind: "crypto",
        qualificationEntryFees: "0.01",
        qualificationRacePayouts: "0.004",
        roundPayouts: "0.02",
        finalPayouts: "0.1",
        manualTournamentPayouts: "1.25",
        campaignExpenses: "0.005",
        net: "1.359",
        transactionCount: 6,
      },
    ]);
    expect(result.unallocatedPayoutCount).toBe(1);
    expect(result.warnings).toContain("VAULT_LEVEL_PAYOUT_UNALLOCATED");
    expect(result.status).toBe("complete_recorded_period");
    expect(result.lifetimeProfitClaimAllowed).toBe(false);
  });

  it("keeps unlike assets and BGC separate without a combined total", () => {
    const result = buildTournamentCampaignEconomics(
      [
        record(),
        record({
          transactionId: "tx-eth",
          assetCode: "ETH",
          signedAmount: "0.001",
          category: "manual_tournament_payout",
        }),
        record({
          transactionId: "tx-bgc",
          assetCode: "BGC",
          assetKind: "game_credit",
          signedAmount: "-5",
          category: "campaign_expense",
        }),
      ],
      coverage,
    );

    expect(result.cashCryptoTotals.map((total) => total.assetCode)).toEqual([
      "DEZ",
      "ETH",
    ]);
    expect(result.bgcTotals).toHaveLength(1);
    expect(result.bgcTotals[0]?.net).toBe("-5");
    expect(result.combinedAssetTotalAvailable).toBe(false);
  });

  it("filters the selected campaign period and retains excluded counts", () => {
    const result = buildTournamentCampaignEconomics(
      [
        record(),
        record({
          transactionId: "other-tournament",
          tournamentId: "other",
        }),
        record({
          transactionId: "outside-period",
          occurredAt: "2026-08-01T00:00:00Z",
        }),
        record({
          transactionId: "excluded",
          aggregateStatus: "excluded",
        }),
      ],
      coverage,
    );

    expect(result.includedTransactionCount).toBe(1);
    expect(result.excludedTransactionCount).toBe(1);
  });

  it("marks incomplete, inferred and unreconciled evidence without hiding totals", () => {
    const result = buildTournamentCampaignEconomics(
      [
        record({
          classificationStatus: "inferred",
          reconciliationStatus: "review_required",
        }),
        record({
          transactionId: "unclassified",
          classificationStatus: "unclassified",
        }),
      ],
      {
        ...coverage,
        sourceCoverage: "partial",
        manualExternalPayoutStatus: "unknown",
        dataCurrentThrough: null,
      },
    );

    expect(result.status).toBe("partial");
    expect(result.warnings).toEqual([
      "SOURCE_COVERAGE_INCOMPLETE",
      "MANUAL_EXTERNAL_PAYOUT_COVERAGE_UNKNOWN",
      "UNCLASSIFIED_CAMPAIGN_ACTIVITY",
      "INFERRED_CLASSIFICATION_PRESENT",
      "UNRESOLVED_RECONCILIATION",
      "DATA_CUTOFF_UNKNOWN",
    ]);
    expect(result.includedTransactionCount).toBe(2);
  });

  it("rejects category direction errors and zero-value ledger records", () => {
    expect(() =>
      buildTournamentCampaignEconomics(
        [record({ signedAmount: "0.01" })],
        coverage,
      ),
    ).toThrow("Campaign category direction is invalid.");
    expect(() =>
      buildTournamentCampaignEconomics(
        [record({ signedAmount: "0" })],
        coverage,
      ),
    ).toThrow("cannot use a zero amount");
  });

  it("rejects fabricated or contradictory core allocation evidence", () => {
    expect(() =>
      buildTournamentCampaignEconomics(
        [
          record({
            allocationStatus: "vault_unallocated",
            coreIds: ["core-1"],
          }),
        ],
        coverage,
      ),
    ).toThrow("core allocation evidence is inconsistent");
    expect(() =>
      buildTournamentCampaignEconomics(
        [record({ coreIds: ["core-1", "core-1"] })],
        coverage,
      ),
    ).toThrow("core IDs must be unique");
  });

  it("rejects duplicate transaction IDs and invalid campaign windows", () => {
    expect(() =>
      buildTournamentCampaignEconomics([record(), record()], coverage),
    ).toThrow("transaction IDs must be unique");
    expect(() =>
      buildTournamentCampaignEconomics([], {
        ...coverage,
        periodStart: coverage.periodEnd,
        periodEnd: coverage.periodStart,
      }),
    ).toThrow("start must not be after");
  });

  it("fails closed on unsupported runtime enums and non-operating records", () => {
    expect(() =>
      buildTournamentCampaignEconomics(
        [
          record({
            classificationStatus: "guessed" as "confirmed",
          }),
        ],
        coverage,
      ),
    ).toThrow("classification status is invalid");
    expect(() =>
      buildTournamentCampaignEconomics(
        [record({ operating: false })],
        coverage,
      ),
    ).toThrow("require an operating ledger record");
  });

  it("enforces BGC asset-kind separation", () => {
    expect(() =>
      buildTournamentCampaignEconomics(
        [record({ assetCode: "BGC", assetKind: "crypto" })],
        coverage,
      ),
    ).toThrow("BGC must remain");
    expect(() =>
      buildTournamentCampaignEconomics(
        [record({ assetCode: "ETH", assetKind: "game_credit" })],
        coverage,
      ),
    ).toThrow("BGC must remain");
  });
});
