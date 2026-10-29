import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  owner: vi.fn(),
  load: vi.fn(),
  createRepository: vi.fn(),
  createLineupRepository: vi.fn(),
  saveRoster: vi.fn(),
  saveLineup: vi.fn(),
  saveFullGatePlan: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/clerk-owner-session", () => ({
  authenticatedClerkOwnerId: mocks.owner,
}));
vi.mock("@/lib/hosted-pro-league-page-runtime", () => ({
  loadHostedProLeagueCommissioningState: mocks.load,
  createHostedProLeagueRosterWriteRepository: mocks.createRepository,
  createHostedProLeagueLineupWriteRepository: mocks.createLineupRepository,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  confirmProLeaguePlanAction,
  confirmProLeaguePlanFormAction,
} from "../app/(private)/pro-league/actions";

function form(overrides: Record<string, string> = {}) {
  const result = new FormData();
  for (const [key, value] of Object.entries({
    confirmed: "confirmed",
    expectedGenerationId: "generation-1",
    expectedRosterVersionId: "draft-roster/generation-1",
    expectedLineupVersionId: "draft-lineup/generation-1",
    ...overrides,
  })) {
    result.set(key, value);
  }
  return result;
}

describe("Pro League owner plan confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTHORIZED_CLERK_USER_ID = "owner-1";
    process.env.DATABASE_URL = "postgres://preview.example/dna";
    process.env.DNA_DATABASE_OWNER_ID = "00000000-0000-4000-8000-000000000001";
    mocks.owner.mockResolvedValue("owner-1");
    mocks.load.mockResolvedValue({
      connectionStatus: "read_model_connected",
      evidence: { generationId: "generation-1" },
      roster: {
        draftRoster: { rosterVersionId: "draft-roster/generation-1" },
      },
      ownerPlan: {
        roster: Array.from({ length: 25 }, (_, index) => ({
          coreId: `core-${index + 1}`,
        })),
        allSlotsFilled: true,
        requiredCoreEntries: 1_021,
        assignedCoreEntries: 1_021,
      },
      lineup: {
        lineup: {
          lineupVersionId: "draft-lineup/generation-1",
          rosterVersionId: "draft-roster/generation-1",
          maps: Array.from({ length: 4 }, () => ({
            entries: Array.from({ length: 42 }, () => ({})),
          })),
        },
      },
    });
    mocks.createRepository.mockReturnValue({ saveVersion: mocks.saveRoster });
    mocks.createLineupRepository.mockReturnValue({
      saveLineup: mocks.saveLineup,
      saveFullGatePlan: mocks.saveFullGatePlan,
    });
    mocks.saveRoster.mockResolvedValue({ disposition: "created" });
    mocks.saveLineup.mockResolvedValue({ disposition: "created" });
    mocks.saveFullGatePlan.mockResolvedValue({
      disposition: "created",
      assignmentCount: 1_021,
    });
  });

  it("blocks an incomplete full-gate plan before any write", async () => {
    const incomplete = await mocks.load();
    mocks.load.mockResolvedValue({
      ...incomplete,
      ownerPlan: { ...incomplete.ownerPlan, assignedCoreEntries: 168 },
    });
    await expect(confirmProLeaguePlanAction(form())).rejects.toThrow(
      "accepted evidence changed",
    );
    expect(mocks.load).toHaveBeenCalledWith(
      expect.objectContaining({ authenticatedOwnerId: "owner-1" }),
    );
    expect(mocks.saveRoster).not.toHaveBeenCalled();
    expect(mocks.saveLineup).not.toHaveBeenCalled();
    expect(mocks.saveFullGatePlan).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("persists the roster, line catalogue and all full-gate assignments", async () => {
    await expect(confirmProLeaguePlanAction(form())).resolves.toBeUndefined();
    expect(mocks.saveRoster).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({
        rosterVersionId: "draft-roster/generation-1",
      }),
    );
    expect(mocks.saveLineup).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({
        lineupVersionId: "draft-lineup/generation-1",
      }),
    );
    expect(mocks.saveFullGatePlan).toHaveBeenCalledWith(
      "owner-1",
      "draft-lineup/generation-1",
      "draft-roster/generation-1",
      expect.objectContaining({
        requiredCoreEntries: 1_021,
        assignedCoreEntries: 1_021,
      }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/pro-league");
  });

  it("rejects stale client identity before the roster write", async () => {
    await expect(
      confirmProLeaguePlanAction(
        form({ expectedRosterVersionId: "stale-roster" }),
      ),
    ).rejects.toThrow("accepted evidence changed");
    expect(mocks.saveRoster).not.toHaveBeenCalled();
    expect(mocks.saveLineup).not.toHaveBeenCalled();
  });

  it("rejects a stale lineup identity before either write", async () => {
    await expect(
      confirmProLeaguePlanAction(
        form({ expectedLineupVersionId: "stale-lineup" }),
      ),
    ).rejects.toThrow("accepted evidence changed");
    expect(mocks.saveRoster).not.toHaveBeenCalled();
    expect(mocks.saveLineup).not.toHaveBeenCalled();
  });

  it("returns a non-secret form failure when owner confirmation is unavailable", async () => {
    mocks.owner.mockResolvedValue(null);
    await expect(confirmProLeaguePlanFormAction("idle", form())).resolves.toBe(
      "unconfirmed",
    );
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.createRepository).not.toHaveBeenCalled();
    expect(mocks.createLineupRepository).not.toHaveBeenCalled();
  });
});
