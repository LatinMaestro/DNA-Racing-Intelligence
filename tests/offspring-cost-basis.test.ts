import { describe, expect, it } from "vitest";

import {
  buildOffspringCostBasis,
  type OffspringCostBasisInput,
} from "../domain/offspring-cost-basis";

function input(
  overrides: Partial<OffspringCostBasisInput> = {},
): OffspringCostBasisInput {
  return {
    assignmentId: "assignment-1",
    offspringCoreId: "offspring-1",
    breedingEventId: "breed-1",
    breedingOccurredAt: "2026-07-20T00:00:00Z",
    requestedAt: "2026-07-23T00:00:00Z",
    ownershipStatus: "confirmed_owned",
    breedingEventStatus: "completed",
    costs: [
      {
        transactionId: "dna-cost",
        category: "dna_base_fee",
        source: "manual_confirmed",
        evidenceStatus: "confirmed",
        assetCode: "DEZ",
        assetKind: "crypto",
        amount: "2.500",
      },
      {
        transactionId: "bgc-cost",
        category: "arena_fee_bgc",
        source: "authoritative_transaction_export",
        evidenceStatus: "confirmed",
        assetCode: "BGC",
        assetKind: "game_credit",
        amount: "10",
      },
    ],
    refunds: [],
    previouslyAssignedTransactionIds: [],
    ...overrides,
  };
}

describe("offspring cost basis", () => {
  it("builds an optional review assignment from confirmed actual costs", () => {
    const result = buildOffspringCostBasis(input());
    expect(result.status).toBe("assignment_review");
    expect(result.totalsByAsset).toEqual([
      {
        assetCode: "BGC",
        assetKind: "game_credit",
        grossCostAmount: "10",
        refundAmount: "0",
        netCostBasisAmount: "10",
      },
      {
        assetCode: "DEZ",
        assetKind: "crypto",
        grossCostAmount: "2.5",
        refundAmount: "0",
        netCostBasisAmount: "2.5",
      },
    ]);
    expect(result.assignmentMutationAllowed).toBe(false);
  });

  it("keeps refunds linked and subtracts them exactly", () => {
    const result = buildOffspringCostBasis(
      input({
        refunds: [
          {
            transactionId: "refund-1",
            appliesToTransactionId: "dna-cost",
            source: "manual_confirmed",
            evidenceStatus: "confirmed",
            assetCode: "DEZ",
            assetKind: "crypto",
            amount: "0.125",
          },
        ],
      }),
    );
    expect(result.totalsByAsset[1]).toEqual(
      expect.objectContaining({
        grossCostAmount: "2.5",
        refundAmount: "0.125",
        netCostBasisAmount: "2.375",
      }),
    );
    expect(result.components[2]).toEqual(
      expect.objectContaining({
        category: "refund",
        appliesToTransactionId: "dna-cost",
        signedAmount: "-0.125",
      }),
    );
  });

  it("holds an unowned or unresolved offspring", () => {
    const notOwned = buildOffspringCostBasis(
      input({ ownershipStatus: "not_owned" }),
    );
    expect(notOwned.status).toBe("held_for_ownership");
    expect(notOwned.holdReasons[0]).toContain("ownership");
  });

  it("holds a breeding event that is not confirmed complete", () => {
    const result = buildOffspringCostBasis(
      input({ breedingEventStatus: "failed" }),
    );
    expect(result.status).toBe("held_for_event");
    expect(result.holdReasons[0]).toContain("not confirmed complete");
  });

  it("prevents the same actual transaction from being assigned twice", () => {
    const result = buildOffspringCostBasis(
      input({ previouslyAssignedTransactionIds: ["dna-cost"] }),
    );
    expect(result.status).toBe("held_for_duplicate");
    expect(result.holdReasons[0]).toContain("already assigned");
  });

  it("holds proposed, reversed or absent cost evidence", () => {
    const proposed = buildOffspringCostBasis(
      input({
        costs: [
          {
            ...input().costs[0]!,
            evidenceStatus: "proposed",
          },
        ],
      }),
    );
    expect(proposed.status).toBe("held_for_evidence");
    expect(buildOffspringCostBasis(input({ costs: [] })).status).toBe(
      "held_for_evidence",
    );
  });

  it("requires every refund to reference a matching included cost", () => {
    expect(() =>
      buildOffspringCostBasis(
        input({
          refunds: [
            {
              transactionId: "refund",
              appliesToTransactionId: "missing",
              source: "manual_confirmed",
              evidenceStatus: "confirmed",
              assetCode: "DEZ",
              assetKind: "crypto",
              amount: "1",
            },
          ],
        }),
      ),
    ).toThrow("reference an included pairing cost");
    expect(() =>
      buildOffspringCostBasis(
        input({
          refunds: [
            {
              transactionId: "refund",
              appliesToTransactionId: "dna-cost",
              source: "manual_confirmed",
              evidenceStatus: "confirmed",
              assetCode: "ETH",
              assetKind: "crypto",
              amount: "1",
            },
          ],
        }),
      ),
    ).toThrow("same asset");
  });

  it("rejects refunds that exceed the referenced actual cost", () => {
    expect(() =>
      buildOffspringCostBasis(
        input({
          refunds: [
            {
              transactionId: "refund",
              appliesToTransactionId: "dna-cost",
              source: "manual_confirmed",
              evidenceStatus: "confirmed",
              assetCode: "DEZ",
              assetKind: "crypto",
              amount: "2.501",
            },
          ],
        }),
      ),
    ).toThrow("cannot exceed");
  });

  it("keeps BGC separate and rejects malformed financial inputs", () => {
    expect(() =>
      buildOffspringCostBasis(
        input({
          costs: [
            {
              ...input().costs[1]!,
              assetCode: "DEZ",
              assetKind: "crypto",
            },
          ],
        }),
      ),
    ).toThrow("BGC must remain");
    expect(() =>
      buildOffspringCostBasis(
        input({
          costs: [{ ...input().costs[0]!, amount: "1e-3" }],
        }),
      ),
    ).toThrow("plain base-10");
  });

  it("never assigns market value or calculates a realised gain", () => {
    const result = buildOffspringCostBasis(input());
    expect(result.originalAssetsCombined).toBe(false);
    expect(result.marketValueAssigned).toBe(false);
    expect(result.realisedGainCalculated).toBe(false);
  });

  it("requires assignment time to follow the completed breeding event", () => {
    expect(() =>
      buildOffspringCostBasis(input({ requestedAt: "2026-07-19T00:00:00Z" })),
    ).toThrow("cannot predate breeding");
  });
});
