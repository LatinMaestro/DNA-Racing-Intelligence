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

const OWNER_ID = "owner-lifecycle";

function plan(input: {
  datasetVersionId: string;
  versionNumber: number;
  rowCount: number;
}): RaceArchiveAggregateRefreshPlanVersion {
  return {
    datasetVersionId: input.datasetVersionId,
    importBatchId: `batch-${input.datasetVersionId}`,
    versionNumber: input.versionNumber,
    sourceRowCount: input.rowCount,
    acceptedRowCount: input.rowCount,
    evidencePartitionCount: 1,
    evidenceRowCount: input.rowCount,
  };
}

function stagedRow(input: {
  sourceRowNumber: number;
  sourceEventId: string;
  sourceCoreId: string;
  fingerprint: string;
}): DurablePreviewStagedRow {
  return {
    sourceRowNumber: input.sourceRowNumber,
    naturalKey: `${input.sourceEventId}:${input.sourceCoreId}`,
    fingerprintSha256: input.fingerprint,
    row: {
      status: "ready",
      sourceType: "race_merge",
      provenance: [],
      issues: [],
      record: {
        sourceType: "race_merge",
        sourceEventId: input.sourceEventId,
        eventAt: "2026-08-26T00:00:00.000Z",
        sourceEventDatetime: "2026-08-26T00:00:00.000Z",
        mode: "bike",
        distance: 1000,
        sourceCoreId: input.sourceCoreId,
        coreNameSourceValue: input.sourceCoreId,
        gate: 1,
        gateCount: 8,
        goldStar: false,
        blueStar: false,
        goldStarEligible: true,
        goldStarSourceValue: "false",
        blueStarSourceValue: "false",
        starDataStatus: "complete",
        finishPosition: 1,
        elapsedTimeSourceValue: "60.000",
        sourceRaceClass: "A",
        sourceFormat: "Sprint",
        feeSourceValue: "0",
        prizeSourceValue: "0",
        assetSourceValue: "DEZ",
        payoutMechanismSourceValue: "Top 3",
        raceTagsSourceValue: "Synthetic lifecycle",
        raceAsset: "DEZ",
        entryFeeAmount: "0",
        grossPayoutAmount: "0",
        economicDataStatus: "ready",
      },
    },
  };
}

function manifest(input: {
  datasetVersionId: string;
  rows: readonly DurablePreviewStagedRow[];
}): SealedRaceArchiveManifest {
  const first = input.rows[0];
  const last = input.rows.at(-1);
  return {
    datasetVersionId: input.datasetVersionId,
    importBatchId: `batch-${input.datasetVersionId}`,
    sourceType: "race_merge",
    evidenceKind: "staged_rows",
    partitionCount: 1,
    rowCount: input.rows.length,
    byteSize: 128 * input.rows.length,
    objects: [
      {
        ownerId: OWNER_ID,
        importBatchId: `batch-${input.datasetVersionId}`,
        sourceType: "race_merge",
        objectKind: "staged_rows",
        partitionNumber: 0,
        objectFormat: "ndjson_gzip",
        objectKey: `archive/${input.datasetVersionId}/part-0.ndjson.gz`,
        checksumSha256: "f".repeat(64),
        byteSize: 128 * input.rows.length,
        rowCount: input.rows.length,
        firstNaturalKey: first?.naturalKey ?? null,
        lastNaturalKey: last?.naturalKey ?? null,
        createdAt: "2026-08-26T00:00:00.000Z",
      },
    ],
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
  rowsByVersion: ReadonlyMap<string, readonly DurablePreviewStagedRow[]>,
): RaceStagedRowRehydrator {
  return {
    async open(input) {
      const rows = rowsByVersion.get(input.datasetVersionId);
      if (rows === undefined) return { status: "missing" as const };
      const importBatchId = `batch-${input.datasetVersionId}`;
      return {
        status: "ready" as const,
        manifest: manifest({ datasetVersionId: input.datasetVersionId, rows }),
        rows: asyncRows(
          rows.map((row) => ({
            datasetVersionId: input.datasetVersionId,
            importBatchId,
            partitionNumber: 0,
            stagedRow: row,
          })),
        ),
      };
    },
  };
}

function memoryStore(): Readonly<{
  store: RaceArchiveExternalSortedRunStore<RaceArchiveCoreAnalyticalObservation>;
  runs: Map<string, RaceArchiveCoreAnalyticalObservation[]>;
}> {
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
      },
    },
  };
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}

function race(
  sourceRowNumber: number,
  suffix: string,
  fingerprintCharacter: string,
): DurablePreviewStagedRow {
  return stagedRow({
    sourceRowNumber,
    sourceEventId: `event-${suffix}`,
    sourceCoreId: `core-${suffix}`,
    fingerprint: fingerprintCharacter.repeat(64),
  });
}

describe("rolling Race source lifecycle", () => {
  it("preserves sealed history while a full current segment is replayed, grows, then hands over to the next segment", async () => {
    const versions = [
      plan({ datasetVersionId: "sealed-6", versionNumber: 1, rowCount: 1 }),
      plan({ datasetVersionId: "rolling-7-a", versionNumber: 2, rowCount: 2 }),
      plan({ datasetVersionId: "rolling-7-b", versionNumber: 3, rowCount: 3 }),
      plan({ datasetVersionId: "rolling-8", versionNumber: 4, rowCount: 1 }),
    ];

    const a = race(1, "a", "a");
    const b = race(1, "b", "b");
    const c = race(2, "c", "c");
    const d = race(3, "d", "d");
    const e = race(1, "e", "e");
    const rowsByVersion = new Map<string, readonly DurablePreviewStagedRow[]>([
      ["sealed-6", [a]],
      ["rolling-7-a", [b, c]],
      ["rolling-7-b", [b, c, d]],
      ["rolling-8", [e]],
    ]);
    const { store, runs } = memoryStore();

    const source = await prepareSpillableRaceArchiveObservations({
      ownerId: OWNER_ID,
      versions,
      rehydrator: rehydrator(rowsByVersion),
      store,
      runPrefix: "race-lifecycle",
      maximumArchivePartitions: 10,
      maximumRecordsInMemory: 2,
      mergeFanIn: 2,
      maximumInputObservations: 5,
      maximumRunObjects: 100,
    });

    expect(source.inputObservationCount).toBe(7);
    const unique = await collect(source.readUnique());

    expect(unique.map((row) => row.naturalKey)).toEqual([
      "event-a:core-a",
      "event-b:core-b",
      "event-c:core-c",
      "event-d:core-d",
      "event-e:core-e",
    ]);
    expect(unique.map((row) => row.versionNumber)).toEqual([1, 2, 2, 3, 4]);
    expect(unique).toHaveLength(5);
    expect(runs.size).toBe(0);
  });
});
