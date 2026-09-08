import { describe, expect, it, vi } from "vitest";

import type {
  DnaOpenLabServingSupplementalCore,
  DnaOpenLabSupplementalCoreReadRepository,
} from "@/lib/neon-dna-open-lab-sync-publication";
import { loadProLeagueCurrentCoreState } from "@/lib/pro-league-current-core-state-service";

const generationId = "22222222-2222-4222-8222-222222222222";
const observedAt = "2026-09-07T01:00:00.000Z";

function row(
  family: DnaOpenLabServingSupplementalCore["family"],
  canonical: DnaOpenLabServingSupplementalCore["canonical"],
): DnaOpenLabServingSupplementalCore {
  return {
    generationId,
    sourceCoreId: "101",
    family,
    observedAt,
    rawEvidenceSha256: "a".repeat(64),
    canonical,
  };
}

function rows(): readonly DnaOpenLabServingSupplementalCore[] {
  return [
    row("racing_stats", {
      sourceType: "core_racing_stats_snapshot",
      sourceCoreId: "101",
      statsByMode: { bike: { starts: 12 }, car: null, horse: null },
      ageingSourceValue: null,
      isMaiden: false,
      tournamentProfitsSourceValue: null,
    }),
    row("power", {
      sourceType: "core_power_snapshot",
      sourceCoreId: "101",
      byMode: {
        bike: {
          powerSourceValue: 82,
          adjustedOddsSourceValue: 1.9,
          varianceSourceValue: 0.11,
          raceCount: 12,
        },
        car: {
          powerSourceValue: null,
          adjustedOddsSourceValue: null,
          varianceSourceValue: null,
          raceCount: 0,
        },
        horse: {
          powerSourceValue: null,
          adjustedOddsSourceValue: null,
          varianceSourceValue: null,
          raceCount: 0,
        },
      },
      aggregateStatsSourceValue: null,
    }),
    row("listing", {
      sourceType: "core_listing_snapshot",
      sourceCoreId: "101",
      priceSourceValue: 25,
      paymentAssetSourceValue: "DEZ",
    }),
    row("attached_assets", {
      sourceType: "core_attached_assets_snapshot",
      sourceCoreId: "101",
      skinSourceValueByMode: { bike: { id: 1 }, car: null, horse: null },
      trailsSourceValue: null,
    }),
    row("owner", {
      sourceType: "core_owner_snapshot",
      sourceCoreId: "101",
      vaultSourceValue: "private-wallet-not-rendered",
    }),
    row("stamina", {
      sourceType: "core_stamina_snapshot",
      sourceCoreId: "101",
      current: 4,
      maximum: 10,
      nextRefillAt: null,
      lastEventAt: null,
      special: null,
    }),
    row("splicing", {
      sourceType: "core_splicing_snapshot",
      sourceCoreId: "101",
      parentsSourceValue: null,
      grandparentsSourceValue: null,
      challengeCreditSourceValue: 0,
      spliceCoreSourceValue: null,
    }),
  ];
}

function repository(
  values: readonly DnaOpenLabServingSupplementalCore[] = rows(),
): DnaOpenLabSupplementalCoreReadRepository {
  return {
    readServingSupplementalCores: vi.fn(async () => ({
      generationId,
      rows: values,
    })),
  };
}

describe("Pro League current Core state service", () => {
  it("keeps complete current API dimensions separate from ranking evidence", async () => {
    const result = await loadProLeagueCurrentCoreState({
      ownerId: "private_owner",
      selectedCores: [{ sourceCoreId: "101", displayName: "Silver Comet" }],
      repository: repository(),
      now: new Date("2026-09-08T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "connected",
      latestObservedAt: observedAt,
      dataCurrentThrough: observedAt,
      freshness: "current",
      cores: [
        {
          displayName: "Silver Comet",
          bikePower: {
            powerSourceValue: 82,
            adjustedOddsSourceValue: 1.9,
            varianceSourceValue: 0.11,
            raceCount: 12,
          },
          stamina: { current: 4, maximum: 10 },
          listing: { priceSourceValue: 25, paymentAssetSourceValue: "DEZ" },
          bikeSkinAttached: true,
          trailsAttached: false,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("private-wallet-not-rendered");
    expect(JSON.stringify(result)).not.toContain("101");
  });

  it("uses the oldest required observation for conservative freshness", async () => {
    const values = rows().map((value, index) =>
      index === 0
        ? { ...value, observedAt: "2026-08-30T00:00:00.000Z" }
        : value,
    );
    await expect(
      loadProLeagueCurrentCoreState({
        ownerId: "private_owner",
        selectedCores: [{ sourceCoreId: "101", displayName: "Silver Comet" }],
        repository: repository(values),
        now: new Date("2026-09-08T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      dataCurrentThrough: "2026-08-30T00:00:00.000Z",
      latestObservedAt: observedAt,
      freshness: "stale",
    });
  });

  it("fails closed when a selected Core is missing a current family", async () => {
    await expect(
      loadProLeagueCurrentCoreState({
        ownerId: "private_owner",
        selectedCores: [{ sourceCoreId: "101", displayName: "Silver Comet" }],
        repository: repository(rows().slice(0, -1)),
      }),
    ).rejects.toThrow("incomplete for Silver Comet");
  });

  it("distinguishes missing configuration from an absent active generation", async () => {
    await expect(
      loadProLeagueCurrentCoreState({
        ownerId: "private_owner",
        selectedCores: [],
        repository: null,
      }),
    ).resolves.toMatchObject({ status: "not_configured" });
    await expect(
      loadProLeagueCurrentCoreState({
        ownerId: "private_owner",
        selectedCores: [],
        repository: {
          readServingSupplementalCores: vi.fn(async () => ({
            generationId: null,
            rows: [],
          })),
        },
      }),
    ).resolves.toMatchObject({ status: "active_generation_unavailable" });
  });
});
