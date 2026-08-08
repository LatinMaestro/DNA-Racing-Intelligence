import { describe, expect, it } from "vitest";

import {
  classifyBreedingEconomicEvidence,
  type BreedingEconomicEvidenceInput,
} from "../domain/breeding-economic-evidence";

function input(
  overrides: Partial<BreedingEconomicEvidenceInput> = {},
): BreedingEconomicEvidenceInput {
  return {
    evidenceId: "evidence-1",
    breedingEventId: "breed-1",
    source: "manual_confirmed",
    lifecycle: "completed",
    occurredAt: "2026-07-22T00:00:00Z",
    parentCoreIds: ["parent-a", "parent-b"],
    offspringCoreId: "offspring-1",
    evidenceNote: "Confirmed against the completed breeding record.",
    entries: [
      {
        transactionId: "dna-fee",
        category: "dna_base_fee",
        direction: "debit",
        assetCode: "DEZ",
        assetKind: "crypto",
        amount: "1.2500",
        externalReference: null,
      },
      {
        transactionId: "arena-fee",
        category: "arena_fee_bgc",
        direction: "debit",
        assetCode: "BGC",
        assetKind: "game_credit",
        amount: "15",
        externalReference: null,
      },
    ],
    ...overrides,
  };
}

describe("breeding economic evidence", () => {
  it("creates review-only postings from confirmed completed evidence", () => {
    const result = classifyBreedingEconomicEvidence(input());
    expect(result.status).toBe("postable_review");
    expect(result.postings).toHaveLength(2);
    expect(result.postings[0]?.signedAmount).toBe("-1.25");
    expect(result.totalsByAsset).toEqual([
      {
        assetCode: "BGC",
        assetKind: "game_credit",
        creditAmount: "0",
        debitAmount: "15",
        netAmount: "-15",
      },
      {
        assetCode: "DEZ",
        assetKind: "crypto",
        creditAmount: "0",
        debitAmount: "1.25",
        netAmount: "-1.25",
      },
    ]);
    expect(result.ledgerMutationAllowed).toBe(false);
  });

  it("never treats an arena listing as completed income", () => {
    const result = classifyBreedingEconomicEvidence(
      input({
        source: "arena_listing",
        lifecycle: "unknown",
        occurredAt: null,
        offspringCoreId: null,
        evidenceNote: null,
        entries: [],
      }),
    );
    expect(result.status).toBe("non_transaction_evidence");
    expect(result.postings).toEqual([]);
    expect(result.arenaListingTreatedAsIncome).toBe(false);
    expect(result.holdReasons[0]).toContain("do not prove");
  });

  it("rejects transaction facts attached to an arena listing", () => {
    expect(() =>
      classifyBreedingEconomicEvidence(
        input({ source: "arena_listing", lifecycle: "unknown" }),
      ),
    ).toThrow("cannot carry completed economic transactions");
  });

  it("keeps unlike assets separate and sums exact decimals", () => {
    const result = classifyBreedingEconomicEvidence(
      input({
        entries: [
          {
            transactionId: "one",
            category: "breeding_fee_earned",
            direction: "credit",
            assetCode: "ETH",
            assetKind: "crypto",
            amount: "0.1",
            externalReference: "tx-1",
          },
          {
            transactionId: "two",
            category: "breeding_fee_earned",
            direction: "credit",
            assetCode: "ETH",
            assetKind: "crypto",
            amount: "0.02",
            externalReference: "tx-2",
          },
          {
            transactionId: "three",
            category: "dna_base_fee",
            direction: "debit",
            assetCode: "DEZ",
            assetKind: "crypto",
            amount: "1",
            externalReference: null,
          },
        ],
      }),
    );
    expect(result.totalsByAsset).toEqual([
      {
        assetCode: "DEZ",
        assetKind: "crypto",
        creditAmount: "0",
        debitAmount: "1",
        netAmount: "-1",
      },
      {
        assetCode: "ETH",
        assetKind: "crypto",
        creditAmount: "0.12",
        debitAmount: "0",
        netAmount: "0.12",
      },
    ]);
    expect(result.assetsCombined).toBe(false);
  });

  it("requires an audit note for manually confirmed evidence", () => {
    expect(() =>
      classifyBreedingEconomicEvidence(input({ evidenceNote: " " })),
    ).toThrow("requires an audit note");
  });

  it("does not post failed, pending or unknown breeding activity", () => {
    expect(() =>
      classifyBreedingEconomicEvidence(input({ lifecycle: "pending" })),
    ).toThrow("cannot create economic postings");
    const held = classifyBreedingEconomicEvidence(
      input({ lifecycle: "failed", entries: [] }),
    );
    expect(held.status).toBe("held_for_completion");
    expect(held.postings).toEqual([]);
  });

  it("holds completed evidence that contains no economic transactions", () => {
    const result = classifyBreedingEconomicEvidence(input({ entries: [] }));
    expect(result.status).toBe("held_for_evidence");
    expect(result.holdReasons[0]).toContain("no confirmed transactions");
  });

  it("restricts refunded evidence to confirmed credit refunds", () => {
    const refunded = classifyBreedingEconomicEvidence(
      input({
        lifecycle: "refunded",
        entries: [
          {
            transactionId: "refund",
            category: "refund",
            direction: "credit",
            assetCode: "DEZ",
            assetKind: "crypto",
            amount: "1.25",
            externalReference: "refund-1",
          },
        ],
      }),
    );
    expect(refunded.status).toBe("refunded_review");
    expect(refunded.totalsByAsset[0]?.netAmount).toBe("1.25");
    expect(() =>
      classifyBreedingEconomicEvidence(input({ lifecycle: "refunded" })),
    ).toThrow("only confirmed refunds");
  });

  it("enforces category direction and separate BGC identity", () => {
    expect(() =>
      classifyBreedingEconomicEvidence(
        input({
          entries: [
            {
              ...input().entries[0]!,
              direction: "credit",
            },
          ],
        }),
      ),
    ).toThrow("category and direction");
    expect(() =>
      classifyBreedingEconomicEvidence(
        input({
          entries: [
            {
              ...input().entries[1]!,
              assetCode: "DEZ",
              assetKind: "crypto",
            },
          ],
        }),
      ),
    ).toThrow("BGC must remain");
  });

  it("requires unique transaction identity and positive plain decimals", () => {
    expect(() =>
      classifyBreedingEconomicEvidence(
        input({ entries: [input().entries[0]!, input().entries[0]!] }),
      ),
    ).toThrow("must be unique");
    expect(() =>
      classifyBreedingEconomicEvidence(
        input({
          entries: [{ ...input().entries[0]!, amount: "1e-3" }],
        }),
      ),
    ).toThrow("plain base-10");
    expect(() =>
      classifyBreedingEconomicEvidence(
        input({
          entries: [{ ...input().entries[0]!, amount: "0" }],
        }),
      ),
    ).toThrow("greater than zero");
  });

  it("cannot initiate a ledger, wallet or game mutation", () => {
    const result = classifyBreedingEconomicEvidence(input());
    expect(result.ledgerMutationAllowed).toBe(false);
    expect(result.walletOrGameTransactionAllowed).toBe(false);
  });
});
