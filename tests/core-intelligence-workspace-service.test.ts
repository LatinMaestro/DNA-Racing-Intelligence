import { describe, expect, it, vi } from "vitest";
import { buildCorePerformanceProfiles } from "@/domain/core-performance";
import { refreshStarProfiles } from "@/domain/star-signals";
import {
  loadCoreIntelligencePageState,
  unavailableCorePerformanceProfileRepository,
  type CorePerformanceProfileRepository,
} from "@/lib/core-intelligence-workspace-service";

const profile = buildCorePerformanceProfiles(
  [
    {
      eventId: "synthetic-event",
      eventAt: "2026-07-23T00:00:00.000Z",
      coreId: "synthetic-core",
      mode: "bike",
      distance: 1_000,
      elapsedTimeMilliseconds: 50_000,
    },
  ],
  [],
  new Date("2026-07-24T00:00:00.000Z"),
)[0]!;
const now = new Date("2026-07-24T00:00:00.000Z");
const profileWithStars = buildCorePerformanceProfiles(
  [
    {
      eventId: "synthetic-starred-event",
      eventAt: "2026-07-23T00:00:00.000Z",
      coreId: "synthetic-core",
      mode: "bike",
      distance: 1_000,
      elapsedTimeMilliseconds: 50_000,
    },
  ],
  refreshStarProfiles([
    {
      eventId: "synthetic-starred-event",
      eventAt: "2026-07-23T00:00:00.000Z",
      mode: "bike",
      distance: 1_000,
      gateCount: 6,
      entries: [
        {
          coreId: "synthetic-core",
          goldStar: true,
          blueStar: false,
          starDataStatus: "complete",
        },
        {
          coreId: "synthetic-opponent",
          goldStar: false,
          blueStar: true,
          starDataStatus: "complete",
        },
      ],
    },
  ]).profiles,
  now,
)[0]!;

describe("Core Intelligence workspace service", () => {
  it("returns an identity state before inspecting persistence", async () => {
    await expect(
      loadCoreIntelligencePageState({
        authenticatedOwnerId: null,
        configuredOwnerId: "owner",
        repository: unavailableCorePerformanceProfileRepository,
        now,
      }),
    ).resolves.toEqual({
      profiles: [],
      lastImportedAt: null,
      connectionStatus: "identity_not_connected",
      esportsProfiles: [],
      esportsLastSyncedAt: null,
      esportsConnectionStatus: "not_configured",
    });
  });

  it("denies a different owner before persistence", async () => {
    const listProfilesByOwner = vi.fn(async () => ({
      profiles: [profile],
      lastImportedAt: "2026-07-23T01:00:00.000Z",
    }));
    await expect(
      loadCoreIntelligencePageState({
        authenticatedOwnerId: "other-owner",
        configuredOwnerId: "owner",
        repository: { status: "ready", listProfilesByOwner },
        now,
      }),
    ).rejects.toThrow("access denied");
    expect(listProfilesByOwner).not.toHaveBeenCalled();
  });

  it("keeps a verified owner fail-closed until persistence is configured", async () => {
    await expect(
      loadCoreIntelligencePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: unavailableCorePerformanceProfileRepository,
        now,
      }),
    ).resolves.toEqual({
      profiles: [],
      lastImportedAt: null,
      connectionStatus: "persistence_not_configured",
      esportsProfiles: [],
      esportsLastSyncedAt: null,
      esportsConnectionStatus: "not_configured",
    });
  });

  it("loads only the verified owner's compact profile projection", async () => {
    const repository: CorePerformanceProfileRepository = {
      status: "ready",
      listProfilesByOwner: vi.fn(async (ownerId) => {
        expect(ownerId).toBe("owner");
        return {
          profiles: [{ ...profile, coreId: " synthetic-core " }],
          lastImportedAt: "2026-07-23T01:00:00.000Z",
        };
      }),
    };

    await expect(
      loadCoreIntelligencePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository,
        now,
      }),
    ).resolves.toEqual({
      profiles: [profile],
      lastImportedAt: "2026-07-23T01:00:00.000Z",
      connectionStatus: "read_model_connected",
      esportsProfiles: [],
      esportsLastSyncedAt: null,
      esportsConnectionStatus: "not_configured",
    });
  });

  it("loads completed Esports evidence through its separate API history lane", async () => {
    await expect(
      loadCoreIntelligencePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: unavailableCorePerformanceProfileRepository,
        esportsRepository: {
          status: "ready",
          listRaceObservationsByOwner: async (ownerId) => {
            expect(ownerId).toBe("owner");
            return {
              lastSyncedAt: "2026-07-23T02:00:00.000Z",
              observations: [
                {
                  sourceRaceId: "esports-race-1",
                  sourceCoreId: "synthetic-core",
                  status: "completed",
                  raceType: "6 gate madness",
                  distanceMetres: 1_000,
                  gateCount: 6,
                  completedAt: "2026-07-23T00:30:00.000Z",
                  finishPosition: 2,
                  elapsedTimeMilliseconds: null,
                  matchId: "match-1",
                  mapId: "map-1",
                  observedAt: "2026-07-23T01:00:00.000Z",
                  sourceAuthority: "dna-open-lab/esports-races",
                },
              ],
            };
          },
        },
        now,
      }),
    ).resolves.toMatchObject({
      connectionStatus: "persistence_not_configured",
      esportsConnectionStatus: "connected",
      esportsLastSyncedAt: "2026-07-23T02:00:00.000Z",
      esportsProfiles: [
        {
          sourceCoreId: "synthetic-core",
          competition: "pro_league_esports",
          raceType: "6 gate madness",
          raceCount: 1,
          successCount: 1,
          timedRaceCount: 0,
        },
      ],
    });
  });

  it("rejects Esports evidence that follows its durable sync cutoff", async () => {
    await expect(
      loadCoreIntelligencePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: unavailableCorePerformanceProfileRepository,
        esportsRepository: {
          status: "ready",
          listRaceObservationsByOwner: async () => ({
            lastSyncedAt: "2026-07-23T00:00:00.000Z",
            observations: [
              {
                sourceRaceId: "future-race",
                sourceCoreId: "synthetic-core",
                status: "scheduled",
                raceType: "1v1",
                distanceMetres: 1_000,
                gateCount: 2,
                completedAt: null,
                finishPosition: null,
                elapsedTimeMilliseconds: null,
                matchId: null,
                mapId: null,
                observedAt: "2026-07-23T00:30:00.000Z",
                sourceAuthority: "dna-open-lab/esports-races",
              },
            ],
          }),
        },
        now,
      }),
    ).rejects.toThrow(/cannot follow its sync timestamp/);
  });

  it("derives freshness at read time instead of trusting persistence", async () => {
    await expect(
      loadCoreIntelligencePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          listProfilesByOwner: async () => ({
            profiles: [{ ...profile, freshness: "stale" }],
            lastImportedAt: "2026-07-23T01:00:00.000Z",
          }),
        },
        now,
      }),
    ).resolves.toMatchObject({
      profiles: [{ freshness: "current" }],
    });
  });

  it("accepts a complete internally consistent nested star profile", async () => {
    await expect(
      loadCoreIntelligencePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          listProfilesByOwner: async () => ({
            profiles: [profileWithStars],
            lastImportedAt: "2026-07-23T01:00:00.000Z",
          }),
        },
        now,
      }),
    ).resolves.toMatchObject({
      profiles: [
        {
          starProfile: {
            goldReceivedRate: { numerator: 1, denominator: 1 },
            blueReceivedRate: { numerator: 0, denominator: 1 },
          },
        },
      ],
    });
  });

  it("rejects malformed, inconsistent or duplicate persisted projections", async () => {
    const malformed = {
      ...profile,
      raceCount: 10,
      sampleStatus: "hypothesis_only" as const,
    };
    const cases = [
      {
        profiles: [malformed],
        lastImportedAt: "2026-07-23T01:00:00.000Z",
      },
      {
        profiles: [profile, profile],
        lastImportedAt: "2026-07-23T01:00:00.000Z",
      },
      { profiles: [profile], lastImportedAt: "not-a-timestamp" },
      { profiles: {}, lastImportedAt: null },
      {
        profiles: [
          {
            ...profile,
            speed: {
              ...profile.speed,
              bestMetresPerSecond: profile.speed.bestMetresPerSecond + 1,
            },
          },
        ],
        lastImportedAt: "2026-07-23T01:00:00.000Z",
      },
      {
        profiles: [
          {
            ...profile,
            starProfile: { coreId: "synthetic-core" } as never,
          },
        ],
        lastImportedAt: "2026-07-23T01:00:00.000Z",
      },
    ];

    for (const projection of cases) {
      await expect(
        loadCoreIntelligencePageState({
          authenticatedOwnerId: "owner",
          configuredOwnerId: "owner",
          repository: {
            status: "ready",
            listProfilesByOwner: async () => projection as never,
          },
          now,
        }),
      ).rejects.toThrow(/Invalid|Duplicate/);
    }
  });

  it("rejects invalid time and repository capabilities", async () => {
    await expect(
      loadCoreIntelligencePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: unavailableCorePerformanceProfileRepository,
        now: "today" as never,
      }),
    ).rejects.toThrow("now must be valid");
    await expect(
      loadCoreIntelligencePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: { status: "unexpected" } as never,
        now,
      }),
    ).rejects.toThrow("repository");
  });
});
