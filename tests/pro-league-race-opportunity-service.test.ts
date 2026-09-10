import { describe, expect, it, vi } from "vitest";

import type { DnaOpenLabCurrentRaceReadRepository } from "@/lib/neon-dna-open-lab-sync-publication";
import type { CanonicalActiveRaceSnapshot } from "@/lib/dna-open-lab-v1-adapters";
import { loadProLeagueRaceOpportunities } from "@/lib/pro-league-race-opportunity-service";

const ownerId = "private_owner";
const generationId = "83000000-0000-4000-8000-000000000001";

function race(input: {
  id: string;
  mode?: "bike" | "car" | "horse";
  status?: string;
  gateCount: number;
  filledGateCount: number;
}) {
  const observedAt = "2026-09-07T20:00:00.000Z";
  const canonical: CanonicalActiveRaceSnapshot = {
    sourceType: "active_race_snapshot",
    sourceRaceId: input.id,
    status: input.status ?? "filling",
    displayName: `Race ${input.id}`,
    mode: input.mode ?? "bike",
    format: "normal",
    raceClassSourceValue: 3,
    fixedFeesByAsset: { DEZ: 0.25 },
    entryFeeUsd: 2.5,
    paymentAsset: "DEZ",
    startAt: null,
    endAt: null,
  };
  return {
    active: {
      sourceRaceId: input.id,
      observedAt,
      rawEvidenceSha256: "a".repeat(64),
      canonical,
    },
    fill: {
      sourceRaceId: input.id,
      observedAt,
      rawEvidenceSha256: "b".repeat(64),
      canonical: {
        sourceType: "race_fill_snapshot" as const,
        sourceRaceId: input.id,
        status: input.status ?? "filling",
        gateCount: input.gateCount,
        filledGateCount: input.filledGateCount,
        entrantCoreIds: Array.from(
          { length: input.filledGateCount },
          (_, index) => `entrant-${input.id}-${index}`,
        ),
        entryConfirmationsBySourceKey: {},
      },
    },
  };
}

function repository(
  values: readonly ReturnType<typeof race>[],
): DnaOpenLabCurrentRaceReadRepository {
  return {
    readServingCurrentRaces: vi.fn(async () => ({
      generationId,
      activeRaces: values.map(({ active }) => active),
      raceFills: values.map(({ fill }) => fill),
    })),
  };
}

describe("Pro League race opportunity service", () => {
  it("shows only filling Bike races at least half full with an open gate", async () => {
    const values = [
      race({ id: "qualifying-odd", gateCount: 5, filledGateCount: 3 }),
      race({ id: "qualifying-even", gateCount: 6, filledGateCount: 3 }),
      race({ id: "below-half", gateCount: 6, filledGateCount: 2 }),
      race({ id: "full", gateCount: 4, filledGateCount: 4 }),
      race({
        id: "closed",
        status: "closed",
        gateCount: 4,
        filledGateCount: 2,
      }),
      race({ id: "car", mode: "car", gateCount: 4, filledGateCount: 2 }),
    ];
    const result = await loadProLeagueRaceOpportunities({
      ownerId,
      priorityGapCount: 4,
      repository: repository(values),
      now: new Date("2026-09-08T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "connected",
      scannedRaceCount: 6,
      qualifyingRaceCount: 2,
      priorityGapCount: 4,
      observedAt: "2026-09-07T20:00:00.000Z",
      freshness: "current",
      exactGapMatchingAvailable: false,
      directRaceLinkAvailable: false,
      raceEntryAllowed: false,
    });
    expect(
      result.opportunities.map(({ sourceRaceId }) => sourceRaceId),
    ).toEqual(["qualifying-odd", "qualifying-even"]);
    expect(result.opportunities[0]).toMatchObject({
      availableGateCount: 2,
      fillPercentage: 60,
      gapMatchStatus: "exact_type_and_distance_unavailable",
    });
  });

  it("labels an old last-good race snapshot as stale", async () => {
    const value = race({ id: "old-race", gateCount: 4, filledGateCount: 2 });
    const old = {
      active: { ...value.active, observedAt: "2026-08-30T00:00:00.000Z" },
      fill: { ...value.fill, observedAt: "2026-08-30T00:00:00.000Z" },
    };
    await expect(
      loadProLeagueRaceOpportunities({
        ownerId,
        priorityGapCount: 1,
        repository: repository([old]),
        now: new Date("2026-09-08T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ freshness: "stale" });
  });

  it("withholds a fee-dependent opportunity when fixed-fee evidence is unavailable", async () => {
    const value = race({ id: "fee-unknown", gateCount: 4, filledGateCount: 2 });
    const { fixedFeesByAsset, ...withoutFixedFees } = value.active.canonical;
    expect(fixedFeesByAsset).toEqual({ DEZ: 0.25 });

    const result = await loadProLeagueRaceOpportunities({
      ownerId,
      priorityGapCount: 1,
      repository: repository([
        {
          ...value,
          active: {
            ...value.active,
            canonical: {
              ...withoutFixedFees,
              fixedFeesEvidenceStatus: "unsupported_source_value" as const,
            },
          },
        },
      ]),
      now: new Date("2026-09-08T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      scannedRaceCount: 1,
      qualifyingRaceCount: 0,
      opportunities: [],
    });
  });

  it.each(["entryFeeUsd", "paymentAsset"] as const)(
    "withholds a fee-dependent opportunity when %s evidence is unavailable",
    async (field) => {
      const value = race({
        id: `unknown-${field}`,
        gateCount: 4,
        filledGateCount: 2,
      });
      const canonical = { ...value.active.canonical };
      delete canonical[field];

      const result = await loadProLeagueRaceOpportunities({
        ownerId,
        priorityGapCount: 1,
        repository: repository([
          { ...value, active: { ...value.active, canonical } },
        ]),
        now: new Date("2026-09-08T00:00:00.000Z"),
      });

      expect(result).toMatchObject({
        scannedRaceCount: 1,
        qualifyingRaceCount: 0,
        opportunities: [],
      });
    },
  );

  it("reports absent configuration and absent last-good generation explicitly", async () => {
    await expect(
      loadProLeagueRaceOpportunities({
        ownerId,
        priorityGapCount: 1,
        repository: null,
      }),
    ).resolves.toMatchObject({
      status: "not_configured",
      opportunities: [],
    });
    await expect(
      loadProLeagueRaceOpportunities({
        ownerId,
        priorityGapCount: 1,
        repository: {
          readServingCurrentRaces: vi.fn(async () => ({
            generationId: null,
            activeRaces: [],
            raceFills: [],
          })),
        },
      }),
    ).resolves.toMatchObject({
      status: "active_generation_unavailable",
      opportunities: [],
    });
  });

  it("fails closed on missing fill coverage or invalid entrant counts", async () => {
    const first = race({ id: "race-1", gateCount: 4, filledGateCount: 2 });
    await expect(
      loadProLeagueRaceOpportunities({
        ownerId,
        priorityGapCount: 1,
        repository: {
          readServingCurrentRaces: vi.fn(async () => ({
            generationId,
            activeRaces: [first.active],
            raceFills: [],
          })),
        },
      }),
    ).rejects.toThrow("coverage is invalid");

    const invalid = {
      ...first.fill,
      canonical: { ...first.fill.canonical, entrantCoreIds: [] },
    };
    await expect(
      loadProLeagueRaceOpportunities({
        ownerId,
        priorityGapCount: 1,
        repository: {
          readServingCurrentRaces: vi.fn(async () => ({
            generationId,
            activeRaces: [first.active],
            raceFills: [invalid],
          })),
        },
      }),
    ).rejects.toThrow("fill authority is invalid");
  });
});
