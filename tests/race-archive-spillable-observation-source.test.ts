import { describe, expect, it } from "vitest";

import type { DurablePreviewStagedRow } from "../lib/durable-import-preview-staging-sink";
import type { SealedRaceArchiveManifest } from "../lib/neon-sealed-race-archive-manifest-repository";
import type { RaceArchiveCoreAnalyticalObservation } from "../lib/race-archive-core-analytical-observations";
import type { RaceArchiveExternalSortedRunStore } from "../lib/race-archive-external-sort";
import type { RaceArchiveAggregateRefreshPlanVersion } from "../lib/race-archive-aggregate-refresher";
import { prepareSpillableRaceArchiveObservations } from "../lib/race-archive-spillable-observation-source";
import type {
  RaceStagedRowRehydrator,
  RehydratedRaceStagedRow,
} from "../lib/race-staged-row-rehydrator";

const OWNER_ID = "owner-1";

function plan(input: {
  datasetVersionId: string;
  importBatchId: string;
  versionNumber: number;
}): RaceArchiveAggregateRefreshPlanVersion {
  return {
    datasetVersionId: input.datasetVersionId,
    importBatchId: input.importBatchId,
    versionNumber: input.versionNumber,
    sourceRowCount: 1,
    acceptedRowCount: 1,
    evidencePartitionCount: 1,
    evidenceRowCount: 1,
  };
}

function manifest(input: {
  datasetVersionId: string;
  importBatchId: string;
}): SealedRaceArchiveManifest {
  return {
    datasetVersionId: input.datasetVersionId,
    importBatchId: input.importBatchId,
    sourceType: "race_merge",
    evidenceKind: "staged_rows",
    partitionCount: 1,
    rowCount: 1,
    byteSize: 128,
    objects: [
      {
        ownerId: OWNER_ID,
        importBatchId: input.importBatchId,
        sourceType: "race_merge",
        objectKind: "staged_rows",
        partitionNumber: 0,
        objectFormat: "ndjson_gzip",
        objectKey: `archive/${input.datasetVersionId}/part-0.ndjson.gz`,
        checksumSha256: "f".repeat(64),
        byteSize: 128,
        rowCount: 1,
        firstNaturalKey: "event-1:core-1",
        lastNaturalKey: "event-1:core-1",
        createdAt: "2026-08-20T01:00:00.000Z",
      },
    ],
  };
}

function stagedRow(input: {
  sourceEventId: string;
  sourceCoreId: string;
  fingerprintSha256: string;
  elapsedTimeSourceValue?: string;
}): DurablePreviewStagedRow {
  return {
    sourceRowNumber: 1,
    naturalKey: `${input.sourceEventId}:${input.sourceCoreId}`,
    fingerprintSha256: input.fingerprintSha256,
    row: {
      status: "ready",
      sourceType: "race_merge",
      provenance: [],
      issues: [],
      record: {
        sourceType: "race_merge",
        sourceEventId: input.sourceEventId,
        eventAt: "2026-08-20T01:02:03.000Z",
        sourceEventDatetime: "2026-08-20T01:02:03.000Z",
        mode: "bike",
        distance: 1000,
        sourceCoreId: input.sourceCoreId,
        coreNameSourceValue: "Core One",
        gate: 2,
        gateCount: 8,
        goldStar: true,
        blueStar: false,
        goldStarEligible: true,
        goldStarSourceValue: "true",
        blueStarSourceValue: "false",
        starDataStatus: "complete",
        finishPosition: 1,
        elapsedTimeSourceValue: input.elapsedTimeSourceValue ?? "61.250",
        sourceRaceClass: "A",
        sourceFormat: "Sprint",
        feeSourceValue: "0",
        prizeSourceValue: "0",
        assetSourceValue: "DEZ",
        payoutMechanismSourceValue: "Top 3",
        raceTagsSourceValue: "Synthetic",
        raceAsset: "DEZ",
        entryFeeAmount: "0",
        grossPayoutAmount: "0",
        economicDataStatus: "ready",
      },
    },
  };
}

function asyncRows(
  rows: readonly RehydratedRaceStagedRow[],
): AsyncIterable<RehydratedRaceStagedRow> {
  return (async function* () {
    for (const row of rows) yield row;
  })();
}

function rehydrator(
  rowsByVersion: ReadonlyMap<string, DurablePreviewStagedRow>,
): RaceStagedRowRehydrator {
  return {
    async open(input) {
      const row = rowsByVersion.get(input.datasetVersionId);
      if (row === undefined) return { status: "missing" as const };
      const importBatchId = `batch-${input.datasetVersionId}`;
      return {
        status: "ready" as const,
        manifest: manifest({
          datasetVersionId: input.datasetVersionId,
          importBatchId,
        }),
        rows: asyncRows([
          {
            datasetVersionId: input.datasetVersionId,
            importBatchId,
            partitionNumber: 0,
            stagedRow: row,
          },
        ]),
      };
    },
  };
}

function memoryStore(input?: { deleted?: string[] }): {
  store: RaceArchiveExternalSortedRunStore<RaceArchiveCoreAnalyticalObservation>;
  runs: Map<string, RaceArchiveCoreAnalyticalObservation[]>;
} {
  const runs = new Map<string, RaceArchiveCoreAnalyticalObservation[]>();
  return {
    runs,
    store: {
      async writeRun({ runId, records }) {
        const values: RaceArchiveCoreAnalyticalObservation[] = [];
        for await (const record of records) values.push(record);
        runs.set(runId, values);
      },
      readRun({ runId }) {
        const values = runs.get(runId) ?? [];
        return (async function* () {
          for (const value of values) yield value;
        })();
      },
      async deleteRun({ runId }) {
        runs.delete(runId);
        input?.deleted?.push(runId);
      },
    },
  };
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}

function prepare(input: {
  versions: readonly RaceArchiveAggregateRefreshPlanVersion[];
  rehydrator: RaceStagedRowRehydrator;
  store: RaceArchiveExternalSortedRunStore<RaceArchiveCoreAnalyticalObservation>;
}) {
  return prepareSpillableRaceArchiveObservations({
    ownerId: OWNER_ID,
    versions: input.versions,
    rehydrator: input.rehydrator,
    store: input.store,
    runPrefix: "aggregate-refresh-1",
    maximumArchivePartitions: 10,
    maximumRecordsInMemory: 1,
    mergeFanIn: 2,
    maximumInputObservations: 10,
    maximumRunObjects: 20,
  });
}

describe("spillable Race archive observation source", () => {
  it("streams exact unique observations after spillable replay deduplication", async () => {
    const first = plan({
      datasetVersionId: "version-1",
      importBatchId: "batch-version-1",
      versionNumber: 1,
    });
    const second = plan({
      datasetVersionId: "version-2",
      importBatchId: "batch-version-2",
      versionNumber: 2,
    });
    const { store, runs } = memoryStore();
    const source = await prepare({
      versions: [first, second],
      rehydrator: rehydrator(
        new Map([
          [
            "version-1",
            stagedRow({
              sourceEventId: "event-1",
              sourceCoreId: "core-1",
              fingerprintSha256: "a".repeat(64),
            }),
          ],
          [
            "version-2",
            stagedRow({
              sourceEventId: "event-1",
              sourceCoreId: "core-1",
              fingerprintSha256: "a".repeat(64),
            }),
          ],
        ]),
      ),
      store,
    });

    expect(source.inputObservationCount).toBe(2);
    expect(source.initialRunCount).toBe(2);
    const unique = await collect(source.readUnique());
    expect(unique).toHaveLength(1);
    expect(unique[0]).toMatchObject({
      naturalKey: "event-1:core-1",
      sourceEventId: "event-1",
      sourceCoreId: "core-1",
      versionNumber: 1,
      elapsedMilliseconds: 61_250,
    });
    expect(runs.size).toBe(0);
  });

  it("fails closed on conflicting replay evidence and cleans scratch runs", async () => {
    const versions = [
      plan({
        datasetVersionId: "version-1",
        importBatchId: "batch-version-1",
        versionNumber: 1,
      }),
      plan({
        datasetVersionId: "version-2",
        importBatchId: "batch-version-2",
        versionNumber: 2,
      }),
    ];
    const deleted: string[] = [];
    const { store, runs } = memoryStore({ deleted });
    const source = await prepare({
      versions,
      rehydrator: rehydrator(
        new Map([
          [
            "version-1",
            stagedRow({
              sourceEventId: "event-1",
              sourceCoreId: "core-1",
              fingerprintSha256: "a".repeat(64),
            }),
          ],
          [
            "version-2",
            stagedRow({
              sourceEventId: "event-1",
              sourceCoreId: "core-1",
              fingerprintSha256: "b".repeat(64),
              elapsedTimeSourceValue: "61.251",
            }),
          ],
        ]),
      ),
      store,
    });

    await expect(collect(source.readUnique())).rejects.toThrow(
      "Race archive history contains conflicting replay evidence.",
    );
    expect(deleted.length).toBeGreaterThan(0);
    expect(runs.size).toBe(0);
  });

  it("rejects the total accepted-row plan before archive reads when input exceeds the bound", async () => {
    const version = {
      ...plan({
        datasetVersionId: "version-1",
        importBatchId: "batch-version-1",
        versionNumber: 1,
      }),
      sourceRowCount: 11,
      acceptedRowCount: 11,
      evidenceRowCount: 11,
    };
    let opened = false;
    const { store } = memoryStore();

    await expect(
      prepareSpillableRaceArchiveObservations({
        ownerId: OWNER_ID,
        versions: [version],
        rehydrator: {
          async open() {
            opened = true;
            return { status: "missing" as const };
          },
        },
        store,
        runPrefix: "aggregate-refresh-1",
        maximumArchivePartitions: 10,
        maximumRecordsInMemory: 1,
        mergeFanIn: 2,
        maximumInputObservations: 10,
        maximumRunObjects: 20,
      }),
    ).rejects.toThrow(
      "Race archive spillable observation input bound was exceeded.",
    );
    expect(opened).toBe(false);
  });
});
