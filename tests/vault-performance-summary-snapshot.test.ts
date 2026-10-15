import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildVaultPerformanceSummary } from "@/domain/vault-performance-summary";
import {
  decodeVaultPerformanceSummarySnapshot,
  encodeVaultPerformanceSummarySnapshot,
  VAULT_PERFORMANCE_SNAPSHOT_MAX_BYTES,
} from "@/lib/vault-performance-summary-snapshot";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const sourceLedgerSha256 = "a".repeat(64);
const now = new Date("2026-10-15T00:00:00.000Z");
const materializedAt = now.toISOString();
const summary = buildVaultPerformanceSummary(
  [
    {
      transactionId: "synthetic-payout",
      assetCode: "DEZ",
      assetKind: "crypto",
      signedAmount: "9007199254740993.000000000000000001",
      category: "open_race_payout",
      operating: true,
    },
    {
      transactionId: "synthetic-fee",
      assetCode: "DEZ",
      assetKind: "crypto",
      signedAmount: "-0.000000000000000001",
      category: "open_race_entry_fee",
      operating: true,
    },
    {
      transactionId: "synthetic-transfer",
      assetCode: "ETH",
      assetKind: "crypto",
      signedAmount: "1.25",
      category: "internal_transfer",
      operating: false,
    },
    {
      transactionId: "synthetic-burn",
      assetCode: "BGC",
      assetKind: "game_credit",
      signedAmount: "8.5",
      category: "burn_bgc_credit",
      operating: true,
    },
    {
      transactionId: "synthetic-sale",
      assetCode: "DEZ",
      assetKind: "crypto",
      signedAmount: "2",
      category: "core_sale",
      operating: true,
    },
  ].map((row) => ({
    ...row,
    occurredAt: "2026-10-14T00:00:00.000Z",
    aggregateStatus: "included",
    classificationStatus: "confirmed",
    reconciliationStatus: "reconciled",
  })) as Parameters<typeof buildVaultPerformanceSummary>[0],
  {
    periodStart: "2026-10-01T00:00:00.000Z",
    periodEnd: "2026-10-31T23:59:59.000Z",
    sourceCoverage: "partial",
    manualTournamentPayoutStatus: "unknown",
    dataCurrentThrough: "2026-10-14T00:00:00.000Z",
    lastImported: "2026-10-14T01:00:00.000Z",
    freshnessState: "current",
  },
);

const encode = (value = summary) =>
  encodeVaultPerformanceSummarySnapshot({
    databaseOwnerId,
    sourceLedgerSha256,
    materializedAt,
    summary: value,
    now,
  });
const decode = (
  snapshot = encode(),
  overrides: Partial<
    Parameters<typeof decodeVaultPerformanceSummarySnapshot>[0]
  > = {},
) =>
  decodeVaultPerformanceSummarySnapshot({
    ...snapshot,
    databaseOwnerId,
    sourceLedgerSha256,
    now,
    ...overrides,
  });
function rehash(json: string) {
  return { json, sha256: createHash("sha256").update(json).digest("hex") };
}

describe("compact Vault Performance summary snapshots", () => {
  it("round-trips approved totals without floating-point conversion or new accounting", () => {
    const snapshot = encode();
    const result = decode(snapshot);
    expect(result).toEqual(summary);
    expect(
      result.cashCryptoTotals.find((t) => t.assetCode === "DEZ"),
    ).toMatchObject({
      openRacePayouts: "9007199254740993.000000000000000001",
      openRacingNet: "9007199254740993",
      realisedCoreTradingResult: null,
    });
    expect(
      result.cashCryptoTotals.find((t) => t.assetCode === "ETH"),
    ).toMatchObject({
      totalRecordedOperatingCashflow: "0",
      nonOperatingMovement: "1.25",
    });
    expect(result.bgcTotals[0]).toMatchObject({
      assetCode: "BGC",
      netBgcMovement: "8.5",
    });
    expect(result.status).toBe("partial");
    expect(result.warnings).toContain("CORE_SALE_COST_BASIS_MISSING");
    expect(result.combinedAssetTotalAvailable).toBe(false);
    expect(Buffer.byteLength(snapshot.json)).toBeLessThan(
      VAULT_PERFORMANCE_SNAPSHOT_MAX_BYTES,
    );
  });

  it("binds the expected owner and source ledger independently of the body checksum", () => {
    const snapshot = encode();
    expect(() =>
      decode(snapshot, {
        databaseOwnerId: "22222222-2222-4222-8222-222222222222",
      }),
    ).toThrow("Invalid Vault Performance summary snapshot.");
    expect(() =>
      decode(snapshot, { sourceLedgerSha256: "b".repeat(64) }),
    ).toThrow("Invalid Vault Performance summary snapshot.");
    expect(() =>
      decode({
        ...snapshot,
        json: snapshot.json.replace("9007199254740993", "9007199254740994"),
      }),
    ).toThrow();
  });

  it("uses deterministic field order while retaining the original asset order and exact amounts", () => {
    const reversed = Object.fromEntries(
      Object.entries(summary).reverse(),
    ) as typeof summary;
    expect(encode(reversed)).toEqual(encode());
    const snapshot = encode();
    expect(() =>
      decode(rehash(JSON.stringify(JSON.parse(snapshot.json), null, 2))),
    ).toThrow();
    expect(() =>
      decode(
        rehash(snapshot.json.replace('"version":1', '"version":1,"version":1')),
      ),
    ).toThrow();
  });

  it("re-derives freshness at read time without rewriting financial totals", () => {
    const result = decode(encode(), {
      now: new Date("2026-10-23T00:00:00.000Z"),
    });
    expect(result.freshnessState).toBe("stale");
    expect(result.warnings).toContain("IMPORTED_DATA_STALE");
    expect(result.cashCryptoTotals).toEqual(summary.cashCryptoTotals);
    expect(result.bgcTotals).toEqual(summary.bgcTotals);
  });

  it("keeps absent cutoff/import evidence unknown rather than inventing coverage", () => {
    const result = decode(
      encode({ ...summary, dataCurrentThrough: null, lastImported: null }),
    );
    expect(result).toMatchObject({
      dataCurrentThrough: null,
      lastImported: null,
      freshnessState: "unknown",
      status: "partial",
    });
    expect(result.warnings).toContain("DATA_CUTOFF_UNKNOWN");
    expect(result.warnings).toContain("IMPORTED_DATA_STALE");
  });

  it("rejects missing fields, null/numeric money, noncanonical decimals and unapproved private fields", () => {
    const first = summary.cashCryptoTotals[0]!;
    const { openRacingNet: _removed, ...incomplete } = first;
    void _removed;
    const cases = [
      { ...summary, cashCryptoTotals: [incomplete] },
      { ...summary, cashCryptoTotals: [{ ...first, openRacingNet: null }] },
      { ...summary, cashCryptoTotals: [{ ...first, openRacingNet: 1.25 }] },
      { ...summary, cashCryptoTotals: [{ ...first, openRacingNet: "1e2" }] },
      { ...summary, cashCryptoTotals: [{ ...first, openRacingNet: "01" }] },
      { ...summary, rawWalletPayload: "synthetic-private-evidence" },
      {
        ...summary,
        cashCryptoTotals: [
          { ...first, privateSourceRow: "synthetic-private-evidence" },
        ],
      },
      { ...summary, includedTransactionCount: "5" },
      { ...summary, warnings: null },
      { ...summary, cashCryptoTotals: null },
    ];
    for (const value of cases)
      expect(() => encode(value as typeof summary)).toThrow(
        "Invalid Vault Performance summary snapshot.",
      );
  });

  it("retains the existing asset, count, completeness and lifetime-claim safeguards", () => {
    for (const value of [
      {
        ...summary,
        cashCryptoTotals: [
          ...summary.cashCryptoTotals,
          summary.cashCryptoTotals[0]!,
        ],
      },
      { ...summary, bgcTotals: summary.cashCryptoTotals },
      {
        ...summary,
        includedTransactionCount: summary.includedTransactionCount + 1,
      },
      { ...summary, status: "complete_recorded_period" },
      { ...summary, lifetimeProfitClaimAllowed: true },
      { ...summary, combinedAssetTotalAvailable: true },
    ])
      expect(() => encode(value as typeof summary)).toThrow();
  });

  it("rejects future/invalid publication and import chronology and unsupported schemas", () => {
    const snapshot = encode();
    const body = JSON.parse(snapshot.json);
    for (const changes of [
      { version: 2 },
      { materializedAt: "2026-10-16T00:00:00.000Z" },
      { materializedAt: "2026-10-13T00:00:00.000Z" },
      { materializedAt: "2026-10-15" },
      { databaseOwnerId: "not-an-owner-id" },
      { sourceLedgerSha256: "unknown" },
      {
        summary: { ...summary, dataCurrentThrough: "2026-10-15T00:00:00.000Z" },
      },
      {
        summary: {
          ...summary,
          dataCurrentThrough: "2026-10-16T00:00:00.000Z",
          lastImported: null,
        },
      },
    ])
      expect(() =>
        decode(rehash(JSON.stringify({ ...body, ...changes }))),
      ).toThrow();
    expect(() => decode(snapshot, { now: new Date("invalid") })).toThrow();
  });

  it("rejects oversized stored bodies before parsing, never truncating financial evidence", () => {
    expect(() =>
      decode(rehash(" ".repeat(VAULT_PERFORMANCE_SNAPSHOT_MAX_BYTES + 1))),
    ).toThrow();
    const first = summary.cashCryptoTotals[0]!;
    expect(() =>
      encode({
        ...summary,
        cashCryptoTotals: [
          {
            ...first,
            openRacingNet: "1".repeat(VAULT_PERFORMANCE_SNAPSHOT_MAX_BYTES),
          },
          ...summary.cashCryptoTotals.slice(1),
        ],
      }),
    ).toThrow();
  });

  it("returns detached values and content-free errors for rejected evidence", () => {
    const snapshot = encode();
    const first = decode(snapshot);
    first.cashCryptoTotals[0]!.openRacingNet = "0";
    expect(decode(snapshot)).toEqual(summary);
    expect(() => decode(rehash("synthetic-private-evidence"))).toThrow(
      /^Invalid Vault Performance summary snapshot\.$/,
    );
    const accessor = { ...summary };
    Object.defineProperty(accessor, "periodStart", {
      enumerable: true,
      get() {
        throw new Error("synthetic-private-evidence");
      },
    });
    expect(() => encode(accessor)).toThrow(
      /^Invalid Vault Performance summary snapshot\.$/,
    );
  });
});
