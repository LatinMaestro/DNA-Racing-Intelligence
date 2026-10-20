import { describe, expect, it, vi } from "vitest";
import { loadProLeaguePlanPersistenceState } from "@/lib/pro-league-plan-persistence-service";
import type { ProLeagueDraftCommissioningState } from "@/lib/pro-league-draft-commissioning-service";

const roster = { rosterVersionId: "draft-roster/generation-1" };
const commissioning = {
  connectionStatus: "read_model_connected",
  evidence: { generationId: "generation-1" },
  roster: { draftRoster: roster },
  ownerPlan: {
    roster: Array.from({ length: 25 }, (_, index) => ({
      coreId: `core-${index + 1}`,
    })),
    allSlotsFilled: true,
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
      }),
    ).resolves.toMatchObject({ status: "identity_not_connected" });
    await expect(
      loadProLeaguePlanPersistenceState({
        ...base,
        rosterRepository: null,
      }),
    ).resolves.toMatchObject({
      status: "persistence_not_configured",
      generationId: "generation-1",
      rosterVersionId: roster.rosterVersionId,
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
    await expect(
      loadProLeaguePlanPersistenceState({
        ...base,
        rosterRepository: { loadVersion },
      }),
    ).resolves.toMatchObject({ status: "not_saved" });
    await expect(
      loadProLeaguePlanPersistenceState({
        ...base,
        rosterRepository: { loadVersion },
      }),
    ).resolves.toMatchObject({
      status: "saved",
      rosterSavedAt: "2026-10-20T00:00:00.000Z",
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
      }),
    ).resolves.toMatchObject({ status: "read_failed" });
    await expect(
      loadProLeaguePlanPersistenceState({
        ...base,
        rosterRepository: {
          loadVersion: vi.fn(async () => {
            throw new Error("private database detail");
          }),
        },
      }),
    ).resolves.toMatchObject({ status: "read_failed" });
  });
});
