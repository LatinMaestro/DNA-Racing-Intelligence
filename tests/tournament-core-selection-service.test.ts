import { describe, expect, it, vi } from "vitest";

import {
  loadTournamentCoreSelectionState,
  parseTournamentCoreSelectionFormData,
  saveTournamentCoreSelection,
  type TournamentCoreSelection,
  type TournamentCoreSelectionRepository,
} from "@/lib/tournament-core-selection-service";

const selection: TournamentCoreSelection = {
  tournamentId: "tour-1",
  bracketId: "bike-a",
  configurationVersion: "config-v1",
  candidateSnapshotVersion: "snapshot-v1",
  coreIds: ["10457", "20001"],
  updatedAt: "2026-10-27T12:00:00.000Z",
};

function repository(): Extract<
  TournamentCoreSelectionRepository,
  { status: "ready" }
> {
  return {
    status: "ready",
    readSelection: vi.fn(async () => selection),
    replaceSelection: vi.fn(async (_ownerId, value) => value),
  };
}

describe("Tournament Core selection service", () => {
  it("loads only the exact owner-scoped Tournament split", async () => {
    const repo = repository();
    await expect(
      loadTournamentCoreSelectionState({
        authenticatedOwnerId: "owner-1",
        configuredOwnerId: "owner-1",
        repository: repo,
        tournamentId: "tour-1",
        bracketId: "bike-a",
      }),
    ).resolves.toEqual({ connectionStatus: "connected", selection });
    expect(repo.readSelection).toHaveBeenCalledWith(
      "owner-1",
      "tour-1",
      "bike-a",
    );
  });

  it("withholds failed reads and rejects a wrong owner", async () => {
    const repo = repository();
    vi.mocked(repo.readSelection).mockRejectedValueOnce(new Error("offline"));
    await expect(
      loadTournamentCoreSelectionState({
        authenticatedOwnerId: "owner-1",
        configuredOwnerId: "owner-1",
        repository: repo,
        tournamentId: "tour-1",
        bracketId: "bike-a",
      }),
    ).resolves.toEqual({ connectionStatus: "read_failed", selection: null });
    await expect(
      loadTournamentCoreSelectionState({
        authenticatedOwnerId: "owner-2",
        configuredOwnerId: "owner-1",
        repository: repo,
        tournamentId: "tour-1",
        bracketId: "bike-a",
      }),
    ).rejects.toThrow("access denied");
  });

  it("parses repeated Core checkboxes and supports clearing", () => {
    const formData = new FormData();
    formData.set("tournamentId", "tour-1");
    formData.set("bracketId", "bike-a");
    formData.set("configurationVersion", "config-v1");
    formData.set("candidateSnapshotVersion", "snapshot-v1");
    formData.append("coreId", "10457");
    formData.append("coreId", "20001");
    expect(
      parseTournamentCoreSelectionFormData(
        formData,
        new Date("2026-10-27T12:00:00.000Z"),
      ),
    ).toEqual(selection);
    formData.delete("coreId");
    expect(
      parseTournamentCoreSelectionFormData(
        formData,
        new Date("2026-10-27T12:00:00.000Z"),
      ).coreIds,
    ).toEqual([]);
  });

  it("persists only through a connected owner repository", async () => {
    const repo = repository();
    await expect(
      saveTournamentCoreSelection({
        authenticatedOwnerId: "owner-1",
        configuredOwnerId: "owner-1",
        repository: repo,
        selection,
      }),
    ).resolves.toEqual(selection);
    expect(repo.replaceSelection).toHaveBeenCalledWith("owner-1", selection);
  });
});
