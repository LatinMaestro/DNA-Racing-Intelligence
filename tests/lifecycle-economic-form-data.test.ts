import { describe, expect, it } from "vitest";

import type { LifecycleEconomicFormConfiguration } from "@/lib/lifecycle-economic-form-data";
import {
  parseBurnCreditFormData,
  parseCoreBurnFormData,
  parseCoreSaleFormData,
} from "@/lib/lifecycle-economic-form-data";

function configuration(
  overrides: Partial<LifecycleEconomicFormConfiguration> = {},
): LifecycleEconomicFormConfiguration {
  return {
    assets: ["ETH", "DEZ", "USD"],
    activeCores: [
      { coreId: "sale-core", coreClass: "Genesis" },
      { coreId: "burn-core", coreClass: "Freak" },
    ],
    confirmedBurns: [
      {
        burnId: "confirmed-burn",
        coreId: "burn-core",
        occurredAt: "2026-07-20T10:00:00+10:00",
        status: "confirmed_event_review",
      },
    ],
    createDurableId: (kind) => `${kind}:synthetic-0001`,
    now: () => new Date("2026-07-26T00:00:00Z"),
    ...overrides,
  };
}

function saleForm(): FormData {
  const form = new FormData();
  form.set("coreId", "sale-core");
  form.set("occurredAt", "2026-07-21T10:00:00+10:00");
  form.set("proceedsAsset", " eth ");
  form.set("proceedsAmount", "5.500");
  form.set("sellingFees", "0.25");
  form.set("acquisitionCost", "4");
  form.set("externalReference", " sale-reference ");
  return form;
}

function burnForm(): FormData {
  const form = new FormData();
  form.set("coreId", "burn-core");
  form.set("coreClass", "Freak");
  form.set("occurredAt", "2026-07-20T10:00:00+10:00");
  form.set("reason", " Confirmed completed burn. ");
  return form;
}

function creditForm(): FormData {
  const form = new FormData();
  form.set("burnId", "confirmed-burn");
  form.set("coreId", "burn-core");
  form.set("occurredAt", "2026-07-21T10:00:00+10:00");
  form.set("amount", "12.00");
  form.set("externalReference", " credit-reference ");
  return form;
}

describe("lifecycle economic FormData", () => {
  it("creates confirmed sale evidence with server-owned identity and ownership", () => {
    expect(parseCoreSaleFormData(saleForm(), configuration())).toEqual({
      saleId: "core_sale:synthetic-0001",
      coreId: "sale-core",
      occurredAt: "2026-07-21T00:00:00.000Z",
      recordedAt: "2026-07-26T00:00:00.000Z",
      evidenceSource: "manual",
      evidenceStatus: "confirmed",
      ownershipAtSale: "confirmed_active",
      proceeds: { asset: "ETH", amount: "5.5" },
      sellingFees: [{ asset: "ETH", amount: "0.25" }],
      acquisitionCost: { asset: "ETH", amount: "4" },
      externalReference: "sale-reference",
      recommendationReferenceId: null,
    });
  });

  it("keeps missing sale cost basis explicit and rejects browser identity", () => {
    const missing = saleForm();
    missing.delete("acquisitionCost");
    expect(parseCoreSaleFormData(missing, configuration())).toMatchObject({
      acquisitionCost: null,
    });

    const browserId = saleForm();
    browserId.set("saleId", "browser-selected");
    expect(() => parseCoreSaleFormData(browserId, configuration())).toThrow(
      "Unexpected form field",
    );
  });

  it("requires confirmed active sale ownership and configured assets", () => {
    expect(() =>
      parseCoreSaleFormData(saleForm(), configuration({ activeCores: [] })),
    ).toThrow("Active ownership is not confirmed");

    expect(() =>
      parseCoreSaleFormData(saleForm(), configuration({ assets: ["DEZ"] })),
    ).toThrow("asset is not configured");
  });

  it("creates a non-Genesis burn from authoritative active-core class", () => {
    expect(parseCoreBurnFormData(burnForm(), configuration())).toEqual({
      burnId: "core_burn:synthetic-0001",
      coreId: "burn-core",
      coreClass: "Freak",
      occurredAt: "2026-07-20T00:00:00.000Z",
      recordedAt: "2026-07-26T00:00:00.000Z",
      evidenceSource: "manual",
      evidenceStatus: "confirmed",
      ownershipAtBurn: "confirmed_active",
      reason: "Confirmed completed burn.",
      recommendationReferenceId: null,
    });
  });

  it("rejects Genesis and browser-restated class evidence", () => {
    const genesis = burnForm();
    genesis.set("coreId", "sale-core");
    genesis.set("coreClass", "Genesis");
    expect(() => parseCoreBurnFormData(genesis, configuration())).toThrow(
      "Genesis cores cannot be burned",
    );

    const mismatch = burnForm();
    mismatch.set("coreClass", "Morphed");
    expect(() => parseCoreBurnFormData(mismatch, configuration())).toThrow(
      "does not match accepted core evidence",
    );
  });

  it("creates only an actual BGC credit matched to a confirmed burn", () => {
    expect(parseBurnCreditFormData(creditForm(), configuration())).toEqual({
      creditId: "burn_bgc_credit:synthetic-0001",
      coreId: "burn-core",
      burnId: "confirmed-burn",
      occurredAt: "2026-07-21T00:00:00.000Z",
      asset: "BGC",
      amount: "12",
      evidenceSource: "manual",
      evidenceStatus: "confirmed",
      externalReference: "credit-reference",
    });
  });

  it("rejects unconfirmed, mismatched and pre-burn credit evidence", () => {
    expect(() =>
      parseBurnCreditFormData(
        creditForm(),
        configuration({ confirmedBurns: [] }),
      ),
    ).toThrow("Burn is not confirmed");

    const mismatch = creditForm();
    mismatch.set("coreId", "another-core");
    expect(() => parseBurnCreditFormData(mismatch, configuration())).toThrow(
      "does not match the confirmed burn",
    );

    const early = creditForm();
    early.set("occurredAt", "2026-07-19T00:00:00Z");
    expect(() => parseBurnCreditFormData(early, configuration())).toThrow(
      "does not reconcile",
    );
  });

  it("rejects ambiguous timestamps, duplicate fields and non-text evidence", () => {
    const localTime = saleForm();
    localTime.set("occurredAt", "2026-07-21T10:00");
    expect(() => parseCoreSaleFormData(localTime, configuration())).toThrow(
      "explicit UTC offset",
    );

    const duplicate = burnForm();
    duplicate.append("reason", "another reason");
    expect(() => parseCoreBurnFormData(duplicate, configuration())).toThrow(
      "exactly once",
    );

    const file = creditForm();
    file.set("externalReference", new Blob(["private"]), "evidence.txt");
    expect(() => parseBurnCreditFormData(file, configuration())).toThrow(
      "must be text",
    );
  });
});
