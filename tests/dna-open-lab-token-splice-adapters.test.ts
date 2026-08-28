import { describe, expect, it } from "vitest";

import {
  adaptDnaSpliceArenaPage,
  adaptDnaSplicePairInfo,
  adaptDnaTokenPrices,
  DnaOpenLabAdapterError,
} from "@/lib/dna-open-lab-v1-adapters";
import type {
  DnaSpliceArenaResult,
  DnaSplicePairInfo,
  DnaTokenPrices,
} from "@/lib/dna-open-lab-v1-client";

const OBSERVED_AT = "2026-08-28T07:00:00Z";

const tokenPrices: DnaTokenPrices = {
  ethusd: 3200,
  btcusd: 95_000,
  dezusd: 0.12,
  hlxusd: 0,
  bgcusd: 1.5,
  tpusd: 0.25,
  methusd: 32,
  mbtcusd: 950,
};

const arenaPage: DnaSpliceArenaResult = {
  cores: [
    {
      hid: 31,
      name: "Synthetic Core",
      type: "Pacer",
      gender: "Female",
      element: "Water",
      color: "Blue",
      hex_code: "#0000ff",
      fno: 2,
      price_usd: 12.5,
    },
  ],
  has_more: true,
  limit: 20,
  page: 1,
};

describe("DNA Open Lab Token and Splice adapters", () => {
  it("marks token prices as current reference values, never historical rates", () => {
    const adapted = adaptDnaTokenPrices({
      raw: tokenPrices,
      observedAt: OBSERVED_AT,
    });

    expect(adapted).toMatchObject({
      scope: "tokens",
      endpoint: "tokens.prices",
      entityKey: "token-prices:current",
      observedAt: "2026-08-28T07:00:00.000Z",
      canonical: {
        sourceType: "token_prices_snapshot",
        valuationUse: "current_reference_only",
        usdReferencePriceByAsset: {
          ETH: 3200,
          BTC: 95_000,
          DEZ: 0.12,
          HLX: 0,
          BGC: 1.5,
          TP: 0.25,
          METH: 32,
          MBTC: 950,
        },
      },
    });
    expect(adapted.canonical).not.toHaveProperty("historicalPrice");
  });

  it("retains Arena request mode, pagination and provider listing values", () => {
    const adapted = adaptDnaSpliceArenaPage({
      raw: arenaPage,
      mode: "bike",
      observedAt: OBSERVED_AT,
    });

    expect(adapted).toMatchObject({
      scope: "splice",
      endpoint: "splice.arena",
      entityKey: "splice-arena:bike:page:1",
      canonical: {
        sourceType: "splice_arena_page_snapshot",
        mode: "bike",
        page: 1,
        pageSizeLimit: 20,
        hasMore: true,
        listings: [
          {
            sourceCoreId: "31",
            displayName: "Synthetic Core",
            coreTypeSourceValue: "Pacer",
            genderSourceValue: "Female",
            elementSourceValue: "Water",
            colorSourceValue: "Blue",
            hexColorSourceValue: "#0000ff",
            fNumber: 2,
            priceUsdSourceValue: 12.5,
          },
        ],
      },
    });
    expect(adapted.canonical.listings[0]).not.toHaveProperty("breedingIncome");
    expect(adapted.canonical.listings[0]).not.toHaveProperty("eligible");
  });

  it("preserves pair-info provider objects and nullable pricing without asserting validity", () => {
    const raw: DnaSplicePairInfo = {
      f: { source_gender: "male", provider_flag: false },
      m: { source_gender: "female", cycles: 0 },
      baby_info: { element: "Fire", fno: 3, type: "Synthetic" },
      prices: null,
    };
    const adapted = adaptDnaSplicePairInfo({
      raw,
      fatherCoreId: 11,
      motherCoreId: 22,
      observedAt: OBSERVED_AT,
    });

    expect(adapted).toMatchObject({
      scope: "splice",
      endpoint: "splice.pair_info",
      entityKey: "splice-pair:11:22",
      canonical: {
        sourceType: "splice_pair_info_snapshot",
        fatherSourceCoreId: "11",
        motherSourceCoreId: "22",
        fatherSourceValue: {
          provider_flag: false,
          source_gender: "male",
        },
        motherSourceValue: { cycles: 0, source_gender: "female" },
        baby: {
          elementSourceValue: "Fire",
          fNumber: 3,
          typeSourceValue: "Synthetic",
        },
        pricesSourceValue: null,
      },
    });
    expect(adapted.canonical).not.toHaveProperty("valid");
    expect(adapted.canonical).not.toHaveProperty("eligible");
  });

  it("fails closed on malformed prices, pagination and pair identity", () => {
    expect(() =>
      adaptDnaTokenPrices({
        raw: { ...tokenPrices, ethusd: Number.NaN },
        observedAt: OBSERVED_AT,
      }),
    ).toThrowError(DnaOpenLabAdapterError);

    expect(() =>
      adaptDnaSpliceArenaPage({
        raw: { ...arenaPage, limit: 0 },
        mode: "bike",
        observedAt: OBSERVED_AT,
      }),
    ).toThrowError("spliceArena.pageSizeLimit must be a positive");

    expect(() =>
      adaptDnaSpliceArenaPage({
        raw: {
          ...arenaPage,
          cores: [arenaPage.cores[0]!, arenaPage.cores[0]!],
        },
        mode: "bike",
        observedAt: OBSERVED_AT,
      }),
    ).toThrowError("duplicate Core IDs");

    expect(() =>
      adaptDnaSplicePairInfo({
        raw: {
          f: {},
          m: {},
          baby_info: { element: "Fire", fno: 2, type: "Synthetic" },
          prices: {},
        },
        fatherCoreId: 11,
        motherCoreId: 11,
        observedAt: OBSERVED_AT,
      }),
    ).toThrowError("parents must be distinct");
  });
});
