import { describe, expect, it } from "vitest";

import {
  adaptDnaCoreAttachedAssets,
  adaptDnaCoreListingPrice,
  adaptDnaCoreOwner,
  adaptDnaCorePower,
  adaptDnaCoreRacingStats,
  adaptDnaCoreSplicingInfo,
  adaptDnaCoreStamina,
  DnaOpenLabAdapterError,
} from "@/lib/dna-open-lab-v1-adapters";
import type {
  DnaCoreAttachedAssets,
  DnaCoreListingPrice,
  DnaCoreOwner,
  DnaCorePower,
  DnaCoreRacingStats,
  DnaCoreSplicingInfo,
  DnaCoreStamina,
} from "@/lib/dna-open-lab-v1-client";

const OBSERVED_AT = "2026-08-28T05:00:00.000Z";

const racingStats: DnaCoreRacingStats = {
  hid: 42,
  hstats_bike: { starts: 8, wins: 2 },
  hstats_car: null,
  hstats_horse: ["provider", "shape"],
  ageing: { state: "active" },
  is_maiden: false,
  tourney_profits: null,
};

const power: DnaCorePower = {
  hid: 42,
  power: {
    bike: { power: 91.5, adjodds: "1.8", variance: 0.12, races_n: 8 },
    car: { power: null, adjodds: null, variance: null, races_n: 0 },
    horse: {
      power: { source: "opaque" },
      adjodds: [2.1],
      variance: { provider: 0.2 },
      races_n: 3,
    },
  },
  m_stats: { provider_total: 11 },
};

describe("DNA Open Lab supplemental Core current-state adapters", () => {
  it("preserves racing-stat source values without assigning undocumented semantics", () => {
    const adapted = adaptDnaCoreRacingStats({
      raw: racingStats,
      observedAt: OBSERVED_AT,
    });

    expect(adapted).toMatchObject({
      source: "dna_open_lab",
      sourceVersion: "v1",
      scope: "cores",
      endpoint: "cores.racing_stats",
      entityKey: "core:42",
      observedAt: OBSERVED_AT,
      canonical: {
        sourceType: "core_racing_stats_snapshot",
        sourceCoreId: "42",
        statsByMode: {
          bike: { starts: 8, wins: 2 },
          car: null,
          horse: ["provider", "shape"],
        },
        ageingSourceValue: { state: "active" },
        isMaiden: false,
        tournamentProfitsSourceValue: null,
      },
    });
    expect(adapted.rawEvidenceSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("keeps provider power, odds and variance opaque while validating mode race counts", () => {
    const adapted = adaptDnaCorePower({ raw: power, observedAt: OBSERVED_AT });

    expect(adapted.canonical).toEqual({
      sourceType: "core_power_snapshot",
      sourceCoreId: "42",
      byMode: {
        bike: {
          powerSourceValue: 91.5,
          adjustedOddsSourceValue: "1.8",
          varianceSourceValue: 0.12,
          raceCount: 8,
        },
        car: {
          powerSourceValue: null,
          adjustedOddsSourceValue: null,
          varianceSourceValue: null,
          raceCount: 0,
        },
        horse: {
          powerSourceValue: { source: "opaque" },
          adjustedOddsSourceValue: [2.1],
          varianceSourceValue: { provider: 0.2 },
          raceCount: 3,
        },
      },
      aggregateStatsSourceValue: { provider_total: 11 },
    });
    expect(adapted.canonical).not.toHaveProperty("winRate");
    expect(adapted.canonical).not.toHaveProperty("rankingScore");

    expect(() =>
      adaptDnaCorePower({
        raw: {
          ...power,
          power: {
            ...power.power,
            bike: { ...power.power.bike, races_n: -1 },
          },
        },
        observedAt: OBSERVED_AT,
      }),
    ).toThrowError("core.power.bike.raceCount must be a non-negative");
  });

  it("preserves absent listing fields instead of inferring a listing state", () => {
    const absent: DnaCoreListingPrice = { hid: 42 };
    const listed: DnaCoreListingPrice = {
      hid: 42,
      price: 12.5,
      token: "DEZ",
      expires_at: "2026-08-29T05:00:00Z",
    };

    expect(
      adaptDnaCoreListingPrice({ raw: absent, observedAt: OBSERVED_AT })
        .canonical,
    ).toEqual({
      sourceType: "core_listing_snapshot",
      sourceCoreId: "42",
    });
    expect(
      adaptDnaCoreListingPrice({ raw: listed, observedAt: OBSERVED_AT })
        .canonical,
    ).toEqual({
      sourceType: "core_listing_snapshot",
      sourceCoreId: "42",
      priceSourceValue: 12.5,
      paymentAssetSourceValue: "DEZ",
      expiresAt: "2026-08-29T05:00:00.000Z",
    });
  });

  it("adapts attached assets, owner and nullable stamina as timestamped current state", () => {
    const assets: DnaCoreAttachedAssets = {
      hid: 42,
      skino: { bike: 7, car: null, horse: { skin: "synthetic" } },
      trailsmap: { bike: [1, 2] },
    };
    const owner: DnaCoreOwner = { hid: 42, vault: "0xsynthetic" };
    const stamina: DnaCoreStamina = {
      hid: 42,
      stamina: {
        stamina: 4,
        max_stamina: 10,
        next_refill: null,
        last_event: "2026-08-28T04:59:00+00:00",
      },
      spstamina: null,
    };

    expect(
      adaptDnaCoreAttachedAssets({ raw: assets, observedAt: OBSERVED_AT })
        .canonical,
    ).toEqual({
      sourceType: "core_attached_assets_snapshot",
      sourceCoreId: "42",
      skinSourceValueByMode: {
        bike: 7,
        car: null,
        horse: { skin: "synthetic" },
      },
      trailsSourceValue: { bike: [1, 2] },
    });
    expect(
      adaptDnaCoreOwner({ raw: owner, observedAt: OBSERVED_AT }).canonical,
    ).toEqual({
      sourceType: "core_owner_snapshot",
      sourceCoreId: "42",
      vaultSourceValue: "0xsynthetic",
    });
    expect(
      adaptDnaCoreStamina({ raw: stamina, observedAt: OBSERVED_AT }).canonical,
    ).toEqual({
      sourceType: "core_stamina_snapshot",
      sourceCoreId: "42",
      current: 4,
      maximum: 10,
      nextRefillAt: null,
      lastEventAt: "2026-08-28T04:59:00.000Z",
      special: null,
    });
  });

  it("preserves special stamina and nullable splice context without interpreting it", () => {
    const stamina: DnaCoreStamina = {
      hid: 42,
      stamina: {
        stamina: 0,
        max_stamina: 10,
        next_refill: "2026-08-28T06:00:00Z",
        last_event: null,
      },
      spstamina: { giveid: "synthetic-give", stamina: 1, max_stamina: 2 },
    };
    const splicing: DnaCoreSplicingInfo = {
      hid: 42,
      parents: null,
      grand_parents: [{ hid: 1 }],
      challenge_credit: 0,
      splice_core: { available: false },
    };

    expect(
      adaptDnaCoreStamina({ raw: stamina, observedAt: OBSERVED_AT }).canonical
        .special,
    ).toEqual({
      sourceGiveId: "synthetic-give",
      current: 1,
      maximum: 2,
    });
    expect(
      adaptDnaCoreSplicingInfo({ raw: splicing, observedAt: OBSERVED_AT })
        .canonical,
    ).toEqual({
      sourceType: "core_splicing_snapshot",
      sourceCoreId: "42",
      parentsSourceValue: null,
      grandparentsSourceValue: [{ hid: 1 }],
      challengeCreditSourceValue: 0,
      spliceCoreSourceValue: { available: false },
    });
  });

  it("fails closed on malformed identity, timestamps and non-JSON provider values", () => {
    expect(() =>
      adaptDnaCoreOwner({
        raw: { hid: 0, vault: "0xsynthetic" },
        observedAt: OBSERVED_AT,
      }),
    ).toThrowError(DnaOpenLabAdapterError);

    expect(() =>
      adaptDnaCoreListingPrice({
        raw: {
          hid: 42,
          expires_at: "2026-08-29 05:00",
        },
        observedAt: OBSERVED_AT,
      }),
    ).toThrowError("core.listing.expiresAt must be a timezone-qualified");

    expect(() =>
      adaptDnaCorePower({
        raw: {
          ...power,
          m_stats: { invalid: undefined },
        },
        observedAt: OBSERVED_AT,
      }),
    ).toThrowError("core.power.aggregateStats.invalid contains a non-JSON");
  });
});
