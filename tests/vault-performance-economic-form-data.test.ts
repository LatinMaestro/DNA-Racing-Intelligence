import { describe, expect, it } from "vitest";
import {
  parseManualLedgerFormData,
  parseManualTournamentPayoutFormData,
  type VaultPerformanceEconomicFormConfiguration,
} from "../lib/vault-performance-economic-form-data";

function configuration(
  overrides: Partial<VaultPerformanceEconomicFormConfiguration> = {},
): VaultPerformanceEconomicFormConfiguration {
  return {
    assets: [
      { code: "ETH", kind: "crypto", decimalPlaces: 18 },
      { code: "USD", kind: "fiat", decimalPlaces: 2 },
      { code: "BGC", kind: "game_credit", decimalPlaces: 0 },
    ],
    manualLedgerSubcategories: [
      { category: "income", subcategory: "other_income" },
      { category: "income", subcategory: "burn_bgc_credit" },
      { category: "expense", subcategory: "other_expense" },
      { category: "opening_balance", subcategory: "opening_balance" },
      { category: "transfer", subcategory: "internal_transfer" },
      { category: "adjustment", subcategory: "adjustment" },
    ],
    createDurableId: (kind) => `${kind}:synthetic-0001`,
    assetRegistryVersion: "registry-v1",
    serverNow: "2026-07-27T00:00:00.000Z",
    ...overrides,
  };
}

function manualLedgerForm(): FormData {
  const form = new FormData();
  form.set("occurredAt", "2026-07-26T10:00:00+10:00");
  form.set("assetCode", " eth ");
  form.set("assetKind", "crypto");
  form.set("amount", "1.2500");
  form.set("category", "income");
  form.set("subcategory", "other_income");
  form.set("accountLabel", " Owner wallet ");
  form.set("externalReference", " synthetic-reference ");
  form.append("coreId", "core-b");
  form.append("coreId", "core-a");
  return form;
}

function payoutForm(): FormData {
  const form = new FormData();
  form.set("occurredAt", "2026-07-26T00:00:00Z");
  form.set("tournamentId", " tournament-1 ");
  form.set("stage", "final");
  form.set("assetCode", "ETH");
  form.set("amount", "2.5000");
  form.set("allocationMethod", "vault_unallocated");
  form.set("receivingAccountLabel", "Owner wallet");
  return form;
}

describe("Vault Performance economic FormData", () => {
  it("creates a canonical manual-ledger input with a server-generated ID", () => {
    const parsed = parseManualLedgerFormData(
      manualLedgerForm(),
      configuration(),
    );

    expect(parsed).toEqual({
      entryId: "manual_ledger_entry:synthetic-0001",
      occurredAt: "2026-07-26T00:00:00.000Z",
      assetCode: "ETH",
      assetKind: "crypto",
      amount: "1.25",
      category: "income",
      subcategory: "other_income",
      direction: "credit",
      accountLabel: "Owner wallet",
      tournamentId: null,
      coreIds: ["core-a", "core-b"],
      externalReference: "synthetic-reference",
      note: null,
    });
  });

  it("does not accept a durable ID from FormData", () => {
    const form = manualLedgerForm();
    form.set("entryId", "browser-selected-id");

    expect(() => parseManualLedgerFormData(form, configuration())).toThrow(
      "Unexpected form field: entryId",
    );
  });

  it("rejects duplicate scalar fields and non-text values", () => {
    const duplicate = manualLedgerForm();
    duplicate.append("amount", "9");
    expect(() => parseManualLedgerFormData(duplicate, configuration())).toThrow(
      "amount must be supplied exactly once",
    );

    const file = manualLedgerForm();
    file.set("note", new Blob(["private evidence"]), "evidence.txt");
    expect(() => parseManualLedgerFormData(file, configuration())).toThrow(
      "note must be text",
    );
  });

  it("uses server-controlled asset evidence and BGC separation", () => {
    const mismatched = manualLedgerForm();
    mismatched.set("assetKind", "fiat");
    expect(() =>
      parseManualLedgerFormData(mismatched, configuration()),
    ).toThrow("does not match server configuration");

    const bgc = manualLedgerForm();
    bgc.set("assetCode", "BGC");
    bgc.set("assetKind", "game_credit");
    bgc.set("amount", "1");
    bgc.set("subcategory", "burn_bgc_credit");
    bgc.delete("coreId");
    bgc.set("coreId", "core-burnt");
    expect(parseManualLedgerFormData(bgc, configuration())).toMatchObject({
      assetCode: "BGC",
      assetKind: "game_credit",
    });
  });

  it("requires an allowlisted category/subcategory pair", () => {
    const form = manualLedgerForm();
    form.set("subcategory", "other_expense");

    expect(() => parseManualLedgerFormData(form, configuration())).toThrow(
      "category and subcategory are not configured",
    );
  });

  it("rejects ambiguous local timestamps, zero and negative amounts", () => {
    const localTimestamp = manualLedgerForm();
    localTimestamp.set("occurredAt", "2026-07-26T10:00");
    expect(() =>
      parseManualLedgerFormData(localTimestamp, configuration()),
    ).toThrow("explicit UTC offset");

    const zero = manualLedgerForm();
    zero.set("amount", "0.00");
    expect(() => parseManualLedgerFormData(zero, configuration())).toThrow(
      "must be positive",
    );

    const negative = manualLedgerForm();
    negative.set("amount", "-1");
    expect(() => parseManualLedgerFormData(negative, configuration())).toThrow(
      "must be positive",
    );
  });

  it("creates balanced transfer and directional-adjustment inputs", () => {
    const transfer = manualLedgerForm();
    transfer.set("category", "transfer");
    transfer.set("subcategory", "internal_transfer");
    transfer.delete("accountLabel");
    transfer.set("fromAccountLabel", "Wallet A");
    transfer.set("toAccountLabel", "Wallet B");
    expect(parseManualLedgerFormData(transfer, configuration())).toMatchObject({
      category: "transfer",
      fromAccountLabel: "Wallet A",
      toAccountLabel: "Wallet B",
    });

    const adjustment = manualLedgerForm();
    adjustment.set("category", "adjustment");
    adjustment.set("subcategory", "adjustment");
    adjustment.set("direction", "debit");
    expect(
      parseManualLedgerFormData(adjustment, configuration()),
    ).toMatchObject({
      category: "adjustment",
      direction: "debit",
      accountLabel: "Owner wallet",
    });
  });

  it("creates an unallocated payout with server-owned precision and ID", () => {
    expect(
      parseManualTournamentPayoutFormData(payoutForm(), configuration()),
    ).toEqual({
      payoutId: "manual_tournament_payout:synthetic-0001",
      occurredAt: "2026-07-26T00:00:00.000Z",
      tournamentId: "tournament-1",
      season: null,
      bracketId: null,
      leaderboardId: null,
      stage: "final",
      amount: "2.5",
      assetCode: "ETH",
      assetKind: "crypto",
      assetDecimalPlaces: 18,
      receivingAccountLabel: "Owner wallet",
      externalReference: null,
      evidenceNote: null,
      allocationMethod: "vault_unallocated",
    });
  });

  it("keeps BGC and incomplete core-allocation submissions out of payouts", () => {
    const bgc = payoutForm();
    bgc.set("assetCode", "BGC");
    expect(() =>
      parseManualTournamentPayoutFormData(bgc, configuration()),
    ).toThrow("BGC cannot be recorded");

    const allocated = payoutForm();
    allocated.set("allocationMethod", "single_core");
    expect(() =>
      parseManualTournamentPayoutFormData(allocated, configuration()),
    ).toThrow("allocation core rows are required");
  });

  it("parses single-core and equal repeated-row allocations", () => {
    const single = payoutForm();
    single.set("allocationMethod", "single_core");
    single.set("allocationCoreId", " core-one ");
    expect(
      parseManualTournamentPayoutFormData(single, configuration()),
    ).toMatchObject({
      allocationMethod: "single_core",
      allocations: [{ coreId: "core-one" }],
    });

    const equal = payoutForm();
    equal.set("allocationMethod", "equal");
    equal.append("allocationCoreId", "core-z");
    equal.append("allocationCoreId", "core-a");
    expect(
      parseManualTournamentPayoutFormData(equal, configuration()),
    ).toMatchObject({
      allocationMethod: "equal",
      allocations: [{ coreId: "core-a" }, { coreId: "core-z" }],
    });
  });

  it("parses exact-amount allocation rows and verifies reconciliation", () => {
    const form = payoutForm();
    form.set("assetCode", "USD");
    form.set("amount", "10.00");
    form.set("allocationMethod", "manual_amounts");
    form.append("allocationCoreId", "core-b");
    form.append("allocationAmount", "6.25");
    form.append("allocationCoreId", "core-a");
    form.append("allocationAmount", "3.75");

    expect(
      parseManualTournamentPayoutFormData(form, configuration()),
    ).toMatchObject({
      allocationMethod: "manual_amounts",
      allocations: [
        { coreId: "core-a", amount: "3.75" },
        { coreId: "core-b", amount: "6.25" },
      ],
    });

    form.delete("allocationAmount");
    form.append("allocationAmount", "4");
    form.append("allocationAmount", "5");
    expect(() =>
      parseManualTournamentPayoutFormData(form, configuration()),
    ).toThrow("must equal the payout amount");
  });

  it("parses exact-percentage and documented-points allocation rows", () => {
    const percentages = payoutForm();
    percentages.set("allocationMethod", "manual_percentages");
    percentages.append("allocationCoreId", "core-a");
    percentages.append("allocationPercentage", "25");
    percentages.append("allocationCoreId", "core-b");
    percentages.append("allocationPercentage", "75.0");
    expect(
      parseManualTournamentPayoutFormData(percentages, configuration()),
    ).toMatchObject({
      allocationMethod: "manual_percentages",
      allocations: [
        { coreId: "core-a", percentage: "25" },
        { coreId: "core-b", percentage: "75.0" },
      ],
    });

    const points = payoutForm();
    points.set("allocationMethod", "documented_points");
    points.append("allocationCoreId", "core-a");
    points.append("allocationPoints", "1");
    points.append("allocationCoreId", "core-b");
    points.append("allocationPoints", "3");
    expect(
      parseManualTournamentPayoutFormData(points, configuration()),
    ).toMatchObject({
      allocationMethod: "documented_points",
      allocations: [
        { coreId: "core-a", points: "1" },
        { coreId: "core-b", points: "3" },
      ],
    });
  });

  it("rejects mismatched, irrelevant, duplicate and unallocated rows", () => {
    const mismatched = payoutForm();
    mismatched.set("allocationMethod", "manual_amounts");
    mismatched.append("allocationCoreId", "core-a");
    expect(() =>
      parseManualTournamentPayoutFormData(mismatched, configuration()),
    ).toThrow("one matching value");

    const irrelevant = payoutForm();
    irrelevant.set("allocationMethod", "equal");
    irrelevant.append("allocationCoreId", "core-a");
    irrelevant.append("allocationPoints", "1");
    expect(() =>
      parseManualTournamentPayoutFormData(irrelevant, configuration()),
    ).toThrow("do not match the selected method");

    const duplicate = payoutForm();
    duplicate.set("allocationMethod", "equal");
    duplicate.append("allocationCoreId", "core-a");
    duplicate.append("allocationCoreId", "core-a");
    expect(() =>
      parseManualTournamentPayoutFormData(duplicate, configuration()),
    ).toThrow("core IDs must be unique");

    const unallocated = payoutForm();
    unallocated.append("allocationCoreId", "core-a");
    expect(() =>
      parseManualTournamentPayoutFormData(unallocated, configuration()),
    ).toThrow("cannot contain core allocation fields");
  });

  it("fails closed on malformed or duplicate server configuration", () => {
    expect(() =>
      parseManualLedgerFormData(
        manualLedgerForm(),
        configuration({
          assets: [
            { code: "ETH", kind: "crypto", decimalPlaces: 18 },
            { code: "eth", kind: "crypto", decimalPlaces: 18 },
          ],
        }),
      ),
    ).toThrow("asset configuration is invalid");

    expect(() =>
      parseManualLedgerFormData(
        manualLedgerForm(),
        configuration({
          createDurableId: () => "browser unsafe id",
        }),
      ),
    ).toThrow("Generated durable economic evidence ID is invalid");
  });
});
