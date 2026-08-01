import { describe, expect, it, vi } from "vitest";
import {
  deriveLifecycleFreshness,
  loadLifecycleWorkspacePageState,
  unavailableLifecycleRankingRepository,
} from "@/lib/lifecycle-workspace-service";
import { ranking } from "./lifecycle-fixture";

const now = new Date("2026-07-30T00:00:00.000Z");

function repository(
  evidence = ranking(),
  latestAcceptedImportAt: string | null = "2026-07-28T00:00:00.000Z",
) {
  return {
    status: "ready" as const,
    loadRankingEvidenceByOwner: async () => ({
      ranking: evidence,
      latestAcceptedImportAt,
    }),
  };
}

describe("Lifecycle workspace service", () => {
  it("returns disconnected states without reading persistence", async () => {
    await expect(
      loadLifecycleWorkspacePageState({
        authenticatedOwnerId: null,
        configuredOwnerId: "owner",
        repository: unavailableLifecycleRankingRepository,
        now,
      }),
    ).resolves.toEqual({
      ranking: null,
      connectionStatus: "identity_not_connected",
    });
    await expect(
      loadLifecycleWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: unavailableLifecycleRankingRepository,
        now,
      }),
    ).resolves.toEqual({
      ranking: null,
      connectionStatus: "persistence_not_configured",
    });
  });

  it("denies a different owner before persistence", async () => {
    const loadRankingEvidenceByOwner = vi.fn(async () => ({
      ranking: ranking(),
      latestAcceptedImportAt: "2026-07-28T00:00:00.000Z",
    }));
    await expect(
      loadLifecycleWorkspacePageState({
        authenticatedOwnerId: "other-owner",
        configuredOwnerId: "owner",
        repository: { status: "ready", loadRankingEvidenceByOwner },
        now,
      }),
    ).rejects.toThrow("access denied");
    expect(loadRankingEvidenceByOwner).not.toHaveBeenCalled();
  });

  it.each([
    [3, "current"],
    [4, "ageing"],
    [7, "ageing"],
    [8, "stale"],
  ] as const)("derives the %s-day boundary as %s", async (days, expected) => {
    const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
    expect(deriveLifecycleFreshness(cutoff, now)).toBe(expected);
    const evidence = ranking({
      dataCurrentThrough: cutoff,
      freshness: expected,
    });
    await expect(
      loadLifecycleWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: repository(evidence),
        now,
      }),
    ).resolves.toMatchObject({ ranking: { freshness: expected } });
  });

  it("defers rankings when no accepted import exists", async () => {
    await expect(
      loadLifecycleWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: repository(ranking(), null),
        now,
      }),
    ).resolves.toEqual({
      ranking: null,
      connectionStatus: "read_model_connected",
    });
  });

  it("rejects future, post-import, stale-label and import-binding inconsistencies", async () => {
    const cases = [
      repository(ranking(), "2026-07-31T00:00:00.000Z"),
      repository(ranking({ evaluatedAt: "2026-07-31T00:00:00.000Z" })),
      repository(ranking({ dataCurrentThrough: "2026-07-29T00:00:00.000Z" })),
      repository(ranking({ freshness: "stale" })),
      repository(ranking(), "2026-07-29T00:00:00.000Z"),
    ];
    for (const item of cases) {
      await expect(
        loadLifecycleWorkspacePageState({
          authenticatedOwnerId: "owner",
          configuredOwnerId: "owner",
          repository: item,
          now,
        }),
      ).rejects.toThrow();
    }
  });

  it("rejects malformed repositories, payloads and server time", async () => {
    await expect(
      loadLifecycleWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: { status: "unsupported" } as never,
        now,
      }),
    ).rejects.toThrow("repository status");
    await expect(
      loadLifecycleWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          loadRankingEvidenceByOwner: async () => null as never,
        },
        now,
      }),
    ).rejects.toThrow("evidence is invalid");
    await expect(
      loadLifecycleWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: repository(),
        now: new Date("invalid"),
      }),
    ).rejects.toThrow("server time");
  });
});
