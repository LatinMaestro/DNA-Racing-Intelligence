import { describe, expect, it, vi } from "vitest";

import type { DnaCoreRaceHistoryPublishedGeneration } from "@/lib/dna-core-race-history-generation";
import { dnaOpenLabRawEvidenceSha256 } from "@/lib/dna-open-lab-v1-adapters";
import type { ActiveDnaCoreRaceHistoryGenerationRow } from "@/lib/neon-active-dna-core-race-history-generation";
import type { OwnerVaultCatalogueRepository } from "@/lib/owner-vault-catalogue-service";
import {
  createTournamentHorseHistoryAuthority,
  createTournamentHorseRosterAuthority,
} from "@/lib/tournament-horse-screening-accepted-authorities";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const authenticatedOwnerId = "user_owner";
const generationId = "a".repeat(64);
const observationSetSha256 = "b".repeat(64);

const generation: DnaCoreRaceHistoryPublishedGeneration = {
  version: 1,
  generationId,
  materializedAt: "2026-10-16T00:00:00.000Z",
  cycleSetSha256: "c".repeat(64),
  observationSetSha256,
  payloadSha256: "d".repeat(64),
  inputCycleCount: 1,
  inputPageCount: 1,
  inputResultCount: 1,
  replayDuplicateCount: 0,
  raceDocumentCount: 1,
  entrantAuthorityOmissionCount: 0,
  entrantMismatchOmissionCount: 0,
  exactDistanceConfirmedCount: 1,
  acceptedPublishedCellCount: 1,
  missingFormatCount: 0,
  unsupportedFormatCount: 0,
  unpublishedCellCount: 0,
  observationCount: 1,
  state: "published",
  publishedAt: "2026-10-16T01:00:00.000Z",
};

function outcome(
  coreId = "101",
  eventId = "event-1",
): ActiveDnaCoreRaceHistoryGenerationRow {
  const payload = {
    sourceType: "core_race_history_outcome" as const,
    payloadVersion: 1 as const,
    naturalKey: `core-result:${coreId}:${eventId}`,
    resultEvidenceSha256: "e".repeat(64),
    raceDocumentEvidenceSha256: "f".repeat(64),
    raceDocumentObservedAt: "2026-10-15T00:00:00.000Z",
    sourceCoreId: coreId,
    sourceRaceId: eventId,
    elapsedMilliseconds: 60_000,
    finishPosition: 1,
    goldStar: null,
    blueStar: null,
    starEvidenceStatus: "missing" as const,
  };
  return {
    generationId,
    ordinal: 0,
    naturalKey: payload.naturalKey,
    rowSha256: dnaOpenLabRawEvidenceSha256(payload),
    payload,
  };
}

function vaultRepository(
  count = 2,
): Extract<OwnerVaultCatalogueRepository, { status: "ready" }> {
  return {
    status: "ready",
    listCoresByOwner: vi.fn(async () =>
      Array.from({ length: count }, (_, index) => ({
        sourceCoreId: String(index + 1),
        displayName: `Core ${index + 1}`,
        coreClass: "Genesis" as const,
        element: "Fire" as const,
        fNumber: 1,
        sex: "male" as const,
        inMyVault: true,
        meEligible: false,
        version: index,
        updatedAt: index === 0 ? null : "2026-10-15T00:00:00.000Z",
      })),
    ),
  };
}

describe("Tournament Horse accepted authorities", () => {
  it("content-addresses the complete owner Vault through the authenticated identity", async () => {
    const repository = vaultRepository();
    const authority = createTournamentHorseRosterAuthority({
      databaseOwnerId,
      authenticatedOwnerId,
      repository,
    });
    const snapshot =
      await authority.loadAcceptedHorseRosterByOwner(authenticatedOwnerId);
    expect(snapshot).toMatchObject({
      databaseOwnerId,
      state: "accepted",
      complete: true,
      truncated: false,
      rosterSnapshotVersion: expect.stringMatching(/^[a-f0-9]{64}$/u),
      cores: [
        { coreId: "1", name: "Core 1", element: "Fire" },
        { coreId: "2", name: "Core 2", element: "Fire" },
      ],
    });
    expect(repository.listCoresByOwner).toHaveBeenCalledWith(
      authenticatedOwnerId,
      {
        scope: "vault",
        query: null,
        element: null,
        coreClass: null,
        sex: null,
        fNumber: null,
      },
    );
    await expect(
      authority.loadAcceptedHorseRosterByOwner("other_owner"),
    ).rejects.toThrow("accepted authorities unavailable");
  });

  it("fails closed at the Vault repository row ceiling", async () => {
    const authority = createTournamentHorseRosterAuthority({
      databaseOwnerId,
      authenticatedOwnerId,
      repository: vaultRepository(500),
    });
    await expect(
      authority.loadAcceptedHorseRosterByOwner(authenticatedOwnerId),
    ).resolves.toMatchObject({
      state: "partial",
      complete: false,
      truncated: true,
    });
  });

  it("retains only explicit Horse observations at approved distances", async () => {
    const rows = [outcome()];
    const readActiveGeneration = vi.fn(async () => generation);
    const readSelectedCoreRows = vi.fn(
      async (
        _ownerId: string,
        _selection: Readonly<{
          generationId: string;
          observationSetSha256: string;
          coreIds: readonly string[];
          maximumRows: number;
        }>,
      ) => {
        void _ownerId;
        void _selection;
        return { status: "ready" as const, rows };
      },
    );
    const readRaceDocuments = vi.fn(async () => [
      {
        source: "dna_open_lab" as const,
        sourceVersion: "v1" as const,
        scope: "races" as const,
        endpoint: "races.docs" as const,
        entityKey: "race:event-1",
        observedAt: "2026-10-15T00:00:00.000Z",
        rawEvidenceSha256: "f".repeat(64),
        canonical: {
          sourceType: "race_document" as const,
          sourceRaceId: "event-1",
          mode: "horse" as const,
          distanceMetres: 1400,
          gateCount: 2,
          format: "WTA",
          startAt: "2026-10-14T00:00:00.000Z",
          entrantCoreIds: ["101", "201"],
        },
      },
    ]);
    const authority = createTournamentHorseHistoryAuthority({
      databaseOwnerId,
      authenticatedOwnerId,
      repository: { readActiveGeneration, readSelectedCoreRows },
      raceAuthority: { readRaceDocuments },
    });
    const snapshot = await authority.loadAcceptedHorseHistoryByOwner(
      authenticatedOwnerId,
      {
        coreIds: ["201", "101"],
        distancesMetres: [2200, 1000, 1400],
        maximumRows: 100,
      },
    );
    expect(snapshot).toMatchObject({
      databaseOwnerId,
      historyGenerationVersion: generationId,
      observationSetSha256,
      evidenceCutoff: generation.materializedAt,
      state: "accepted",
      completeForRequestedCores: true,
      truncated: false,
      requestedCoreIds: ["101", "201"],
      cores: [
        {
          coreId: "101",
          observations: [
            {
              eventId: "event-1",
              mode: "horse",
              distanceMetres: 1400,
              gateCount: 2,
              elapsedTimeMilliseconds: 60_000,
            },
          ],
        },
        { coreId: "201", observations: [] },
      ],
    });
    expect(readSelectedCoreRows).toHaveBeenCalledWith(authenticatedOwnerId, {
      generationId,
      observationSetSha256,
      coreIds: ["101", "201"],
      maximumRows: 100,
    });
  });

  it("reads a large roster in sequential 64-Core batches", async () => {
    const readActiveGeneration = vi.fn(async () => generation);
    const readSelectedCoreRows = vi.fn(
      async (
        _ownerId: string,
        _selection: Readonly<{
          generationId: string;
          observationSetSha256: string;
          coreIds: readonly string[];
          maximumRows: number;
        }>,
      ) => {
        void _ownerId;
        void _selection;
        return { status: "ready" as const, rows: [] };
      },
    );
    const authority = createTournamentHorseHistoryAuthority({
      databaseOwnerId,
      authenticatedOwnerId,
      repository: { readActiveGeneration, readSelectedCoreRows },
      raceAuthority: { readRaceDocuments: vi.fn(async () => []) },
    });
    const coreIds = Array.from({ length: 130 }, (_, index) => String(index));
    await expect(
      authority.loadAcceptedHorseHistoryByOwner(authenticatedOwnerId, {
        coreIds,
        distancesMetres: [1000, 1400, 2200],
        maximumRows: 100,
      }),
    ).resolves.toMatchObject({ state: "accepted", cores: { length: 130 } });
    expect(
      readSelectedCoreRows.mock.calls.map((call) => call[1].coreIds.length),
    ).toEqual([64, 64, 2]);
  });

  it("withholds truncated or changing generations", async () => {
    const readActiveGeneration = vi.fn(async () => generation);
    const readSelectedCoreRows = vi.fn(
      async (
        _ownerId: string,
        _selection: Readonly<{
          generationId: string;
          observationSetSha256: string;
          coreIds: readonly string[];
          maximumRows: number;
        }>,
      ) => {
        void _ownerId;
        void _selection;
        return { status: "truncated" as const, rows: [] };
      },
    );
    const authority = createTournamentHorseHistoryAuthority({
      databaseOwnerId,
      authenticatedOwnerId,
      repository: { readActiveGeneration, readSelectedCoreRows },
      raceAuthority: { readRaceDocuments: vi.fn(async () => []) },
    });
    await expect(
      authority.loadAcceptedHorseHistoryByOwner(authenticatedOwnerId, {
        coreIds: ["101"],
        distancesMetres: [1000, 1400, 2200],
        maximumRows: 1,
      }),
    ).resolves.toMatchObject({
      state: "partial",
      completeForRequestedCores: false,
      truncated: true,
      cores: [],
    });
  });
});
