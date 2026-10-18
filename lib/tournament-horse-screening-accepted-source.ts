import { createHash } from "node:crypto";

import {
  horseOneVOneTournamentDistances,
  type HorseOneVOneCoreEvidence,
  type HorseOneVOneScreeningGroup,
} from "@/domain/horse-one-v-one-tournament-screening";
import type {
  TournamentHorseScreeningAcceptedSource,
  TournamentHorseScreeningAcceptedSourceBoundary,
} from "@/lib/tournament-horse-screening-materializer";
import { TOURNAMENT_HORSE_SCREENING_MAXIMUM_CORES } from "@/lib/tournament-horse-screening-materializer";

const HASH = /^[a-f0-9]{64}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const ERROR = "Tournament Horse screening accepted source unavailable.";
const MAXIMUM_GROUP_COUNT = 96;
const MAXIMUM_OBSERVATION_COUNT = 10_000;

export type TournamentHorseRosterCore = Readonly<{
  coreId: string;
  name: string;
  element: string;
}>;

export type TournamentHorseRosterSnapshot = Readonly<{
  databaseOwnerId: string;
  rosterSnapshotVersion: string;
  state: "accepted" | "partial" | "unknown";
  complete: boolean;
  truncated: boolean;
  cores: readonly TournamentHorseRosterCore[];
}>;

export type TournamentHorseHistoryObservation = Readonly<{
  eventId: string;
  eventAt: string;
  mode: "horse";
  distanceMetres: number;
  gateCount: number;
  elapsedTimeMilliseconds: number;
}>;

export type TournamentHorseCoreHistory = Readonly<{
  coreId: string;
  observations: readonly TournamentHorseHistoryObservation[];
}>;

export type TournamentHorseHistorySnapshot = Readonly<{
  databaseOwnerId: string;
  historyGenerationVersion: string;
  observationSetSha256: string;
  evidenceCutoff: string;
  state: "accepted" | "partial" | "unknown";
  completeForRequestedCores: boolean;
  truncated: boolean;
  requestedCoreIds: readonly string[];
  cores: readonly TournamentHorseCoreHistory[];
}>;

export type TournamentHorseOpponentPoolGroup = Readonly<{
  element: string;
  distanceMetres: number;
  tournamentFieldOpponentCoreIds: readonly string[];
  topTenPercentOpponentCoreIds: readonly string[];
  status: "confirmed" | "review_required";
}>;

export type TournamentHorseOpponentPoolSnapshot = Readonly<{
  databaseOwnerId: string;
  opponentPoolSnapshotVersion: string;
  state: "accepted" | "partial" | "unknown";
  completeForRosterElements: boolean;
  truncated: boolean;
  cores: readonly TournamentHorseRosterCore[];
  groups: readonly TournamentHorseOpponentPoolGroup[];
}>;

export type TournamentHorseAcceptedAuthorityPointers = Readonly<{
  rosterSnapshotVersion: string;
  historyGenerationVersion: string;
  observationSetSha256: string;
  opponentPoolSnapshotVersion: string;
  evidenceCutoff: string;
}>;

export type TournamentHorseAcceptedSourceRepositories = Readonly<{
  roster: Readonly<{
    loadAcceptedHorseRosterByOwner(
      ownerId: string,
    ): Promise<TournamentHorseRosterSnapshot | null>;
    readAcceptedHorseRosterVersionByOwner(
      ownerId: string,
    ): Promise<string | null>;
  }>;
  opponentPools: Readonly<{
    loadAcceptedHorseOpponentPoolsByOwner(
      ownerId: string,
    ): Promise<TournamentHorseOpponentPoolSnapshot | null>;
    readAcceptedHorseOpponentPoolVersionByOwner(
      ownerId: string,
    ): Promise<string | null>;
  }>;
  history: Readonly<{
    loadAcceptedHorseHistoryByOwner(
      ownerId: string,
      request: Readonly<{
        coreIds: readonly string[];
        distancesMetres: readonly number[];
        maximumRows: number;
      }>,
    ): Promise<TournamentHorseHistorySnapshot | null>;
    readAcceptedHorseHistoryPointerByOwner(ownerId: string): Promise<Readonly<{
      historyGenerationVersion: string;
      observationSetSha256: string;
      evidenceCutoff: string;
    }> | null>;
  }>;
}>;

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

function hash(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) fail();
  return value;
}

function timestamp(value: unknown): string {
  const supplied = text(value);
  const parsed = new Date(supplied);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== supplied)
    fail();
  return supplied;
}

function unique(values: readonly string[]): readonly string[] {
  const normalized = values.map((value) => text(value));
  if (new Set(normalized).size !== normalized.length) fail();
  return Object.freeze(normalized);
}

function sourceIdentity(
  pointers: TournamentHorseAcceptedAuthorityPointers,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        methodVersion: "horse-1v1-exact-distance-transfer-v2",
        rosterSnapshotVersion: hash(pointers.rosterSnapshotVersion),
        historyGenerationVersion: hash(pointers.historyGenerationVersion),
        observationSetSha256: hash(pointers.observationSetSha256),
        opponentPoolSnapshotVersion: hash(pointers.opponentPoolSnapshotVersion),
        evidenceCutoff: timestamp(pointers.evidenceCutoff),
      }),
      "utf8",
    )
    .digest("hex");
}

function profileMap(
  values: readonly TournamentHorseRosterCore[],
): ReadonlyMap<string, TournamentHorseRosterCore> {
  const result = new Map<string, TournamentHorseRosterCore>();
  for (const value of values) {
    const normalized = Object.freeze({
      coreId: text(value.coreId),
      name: text(value.name),
      element: text(value.element, 128),
    });
    const previous = result.get(normalized.coreId);
    if (previous !== undefined) fail();
    result.set(normalized.coreId, normalized);
  }
  return result;
}

function mergeProfiles(
  roster: readonly TournamentHorseRosterCore[],
  opponents: readonly TournamentHorseRosterCore[],
) {
  const result = new Map(profileMap(opponents));
  for (const [coreId, profile] of profileMap(roster)) {
    const previous = result.get(coreId);
    if (
      previous !== undefined &&
      (previous.name !== profile.name || previous.element !== profile.element)
    )
      fail();
    result.set(coreId, profile);
  }
  if (result.size > TOURNAMENT_HORSE_SCREENING_MAXIMUM_CORES) fail();
  return result;
}

function historyMap(
  snapshot: TournamentHorseHistorySnapshot,
  requestedCoreIds: readonly string[],
) {
  if (
    !Array.isArray(snapshot.requestedCoreIds) ||
    !Array.isArray(snapshot.cores) ||
    snapshot.cores.length > TOURNAMENT_HORSE_SCREENING_MAXIMUM_CORES
  )
    fail();
  const supplied = unique(snapshot.requestedCoreIds);
  if (
    supplied.length !== requestedCoreIds.length ||
    ![...supplied]
      .sort()
      .every((value, index) => value === [...requestedCoreIds].sort()[index])
  )
    fail();
  let observationCount = 0;
  const result = new Map<string, TournamentHorseHistoryObservation[]>();
  for (const core of snapshot.cores) {
    const coreId = text(core.coreId);
    if (
      !requestedCoreIds.includes(coreId) ||
      result.has(coreId) ||
      !Array.isArray(core.observations)
    )
      fail();
    const events = new Set<string>();
    const observations = core.observations.map(
      (observation: TournamentHorseHistoryObservation) => {
        const eventId = text(observation.eventId);
        const eventAt = timestamp(observation.eventAt);
        if (
          events.has(eventId) ||
          observation.mode !== "horse" ||
          !horseOneVOneTournamentDistances.includes(
            observation.distanceMetres as (typeof horseOneVOneTournamentDistances)[number],
          ) ||
          !Number.isSafeInteger(observation.gateCount) ||
          observation.gateCount < 1 ||
          !Number.isSafeInteger(observation.elapsedTimeMilliseconds) ||
          observation.elapsedTimeMilliseconds < 1 ||
          eventAt >= snapshot.evidenceCutoff
        )
          fail();
        events.add(eventId);
        observationCount += 1;
        return Object.freeze({
          eventId,
          eventAt,
          mode: "horse" as const,
          distanceMetres: observation.distanceMetres,
          gateCount: observation.gateCount,
          elapsedTimeMilliseconds: observation.elapsedTimeMilliseconds,
        });
      },
    );
    result.set(coreId, observations);
  }
  if (observationCount > MAXIMUM_OBSERVATION_COUNT) fail();
  return result;
}

function buildCoreEvidence(
  profile: TournamentHorseRosterCore,
  ownedCoreIds: ReadonlySet<string>,
  observations: readonly TournamentHorseHistoryObservation[],
  distanceMetres: (typeof horseOneVOneTournamentDistances)[number],
): HorseOneVOneCoreEvidence {
  const exact = observations
    .filter((value) => value.distanceMetres === distanceMetres)
    .map(({ eventId, eventAt, elapsedTimeMilliseconds }) =>
      Object.freeze({ eventId, eventAt, elapsedTimeMilliseconds }),
    );
  return Object.freeze({
    coreId: profile.coreId,
    name: profile.name,
    owned: ownedCoreIds.has(profile.coreId),
    element: profile.element,
    distanceMetres,
    distanceObservations: Object.freeze(exact),
    directOneVOneObservations: Object.freeze(
      observations
        .filter(
          (value) =>
            value.distanceMetres === distanceMetres && value.gateCount === 2,
        )
        .map(({ eventId, eventAt, elapsedTimeMilliseconds }) =>
          Object.freeze({ eventId, eventAt, elapsedTimeMilliseconds }),
        ),
    ),
  });
}

/**
 * Composes already-accepted persisted authorities. It never chooses opponents,
 * infers element membership or changes the approved Horse pairwise method.
 */
export function createTournamentHorseScreeningAcceptedSourceBoundary(input: {
  databaseOwnerId: string;
  repositories: TournamentHorseAcceptedSourceRepositories;
}): TournamentHorseScreeningAcceptedSourceBoundary {
  const configuredOwnerId = text(input.databaseOwnerId);
  if (!UUID.test(configuredOwnerId)) fail();

  async function currentIdentity(ownerId: string): Promise<string | null> {
    if (text(ownerId) !== configuredOwnerId) fail();
    const [rosterVersion, historyPointer, opponentPoolVersion] =
      await Promise.all([
        input.repositories.roster.readAcceptedHorseRosterVersionByOwner(
          ownerId,
        ),
        input.repositories.history.readAcceptedHorseHistoryPointerByOwner(
          ownerId,
        ),
        input.repositories.opponentPools.readAcceptedHorseOpponentPoolVersionByOwner(
          ownerId,
        ),
      ]);
    if (
      rosterVersion === null ||
      historyPointer === null ||
      opponentPoolVersion === null
    )
      return null;
    return sourceIdentity({
      rosterSnapshotVersion: rosterVersion,
      historyGenerationVersion: historyPointer.historyGenerationVersion,
      observationSetSha256: historyPointer.observationSetSha256,
      opponentPoolSnapshotVersion: opponentPoolVersion,
      evidenceCutoff: historyPointer.evidenceCutoff,
    });
  }

  return Object.freeze({
    async loadAcceptedSourceByOwner(ownerId) {
      try {
        if (text(ownerId) !== configuredOwnerId) fail();
        const [roster, pools] = await Promise.all([
          input.repositories.roster.loadAcceptedHorseRosterByOwner(ownerId),
          input.repositories.opponentPools.loadAcceptedHorseOpponentPoolsByOwner(
            ownerId,
          ),
        ]);
        if (roster === null || pools === null) return null;
        if (
          roster.databaseOwnerId !== ownerId ||
          pools.databaseOwnerId !== ownerId ||
          !Array.isArray(roster.cores) ||
          !Array.isArray(pools.cores) ||
          !Array.isArray(pools.groups) ||
          roster.cores.length < 1 ||
          roster.cores.length > TOURNAMENT_HORSE_SCREENING_MAXIMUM_CORES ||
          pools.groups.length < 1 ||
          pools.groups.length > MAXIMUM_GROUP_COUNT
        )
          fail();
        const rosterVersion = hash(roster.rosterSnapshotVersion);
        const opponentPoolVersion = hash(pools.opponentPoolSnapshotVersion);
        const profiles = mergeProfiles(roster.cores, pools.cores);
        const ownedCoreIds = new Set(
          roster.cores.map(({ coreId }) => text(coreId)),
        );
        const elements = [
          ...new Set(roster.cores.map(({ element }) => text(element, 128))),
        ].sort();
        const expectedGroupKeys = new Set(
          elements.flatMap((element) =>
            horseOneVOneTournamentDistances.map(
              (distance) => `${element}\u0000${distance}`,
            ),
          ),
        );
        const groupsByKey = new Map<string, TournamentHorseOpponentPoolGroup>();
        for (const group of pools.groups) {
          const element = text(group.element, 128);
          if (
            !horseOneVOneTournamentDistances.includes(
              group.distanceMetres as (typeof horseOneVOneTournamentDistances)[number],
            )
          )
            fail();
          const key = `${element}\u0000${group.distanceMetres}`;
          if (groupsByKey.has(key)) fail();
          const fieldIds = unique(group.tournamentFieldOpponentCoreIds);
          const stressIds = unique(group.topTenPercentOpponentCoreIds);
          if (
            [...fieldIds, ...stressIds].some(
              (coreId) => profiles.get(coreId)?.element !== element,
            )
          )
            fail();
          groupsByKey.set(key, {
            ...group,
            element,
            tournamentFieldOpponentCoreIds: fieldIds,
            topTenPercentOpponentCoreIds: stressIds,
          });
        }
        const requestedCoreIds = Object.freeze(
          [
            ...new Set([
              ...ownedCoreIds,
              ...pools.groups.flatMap((group) => [
                ...group.tournamentFieldOpponentCoreIds,
                ...group.topTenPercentOpponentCoreIds,
              ]),
            ]),
          ].sort(),
        );
        const history =
          await input.repositories.history.loadAcceptedHorseHistoryByOwner(
            ownerId,
            {
              coreIds: requestedCoreIds,
              distancesMetres: horseOneVOneTournamentDistances,
              maximumRows: MAXIMUM_OBSERVATION_COUNT,
            },
          );
        if (history === null) return null;
        if (history.databaseOwnerId !== ownerId) fail();
        const evidenceCutoff = timestamp(history.evidenceCutoff);
        const histories = historyMap(history, requestedCoreIds);
        const groups: HorseOneVOneScreeningGroup[] = [];
        for (const key of [...expectedGroupKeys].sort()) {
          const pool = groupsByKey.get(key);
          if (pool === undefined) continue;
          const distance =
            pool.distanceMetres as (typeof horseOneVOneTournamentDistances)[number];
          const evidenceCoreIds = new Set([
            ...roster.cores
              .filter(({ element }) => element === pool.element)
              .map(({ coreId }) => coreId),
            ...pool.tournamentFieldOpponentCoreIds,
            ...pool.topTenPercentOpponentCoreIds,
          ]);
          groups.push(
            Object.freeze({
              element: pool.element,
              distanceMetres: distance,
              evidence: Object.freeze(
                [...evidenceCoreIds].sort().map((coreId) => {
                  const profile = profiles.get(coreId);
                  if (profile === undefined) fail();
                  return buildCoreEvidence(
                    profile,
                    ownedCoreIds,
                    histories.get(coreId) ?? [],
                    distance,
                  );
                }),
              ),
              tournamentFieldOpponentCoreIds:
                pool.tournamentFieldOpponentCoreIds,
              topTenPercentOpponentCoreIds: pool.topTenPercentOpponentCoreIds,
              opponentPoolStatus: pool.status,
            }),
          );
        }
        const exactGroupCoverage =
          groupsByKey.size === expectedGroupKeys.size &&
          [...groupsByKey.keys()].every((key) => expectedGroupKeys.has(key));
        const completeHistories =
          histories.size === requestedCoreIds.length &&
          requestedCoreIds.every((coreId) => histories.has(coreId));
        const state =
          roster.state === "accepted" &&
          pools.state === "accepted" &&
          history.state === "accepted"
            ? "accepted"
            : roster.state === "unknown" ||
                pools.state === "unknown" ||
                history.state === "unknown"
              ? "unknown"
              : "partial";
        const pointers = Object.freeze({
          rosterSnapshotVersion: rosterVersion,
          historyGenerationVersion: hash(history.historyGenerationVersion),
          observationSetSha256: hash(history.observationSetSha256),
          opponentPoolSnapshotVersion: opponentPoolVersion,
          evidenceCutoff,
        });
        const source: TournamentHorseScreeningAcceptedSource = Object.freeze({
          databaseOwnerId: ownerId,
          sourceSnapshotVersion: sourceIdentity(pointers),
          evidenceCutoff,
          coverage: Object.freeze({
            state,
            generationIntegrityVerified:
              history.state === "accepted" && history.truncated === false,
            ownerRosterVerified:
              roster.state === "accepted" &&
              roster.complete === true &&
              roster.truncated === false,
            exactHorseDistanceCoverageVerified:
              history.state === "accepted" &&
              history.completeForRequestedCores === true &&
              completeHistories,
            opponentPoolsVerified:
              pools.state === "accepted" &&
              pools.completeForRosterElements === true &&
              pools.truncated === false &&
              exactGroupCoverage &&
              groups.every(
                ({
                  opponentPoolStatus,
                  tournamentFieldOpponentCoreIds,
                  topTenPercentOpponentCoreIds,
                }) =>
                  opponentPoolStatus === "confirmed" &&
                  tournamentFieldOpponentCoreIds.length > 0 &&
                  topTenPercentOpponentCoreIds.length > 0,
              ),
            completeForRequestedCores:
              history.completeForRequestedCores === true && completeHistories,
            truncated:
              roster.truncated === true ||
              pools.truncated === true ||
              history.truncated === true,
          }),
          groups: Object.freeze(groups),
        });
        return source;
      } catch {
        return fail();
      }
    },

    async readAcceptedSourceIdentityByOwner(ownerId) {
      try {
        return await currentIdentity(ownerId);
      } catch {
        return fail();
      }
    },
  });
}
