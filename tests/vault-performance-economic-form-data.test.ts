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
      { category: "expense", subcategory: "other_expense" },
      { category: "opening_balance", subcategory: "opening_balance" },
      { category: "transfer", subcategory: "internal_transfer" },
      { category: "adjustment", subcategory: "balance_adjustment" },
    ],
    createDurableId: (kind) => `${kind}:synthetic-0001`,
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
    expect(parseManualLedgerFormData(bgc, configuration())).toMatchObject({
      assetCode: "BGC",
      assetKind: "game_credit",
    });
  });

  it("requires an allowlisted category/subcategory pair", () => {
    const form = manualLedgerForm();
    form.set("subcategory", "breeding_income");

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

  it("keeps transfers and directional adjustments disabled", () => {
    const transfer = manualLedgerForm();
    transfer.set("category", "transfer");
    transfer.set("subcategory", "internal_transfer");
    expect(() => parseManualLedgerFormData(transfer, configuration())).toThrow(
      "remain disabled",
    );

    const adjustment = manualLedgerForm();
    adjustment.set("category", "adjustment");
    adjustment.set("subcategory", "balance_adjustment");
    expect(() =>
      parseManualLedgerFormData(adjustment, configuration()),
    ).toThrow("remain disabled");
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
    ).toThrow("conditional allocation controls");
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
