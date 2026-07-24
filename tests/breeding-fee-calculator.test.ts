import { describe, expect, it } from "vitest";

import {
  calculateBreedingFees,
  type BreedingFeeCalculationInput,
  type BreedingFeeComponentInput,
} from "../domain/breeding-fee-calculator";

function component(
  category: BreedingFeeComponentInput["category"],
  overrides: Partial<BreedingFeeComponentInput> = {},
): BreedingFeeComponentInput {
  const arena = category !== "base_fee";
  return {
    componentId: category,
    category,
    sourceStatus: "confirmed",
    asset: category === "base_fee" ? "BGC" : "USD",
    exactAmount: category === "base_fee" ? "12.5" : "2.25",
    sourceKind: arena ? "arena_listing" : "manual_rule",
    listingId: arena ? `listing-${category}` : null,
    dataCurrentThrough: "2026-07-22T00:00:00Z",
    lastImported: "2026-07-22T01:00:00Z",
    expiresAt: arena ? "2026-07-25T00:00:00Z" : null,
    freshness: "current",
    ...overrides,
  };
}

function input(
  overrides: Partial<BreedingFeeCalculationInput> = {},
): BreedingFeeCalculationInput {
  return {
    pairingId: "pair-1",
    evaluatedAt: "2026-07-23T00:00:00Z",
    components: [
      component("base_fee"),
      component("parent_a_arena_fee"),
      component("parent_b_arena_fee"),
    ],
    ...overrides,
  };
}

describe("breeding fee calculator", () => {
  it("totals exact amounts separately by asset", () => {
    const result = calculateBreedingFees(input());
    expect(result.status).toBe("ready_for_review");
    expect(result.totals).toEqual({ BGC: "12.5", USD: "4.5" });
    expect(result.bgcUsdReferenceEquivalent).toBe("12.5");
    expect(result.combinedCashTotal).toBeNull();
    expect(result.liveConfirmationRequired).toBe(true);
    expect(result.breedingExecutionAllowed).toBe(false);
  });

  it("uses exact decimal arithmetic without floating point drift", () => {
    const result = calculateBreedingFees(
      input({
        components: [
          component("base_fee", { exactAmount: "0.1" }),
          component("parent_a_arena_fee", {
            asset: "BGC",
            exactAmount: "0.2",
          }),
        ],
      }),
    );
    expect(result.totals.BGC).toBe("0.3");
  });

  it("fails closed when a fee is unknown", () => {
    const result = calculateBreedingFees(
      input({
        components: [
          component("base_fee"),
          component("parent_a_arena_fee", {
            sourceStatus: "unknown",
            exactAmount: null,
          }),
        ],
      }),
    );
    expect(result.status).toBe("review_required");
    expect(result.totals).toEqual({ BGC: null, USD: null });
    expect(result.warnings).toEqual(
      expect.arrayContaining(["COMPONENT_UNKNOWN", "AMOUNT_UNKNOWN"]),
    );
  });

  it("holds expired Arena evidence", () => {
    const result = calculateBreedingFees(
      input({
        components: [
          component("base_fee"),
          component("parent_a_arena_fee", {
            expiresAt: "2026-07-22T00:00:00Z",
          }),
        ],
      }),
    );
    expect(result.status).toBe("review_required");
    expect(result.warnings).toContain("LISTING_EXPIRED");
  });

  it("keeps ageing and stale evidence explicit", () => {
    const ageing = calculateBreedingFees(
      input({
        components: [component("base_fee", { freshness: "ageing" })],
      }),
    );
    expect(ageing.status).toBe("review_required");
    expect(ageing.warnings).toContain("EVIDENCE_AGEING");

    const stale = calculateBreedingFees(
      input({
        components: [component("base_fee", { freshness: "stale" })],
      }),
    );
    expect(stale.warnings).toContain("EVIDENCE_STALE");
  });

  it("requires one base fee and unique categories", () => {
    expect(() =>
      calculateBreedingFees(
        input({ components: [component("parent_a_arena_fee")] }),
      ),
    ).toThrow("base fee");
    expect(() =>
      calculateBreedingFees(
        input({
          components: [
            component("base_fee"),
            component("base_fee", { componentId: "base-2" }),
          ],
        }),
      ),
    ).toThrow("category may appear only once");
  });

  it("requires Arena provenance and expiry", () => {
    expect(() =>
      calculateBreedingFees(
        input({
          components: [
            component("base_fee"),
            component("parent_a_arena_fee", { listingId: null }),
          ],
        }),
      ),
    ).toThrow("listing ID");
    expect(() =>
      calculateBreedingFees(
        input({
          components: [
            component("base_fee"),
            component("parent_a_arena_fee", { expiresAt: null }),
          ],
        }),
      ),
    ).toThrow("expiry timestamp");
  });

  it("rejects malformed, negative and over-precise amounts", () => {
    for (const exactAmount of ["-1", "1e3", "1.1234567890123456789"]) {
      expect(() =>
        calculateBreedingFees(
          input({
            components: [component("base_fee", { exactAmount })],
          }),
        ),
      ).toThrow("exact decimal");
    }
  });

  it("keeps data cutoff and import timestamps independently auditable", () => {
    expect(() =>
      calculateBreedingFees(
        input({
          components: [
            component("base_fee", {
              dataCurrentThrough: "2026-07-22T02:00:00Z",
              lastImported: "2026-07-22T01:00:00Z",
            }),
          ],
        }),
      ),
    ).toThrow("cannot precede");
    const result = calculateBreedingFees(
      input({
        components: [
          component("base_fee", {
            dataCurrentThrough: null,
            lastImported: null,
            freshness: "unknown",
          }),
        ],
      }),
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining(["DATA_CUTOFF_UNKNOWN", "LAST_IMPORTED_UNKNOWN"]),
    );
  });
});
