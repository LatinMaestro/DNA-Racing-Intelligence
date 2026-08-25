import { describe, expect, it } from "vitest";

import type { DurablePreviewStagedRow } from "../lib/durable-import-preview-staging-sink";
import type { SealedRaceArchiveManifest } from "../lib/neon-sealed-race-archive-manifest-repository";
import type { RaceArchiveAggregateRefreshPlanVersion } from "../lib/race-archive-aggregate-refresher";
import { raceArchiveObservationsFromRefreshPlan } from "../lib/race-archive-observation-stream";
import type {
  RaceStagedRowRehydrator,
  RehydratedRaceStagedRow,
} from "../lib/race-staged-row-rehydrator";

const DATASET_VERSION_ID = "version-1";
const IMPORT_BATCH_ID = "batch-1";
const OWNER_ID = "owner-1";

function plan(input?: {
  sourceRowCount?: number;
  acceptedRowCount?: number;
  evidencePartitionCount?: number;
}): RaceArchiveAggregateRefreshPlanVersion {
  return {
    datasetVersionId: DATASET_VERSION_ID,
    importBatchId: IMPORT_BATCH_ID,
    versionNumber: 1,
    sourceRowCount: input?.sourceRowCount ?? 2,
    acceptedRowCount: input?.acceptedRowCount ?? 1,
    evidencePartitionCount: input?.evidencePartitionCount ?? 1,
    evidenceRowCount: input?.sourceRowCount ?? 2,
  };
}

function manifest(input?: {
  datasetVersionId?: string;
  rowCount?: number;
}): SealedRaceArchiveManifest {
  return {
    datasetVersionId: input?.datasetVersionId ?? DATASET_VERSION_ID,
    importBatchId: IMPORT_BATCH_ID,
    sourceType: "race_merge",
    evidenceKind: "staged_rows",
    partitionCount: 1,
    rowCount: input?.rowCount ?? 2,
    byteSize: 128,
    objects: [
      {
        ownerId: OWNER_ID,
        importBatchId: IMPORT_BATCH_ID,
        sourceType: "race_merge",
        objectKind: "staged_rows",
        partitionNumber: 0,
        objectFormat: "ndjson_gzip",
        objectKey: "archive/version-1/part-0.ndjson.gz",
        checksumSha256: "f".repeat(64),
        byteSize: 128,
        rowCount: input?.rowCount ?? 2,
        firstNaturalKey: "event-21:core-7",
        lastNaturalKey: "event-21:core-7",
        createdAt: "2026-08-20T01:00:00.000Z",
      },
    ],
  };
}

function readyStagedRow(): DurablePreviewStagedRow {
  return {
    sourceRowNumber: 1,
    naturalKey: "event-21:core-7",
    fingerprintSha256: "a".repeat(64),
    row: {
      status: "ready",
      sourceType: "race_merge",
      provenance: [],
      issues: [],
      record: {
        sourceType: "race_merge",
        sourceEventId: "event-21",
        eventAt: "2026-08-20T01:02:03.000Z",
        sourceEventDatetime: "2026-08-20T01:02:03.000Z",
        mode: "bike",
        distance: 1000,
        sourceCoreId: "core-7",
        coreNameSourceValue: "Core Seven",
        gate: 2,
        gateCount: 8,
        goldStar: true,
        blueStar: false,
        goldStarEligible: true,
        goldStarSourceValue: "true",
        blueStarSourceValue: "false",
        starDataStatus: "complete",
        finishPosition: 1,
        elapsedTimeSourceValue: "61.250",
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

function quarantinedStagedRow(): DurablePreviewStagedRow {
  return {
    sourceRowNumber: 2,
    naturalKey: null,
    fingerprintSha256: null,
    row: {
      status: "quarantined",
      sourceType: "race_merge",
      provenance: [],
      issues: [],
      record: null,
    },
  };
}

function rehydratedRows(): readonly RehydratedRaceStagedRow[] {
  return [
    {
      datasetVersionId: DATASET_VERSION_ID,
      importBatchId: IMPORT_BATCH_ID,
      partitionNumber: 0,
      stagedRow: readyStagedRow(),
    },
    {
      datasetVersionId: DATASET_VERSION_ID,
      importBatchId: IMPORT_BATCH_ID,
      partitionNumber: 0,
      stagedRow: quarantinedStagedRow(),
    },
  ];
}

function asyncRows(
  rows: readonly RehydratedRaceStagedRow[],
): AsyncIterable<RehydratedRaceStagedRow> {
  return (async function* () {
    for (const row of rows) yield row;
  })();
}

function rehydrator(input?: {
  manifest?: SealedRaceArchiveManifest;
  rows?: readonly RehydratedRaceStagedRow[];
  missing?: boolean;
}): RaceStagedRowRehydrator {
  return {
    async open() {
      if (input?.missing === true) return { status: "missing" as const };
      return {
        status: "ready" as const,
        manifest: input?.manifest ?? manifest(),
        rows: asyncRows(input?.rows ?? rehydratedRows()),
      };
    },
  };
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}

describe("Race archive observation stream", () => {
  it("streams only ready observations with exact archive provenance", async () => {
    const observations = await collect(
      raceArchiveObservationsFromRefreshPlan({
        ownerId: OWNER_ID,
        versions: [plan()],
        rehydrator: rehydrator(),
        maximumArchivePartitions: 10,
      }),
    );

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      datasetVersionId: DATASET_VERSION_ID,
      importBatchId: IMPORT_BATCH_ID,
      versionNumber: 1,
      partitionNumber: 0,
      sourceRowNumber: 1,
      naturalKey: "event-21:core-7",
      fingerprintSha256: "a".repeat(64),
      sourceEventId: "event-21",
      sourceCoreId: "core-7",
      elapsedMilliseconds: 61_250,
    });
  });

  it("fails closed when the planned archive evidence is unavailable or changes", async () => {
    await expect(
      collect(
        raceArchiveObservationsFromRefreshPlan({
          ownerId: OWNER_ID,
          versions: [plan()],
          rehydrator: rehydrator({ missing: true }),
          maximumArchivePartitions: 10,
        }),
      ),
    ).rejects.toThrow(/missing evidence/);

    await expect(
      collect(
        raceArchiveObservationsFromRefreshPlan({
          ownerId: OWNER_ID,
          versions: [plan()],
          rehydrator: rehydrator({
            manifest: manifest({ datasetVersionId: "other-version" }),
          }),
          maximumArchivePartitions: 10,
        }),
      ),
    ).rejects.toThrow(/identity or coverage changed/);
  });

  it("fails closed when streamed row accounting changes", async () => {
    await expect(
      collect(
        raceArchiveObservationsFromRefreshPlan({
          ownerId: OWNER_ID,
          versions: [plan({ sourceRowCount: 3, acceptedRowCount: 1 })],
          rehydrator: rehydrator({ manifest: manifest({ rowCount: 3 }) }),
          maximumArchivePartitions: 10,
        }),
      ),
    ).rejects.toThrow(/row accounting changed/);
  });
});
