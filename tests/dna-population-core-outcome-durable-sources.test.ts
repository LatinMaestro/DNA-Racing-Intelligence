import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type {\n  DnaCoreRaceHistoryPublishedGeneration,\n} from "@/lib/dna-core-race-history-generation";
import {
  readDnaPersistedApiOutcomeDurableSource,
  readDnaRaceMergeOutcomeDurableSource,
} from "@/lib/dna-population-core-outcome-durable-sources";
import { dnaOpenLabRawEvidenceSha256 } from "@/lib/dna-open-lab-v1-adapters";
import type {
  ActiveDnaCoreRaceHistoryGenerationReadRepository,
  ActiveDnaCoreRaceHistoryGenerationRow,
} from "@/lib/neon-active-dna-core-race-history-generation";
import type { RaceMergeCoreOutcomeR2Manifest } from "@/lib/race-merge-core-outcome-r2-generation";

const GENERATION = "owner-race-merge-outcomes-v1";

function manifest(\n  core: number,\n  cohort: number,\n): RaceMergeCoreOutcomeR2Manifest {
  return Object.freeze({
    version: 1 as const,
    generationId: GENERATION,
    sourceCoreId: core,
    objectKey: `private/${cohort}/${core}.json`,
    bodySha256: core.toString(16).padStart(64, "0").slice(-64),
    byteLength: 100 + core,
    uniqueOutcomeCount: 1,
    sourceObservationCount: 1,
    firstSourceRaceId: `race-${core}`,
    lastSourceRaceId: `race-${core}`,
    registeredAt: "2026-10-05T00:00:00.000Z",
  });
}

function apiRow(\n  ordinal: number,\n  core: number,\n): ActiveDnaCoreRaceHistoryGenerationRow {
  const payload = Object.freeze({
    sourceType: "core_race_history_outcome" as const,
    payloadVersion: 1 as const,
    naturalKey: `core-result:${core}:race-api-${ordinal}`,
    resultEvidenceSha256: "b".repeat(64),
    raceDocumentEvidenceSha256: "c".repeat(64),
    raceDocumentObservedAt: "2026-10-05T00:00:00.000Z",
    sourceCoreId: String(core),
    sourceRaceId: `race-api-${ordinal}`,
    elapsedMilliseconds: 40_000 + ordinal,
    finishPosition: ordinal + 1,
    goldStar: false,
    blueStar: false,
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

function apiGeneration(
  rows: readonly ActiveDnaCoreRaceHistoryGenerationRow[],
): DnaCoreRaceHistoryPublishedGeneration {
  const digest = createHash("sha256");
  for (const row of rows) {
    digest.update(
      `${row.ordinal}:${row.naturalKey}:${row.rowSha256}\n`,
      "utf8",
    );
  }
  return Object.freeze({
    version: 1 as const,
    generationId: "a".repeat(64),
    materializedAt: "2026-10-05T00:00:00.000Z",
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
    state: "published" as const,
    publishedAt: "2026-10-05T00:01:00.000Z",
  });
}

describe("DNA population Core outcome durable sources", () => {
  it(\n    "reopens full cohorts plus a bounded terminal cohort without writes or DNA calls",\n    async () => {
    const cohortOne = Array.from({ length: 100 }, (_, index) =>
      manifest(index + 1, 1),
    );
    const cohortTwo = [manifest(101, 2), manifest(102, 2)];
    const repository = {
      listManifests: vi.fn(
        async (
          _ownerId: string,
          request: {
            cohortOrdinal: number;
            afterSourceCoreId: number;
            limit: number;
          },
        ) => {
          const source =
            request.cohortOrdinal === 1
              ? cohortOne
              : request.cohortOrdinal === 2
                ? cohortTwo
                : [];
          return Object.freeze(
            source
              .filter(
                (value) => value.sourceCoreId > request.afterSourceCoreId,
              )
              .slice(0, request.limit),
          );
        },
      ),
    };
    const store = {
      read: vi.fn(async (receipt: RaceMergeCoreOutcomeR2Manifest) =>
        Object.freeze([
          Object.freeze({
            source: "race_merge" as const,
            sourceCoreId: receipt.sourceCoreId,
            sourceRaceId: receipt.firstSourceRaceId,
            finishPosition: 1,
            elapsedMilliseconds: 50_000,
          }),
        ]),
      ),
    };

    const source = await readDnaRaceMergeOutcomeDurableSource({
      ownerId: "private-owner",
      generationId: GENERATION,
      terminalCohortOrdinal: 2,
      terminalCoreCount: 2,
      repository,
      store,
    });

    expect(source).toMatchObject({
      cohortCount: 2,
      manifestCount: 102,
      uniqueOutcomeCount: 102,
      sourceObservationCount: 102,
      firstSourceCoreId: 1,
      lastSourceCoreId: 102,
      dnaProviderRequestCount: 0,
      persistentWritePerformed: false,
      paidUsageAllowed: false,
    });
    await expect(source.loadOutcomes(102)).resolves.toEqual([
      {
        source: "race_merge",
        sourceCoreId: 102,
        sourceRaceId: "race-102",
        finishPosition: 1,
        elapsedMilliseconds: 50_000,
      },
    ]);
    await expect(source.loadOutcomes(999)).resolves.toEqual([]);
  });

  it("fails closed when a non-terminal cohort is not exactly 100 Cores", async () => {
    const repository = {
      listManifests: vi.fn(async () =>
        Object.freeze([manifest(1, 1), manifest(2, 1)]),
      ),
    };
    await expect(
      readDnaRaceMergeOutcomeDurableSource({
        ownerId: "private-owner",
        generationId: GENERATION,
        terminalCohortOrdinal: 2,
        terminalCoreCount: 1,
        repository,
        store: { read: vi.fn() },
      }),
    ).rejects.toThrow("manifest count");
  });

  it(\n    "reopens the published API generation, verifies its digest and indexes outcomes by Core",\n    async () => {
    const rows = [apiRow(0, 101), apiRow(1, 101), apiRow(2, 202)];
    const active = apiGeneration(rows);
    const repository: ActiveDnaCoreRaceHistoryGenerationReadRepository = {
      readActiveGeneration: vi.fn(async () => active),
      readActiveRows: vi.fn(async (_ownerId, afterOrdinal, limit) =>
        Object.freeze(
          rows
            .filter((row) => row.ordinal > afterOrdinal)
            .slice(0, limit),
        ),
      ),
    };

    const source = await readDnaPersistedApiOutcomeDurableSource({
      ownerId: "private-owner",
      repository,
      pageSize: 2,
    });

    expect(source).not.toBeNull();
    expect(source).toMatchObject({
      generationId: active.generationId,
      observationCount: 3,
      coreCount: 2,
      payloadSha256: active.payloadSha256,
      dnaProviderRequestCount: 0,
      persistentWritePerformed: false,
      paidUsageAllowed: false,
    });
    await expect(source!.loadOutcomes(101)).resolves.toEqual([
      expect.objectContaining({
        source: "core_history_api",
        sourceCoreId: 101,
        sourceRaceId: "race-api-0",
      }),
      expect.objectContaining({
        source: "core_history_api",
        sourceCoreId: 101,
        sourceRaceId: "race-api-1",
      }),
    ]);
    expect(repository.readActiveGeneration).toHaveBeenCalledTimes(2);
  });

  it("fails closed on API payload digest drift", async () => {
    const rows = [apiRow(0, 101)];
    const active = {\n      ...apiGeneration(rows),\n      payloadSha256: "f".repeat(64),\n    };
    const repository: ActiveDnaCoreRaceHistoryGenerationReadRepository = {
      readActiveGeneration: vi.fn(async () => active),
      readActiveRows: vi.fn(async () => rows),
    };
    await expect(
      readDnaPersistedApiOutcomeDurableSource({
        ownerId: "private-owner",
        repository,
      }),
    ).rejects.toThrow("digest changed");
  });
});
