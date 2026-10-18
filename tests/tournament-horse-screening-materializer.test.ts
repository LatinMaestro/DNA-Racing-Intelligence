import { describe, expect, it, vi } from "vitest";

import type { HorseOneVOneCoreEvidence } from "@/domain/horse-one-v-one-tournament-screening";
import {
  materializeTournamentHorseScreeningSnapshot,
  TOURNAMENT_HORSE_SCREENING_MAXIMUM_OBSERVATIONS,
  type TournamentHorseScreeningAcceptedSource,
  type TournamentHorseScreeningPublicationCandidate,
} from "@/lib/tournament-horse-screening-materializer";

const owner = "11111111-1111-4111-8111-111111111111";
const sourceVersion = "a".repeat(64);
const cutoff = "2026-10-18T00:00:00.000Z";

function evidence(input: {
  coreId: string;
  name: string;
  owned: boolean;
  elapsed: readonly number[];
  direct?: boolean;
}): HorseOneVOneCoreEvidence {
  const distanceObservations = input.elapsed.map(
    (elapsedTimeMilliseconds, index) => ({
      eventId: `${input.coreId}-${index}`,
      eventAt: `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      elapsedTimeMilliseconds,
    }),
  );
  return {
    coreId: input.coreId,
    name: input.name,
    owned: input.owned,
    element: "Fire",
    distanceMetres: 1000,
    distanceObservations,
    directOneVOneObservations: input.direct ? distanceObservations : [],
  };
}

const candidate = evidence({
  coreId: "101",
  name: "Candidate",
  owned: true,
  elapsed: Array.from({ length: 10 }, (_, index) => 50_000 + index),
  direct: true,
});
const opponent = evidence({
  coreId: "201",
  name: "Opponent",
  owned: false,
  elapsed: Array.from({ length: 10 }, (_, index) => 55_000 + index),
  direct: true,
});

function acceptedSource(
  change: Partial<TournamentHorseScreeningAcceptedSource> = {},
): TournamentHorseScreeningAcceptedSource {
  return {
    databaseOwnerId: owner,
    sourceSnapshotVersion: sourceVersion,
    evidenceCutoff: cutoff,
    coverage: {
      state: "accepted",
      generationIntegrityVerified: true,
      ownerRosterVerified: true,
      exactHorseDistanceCoverageVerified: true,
      opponentPoolsVerified: true,
      completeForRequestedCores: true,
      truncated: false,
    },
    groups: [
      {
        element: "Fire",
        distanceMetres: 1000,
        evidence: [opponent, candidate],
        tournamentFieldOpponentCoreIds: ["201"],
        topTenPercentOpponentCoreIds: ["201"],
        opponentPoolStatus: "confirmed",
      },
    ],
    ...change,
  };
}

function harness(change: Partial<TournamentHorseScreeningAcceptedSource> = {}) {
  const sourceValue = acceptedSource(change);
  const loadAcceptedSourceByOwner = vi.fn(async () => sourceValue);
  const readAcceptedSourceIdentityByOwner = vi.fn(async () => sourceVersion);
  const readActiveSnapshotVersionByOwner = vi.fn(
    async (): Promise<string | null> => "b".repeat(64),
  );
  const publishCandidate = vi.fn(
    async (
      publicationCandidate: TournamentHorseScreeningPublicationCandidate,
    ) => {
      void publicationCandidate;
      return "published" as const;
    },
  );
  const run = () =>
    materializeTournamentHorseScreeningSnapshot({
      databaseOwnerId: owner,
      source: {
        loadAcceptedSourceByOwner,
        readAcceptedSourceIdentityByOwner,
      },
      publication: {
        readActiveSnapshotVersionByOwner,
        publishCandidate,
      },
      now: () => new Date("2026-10-19T00:00:00.000Z"),
    });
  return {
    run,
    loadAcceptedSourceByOwner,
    readAcceptedSourceIdentityByOwner,
    readActiveSnapshotVersionByOwner,
    publishCandidate,
  };
}

describe("Tournament Horse screening snapshot materializer", () => {
  it("publishes one canonical content-addressed snapshot from accepted bounded evidence", async () => {
    const test = harness();
    await expect(test.run()).resolves.toEqual({ status: "published" });
    expect(test.publishCandidate).toHaveBeenCalledWith({
      databaseOwnerId: owner,
      expectedActiveSnapshotVersion: "b".repeat(64),
      sourceSnapshotVersion: sourceVersion,
      snapshotVersion: expect.stringMatching(/^[a-f0-9]{64}$/u),
      payloadJson: expect.any(String),
      publishedAt: "2026-10-19T00:00:00.000Z",
    });
    const publication = test.publishCandidate.mock.calls[0]![0];
    expect(JSON.parse(publication.payloadJson)).toMatchObject({
      modelVersion: "horse-1v1-exact-distance-transfer-v2",
      evidenceCutoff: cutoff,
      sourceSnapshotVersion: sourceVersion,
      candidates: [
        {
          coreId: "101",
          expectedFieldPWinMillionths: 1_000_000,
          projectedFieldOutperformanceMillionths: 1_000_000,
          decisionUseAllowed: false,
          economicStatus: "unavailable",
        },
      ],
    });
  });

  it("canonicalizes source ordering before hashing", async () => {
    const first = harness();
    const reversedCandidate = {
      ...candidate,
      distanceObservations: [...candidate.distanceObservations].reverse(),
      directOneVOneObservations: [
        ...candidate.directOneVOneObservations,
      ].reverse(),
    };
    const reversedOpponent = {
      ...opponent,
      distanceObservations: [...opponent.distanceObservations].reverse(),
      directOneVOneObservations: [
        ...opponent.directOneVOneObservations,
      ].reverse(),
    };
    const second = harness({
      groups: [
        {
          ...acceptedSource().groups[0]!,
          evidence: [reversedCandidate, reversedOpponent],
        },
      ],
    });
    await first.run();
    await second.run();
    expect(second.publishCandidate.mock.calls[0]![0].snapshotVersion).toBe(
      first.publishCandidate.mock.calls[0]![0].snapshotVersion,
    );
    expect(second.publishCandidate.mock.calls[0]![0].payloadJson).toBe(
      first.publishCandidate.mock.calls[0]![0].payloadJson,
    );
  });

  it("returns unchanged without conflicting with an immutable active row", async () => {
    const first = harness();
    await first.run();
    const activeVersion =
      first.publishCandidate.mock.calls[0]![0].snapshotVersion;
    const repeated = harness();
    repeated.readActiveSnapshotVersionByOwner.mockResolvedValueOnce(
      activeVersion,
    );
    await expect(repeated.run()).resolves.toEqual({ status: "unchanged" });
    expect(repeated.publishCandidate).not.toHaveBeenCalled();
  });

  it("withholds incomplete accepted authority without publishing", async () => {
    const value = acceptedSource();
    const test = harness({
      coverage: { ...value.coverage, opponentPoolsVerified: false },
    });
    await expect(test.run()).resolves.toEqual({ status: "source_incomplete" });
    expect(test.readAcceptedSourceIdentityByOwner).not.toHaveBeenCalled();
    expect(test.publishCandidate).not.toHaveBeenCalled();
  });

  it("preserves last-good when source identity changes before publication", async () => {
    const test = harness();
    test.readAcceptedSourceIdentityByOwner.mockResolvedValueOnce(
      "c".repeat(64),
    );
    await expect(test.run()).resolves.toEqual({ status: "source_changed" });
    expect(test.readActiveSnapshotVersionByOwner).not.toHaveBeenCalled();
    expect(test.publishCandidate).not.toHaveBeenCalled();
  });

  it("fails closed and sanitizes unbounded or malformed source evidence", async () => {
    const tooMany = Array.from(
      { length: TOURNAMENT_HORSE_SCREENING_MAXIMUM_OBSERVATIONS + 1 },
      (_, index) => ({
        eventId: `event-${index}`,
        eventAt: "2026-09-01T00:00:00.000Z",
        elapsedTimeMilliseconds: 50_000,
      }),
    );
    const test = harness({
      groups: [
        {
          ...acceptedSource().groups[0]!,
          evidence: [{ ...candidate, distanceObservations: tooMany }, opponent],
        },
      ],
    });
    await expect(test.run()).rejects.toThrow(
      "Tournament Horse screening materialization unavailable.",
    );
    expect(test.publishCandidate).not.toHaveBeenCalled();
  });
});
