import { describe, expect, it, vi } from "vitest";
import { loadProLeaguePlanPersistenceState } from "@/lib/pro-league-plan-persistence-service";
import type { ProLeagueDraftCommissioningState } from "@/lib/pro-league-draft-commissioning-service";

const roster = { rosterVersionId: "draft-roster/generation-1" };
const lineup = {
  lineupVersionId: "draft-lineup/generation-1",
  rosterVersionId: roster.rosterVersionId,
  maps: Array.from({ length: 4 }, () => ({
    entries: Array.from({ length: 42 }, () => ({})),
  })),
};
const commissioning = {
  connectionStatus: "read_model_connected",
  evidence: { generationId: "generation-1" },
  roster: { draftRoster: roster },
  lineup: { lineup },
  ownerPlan: {
    planId: "owner-final-roster/full-gate-win-first/2026-09-20",
    roster: Array.from({ length: 25 }, (_, index) => ({
      coreId: `core-${index + 1}`,
    })),
    allSlotsFilled: true,
    requiredCoreEntries: 1_021,
    assignedCoreEntries: 1_021,
  },
} as unknown as ProLeagueDraftCommissioningState;
const base = {
  authenticatedOwnerId: "owner-1",
  configuredOwnerId: "owner-1",
  commissioning,
};

describe("Pro League owner roster persistence state", () => {
  it("keeps owner identity and repository availability explicit", async () => {
    await expect(
      loadProLeaguePlanPersistenceState({
        ...base,
        authenticatedOwnerId: null,
        rosterRepository: null,
        lineupRepository: null,
      }),
    ).resolves.toMatchObject({ status: "identity_not_connected" });
    await expect(
      loadProLeaguePlanPersistenceState({
        ...base,
        rosterRepository: null,
        lineupRepository: null,
      }),
    ).resolves.toMatchObject({
      status: "persistence_not_configured",
      generationId: "generation-1",
      rosterVersionId: roster.rosterVersionId,
      lineupVersionId: lineup.lineupVersionId,
    });
  });

  it("distinguishes an unsaved roster from the exact immutable version", async () => {
    const loadVersion = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        version: roster,
        createdAt: "2026-10-20T00:00:00.000Z",
      });
    const loadLineup = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        version: lineup,
        createdAt: "2026-10-20T00:01:00.000Z",
      });
    const loadFullGatePlan = vi.fn(async () => null);
    await expect(
      loadProLeaguePlanPersistenceState({
        ...base,
        rosterRepository: { loadVersion },
        lineupRepository: { loadLineup, loadFullGatePlan },
      }),
    ).resolves.toMatchObject({
      status: "not_saved",
      persistedAssignmentCount: 0,
      requiredAssignmentCount: 1_021,
    });
    await expect(
      loadProLeaguePlanPersistenceState({
        ...base,
        rosterRepository: { loadVersion },
        lineupRepository: { loadLineup, loadFullGatePlan },
      }),
    ).resolves.toMatchObject({
      status: "lead_only_saved",
      rosterSavedAt: "2026-10-20T00:00:00.000Z",
      lineupSavedAt: "2026-10-20T00:01:00.000Z",
      persistedAssignmentCount: 168,
      requiredAssignmentCount: 1_021,
    });
  });

  it("accepts saved status only when every required gate assignment is persisted", async () => {
    await expect(
      loadProLeaguePlanPersistenceState({
        ...base,
        rosterRepository: {
          loadVersion: vi.fn(async () => ({
            version: roster,
            createdAt: "2026-10-20T00:00:00.000Z",
          })),
        },
        lineupRepository: {
          loadLineup: vi.fn(async () => ({
            version: lineup,
            createdAt: "2026-10-20T00:01:00.000Z",
          })),
          loadFullGatePlan: vi.fn(async () => ({
            lineupVersionId: lineup.lineupVersionId,
            rosterVersionId: roster.rosterVersionId,
            planId: "owner-final-roster/full-gate-win-first/2026-09-20",
            assignments: Array.from({ length: 1_021 }, () => ({})),
            createdAt: "2026-10-20T00:02:00.000Z",
          })),
        },
      }),
    ).resolves.toMatchObject({
      status: "saved",
      persistedAssignmentCount: 1_021,
      lineupSavedAt: "2026-10-20T00:02:00.000Z",
    });
  });

  it("withholds failed or mismatched stored roster reads", async () => {
    await expect(
      loadProLeaguePlanPersistenceState({
        ...base,
        rosterRepository: {
          loadVersion: vi.fn(async () => ({
            version: { rosterVersionId: "different-roster" },
            createdAt: "2026-10-20T00:00:00.000Z",
          })),
        },
        lineupRepository: {
          loadLineup: vi.fn(async () => ({
            version: lineup,
            createdAt: "2026-10-20T00:01:00.000Z",
          })),
          loadFullGatePlan: vi.fn(async () => null),
        },
      }),
    ).resolves.toMatchObject({
      status: "read_failed",
      failureStage: "integrity",
    });
    await expect(
      loadProLeaguePlanPersistenceState({
        ...base,
        rosterRepository: {
          loadVersion: vi.fn(async () => {
            throw new Error("private database detail");
          }),
        },
        lineupRepository: {
          loadLineup: vi.fn(async () => ({
            version: lineup,
            createdAt: "2026-10-20T00:01:00.000Z",
          })),
          loadFullGatePlan: vi.fn(async () => null),
        },
      }),
    ).resolves.toMatchObject({
      status: "read_failed",
      failureStage: "roster_read",
    });
  });

  it("identifies a failed lineup read without exposing its error", async () => {
    await expect(
      loadProLeaguePlanPersistenceState({
        ...base,
        rosterRepository: {
          loadVersion: vi.fn(async () => ({
            version: roster,
            createdAt: "2026-10-20T00:00:00.000Z",
          })),
        },
        lineupRepository: {
          loadLineup: vi.fn(async () => {
            throw new Error("private database detail");
          }),
          loadFullGatePlan: vi.fn(async () => null),
        },
      }),
    ).resolves.toMatchObject({
      status: "read_failed",
      failureStage: "lineup_read",
    });
  });
});
