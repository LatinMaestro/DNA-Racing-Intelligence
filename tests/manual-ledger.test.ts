import { describe, expect, it } from "vitest";
import {
  validateManualLedgerEntry,
  type ManualLedgerEntryInput,
  type TournamentCampaignBinding,
} from "@/domain/manual-ledger";

const asset = { code: "DEZ", kind: "crypto" as const, precision: 8 };
const context = {
  assetDefinition: asset,
  assetRegistryVersion: "assets-v1",
  serverNow: "2026-07-21T00:00:00.000Z",
  tournamentCampaignBinding: null,
};

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
    accountLabel: "Synthetic account",
    costBasisStatus: "not_applicable",
    ...overrides,
  };
}

describe("manual ledger domain", () => {
  it("canonicalizes time and exact amounts using authoritative asset metadata", () => {
    expect(validateManualLedgerEntry(entry(), context)).toMatchObject({
      occurredAt: "2026-07-20T00:00:00.000Z",
      assetCode: "DEZ",
      assetKind: "crypto",
      assetRegistryVersion: "assets-v1",
      assetPrecision: 8,
      amount: "12.34",
      completeness: "complete",
    });
  });

  it("rejects metadata mismatch, excess precision and future evidence", () => {
    expect(() =>
      validateManualLedgerEntry(entry({ assetKind: "fiat" }), context),
    ).toThrow("authoritative registry");
    expect(() =>
      validateManualLedgerEntry(entry({ amount: "0.000000001" }), context),
    ).toThrow("precision");
    expect(() =>
      validateManualLedgerEntry(
        entry({ occurredAt: "2026-07-22T00:00:00Z" }),
        context,
      ),
    ).toThrow("future");
  });

  it("keeps transfers balanced and outside operating profit", () => {
    const result = validateManualLedgerEntry(
      entry({
        category: "transfer",
        subcategory: "internal_transfer",
        accountLabel: null,
        fromAccountLabel: "Synthetic A",
        toAccountLabel: "Synthetic B",
      }),
      context,
    );
    expect(
      result.postings.map((posting) => ({
        amount: posting.signedAmount,
        operating: posting.operating,
      })),
    ).toEqual([
      { amount: "-12.34", operating: false },
      { amount: "12.34", operating: false },
    ]);
  });

  it("keeps BGC isolated and sale profit partial without cost basis", () => {
    const bgc = validateManualLedgerEntry(
      entry({
        assetCode: "BGC",
        assetKind: "game_credit",
        category: "income",
        subcategory: "burn_bgc_credit",
        coreIds: ["synthetic-core"],
        amount: "5",
      }),
      {
        ...context,
        assetDefinition: { code: "BGC", kind: "game_credit", precision: 0 },
      },
    );
    expect(bgc).toMatchObject({ assetCode: "BGC", assetKind: "game_credit" });
    expect(() =>
      validateManualLedgerEntry(
        entry({ assetCode: "BGC", assetKind: "game_credit", amount: "12" }),
        {
          ...context,
          assetDefinition: { code: "BGC", kind: "game_credit", precision: 0 },
        },
      ),
    ).toThrow("separate in-game-credit ledger");

    const sale = validateManualLedgerEntry(
      entry({
        subcategory: "core_sale",
        coreIds: ["synthetic-core"],
        costBasisStatus: "missing",
      }),
      context,
    );
    expect(sale).toMatchObject({
      completeness: "partial",
      warnings: ["CORE_SALE_COST_BASIS_MISSING"],
    });
  });

  it("does not allow free-text tournament linkage into campaign totals", () => {
    const unbound = validateManualLedgerEntry(
      entry({
        subcategory: "manual_tournament_payout",
        tournamentId: "synthetic-tournament",
        coreIds: [],
      }),
      context,
    );
    expect(unbound).toMatchObject({
      tournamentAggregationEligible: false,
      completeness: "partial",
      warnings: [
        "UNALLOCATED_TOURNAMENT_PAYOUT",
        "TOURNAMENT_CAMPAIGN_BINDING_REQUIRED",
      ],
    });
    expect(unbound.postings[0]?.tournamentAggregationEligible).toBe(false);

    const binding: TournamentCampaignBinding = {
      tournamentId: "synthetic-tournament",
      evidenceId: "synthetic-evidence-v1",
      configurationVersion: "synthetic-config-v1",
      ownerAcknowledgedAt: "2026-07-19T00:00:00Z",
    };
    const bound = validateManualLedgerEntry(
      entry({
        subcategory: "manual_tournament_payout",
        tournamentId: "synthetic-tournament",
        coreIds: ["synthetic-core"],
      }),
      { ...context, tournamentCampaignBinding: binding },
    );
    expect(bound).toMatchObject({
      tournamentAggregationEligible: true,
      completeness: "complete",
      tournamentCampaignBinding: {
        ownerAcknowledgedAt: "2026-07-19T00:00:00.000Z",
      },
    });
    expect(() =>
      validateManualLedgerEntry(
        entry({
          subcategory: "manual_tournament_payout",
          tournamentId: "synthetic-tournament",
        }),
        {
          ...context,
          tournamentCampaignBinding: {
            ...binding,
            ownerAcknowledgedAt: "2026-07-22T00:00:00Z",
          },
        },
      ),
    ).toThrow("acknowledgement cannot be in the future");
  });
});
