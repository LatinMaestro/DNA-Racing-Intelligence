import { describe, expect, it } from "vitest";
import {
  multiplyExactDecimals,
  negateExactDecimal,
  normalizeExactDecimal,
  normalizeSourceExactDecimal,
} from "@/domain/exact-decimal";
import {
  deriveRaceEconomicTransactions,
  validateRaceEconomics,
} from "@/domain/race-economics";
import {
  BGC_USD_REFERENCE_RATE,
  coinGeckoSeriesByAsset,
  DEZ_POLYGON_CONTRACT,
  utcRateDate,
  validateDailyUsdRate,
  valueRaceEconomicTransactionUsd,
} from "@/domain/race-usd-valuation";
import { raceEntryNaturalKey } from "@/domain/import-contract";

describe("Phase 1 exact race economics", () => {
  it("normalizes owner-confirmed DEZ fee, prize, payout mechanism and tags", () => {
    const result = validateRaceEconomics({
      feeSourceValue: "2417.2105",
      prizeSourceValue: "7251.6315",
      assetSourceValue: "dez",
      payoutMechanismSourceValue: "top2",
      raceTagsSourceValue: "Water, ME",
    });

    expect(result).toMatchObject({
      status: "ready",
      asset: "DEZ",
      entryFee: "2417.2105",
      grossPayout: "7251.6315",
      payoutMechanismSourceValue: "top2",
      raceTagsSourceValue: "Water, ME",
      issueCodes: [],
    });
  });

  it("normalizes source scientific notation without widening plain decimals", () => {
    expect(normalizeSourceExactDecimal("1e-7")).toBe("0.0000001");
    expect(normalizeSourceExactDecimal("1.25E+2")).toBe("125");
    expect(normalizeSourceExactDecimal("-2.50e-3")).toBe("-0.0025");
    expect(
      multiplyExactDecimals(normalizeSourceExactDecimal("1e-7"), "2500"),
    ).toBe("0.00025");
    expect(() => normalizeExactDecimal("1e-7")).toThrow(TypeError);
    expect(() => normalizeSourceExactDecimal("1e10001")).toThrow(RangeError);
    expect(() => normalizeSourceExactDecimal("001e-2")).toThrow(TypeError);
  });

  it("derives exact ETH economics encoded in scientific notation", () => {
    const economics = validateRaceEconomics({
      feeSourceValue: "1e-7",
      prizeSourceValue: "2.5E-6",
      assetSourceValue: "eth",
    });

    expect(economics).toMatchObject({
      status: "ready",
      asset: "ETH",
      entryFee: "0.0000001",
      grossPayout: "0.0000025",
      issueCodes: [],
    });
    expect(
      deriveRaceEconomicTransactions(
        raceEntryNaturalKey("scientific-event", "synthetic-core"),
        economics,
      ).map(({ signedAmount }) => signedAmount),
    ).toEqual(["-0.0000001", "0.0000025"]);
  });

  it("derives one exact debit and credit with stable distinct keys", () => {
    const raceEntryKey = raceEntryNaturalKey("event-1", "core-1");
    const transactions = deriveRaceEconomicTransactions(
      raceEntryKey,
      validateRaceEconomics({
        feeSourceValue: "13.0719",
        prizeSourceValue: "10.457516",
        assetSourceValue: "DEZ",
        payoutMechanismSourceValue: "wta",
      }),
    );

    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({
      transactionType: "entry_fee",
      direction: "debit",
      signedAmount: "-13.0719",
    });
    expect(transactions[1]).toMatchObject({
      transactionType: "payout",
      direction: "credit",
      signedAmount: "10.457516",
    });
    expect(transactions[0]?.naturalKey).not.toBe(transactions[1]?.naturalKey);
  });

  it("does not create zero-value transactions", () => {
    expect(
      deriveRaceEconomicTransactions(
        raceEntryNaturalKey("free-event", "core-1"),
        validateRaceEconomics({
          feeSourceValue: "0.0",
          prizeSourceValue: "0.000",
          assetSourceValue: "ETH",
        }),
      ),
    ).toEqual([]);
  });

  it("keeps missing, invalid and unsupported economics out of the ledger", () => {
    const inputs = [
      validateRaceEconomics({}),
      validateRaceEconomics({
        feeSourceValue: "1",
        prizeSourceValue: "",
        assetSourceValue: "DEZ",
      }),
      validateRaceEconomics({
        feeSourceValue: "-1",
        prizeSourceValue: "2",
        assetSourceValue: "DEZ",
      }),
      validateRaceEconomics({
        feeSourceValue: "1",
        prizeSourceValue: "2",
        assetSourceValue: "SOL",
      }),
    ];

    expect(inputs.map(({ status }) => status)).toEqual([
      "missing",
      "missing",
      "invalid",
      "unsupported_asset",
    ]);
    for (const input of inputs) {
      expect(
        deriveRaceEconomicTransactions(
          raceEntryNaturalKey("event", "core"),
          input,
        ),
      ).toEqual([]);
    }
  });

  it("treats historical BGC races as performance-only free races", () => {
    const economics = validateRaceEconomics({
      feeSourceValue: "12.5",
      prizeSourceValue: "99",
      assetSourceValue: "bgc",
      payoutMechanismSourceValue: "synthetic-format",
    });

    expect(economics).toMatchObject({
      status: "historical_non_economic",
      asset: null,
      entryFee: "0",
      grossPayout: "0",
      feeSourceValue: "12.5",
      prizeSourceValue: "99",
      issueCodes: [],
    });
    expect(
      deriveRaceEconomicTransactions(
        raceEntryNaturalKey("bgc-event", "synthetic-core"),
        economics,
      ),
    ).toEqual([]);
  });

  it("does not review ignored historical BGC source amounts", () => {
    expect(
      validateRaceEconomics({
        feeSourceValue: "",
        prizeSourceValue: "legacy-value-not-used-economically",
        assetSourceValue: "BGC",
      }),
    ).toMatchObject({
      status: "historical_non_economic",
      entryFee: "0",
      grossPayout: "0",
      issueCodes: [],
    });
  });

  it("performs exact decimal operations without binary floating point", () => {
    expect(() => normalizeExactDecimal("001")).toThrow(TypeError);
    expect(normalizeExactDecimal("10.5000")).toBe("10.5");
    expect(negateExactDecimal("0.000")).toBe("0");
    expect(multiplyExactDecimals("13.0719", "0.0008")).toBe("0.01045752");
    expect(multiplyExactDecimals("-10.457516", "0.0008")).toBe("-0.0083660128");
  });
});

describe("Phase 1 UTC daily USD valuation", () => {
  const rate = validateDailyUsdRate({
    asset: "DEZ",
    rateDate: "2026-07-11",
    usdPerAsset: "0.0008",
    provider: "coingecko",
    seriesId: coinGeckoSeriesByAsset.DEZ,
    sourceAt: "2026-07-11T00:00:00Z",
    retrievedAt: "2026-07-23T01:00:00Z",
    status: "available",
  });

  it("pins the DEZ series to the confirmed Polygon contract", () => {
    expect(DEZ_POLYGON_CONTRACT).toBe(
      "0xdc4F4eD9872571d5eC8986a502A0D88F3a175f1E",
    );
    expect(coinGeckoSeriesByAsset.DEZ).toContain(
      DEZ_POLYGON_CONTRACT.toLowerCase(),
    );
    expect(coinGeckoSeriesByAsset.ETH).toBe("coingecko:coin:ethereum");
  });

  it("keys every race to its UTC calendar day", () => {
    expect(utcRateDate("2026-07-11T23:59:59-10:00")).toBe("2026-07-12");
  });

  it("values exact signed token amounts and retains rate provenance", () => {
    const [fee] = deriveRaceEconomicTransactions(
      raceEntryNaturalKey("event-2", "core-2"),
      validateRaceEconomics({
        feeSourceValue: "13.0719",
        prizeSourceValue: "0",
        assetSourceValue: "DEZ",
      }),
    );
    if (fee === undefined) throw new Error("Synthetic fee was not derived.");

    expect(
      valueRaceEconomicTransactionUsd(fee, "2026-07-11T16:53:00.167Z", rate),
    ).toMatchObject({
      convertedUsdAmount: "-0.01045752",
      rateDate: "2026-07-11",
      rateProvider: "coingecko",
      rateSeriesId: coinGeckoSeriesByAsset.DEZ,
    });
  });

  it("returns unavailable for a missing rate and rejects wrong date/asset", () => {
    const [fee] = deriveRaceEconomicTransactions(
      raceEntryNaturalKey("event-3", "core-3"),
      validateRaceEconomics({
        feeSourceValue: "1",
        prizeSourceValue: "0",
        assetSourceValue: "DEZ",
      }),
    );
    if (fee === undefined) throw new Error("Synthetic fee was not derived.");

    expect(
      valueRaceEconomicTransactionUsd(fee, "2026-07-11T01:00:00Z", null),
    ).toBeNull();
    expect(() =>
      valueRaceEconomicTransactionUsd(fee, "2026-07-12T01:00:00Z", rate),
    ).toThrow(RangeError);
  });

  it("keeps the owner-confirmed BGC reference separate", () => {
    expect(BGC_USD_REFERENCE_RATE).toBe("1");
  });
});
