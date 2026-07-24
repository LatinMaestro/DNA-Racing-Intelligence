import { describe, expect, it, vi } from "vitest";
import { buildCorePerformanceProfiles } from "@/domain/core-performance";
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

describe("Core Intelligence workspace service", () => {
  it("returns an identity state before inspecting persistence", async () => {
    await expect(
      loadCoreIntelligencePageState({
        authenticatedOwnerId: null,
        configuredOwnerId: "owner",
        repository: unavailableCorePerformanceProfileRepository,
      }),
    ).resolves.toEqual({
      profiles: [],
      lastImportedAt: null,
      connectionStatus: "identity_not_connected",
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
      }),
    ).resolves.toEqual({
      profiles: [],
      lastImportedAt: null,
      connectionStatus: "persistence_not_configured",
    });
  });

  it("loads only the verified owner's compact profile projection", async () => {
    const repository: CorePerformanceProfileRepository = {
      status: "ready",
      listProfilesByOwner: vi.fn(async (ownerId) => {
        expect(ownerId).toBe("owner");
        return {
          profiles: [profile],
          lastImportedAt: "2026-07-23T01:00:00.000Z",
        };
      }),
    };

    await expect(
      loadCoreIntelligencePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository,
      }),
    ).resolves.toEqual({
      profiles: [profile],
      lastImportedAt: "2026-07-23T01:00:00.000Z",
      connectionStatus: "read_model_connected",
    });
  });

  it("rejects malformed or duplicate persisted projections", async () => {
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
    ];

    for (const projection of cases) {
      await expect(
        loadCoreIntelligencePageState({
          authenticatedOwnerId: "owner",
          configuredOwnerId: "owner",
          repository: {
            status: "ready",
            listProfilesByOwner: async () => projection,
          },
        }),
      ).rejects.toThrow(/Invalid|Duplicate/);
    }
  });
});
