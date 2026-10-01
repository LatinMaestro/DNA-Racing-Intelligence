import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { activeCoreHistoryProLeagueSource } from "@/lib/active-core-history-pro-league-source";
import type { DnaCoreRaceHistoryPublishedGeneration } from "@/lib/dna-core-race-history-generation";
import { dnaOpenLabRawEvidenceSha256 } from "@/lib/dna-open-lab-v1-adapters";
import type {
  ActiveDnaCoreRaceHistoryGenerationReadRepository,
  ActiveDnaCoreRaceHistoryGenerationRow,
} from "@/lib/neon-active-dna-core-race-history-generation";

function row(ordinal: number): ActiveDnaCoreRaceHistoryGenerationRow {
  const payload = {
    sourceType: "joined_core_race_history_result" as const,
    naturalKey: `core-result:${101 + ordinal}:race-${ordinal + 1}`,
    resultEvidenceSha256: "b".repeat(64),
    raceDocumentEvidenceSha256: "c".repeat(64),
    raceDocumentObservedAt: "2026-09-16T00:00:00.000Z",
    sourceCoreId: String(101 + ordinal),
    sourceRaceId: `race-${ordinal + 1}`,
    mode: "bike" as const,
    distanceMetres: 1_200,
    distanceAuthority: "result_and_race_document" as const,
    elapsedMilliseconds: 40_000 + ordinal,
    finishPosition: ordinal + 1,
    eventAt: `2026-09-${String(14 + ordinal).padStart(2, "0")}T00:00:00.000Z`,
    gateCount: 12,
    payoutMechanismSourceValue: "Winner Take All",
    sourceFormat: "standard",
    sourceRaceClass: null,
    goldStar: false,
    blueStar: false,
    starEvidenceStatus: "available" as const,
    publishedCellStatus: "accepted" as const,
    raceType: "12 gate WTA",
    mapIds: ["map-1"],
  };
  return Object.freeze({
    generationId: "a".repeat(64),
    ordinal,
    naturalKey: payload.naturalKey,
    rowSha256: dnaOpenLabRawEvidenceSha256(payload),
    payload,
  });
}

function compactRow(ordinal: number): ActiveDnaCoreRaceHistoryGenerationRow {
  const payload = Object.freeze({
    sourceType: "core_race_history_outcome" as const,
    payloadVersion: 1 as const,
    naturalKey: `bike:race-${ordinal + 1}:${101 + ordinal}`,
    resultEvidenceSha256: "b".repeat(64),
    raceDocumentEvidenceSha256: "c".repeat(64),
    raceDocumentObservedAt: "2026-09-16T00:00:00.000Z",
    sourceCoreId: String(101 + ordinal),
    sourceRaceId: `race-${ordinal + 1}`,
    elapsedMilliseconds: 40_000 + ordinal,
    finishPosition: ordinal + 1,
    goldStar: ordinal === 0,
    blueStar: ordinal === 1,
    starEvidenceStatus: "available" as const,
  });
  return Object.freeze({
    generationId: "a".repeat(64),
    ordinal,
    naturalKey: payload.naturalKey,
    rowSha256: dnaOpenLabRawEvidenceSha256(payload),
    payload,
  });
}

function generation(rows: readonly ActiveDnaCoreRaceHistoryGenerationRow[]) {
  const digest = createHash("sha256");
  for (const value of rows) {
    digest.update(
      `${value.ordinal}:${value.naturalKey}:${value.rowSha256}\n`,
      "utf8",
    );
  }
  return Object.freeze({
    version: 1,
    generationId: "a".repeat(64),
    materializedAt: "2026-09-16T00:00:00.000Z",
    cycleSetSha256: "d".repeat(64),
    observationSetSha256: "e".repeat(64),
    payloadSha256: digest.digest("hex"),
    inputCycleCount: 1,
    inputPageCount: 1,
    inputResultCount: rows.length,
    replayDuplicateCount: 0,
    raceDocumentCount: rows.length,
    entrantAuthorityOmissionCount: 0,
    entrantMismatchOmissionCount: 0,
    exactDistanceConfirmedCount: rows.length,
    acceptedPublishedCellCount: rows.length,
    missingFormatCount: 0,
    unsupportedFormatCount: 0,
    unpublishedCellCount: 0,
    observationCount: rows.length,
    state: "published",
    publishedAt: "2026-09-16T00:01:00.000Z",
  }) satisfies DnaCoreRaceHistoryPublishedGeneration;
}

async function collect<T>(source: AsyncIterable<T>): Promise<readonly T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

describe("active Core history Pro League source", () => {
  it("pages, reconciles and adapts only authoritative race facts", async () => {
    const rows = [row(0), row(1)];
    const active = generation(rows);
    const repository: ActiveDnaCoreRaceHistoryGenerationReadRepository = {
      readActiveGeneration: vi.fn(async () => active),
      readActiveRows: vi.fn(async (_owner, afterOrdinal) =>
        rows.filter((value) => value.ordinal > afterOrdinal).slice(0, 1),
      ),
    };
    const source = await activeCoreHistoryProLeagueSource({
      ownerId: "private_owner",
      repository,
      pageSize: 1,
    });
    expect(source).not.toBeNull();
    await expect(collect(source!.observations)).resolves.toEqual([
      {
        naturalKey: rows[0]!.naturalKey,
        sourceCoreId: "101",
        eventAt: "2026-09-14T00:00:00.000Z",
        mode: "bike",
        distanceMetres: 1_200,
        gateCount: 12,
        finishPosition: 1,
        elapsedMilliseconds: 40_000,
        payoutMechanismSourceValue: "Winner Take All",
        goldStar: null,
        blueStar: null,
        goldStarAssignmentOpportunity: null,
        blueStarAssignmentOpportunity: null,
        starEvidenceStatus: "missing",
      },
      expect.objectContaining({ sourceCoreId: "102", finishPosition: 2 }),
    ]);
    expect(repository.readActiveGeneration).toHaveBeenCalledTimes(2);
  });

  it("joins compact outcomes to canonical Race authority at read time", async () => {
    const rows = [compactRow(0), compactRow(1)];
    const active = generation(rows);
    const repository: ActiveDnaCoreRaceHistoryGenerationReadRepository = {
      readActiveGeneration: vi.fn(async () => active),
      readActiveRows: vi.fn(async () => rows),
    };
    const raceAuthority = {
      readRaceDocuments: vi.fn(
        async (
          _owner: string,
          references: readonly Readonly<{ sourceRaceId: string }>[],
        ) =>
          references.map(({ sourceRaceId }, index) =>
            Object.freeze({
              source: "dna_open_lab" as const,
              sourceVersion: "v1" as const,
              scope: "races" as const,
              endpoint: "races.docs",
              entityKey: `race:${sourceRaceId}`,
              observedAt: "2026-09-16T00:00:00.000Z",
              rawEvidenceSha256: "c".repeat(64),
              canonical: Object.freeze({
                sourceType: "race_document" as const,
                sourceRaceId,
                mode: "bike" as const,
                distanceMetres: 1_200,
                gateCount: 12,
                entrantCoreIds: [String(101 + index)],
                yellowStarSourceCoreIds: index === 0 ? ["101"] : [],
                blueStarSourceCoreIds: index === 1 ? ["102"] : [],
                startAt: `2026-09-${String(14 + index).padStart(2, "0")}T00:00:00.000Z`,
                payoutSourceValue: "Winner Take All",
              }),
            }),
          ),
      ),
    };
    const source = await activeCoreHistoryProLeagueSource({
      ownerId: "private_owner",
      repository,
      raceAuthority,
    });

    await expect(collect(source!.observations)).resolves.toEqual([
      expect.objectContaining({
        sourceCoreId: "101",
        mode: "bike",
        distanceMetres: 1_200,
        gateCount: 12,
        finishPosition: 1,
        elapsedMilliseconds: 40_000,
        goldStar: true,
        blueStar: false,
        goldStarAssignmentOpportunity: true,
        blueStarAssignmentOpportunity: false,
        starEvidenceStatus: "available",
      }),
      expect.objectContaining({ sourceCoreId: "102", finishPosition: 2 }),
    ]);
    expect(raceAuthority.readRaceDocuments).toHaveBeenCalledWith(
      "private_owner",
      [
        {
          sourceRaceId: "race-1",
          observedAt: "2026-09-16T00:00:00.000Z",
          rawEvidenceSha256: "c".repeat(64),
        },
        {
          sourceRaceId: "race-2",
          observedAt: "2026-09-16T00:00:00.000Z",
          rawEvidenceSha256: "c".repeat(64),
        },
      ],
    );
  });

  it("fails closed when compact outcomes lack exact canonical Race evidence", async () => {
    const rows = [compactRow(0)];
    const active = generation(rows);
    const repository: ActiveDnaCoreRaceHistoryGenerationReadRepository = {
      readActiveGeneration: vi.fn(async () => active),
      readActiveRows: vi.fn(async () => rows),
    };
    const unavailable = await activeCoreHistoryProLeagueSource({
      ownerId: "private_owner",
      repository,
    });
    await expect(collect(unavailable!.observations)).rejects.toThrow(
      "canonical Race authority is unavailable",
    );
  });

  it("fails closed on incomplete coverage, digest drift and pointer drift", async () => {
    const rows = [row(0)];
    const active = generation(rows);
    const incomplete: ActiveDnaCoreRaceHistoryGenerationReadRepository = {
      readActiveGeneration: vi.fn(async () => ({
        ...active,
        observationCount: 2,
        exactDistanceConfirmedCount: 2,
        acceptedPublishedCellCount: 2,
        inputResultCount: 2,
      })),
      readActiveRows: vi.fn(async (_owner, afterOrdinal) =>
        afterOrdinal < 0 ? rows : [],
      ),
    };
    const incompleteSource = await activeCoreHistoryProLeagueSource({
      ownerId: "private_owner",
      repository: incomplete,
    });
    await expect(collect(incompleteSource!.observations)).rejects.toThrow(
      "coverage is incomplete",
    );

    const digestDrift: ActiveDnaCoreRaceHistoryGenerationReadRepository = {
      readActiveGeneration: vi.fn(async () => ({
        ...active,
        payloadSha256: "0".repeat(64),
      })),
      readActiveRows: vi.fn(async () => rows),
    };
    const digestDriftSource = await activeCoreHistoryProLeagueSource({
      ownerId: "private_owner",
      repository: digestDrift,
    });
    await expect(collect(digestDriftSource!.observations)).rejects.toThrow(
      "digest changed",
    );

    const drifted: ActiveDnaCoreRaceHistoryGenerationReadRepository = {
      readActiveGeneration: vi
        .fn()
        .mockResolvedValueOnce(active)
        .mockResolvedValueOnce({ ...active, generationId: "f".repeat(64) }),
      readActiveRows: vi.fn(async () => rows),
    };
    const driftedSource = await activeCoreHistoryProLeagueSource({
      ownerId: "private_owner",
      repository: drifted,
    });
    await expect(collect(driftedSource!.observations)).rejects.toThrow(
      "pointer changed",
    );
  });
});
