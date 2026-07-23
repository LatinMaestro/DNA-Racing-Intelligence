import { describe, expect, it } from "vitest";
import {
  filterEconomicLedger,
  type FilterableEconomicRecordInput,
} from "@/domain/economic-ledger-filter";

function record(
  overrides: Partial<FilterableEconomicRecordInput> = {},
): FilterableEconomicRecordInput {
  return {
    transactionId: "tx-1",
    occurredAt: "2026-07-15T00:00:00Z",
    assetCode: "DEZ",
    signedAmount: "10.00",
    aggregateStatus: "included",
    category: "racing_income",
    subcategory: "race_prize",
    coreIds: ["core-1"],
    mode: "bike",
    distanceMetres: 1400,
    tournamentId: "tournament-1",
    bracketId: "bracket-1",
    ...overrides,
  };
}

describe("Phase 2A economic ledger filters", () => {
  it("returns included records in deterministic time and ID order by default", () => {
    const result = filterEconomicLedger([
      record({ transactionId: "later", occurredAt: "2026-07-16T00:00:00Z" }),
      record({ transactionId: "same-b" }),
      record({ transactionId: "same-a" }),
      record({ transactionId: "excluded", aggregateStatus: "excluded" }),
    ]);
    expect(result.records.map(({ transactionId }) => transactionId)).toEqual([
      "same-a",
      "same-b",
      "later",
    ]);
    expect(result.filterStatus).toBe("all_included_records");
  });

  it("applies an inclusive reporting period", () => {
    const result = filterEconomicLedger(
      [
        record({ transactionId: "start", occurredAt: "2026-07-01T00:00:00Z" }),
        record({ transactionId: "middle" }),
        record({ transactionId: "end", occurredAt: "2026-07-31T23:59:59Z" }),
        record({ transactionId: "after", occurredAt: "2026-08-01T00:00:00Z" }),
      ],
      {
        periodStart: "2026-07-01T00:00:00Z",
        periodEnd: "2026-07-31T23:59:59Z",
      },
    );
    expect(result.records.map(({ transactionId }) => transactionId)).toEqual([
      "start",
      "middle",
      "end",
    ]);
  });

  it("filters assets case-insensitively without combining them", () => {
    const result = filterEconomicLedger(
      [
        record(),
        record({ transactionId: "eth", assetCode: "ETH" }),
        record({ transactionId: "bgc", assetCode: "BGC" }),
      ],
      { assetCodes: ["dez"] },
    );
    expect(result.records).toEqual([
      expect.objectContaining({ transactionId: "tx-1", assetCode: "DEZ" }),
    ]);
  });

  it("uses OR within a filter dimension and AND between dimensions", () => {
    const result = filterEconomicLedger(
      [
        record(),
        record({
          transactionId: "horse",
          mode: "horse",
          category: "racing_expense",
        }),
        record({
          transactionId: "car",
          mode: "car",
          category: "racing_income",
        }),
      ],
      {
        modes: ["bike", "horse"],
        categories: ["racing_income"],
      },
    );
    expect(result.records.map(({ transactionId }) => transactionId)).toEqual([
      "tx-1",
    ]);
  });

  it("filters exact metre distances independently from inclusive bands", () => {
    const records = [
      record({ transactionId: "1200", distanceMetres: 1200 }),
      record({ transactionId: "1400", distanceMetres: 1400 }),
      record({ transactionId: "1600", distanceMetres: 1600 }),
      record({ transactionId: "1800", distanceMetres: 1800 }),
      record({ transactionId: "2000", distanceMetres: 2000 }),
    ];
    expect(
      filterEconomicLedger(records, {
        exactDistancesMetres: [1400],
      }).records.map(({ transactionId }) => transactionId),
    ).toEqual(["1400"]);
    expect(
      filterEconomicLedger(records, {
        distanceBands: ["middle"],
      }).records.map(({ transactionId }) => transactionId),
    ).toEqual(["1400", "1600", "1800"]);
  });

  it("preserves overlapping confirmed band boundaries", () => {
    const records = [
      record({ transactionId: "1400", distanceMetres: 1400 }),
      record({ transactionId: "1800", distanceMetres: 1800 }),
    ];
    expect(
      filterEconomicLedger(records, {
        distanceBands: ["sprint"],
      }).records.map(({ transactionId }) => transactionId),
    ).toEqual(["1400"]);
    expect(
      filterEconomicLedger(records, {
        distanceBands: ["marathon"],
      }).records.map(({ transactionId }) => transactionId),
    ).toEqual(["1800"]);
  });

  it("does not invent core attribution for vault-level payouts", () => {
    const records = [
      record(),
      record({
        transactionId: "vault-level",
        coreIds: [],
        subcategory: "manual_tournament_payout",
      }),
    ];
    const all = filterEconomicLedger(records);
    expect(all.unallocatedTransactionCount).toBe(1);
    expect(
      filterEconomicLedger(records, { coreIds: ["core-1"] }).records.map(
        ({ transactionId }) => transactionId,
      ),
    ).toEqual(["tx-1"]);
  });

  it("filters tournament and bracket without collapsing either dimension", () => {
    const result = filterEconomicLedger(
      [
        record(),
        record({ transactionId: "other-bracket", bracketId: "bracket-2" }),
        record({
          transactionId: "other-tournament",
          tournamentId: "tournament-2",
        }),
      ],
      {
        tournamentIds: ["tournament-1"],
        bracketIds: ["bracket-2"],
      },
    );
    expect(result.records.map(({ transactionId }) => transactionId)).toEqual([
      "other-bracket",
    ]);
  });

  it("includes excluded evidence only when explicitly requested", () => {
    const result = filterEconomicLedger(
      [
        record(),
        record({ transactionId: "excluded", aggregateStatus: "excluded" }),
      ],
      { includeExcluded: true },
    );
    expect(result.matchedTransactionCount).toBe(2);
    expect(result.excludedTransactionCount).toBe(1);
    expect(result.filterStatus).toBe("filtered");
  });

  it("fails closed on malformed records and runtime filter values", () => {
    expect(() =>
      filterEconomicLedger([record({ mode: "plane" as "bike" })]),
    ).toThrow("mode");
    expect(() => filterEconomicLedger([record({ distanceMetres: 0 })])).toThrow(
      "positive metres",
    );
    expect(() =>
      filterEconomicLedger([record()], {
        modes: ["plane" as "bike"],
      }),
    ).toThrow("supported modes");
    expect(() =>
      filterEconomicLedger([record()], {
        distanceBands: ["ultra" as "sprint"],
      }),
    ).toThrow("supported bands");
    expect(() =>
      filterEconomicLedger([record()], {
        exactDistancesMetres: [1400, 1400],
      }),
    ).toThrow("unique positive integers");
    expect(() =>
      filterEconomicLedger([record()], {
        periodStart: "2026-08-01T00:00:00Z",
        periodEnd: "2026-07-01T00:00:00Z",
      }),
    ).toThrow("must not be after");
  });
});
