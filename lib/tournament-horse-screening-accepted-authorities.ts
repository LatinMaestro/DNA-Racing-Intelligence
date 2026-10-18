import { createHash } from "node:crypto";

import type { ActiveCoreHistoryCanonicalRaceAuthority } from "@/lib/active-core-history-pro-league-source";
import type {
  ActiveDnaCoreRaceHistoryGenerationReadRepository,
  SelectedDnaCoreRaceHistoryReadRepository,
} from "@/lib/neon-active-dna-core-race-history-generation";
import type { OwnerVaultCatalogueRepository } from "@/lib/owner-vault-catalogue-service";
import { OWNER_VAULT_LIST_LIMIT } from "@/lib/owner-vault-catalogue-service";
import { readSelectedCoreHistoryRaceSource } from "@/lib/selected-core-history-race-source";
import {
  createTournamentHorseScreeningAcceptedSourceBoundary,
  type TournamentHorseAcceptedSourceRepositories,
  type TournamentHorseHistorySnapshot,
  type TournamentHorseRosterSnapshot,
} from "@/lib/tournament-horse-screening-accepted-source";
import type { TournamentHorseScreeningAcceptedSourceBoundary } from "@/lib/tournament-horse-screening-materializer";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const ERROR = "Tournament Horse accepted authorities unavailable.";
const CORE_BATCH_SIZE = 64;
const MAXIMUM_CORES = 512;
const MAXIMUM_ROWS = 10_000;
const HORSE_DISTANCES = [1000, 1400, 2200] as const;

type HistoryRepository = Pick<
  ActiveDnaCoreRaceHistoryGenerationReadRepository,
  "readActiveGeneration"
> &
  SelectedDnaCoreRaceHistoryReadRepository;

function fail(): never {
  throw new Error(ERROR);
}

function text(value: unknown, maximum = 512): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > maximum ||
    CONTROL.test(value)
  )
    fail();
  return value;
}

function timestamp(value: unknown): string {
  const supplied = text(value);
  const parsed = new Date(supplied);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== supplied)
    fail();
  return supplied;
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function normalizedCoreIds(values: readonly string[]): readonly string[] {
  if (
    !Array.isArray(values) ||
    values.length < 1 ||
    values.length > MAXIMUM_CORES
  )
    fail();
  const result = values.map((value) => text(value)).sort();
  if (new Set(result).size !== result.length) fail();
  return Object.freeze(result);
}

function normalizedDistances(
  values: readonly number[],
): readonly (typeof HORSE_DISTANCES)[number][] {
  if (!Array.isArray(values)) fail();
  const result = [...values].sort((left, right) => left - right);
  if (
    result.length !== HORSE_DISTANCES.length ||
    result.some((value, index) => value !== HORSE_DISTANCES[index])
  )
    fail();
  return HORSE_DISTANCES;
}

/**
 * Adapts the complete bounded owner Vault into an immutable content identity.
 * The 500-row repository ceiling is never treated as proof of completeness.
 */
export function createTournamentHorseRosterAuthority(
  input: Readonly<{
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    repository: OwnerVaultCatalogueRepository;
  }>,
): TournamentHorseAcceptedSourceRepositories["roster"] {
  const databaseOwnerId = text(input.databaseOwnerId);
  const authenticatedOwnerId = text(input.authenticatedOwnerId);
  const repository = input.repository;
  if (!UUID.test(databaseOwnerId) || repository.status !== "ready") fail();
  const readyRepository: Extract<
    OwnerVaultCatalogueRepository,
    { status: "ready" }
  > = repository;

  async function load(ownerId: string): Promise<TournamentHorseRosterSnapshot> {
    if (text(ownerId) !== authenticatedOwnerId) fail();
    const values = await readyRepository.listCoresByOwner(ownerId, {
      scope: "vault",
      query: null,
      element: null,
      coreClass: null,
      sex: null,
      fNumber: null,
    });
    if (
      !Array.isArray(values) ||
      values.length < 1 ||
      values.length > OWNER_VAULT_LIST_LIMIT
    )
      fail();
    const cores = values
      .map((value) => {
        if (value.inMyVault !== true) fail();
        return Object.freeze({
          coreId: text(value.sourceCoreId),
          name: text(value.displayName),
          element: text(value.element, 128),
          version: value.version,
          updatedAt:
            value.updatedAt === null ? null : timestamp(value.updatedAt),
        });
      })
      .sort((left, right) => left.coreId.localeCompare(right.coreId));
    if (new Set(cores.map(({ coreId }) => coreId)).size !== cores.length)
      fail();
    const truncated = cores.length === OWNER_VAULT_LIST_LIMIT;
    return Object.freeze({
      databaseOwnerId,
      rosterSnapshotVersion: digest({ version: 1, databaseOwnerId, cores }),
      state: truncated ? ("partial" as const) : ("accepted" as const),
      complete: !truncated,
      truncated,
      cores: Object.freeze(
        cores.map(({ coreId, name, element }) =>
          Object.freeze({ coreId, name, element }),
        ),
      ),
    });
  }

  return Object.freeze({
    loadAcceptedHorseRosterByOwner: load,
    async readAcceptedHorseRosterVersionByOwner(ownerId) {
      return (await load(ownerId)).rosterSnapshotVersion;
    },
  });
}

/**
 * Joins the active compact Core generation to canonical Race documents in
 * sequential 64-Core batches. It classifies only explicit Horse observations
 * at the three approved distances and preserves empty requested histories.
 */
export function createTournamentHorseHistoryAuthority(
  input: Readonly<{
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    repository: HistoryRepository;
    raceAuthority: ActiveCoreHistoryCanonicalRaceAuthority;
  }>,
): TournamentHorseAcceptedSourceRepositories["history"] {
  const databaseOwnerId = text(input.databaseOwnerId);
  const authenticatedOwnerId = text(input.authenticatedOwnerId);
  if (!UUID.test(databaseOwnerId)) fail();

  return Object.freeze({
    async loadAcceptedHorseHistoryByOwner(ownerId, request) {
      try {
        if (text(ownerId) !== authenticatedOwnerId) fail();
        const coreIds = normalizedCoreIds(request.coreIds);
        normalizedDistances(request.distancesMetres);
        if (
          !Number.isSafeInteger(request.maximumRows) ||
          request.maximumRows < 1 ||
          request.maximumRows > MAXIMUM_ROWS
        )
          fail();
        const generation =
          await input.repository.readActiveGeneration(authenticatedOwnerId);
        if (generation === null) return null;
        const evidenceCutoff = timestamp(generation.materializedAt);
        const observations = new Map<
          string,
          TournamentHorseHistorySnapshot["cores"][number]["observations"][number][]
        >(coreIds.map((coreId) => [coreId, []]));
        let remainingRows = request.maximumRows;
        for (
          let offset = 0;
          offset < coreIds.length;
          offset += CORE_BATCH_SIZE
        ) {
          if (remainingRows === 0) {
            return Object.freeze({
              databaseOwnerId,
              historyGenerationVersion: generation.generationId,
              observationSetSha256: generation.observationSetSha256,
              evidenceCutoff,
              state: "partial" as const,
              completeForRequestedCores: false,
              truncated: true,
              requestedCoreIds: coreIds,
              cores: Object.freeze([]),
            });
          }
          const batch = coreIds.slice(offset, offset + CORE_BATCH_SIZE);
          const selected = await readSelectedCoreHistoryRaceSource({
            authenticatedOwnerId,
            configuredOwnerId: authenticatedOwnerId,
            selection: {
              generationId: generation.generationId,
              observationSetSha256: generation.observationSetSha256,
              coreIds: batch,
              maximumRows: remainingRows,
            },
            evidenceCutoff,
            maximumRaceDocuments: remainingRows,
            repository: input.repository,
            raceAuthority: input.raceAuthority,
          });
          if (selected.status !== "ready") {
            return Object.freeze({
              databaseOwnerId,
              historyGenerationVersion: generation.generationId,
              observationSetSha256: generation.observationSetSha256,
              evidenceCutoff,
              state: "partial" as const,
              completeForRequestedCores: false,
              truncated: selected.status === "truncated",
              requestedCoreIds: coreIds,
              cores: Object.freeze([]),
            });
          }
          remainingRows -= selected.selectedOutcomeCount;
          if (remainingRows < 0) fail();
          for (const value of selected.observations) {
            if (
              value.mode !== "horse" ||
              !HORSE_DISTANCES.includes(
                value.distanceMeters as (typeof HORSE_DISTANCES)[number],
              )
            )
              continue;
            observations.get(value.coreId)?.push(
              Object.freeze({
                eventId: value.eventId,
                eventAt: value.eventAt,
                mode: "horse" as const,
                distanceMetres: value.distanceMeters,
                gateCount: value.gateCount,
                elapsedTimeMilliseconds: value.elapsedTimeMilliseconds,
              }),
            );
          }
        }
        const confirmed =
          await input.repository.readActiveGeneration(authenticatedOwnerId);
        if (
          confirmed?.generationId !== generation.generationId ||
          confirmed.observationSetSha256 !== generation.observationSetSha256
        )
          return null;
        return Object.freeze({
          databaseOwnerId,
          historyGenerationVersion: generation.generationId,
          observationSetSha256: generation.observationSetSha256,
          evidenceCutoff,
          state: "accepted" as const,
          completeForRequestedCores: true,
          truncated: false,
          requestedCoreIds: coreIds,
          cores: Object.freeze(
            coreIds.map((coreId) =>
              Object.freeze({
                coreId,
                observations: Object.freeze(observations.get(coreId) ?? []),
              }),
            ),
          ),
        });
      } catch {
        return fail();
      }
    },
    async readAcceptedHorseHistoryPointerByOwner(ownerId) {
      if (text(ownerId) !== authenticatedOwnerId) fail();
      const generation =
        await input.repository.readActiveGeneration(authenticatedOwnerId);
      return generation === null
        ? null
        : Object.freeze({
            historyGenerationVersion: generation.generationId,
            observationSetSha256: generation.observationSetSha256,
            evidenceCutoff: timestamp(generation.materializedAt),
          });
    },
  });
}

export function createTournamentHorseScreeningAcceptedSourceComposition(
  input: Readonly<{
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    vaultRepository: OwnerVaultCatalogueRepository;
    historyRepository: HistoryRepository;
    raceAuthority: ActiveCoreHistoryCanonicalRaceAuthority;
    opponentPools: TournamentHorseAcceptedSourceRepositories["opponentPools"];
  }>,
): TournamentHorseScreeningAcceptedSourceBoundary {
  return createTournamentHorseScreeningAcceptedSourceBoundary({
    databaseOwnerId: input.databaseOwnerId,
    authenticatedOwnerId: input.authenticatedOwnerId,
    repositories: {
      roster: createTournamentHorseRosterAuthority({
        databaseOwnerId: input.databaseOwnerId,
        authenticatedOwnerId: input.authenticatedOwnerId,
        repository: input.vaultRepository,
      }),
      history: createTournamentHorseHistoryAuthority({
        databaseOwnerId: input.databaseOwnerId,
        authenticatedOwnerId: input.authenticatedOwnerId,
        repository: input.historyRepository,
        raceAuthority: input.raceAuthority,
      }),
      opponentPools: input.opponentPools,
    },
  });
}
