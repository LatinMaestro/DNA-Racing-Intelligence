import { describe, expect, it } from "vitest";

import {
  assessCoreSaleEvidence,
  type CoreSaleEvidenceInput,
} from "../domain/core-sale-evidence";

function input(
  overrides: Partial<CoreSaleEvidenceInput> = {},
): CoreSaleEvidenceInput {
  return {
    saleId: "sale-1",
    coreId: "core-1",
    occurredAt: "2026-07-20T00:00:00Z",
    recordedAt: "2026-07-21T00:00:00Z",
    evidenceSource: "manual",
    evidenceStatus: "confirmed",
    ownershipAtSale: "confirmed_active",
    proceeds: { asset: "DEZ", amount: "100.125" },
    sellingFees: [{ asset: "DEZ", amount: "2.125" }],
    acquisitionCost: { asset: "DEZ", amount: "70" },
    externalReference: "sale-ref",
    recommendationReferenceId: "lifecycle-review-1",
    ...overrides,
  };
}

describe("core sale evidence", () => {
  it("creates exact review postings and a realised result", () => {
    const result = assessCoreSaleEvidence(input());
    expect(result.postings).toEqual([
      { postingType: "sale_proceeds", asset: "DEZ", signedAmount: "100.125" },
      { postingType: "selling_fee", asset: "DEZ", signedAmount: "-2.125" },
    ]);
    expect(result.realisedResult).toEqual({
      status: "available",
      asset: "DEZ",
      signedAmount: "28",
    });
  });

  it("reports a loss without binary floating-point arithmetic", () => {
    const result = assessCoreSaleEvidence(
      input({
        proceeds: { asset: "ETH", amount: "0.1" },
        sellingFees: [{ asset: "ETH", amount: "0.02" }],
        acquisitionCost: { asset: "ETH", amount: "0.11" },
      }),
    );
    expect(result.realisedResult.signedAmount).toBe("-0.03");
  });

  it("keeps proceeds but withholds realised result when cost basis is missing", () => {
    const result = assessCoreSaleEvidence(input({ acquisitionCost: null }));
    expect(result.status).toBe("postable_review");
    expect(result.realisedResult.status).toBe("missing_cost_basis");
    expect(result.reviewReasons).toContain("Acquisition cost is unavailable.");
  });

  it("does not combine unlike assets", () => {
    const result = assessCoreSaleEvidence(
      input({ acquisitionCost: { asset: "ETH", amount: "0.5" } }),
    );
    expect(result.realisedResult).toEqual({
      status: "asset_mismatch",
      asset: null,
      signedAmount: null,
    });
  });

  it("holds provisional, conflicted or unowned evidence from posting", () => {
    expect(
      assessCoreSaleEvidence(input({ evidenceStatus: "provisional" })).postings,
    ).toEqual([]);
    expect(
      assessCoreSaleEvidence(input({ evidenceStatus: "conflicted" })).status,
    ).toBe("review_required");
    expect(
      assessCoreSaleEvidence(input({ ownershipAtSale: "unknown" })).postings,
    ).toEqual([]);
  });

  it("never treats strategic advice as execution evidence", () => {
    expect(assessCoreSaleEvidence(input())).toMatchObject({
      recommendationWasExecutionEvidence: false,
      saleExecutionAllowed: false,
      ownershipMutationAllowed: false,
      marketValueInferred: false,
    });
  });

  it("rejects malformed amounts and reversed timestamps", () => {
    expect(() =>
      assessCoreSaleEvidence(
        input({ proceeds: { asset: "DEZ", amount: "1e3" } }),
      ),
    ).toThrow("positive plain decimal");
    expect(() =>
      assessCoreSaleEvidence(input({ recordedAt: "2026-07-19T00:00:00Z" })),
    ).toThrow("cannot precede");
  });

  it("fails closed on unsupported runtime evidence", () => {
    expect(() =>
      assessCoreSaleEvidence(
        input({
          evidenceStatus: "complete" as CoreSaleEvidenceInput["evidenceStatus"],
        }),
      ),
    ).toThrow("status is invalid");
  });
});
