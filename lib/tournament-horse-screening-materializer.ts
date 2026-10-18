import { createHash } from "node:crypto";

import {
  screenHorseOneVOneTournamentCandidates,
  type HorseOneVOneCoreEvidence,
  type HorseOneVOneScreeningGroup,
} from "@/domain/horse-one-v-one-tournament-screening";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const ERROR = "Tournament Horse screening materialization unavailable.";

export const TOURNAMENT_HORSE_SCREENING_MAXIMUM_GROUPS = 96;
// The accepted owner Vault currently contains 195 Cores. Keep the read bounded
// while allowing the whole Vault plus a compact confirmed opponent pool.
export const TOURNAMENT_HORSE_SCREENING_MAXIMUM_CORES = 512;
export const TOURNAMENT_HORSE_SCREENING_MAXIMUM_OBSERVATIONS = 10_000;
export const TOURNAMENT_HORSE_SCREENING_MAXIMUM_PAYLOAD_BYTES = 1_048_576;

export type TournamentHorseScreeningAcceptedCoverage = Readonly<{
  state: "accepted" | "partial" | "unknown";
  generationIntegrityVerified: boolean;
  ownerRosterVerified: boolean;
  exactHorseDistanceCoverageVerified: boolean;
  opponentPoolsVerified: boolean;
  completeForRequestedCores: boolean;
  truncated: boolean;
}>;

export type TournamentHorseScreeningAcceptedSource = Readonly<{
  databaseOwnerId: string;
  /** Content-addressed identity of history, roster, element and pool authority. */
  sourceSnapshotVersion: string;
  evidenceCutoff: string;
  coverage: TournamentHorseScreeningAcceptedCoverage;
  groups: readonly HorseOneVOneScreeningGroup[];
}>;

export type TournamentHorseScreeningPublicationCandidate = Readonly<{
  databaseOwnerId: string;
  expectedActiveSnapshotVersion: string | null;
  sourceSnapshotVersion: string;
  snapshotVersion: string;
  payloadJson: string;
  publishedAt: string;
}>;

export type TournamentHorseScreeningPublicationOutcome =
  "published" | "unchanged" | "source_changed";

export type TournamentHorseScreeningMaterializationOutcome =
  | Readonly<{ status: "source_unavailable" | "source_incomplete" }>
  | Readonly<{ status: TournamentHorseScreeningPublicationOutcome }>;

export type TournamentHorseScreeningAcceptedSourceBoundary = Readonly<{
  loadAcceptedSourceByOwner(
    ownerId: string,
  ): Promise<TournamentHorseScreeningAcceptedSource | null>;
  readAcceptedSourceIdentityByOwner(ownerId: string): Promise<string | null>;
}>;

export type TournamentHorseScreeningPublicationBoundary = Readonly<{
  readActiveSnapshotVersionByOwner(ownerId: string): Promise<string | null>;
  /**
   * Must compare expectedActiveSnapshotVersion and activate the immutable
   * content-addressed snapshot in one database transaction.
   */
  publishCandidate(
    candidate: TournamentHorseScreeningPublicationCandidate,
  ): Promise<TournamentHorseScreeningPublicationOutcome>;
}>;

function fail(): never {
  // Never disclose owner, roster, provider or race evidence in errors.
  throw new Error(ERROR);
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || value.trim() !== value) fail();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) fail();
  return value;
}

function canonicalEvidence(
  value: HorseOneVOneCoreEvidence,
): HorseOneVOneCoreEvidence {
  const observations = (
    input: HorseOneVOneCoreEvidence["distanceObservations"],
  ) =>
    Object.freeze(
      [...input].sort(
        (left, right) =>
          left.eventAt.localeCompare(right.eventAt) ||
          left.eventId.localeCompare(right.eventId),
      ),
    );
  return Object.freeze({
    ...value,
    distanceObservations: observations(value.distanceObservations),
    directOneVOneObservations: observations(value.directOneVOneObservations),
  });
}

function canonicalGroups(
  groups: readonly HorseOneVOneScreeningGroup[],
): readonly HorseOneVOneScreeningGroup[] {
  return Object.freeze(
    groups
      .map((group) =>
        Object.freeze({
          ...group,
          evidence: Object.freeze(
            group.evidence
              .map(canonicalEvidence)
              .sort((left, right) => left.coreId.localeCompare(right.coreId)),
          ),
          tournamentFieldOpponentCoreIds: Object.freeze(
            [...group.tournamentFieldOpponentCoreIds].sort(),
          ),
          topTenPercentOpponentCoreIds: Object.freeze(
            [...group.topTenPercentOpponentCoreIds].sort(),
          ),
        }),
      )
      .sort(
        (left, right) =>
          left.element.localeCompare(right.element) ||
          left.distanceMetres - right.distanceMetres,
      ),
  );
}

function accepted(source: TournamentHorseScreeningAcceptedSource): boolean {
  if (
    !source.coverage ||
    !Array.isArray(source.groups) ||
    source.groups.length < 1 ||
    source.groups.length > TOURNAMENT_HORSE_SCREENING_MAXIMUM_GROUPS
  )
    fail();
  const coreIds = new Set<string>();
  let observationCount = 0;
  for (const group of source.groups) {
    if (!Array.isArray(group.evidence)) fail();
    for (const core of group.evidence) {
      coreIds.add(core.coreId);
      observationCount +=
        core.distanceObservations.length +
        core.directOneVOneObservations.length;
    }
  }
  if (
    coreIds.size > TOURNAMENT_HORSE_SCREENING_MAXIMUM_CORES ||
    observationCount > TOURNAMENT_HORSE_SCREENING_MAXIMUM_OBSERVATIONS
  )
    fail();
  return (
    source.coverage.state === "accepted" &&
    source.coverage.generationIntegrityVerified === true &&
    source.coverage.ownerRosterVerified === true &&
    source.coverage.exactHorseDistanceCoverageVerified === true &&
    source.coverage.opponentPoolsVerified === true &&
    source.coverage.completeForRequestedCores === true &&
    source.coverage.truncated === false &&
    source.groups.every(
      ({ opponentPoolStatus }) => opponentPoolStatus === "confirmed",
    )
  );
}

/**
 * Builds and atomically publishes one bounded owner-scoped snapshot. The
 * accepted source adapter owns history/roster/context completeness; this
 * coordinator adds no classification, probability or opponent-pool rules.
 */
export async function materializeTournamentHorseScreeningSnapshot(
  input: Readonly<{
    databaseOwnerId: string;
    source: TournamentHorseScreeningAcceptedSourceBoundary;
    publication: TournamentHorseScreeningPublicationBoundary;
    now?: () => Date;
  }>,
): Promise<TournamentHorseScreeningMaterializationOutcome> {
  try {
    if (
      !UUID.test(input.databaseOwnerId) ||
      typeof input.source?.loadAcceptedSourceByOwner !== "function" ||
      typeof input.source?.readAcceptedSourceIdentityByOwner !== "function" ||
      typeof input.publication?.readActiveSnapshotVersionByOwner !==
        "function" ||
      typeof input.publication?.publishCandidate !== "function"
    )
      fail();
    const now = (input.now ?? (() => new Date()))();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) fail();

    const source = await input.source.loadAcceptedSourceByOwner(
      input.databaseOwnerId,
    );
    if (source === null) return { status: "source_unavailable" };
    if (
      source.databaseOwnerId !== input.databaseOwnerId ||
      !HASH.test(source.sourceSnapshotVersion)
    )
      fail();
    const evidenceCutoff = timestamp(source.evidenceCutoff);
    if (Date.parse(evidenceCutoff) > now.getTime()) fail();
    if (!accepted(source)) return { status: "source_incomplete" };

    const result = screenHorseOneVOneTournamentCandidates({
      evidenceCutoff,
      groups: canonicalGroups(source.groups),
    });
    if (result.candidates.length < 1 || result.candidates.length > 5_000)
      fail();
    const payloadJson = JSON.stringify({
      modelVersion: result.modelVersion,
      evidenceCutoff: result.evidenceCutoff,
      sourceSnapshotVersion: source.sourceSnapshotVersion,
      candidates: result.candidates,
    });
    if (
      Buffer.byteLength(payloadJson, "utf8") < 1 ||
      Buffer.byteLength(payloadJson, "utf8") >
        TOURNAMENT_HORSE_SCREENING_MAXIMUM_PAYLOAD_BYTES
    )
      fail();
    const snapshotVersion = createHash("sha256")
      .update(payloadJson, "utf8")
      .digest("hex");

    const acceptedIdentity =
      await input.source.readAcceptedSourceIdentityByOwner(
        input.databaseOwnerId,
      );
    if (acceptedIdentity !== source.sourceSnapshotVersion)
      return { status: "source_changed" };
    const expectedActiveSnapshotVersion =
      await input.publication.readActiveSnapshotVersionByOwner(
        input.databaseOwnerId,
      );
    if (
      expectedActiveSnapshotVersion !== null &&
      !HASH.test(expectedActiveSnapshotVersion)
    )
      fail();
    // The immutable row stores publishedAt outside the content-addressed body.
    // Re-publishing the same body with a later timestamp would conflict with
    // that immutable row, so an already-active digest is explicitly unchanged.
    if (expectedActiveSnapshotVersion === snapshotVersion)
      return { status: "unchanged" };

    const status = await input.publication.publishCandidate({
      databaseOwnerId: input.databaseOwnerId,
      expectedActiveSnapshotVersion,
      sourceSnapshotVersion: source.sourceSnapshotVersion,
      snapshotVersion,
      payloadJson,
      publishedAt: now.toISOString(),
    });
    if (
      !(["published", "unchanged", "source_changed"] as const).includes(status)
    )
      fail();
    return { status };
  } catch {
    return fail();
  }
}
