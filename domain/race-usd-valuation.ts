import {
  multiplyExactDecimals,
  normalizeExactDecimal,
} from "@/domain/exact-decimal";
import type {
  RaceAsset,
  RaceEconomicTransaction,
} from "@/domain/race-economics";

export const DEZ_POLYGON_CONTRACT =
  "0xdc4F4eD9872571d5eC8986a502A0D88F3a175f1E" as const;

export const coinGeckoSeriesByAsset = {
  ETH: "coingecko:coin:ethereum",
  DEZ: `coingecko:polygon-pos:contract:${DEZ_POLYGON_CONTRACT.toLowerCase()}`,
} as const satisfies Readonly<Record<RaceAsset, string>>;

export const BGC_USD_REFERENCE_RATE = "1" as const;

const UTC_DATE = /^\\d{4}-\\d{2}-\\d{2}$/;

export function utcRateDate(eventAt: string): string {
  const parsed = new Date(eventAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("eventAt must be a valid timestamp.");
  }
  return parsed.toISOString().slice(0, 10);
}

export type DailyUsdRate = Readonly<{
  asset: RaceAsset;
  rateDate: string;
  usdPerAsset: string;
  provider: "coingecko" | "manual";
  seriesId: string;
  sourceAt: string;
  retrievedAt: string;
  status: "available" | "manual_override";
}>;

function instant(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`${field} must be a valid timestamp.`);
  }
  return parsed.toISOString();
}

export function validateDailyUsdRate(input: DailyUsdRate): DailyUsdRate {
  if (!UTC_DATE.test(input.rateDate)) {
    throw new TypeError("rateDate must use YYYY-MM-DD UTC form.");
  }

  const usdPerAsset = normalizeExactDecimal(input.usdPerAsset);
  if (usdPerAsset === "0" || usdPerAsset.startsWith("-")) {
    throw new RangeError("usdPerAsset must be greater than zero.");
  }

  const expectedSeries =
    input.provider === "coingecko"
      ? coinGeckoSeriesByAsset[input.asset]
      : input.seriesId.trim();
  if (!expectedSeries || input.seriesId !== expectedSeries) {
    throw new TypeError("seriesId does not match the selected provider asset.");
  }

  return {
    ...input,
    usdPerAsset,
    sourceAt: instant(input.sourceAt, "sourceAt"),
    retrievedAt: instant(input.retrievedAt, "retrievedAt"),
  };
}

export type ValuedRaceEconomicTransaction = RaceEconomicTransaction &
  Readonly<{
    rateDate: string;
    usdPerAsset: string;
    convertedUsdAmount: string;
    rateProvider: DailyUsdRate["provider"];
    rateSeriesId: string;
    valuationStatus: "available" | "manual_override";
  }>;

export function valueRaceEconomicTransactionUsd(
  transaction: RaceEconomicTransaction,
  occurredAt: string,
  rate: DailyUsdRate | null,
): ValuedRaceEconomicTransaction | null {
  if (rate === null) return null;

  const validated = validateDailyUsdRate(rate);
  const rateDate = utcRateDate(occurredAt);
  if (
    validated.asset !== transaction.asset ||
    validated.rateDate !== rateDate
  ) {
    throw new RangeError(
      "Daily USD rate does not match transaction asset/date.",
    );
  }

  return {
    ...transaction,
    rateDate,
    usdPerAsset: validated.usdPerAsset,
    convertedUsdAmount: multiplyExactDecimals(
      transaction.signedAmount,
      validated.usdPerAsset,
    ),
    rateProvider: validated.provider,
    rateSeriesId: validated.seriesId,
    valuationStatus: validated.status,
  };
}
