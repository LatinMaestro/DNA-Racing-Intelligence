import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  owner: vi.fn(),
  load: vi.fn(),
  createRepository: vi.fn(),
  saveRoster: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/clerk-owner-session", () => ({
  authenticatedClerkOwnerId: mocks.owner,
}));
vi.mock("@/lib/hosted-pro-league-page-runtime", () => ({
  loadHostedProLeagueCommissioningState: mocks.load,
  createHostedProLeagueRosterWriteRepository: mocks.createRepository,
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
      },
      lineup: {
        lineup: {
          lineupVersionId: "draft-lineup/generation-1",
          rosterVersionId: "draft-roster/generation-1",
        },
      },
    });
    mocks.createRepository.mockReturnValue({ saveVersion: mocks.saveRoster });
    mocks.saveRoster.mockResolvedValue({ disposition: "created" });
  });

  it("recomputes the accepted plan before persisting its immutable roster", async () => {
    await expect(confirmProLeaguePlanAction(form())).resolves.toBeUndefined();
    expect(mocks.load).toHaveBeenCalledWith(
      expect.objectContaining({ authenticatedOwnerId: "owner-1" }),
    );
    expect(mocks.saveRoster).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({
        rosterVersionId: "draft-roster/generation-1",
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
  });

  it("returns a non-secret form failure when owner confirmation is unavailable", async () => {
    mocks.owner.mockResolvedValue(null);
    await expect(confirmProLeaguePlanFormAction("idle", form())).resolves.toBe(
      "unconfirmed",
    );
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.createRepository).not.toHaveBeenCalled();
  });
});
