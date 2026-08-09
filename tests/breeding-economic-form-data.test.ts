import { describe, expect, it } from "vitest";

import type { BreedingEconomicFormConfiguration } from "@/lib/breeding-economic-form-data";
import {
  parseBreedingEconomicEvidenceFormData,
  parseOffspringCostBasisFormData,
} from "@/lib/breeding-economic-form-data";

function configuration(
  overrides: Partial<BreedingEconomicFormConfiguration> = {},
): BreedingEconomicFormConfiguration {
  return {
    assets: [
      { code: "DEZ", kind: "crypto" },
      { code: "USD", kind: "fiat" },
      { code: "BGC", kind: "game_credit" },
    ],
    confirmedOwnedCoreIds: ["offspring"],
    completedBreedingEvents: [
      {
        breedingEventId: "breeding-event",
        occurredAt: "2026-07-20T10:00:00+10:00",
        status: "completed",
      },
    ],
    confirmedCosts: [
      {
        breedingEventId: "breeding-event",
        transactionId: "cost-dez",
        category: "dna_base_fee",
        source: "manual_confirmed",
        evidenceStatus: "confirmed",
        assetCode: "DEZ",
        assetKind: "crypto",
        amount: "2.5",
      },
      {
        breedingEventId: "breeding-event",
        transactionId: "cost-bgc",
        category: "arena_fee_bgc",
        source: "manual_confirmed",
        evidenceStatus: "confirmed",
        assetCode: "BGC",
        assetKind: "game_credit",
        amount: "10",
      },
    ],
    confirmedRefunds: [
      {
        breedingEventId: "breeding-event",
        transactionId: "refund-dez",
        appliesToTransactionId: "cost-dez",
        source: "manual_confirmed",
        evidenceStatus: "confirmed",
        assetCode: "DEZ",
        assetKind: "crypto",
        amount: "0.5",
      },
    ],
    createDurableId: (kind) => `${kind}:synthetic-0001`,
    now: () => new Date("2026-07-26T00:00:00Z"),
    ...overrides,
  };
}

function evidenceForm(): FormData {
  const form = new FormData();
  form.set("breedingEventId", " breeding-event ");
  form.set("occurredAt", "2026-07-20T10:00:00+10:00");
  form.set("lifecycle", "completed");
  form.set("parentCoreIdA", "parent-b");
  form.set("parentCoreIdB", "parent-a");
  form.set("offspringCoreId", "offspring");
  form.set("category", "dna_base_fee");
  form.set("assetCode", " dez ");
  form.set("amount", "2.500");
  form.set("externalReference", " external-reference ");
  form.set("evidenceNote", " Confirmed completed breeding. ");
  return form;
}

function costBasisForm(): FormData {
  const form = new FormData();
  form.set("offspringCoreId", "offspring");
  form.set("breedingEventId", "breeding-event");
  form.append("transactionId", "cost-bgc");
  form.append("transactionId", "refund-dez");
  form.append("transactionId", "cost-dez");
  return form;
}

describe("breeding economic FormData", () => {
  it("creates canonical manual evidence with server-generated durable IDs", () => {
    expect(
      parseBreedingEconomicEvidenceFormData(evidenceForm(), configuration()),
    ).toEqual({
      evidenceId: "breeding_economic_evidence:synthetic-0001",
      breedingEventId: "breeding-event",
      source: "manual_confirmed",
      lifecycle: "completed",
      occurredAt: "2026-07-20T00:00:00.000Z",
      parentCoreIds: ["parent-b", "parent-a"],
      offspringCoreId: "offspring",
      evidenceNote: "Confirmed completed breeding.",
      entries: [
        {
          transactionId: "breeding_economic_transaction:synthetic-0001",
          category: "dna_base_fee",
          direction: "debit",
          assetCode: "DEZ",
          assetKind: "crypto",
          amount: "2.5",
          externalReference: "external-reference",
        },
      ],
    });
  });

  it("derives refund direction and keeps BGC server-controlled", () => {
    const refund = evidenceForm();
    refund.set("lifecycle", "refunded");
    refund.set("category", "refund");
    expect(
      parseBreedingEconomicEvidenceFormData(refund, configuration()),
    ).toMatchObject({
      lifecycle: "refunded",
      entries: [{ category: "refund", direction: "credit" }],
    });

    const bgc = evidenceForm();
    bgc.set("category", "arena_fee_bgc");
    bgc.set("assetCode", "BGC");
    expect(
      parseBreedingEconomicEvidenceFormData(bgc, configuration()),
    ).toMatchObject({
      entries: [
        {
          category: "arena_fee_bgc",
          assetCode: "BGC",
          assetKind: "game_credit",
        },
      ],
    });
  });

  it("rejects browser durable IDs, ambiguous time and inconsistent evidence", () => {
    const durableId = evidenceForm();
    durableId.set("evidenceId", "browser-id");
    expect(() =>
      parseBreedingEconomicEvidenceFormData(durableId, configuration()),
    ).toThrow("Unexpected form field");

    const localTime = evidenceForm();
    localTime.set("occurredAt", "2026-07-20T10:00");
    expect(() =>
      parseBreedingEconomicEvidenceFormData(localTime, configuration()),
    ).toThrow("explicit UTC offset");

    const inconsistent = evidenceForm();
    inconsistent.set("lifecycle", "refunded");
    expect(() =>
      parseBreedingEconomicEvidenceFormData(inconsistent, configuration()),
    ).toThrow("lifecycle and economic category");
  });

  it("resolves cost basis from server-confirmed evidence only", () => {
    expect(
      parseOffspringCostBasisFormData(costBasisForm(), configuration()),
    ).toEqual({
      assignmentId: "offspring_cost_basis:synthetic-0001",
      offspringCoreId: "offspring",
      breedingEventId: "breeding-event",
      breedingOccurredAt: "2026-07-20T00:00:00.000Z",
      requestedAt: "2026-07-26T00:00:00.000Z",
      ownershipStatus: "confirmed_owned",
      breedingEventStatus: "completed",
      costs: [
        expect.objectContaining({ transactionId: "cost-bgc" }),
        expect.objectContaining({ transactionId: "cost-dez" }),
      ],
      refunds: [expect.objectContaining({ transactionId: "refund-dez" })],
    });
  });

  it("rejects browser-restated costs and unconfirmed ownership or evidence", () => {
    const restated = costBasisForm();
    restated.set("amount", "999");
    expect(() =>
      parseOffspringCostBasisFormData(restated, configuration()),
    ).toThrow("Unexpected form field");

    expect(() =>
      parseOffspringCostBasisFormData(
        costBasisForm(),
        configuration({ confirmedOwnedCoreIds: [] }),
      ),
    ).toThrow("ownership is not confirmed");

    const unknown = costBasisForm();
    unknown.delete("transactionId");
    unknown.set("transactionId", "unknown");
    expect(() =>
      parseOffspringCostBasisFormData(unknown, configuration()),
    ).toThrow("not confirmed");
  });

  it("rejects cross-event, duplicate and refund-only selections", () => {
    const crossEvent = costBasisForm();
    expect(() =>
      parseOffspringCostBasisFormData(
        crossEvent,
        configuration({
          confirmedCosts: configuration().confirmedCosts.map((cost) => ({
            ...cost,
            breedingEventId: "another-event",
          })),
        }),
      ),
    ).toThrow("belongs to another breeding event");

    const duplicate = costBasisForm();
    duplicate.append("transactionId", "cost-dez");
    expect(() =>
      parseOffspringCostBasisFormData(duplicate, configuration()),
    ).toThrow("must be unique");

    const refundOnly = costBasisForm();
    refundOnly.delete("transactionId");
    refundOnly.set("transactionId", "refund-dez");
    expect(() =>
      parseOffspringCostBasisFormData(refundOnly, configuration()),
    ).toThrow("At least one confirmed pairing cost");
  });

  it("rejects a selected refund without its cost and inconsistent asset evidence", () => {
    const missingReferencedCost = costBasisForm();
    missingReferencedCost.delete("transactionId");
    missingReferencedCost.append("transactionId", "cost-bgc");
    missingReferencedCost.append("transactionId", "refund-dez");
    expect(() =>
      parseOffspringCostBasisFormData(missingReferencedCost, configuration()),
    ).toThrow("refund requires its pairing cost");

    expect(() =>
      parseOffspringCostBasisFormData(
        costBasisForm(),
        configuration({ assets: [{ code: "BGC", kind: "game_credit" }] }),
      ),
    ).toThrow("asset is not configured consistently");
  });
});
