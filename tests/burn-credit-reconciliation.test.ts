import { describe, expect, it } from "vitest";

import {
  reconcileBurnCredit,
  type BurnCreditEvidence,
  type ConfirmedBurnEvidence,
} from "../domain/burn-credit-reconciliation";

const burn: ConfirmedBurnEvidence = {
  burnId: "burn-1",
  coreId: "core-1",
  occurredAt: "2026-07-20T00:00:00Z",
  status: "confirmed_event_review",
};

function credit(
  overrides: Partial<BurnCreditEvidence> = {},
): BurnCreditEvidence {
  return {
    creditId: "credit-1",
    coreId: "core-1",
    burnId: "burn-1",
    occurredAt: "2026-07-20T00:01:00Z",
    asset: "BGC",
    amount: "125.5",
    evidenceSource: "manual",
    evidenceStatus: "confirmed",
    externalReference: null,
    ...overrides,
  };
}

describe("burn-credit reconciliation", () => {
  it("links one confirmed actual BGC credit to a confirmed burn", () => {
    expect(reconcileBurnCredit({ burn, credits: [credit()] })).toMatchObject({
      status: "matched_actual_credit",
      matchedCreditId: "credit-1",
      actualBgcAmount: "125.5",
      ledgerPostingProposed: true,
    });
  });

  it("keeps a missing credit explicit without predicting one", () => {
    expect(reconcileBurnCredit({ burn, credits: [] })).toMatchObject({
      status: "credit_missing",
      actualBgcAmount: null,
      creditPredicted: false,
      ledgerPostingProposed: false,
    });
  });

  it("holds a core/date candidate without an explicit burn link", () => {
    const result = reconcileBurnCredit({
      burn,
      credits: [credit({ burnId: null })],
    });
    expect(result.status).toBe("review_required");
    expect(result.reviewItems[0]?.reason).toContain("requires confirmation");
  });

  it("holds credits for another burn, another core or before the event", () => {
    const result = reconcileBurnCredit({
      burn,
      credits: [
        credit({ creditId: "other-burn", burnId: "burn-2" }),
        credit({ creditId: "other-core", coreId: "core-2" }),
        credit({
          creditId: "before",
          occurredAt: "2026-07-19T23:59:00Z",
        }),
      ],
    });
    expect(result.status).toBe("review_required");
    expect(result.reviewItems).toHaveLength(3);
  });

  it("surfaces multiple direct credits without excluding either", () => {
    const result = reconcileBurnCredit({
      burn,
      credits: [credit(), credit({ creditId: "credit-2" })],
    });
    expect(result.status).toBe("review_required");
    expect(result.matchedCreditId).toBeNull();
    expect(result.automaticExclusionAllowed).toBe(false);
  });

  it("cannot post a credit against an unconfirmed burn", () => {
    const result = reconcileBurnCredit({
      burn: { ...burn, status: "review_required" },
      credits: [credit()],
    });
    expect(result.status).toBe("burn_unconfirmed");
    expect(result.ledgerPostingProposed).toBe(false);
  });

  it("requires BGC and exact positive plain-decimal evidence", () => {
    expect(() =>
      reconcileBurnCredit({
        burn,
        credits: [credit({ asset: "DEZ" })],
      }),
    ).toThrow("must use BGC");
    expect(() =>
      reconcileBurnCredit({
        burn,
        credits: [credit({ amount: "1e3" })],
      }),
    ).toThrow("positive plain decimal");
  });

  it("fails closed on duplicate IDs and unsupported runtime status", () => {
    expect(() =>
      reconcileBurnCredit({ burn, credits: [credit(), credit()] }),
    ).toThrow("must be unique");
    expect(() =>
      reconcileBurnCredit({
        burn,
        credits: [
          credit({
            evidenceStatus: "complete" as BurnCreditEvidence["evidenceStatus"],
          }),
        ],
      }),
    ).toThrow("status is invalid");
  });

  it("never uses strategic advice or mutates the burn event", () => {
    expect(reconcileBurnCredit({ burn, credits: [credit()] })).toMatchObject({
      strategicRecommendationUsed: false,
      burnEventMutated: false,
      creditPredicted: false,
    });
  });
});
