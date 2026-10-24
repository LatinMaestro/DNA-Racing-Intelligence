import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  owner: vi.fn(),
  createRepository: vi.fn(),
  parse: vi.fn(),
  save: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/clerk-owner-session", () => ({
  authenticatedClerkOwnerId: mocks.owner,
}));
vi.mock("@/lib/neon-tournament-configuration-write-repository", () => ({
  neonTournamentConfigurationWriteRepositoryFromEnvironment:
    mocks.createRepository,
}));
vi.mock("@/lib/tournament-configuration-write-service", () => ({
  parseTournamentConfigurationFormData: mocks.parse,
  saveTournamentConfiguration: mocks.save,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { saveTournamentConfigurationAction } from "../app/(private)/tournaments/actions";

describe("Tournament configuration save action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTHORIZED_CLERK_USER_ID = "owner-1";
    process.env.DATABASE_URL = "postgres://preview.example/dna";
    process.env.DNA_DATABASE_OWNER_ID = "00000000-0000-4000-8000-000000000001";
    process.env.DNA_DATABASE_RUNTIME_ROLE = "dna_app_runtime";
    mocks.owner.mockResolvedValue("owner-1");
    mocks.createRepository.mockReturnValue({ status: "ready" });
    mocks.save.mockResolvedValue(undefined);
  });

  it.each(["bike", "car", "horse"] as const)(
    "reloads the exact saved %s split after persistence",
    async (mode) => {
      const configuration = {
        tournamentId: `owner ${mode} tournament`,
        bracketId: `${mode}/primary split`,
        mode,
      };
      mocks.parse.mockReturnValue(configuration);
      const formData = new FormData();

      await expect(
        saveTournamentConfigurationAction(formData),
      ).resolves.toBeUndefined();

      expect(mocks.save).toHaveBeenCalledWith({
        authenticatedOwnerId: "owner-1",
        configuredOwnerId: "owner-1",
        repository: { status: "ready" },
        configuration,
      });
      expect(mocks.revalidatePath).toHaveBeenCalledWith("/tournaments");
      expect(mocks.revalidatePath).toHaveBeenCalledWith("/discovery");
      expect(mocks.redirect).toHaveBeenCalledWith(
        `/tournaments?tournamentId=owner%20${mode}%20tournament` +
          `&bracketId=${mode}%2Fprimary%20split`,
      );
    },
  );
});
