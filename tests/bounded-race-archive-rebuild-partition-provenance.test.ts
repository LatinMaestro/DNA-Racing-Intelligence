import { describe, expect, it, vi } from "vitest";

import type { DurablePreviewStagedRow } from "@/lib/durable-import-preview-staging-sink";
import {
  createBoundedRaceArchiveRebuildSession,
  type RaceArchiveRebuildRepository,
  type RaceArchiveRebuildTransaction,
} from "@/lib/bounded-race-archive-rebuild-session";
import type { RaceStagedRowRehydrator } from "@/lib/race-staged-row-rehydrator";

const datasetVersionId = "11111111-1111-4111-8111-111111111111";
const importBatchId = "22222222-2222-4222-8222-222222222222";

function stagedRow(sourceRowNumber: number): DurablePreviewStagedRow {
  return {
    sourceRowNumber,
    naturalKey: `event-${sourceRowNumber}:core-1`,
    fingerprintSha256: "a".repeat(64),
    row: {
      status: "ready",
      sourceType: "race_merge",
      record: {
        sourceType: "race_merge",
        sourceEventId: `event-${sourceRowNumber}`,
        sourceCoreId: "core-1",
      },
      provenance: [],
      issues: [],
    } as unknown as DurablePreviewStagedRow["row"],
  };
}

describe("bounded Race archive rebuild partition provenance", () => {
  it("passes verified archive partition numbers through bounded staging", async () => {
    const stageRows = vi.fn<RaceArchiveRebuildTransaction["stageRows"]>();
    const transaction: RaceArchiveRebuildTransaction = {
      stageRows,
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
    };
    const repository: RaceArchiveRebuildRepository = {
      begin: vi.fn(async () => transaction),
    };
    const rehydrator: RaceStagedRowRehydrator = {
      open: vi.fn(async () => ({
        status: "ready" as const,
        manifest: {
          datasetVersionId,
          importBatchId,
          sourceType: "race_merge" as const,
          evidenceKind: "staged_rows" as const,
          partitionCount: 5,
          rowCount: 2,
          byteSize: 200,
          objects: [],
        },
        rows: (async function* () {
          yield {
            datasetVersionId,
            importBatchId,
            partitionNumber: 3,
            stagedRow: stagedRow(1),
          };
          yield {
            datasetVersionId,
            importBatchId,
            partitionNumber: 4,
            stagedRow: stagedRow(2),
          };
        })(),
      })),
    };
    const service = createBoundedRaceArchiveRebuildSession({
      rehydrator,
      repository,
      maximumRowsPerWrite: 2,
    });

    await expect(
      service.rebuild({
        ownerId: "user_owner",
        datasetVersionId,
        maximumPartitions: 5,
      }),
    ).resolves.toMatchObject({ status: "rebuilt" });

    expect(stageRows).toHaveBeenCalledTimes(1);
    expect(
      stageRows.mock.calls[0]?.[0].rows.map((row) => row.partitionNumber),
    ).toEqual([3, 4]);
  });
});
