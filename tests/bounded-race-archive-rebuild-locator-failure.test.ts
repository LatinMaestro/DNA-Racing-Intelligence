import { describe, expect, it, vi } from "vitest";

import type { DurablePreviewStagedRow } from "@/lib/durable-import-preview-staging-sink";
import {
  createBoundedRaceArchiveRebuildSession,
  type RaceArchiveCoreLocatorRepository,
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

describe("bounded Race archive rebuild locator failures", () => {
  it("classifies locator accumulation bounds separately and rolls back before persistence", async () => {
    const stageRows = vi.fn<RaceArchiveRebuildTransaction["stageRows"]>();
    const commit = vi.fn<RaceArchiveRebuildTransaction["commit"]>();
    const rollback = vi.fn<RaceArchiveRebuildTransaction["rollback"]>();
    const transaction: RaceArchiveRebuildTransaction = {
      stageRows,
      commit,
      rollback,
    };
    const repository: RaceArchiveRebuildRepository = {
      begin: vi.fn(async () => transaction),
    };
    const replace = vi.fn<RaceArchiveCoreLocatorRepository["replace"]>();
    const coreLocatorRepository: RaceArchiveCoreLocatorRepository = { replace };
    const rehydrator: RaceStagedRowRehydrator = {
      open: vi.fn(async () => ({
        status: "ready" as const,
        manifest: {
          datasetVersionId,
          importBatchId,
          sourceType: "race_merge" as const,
          evidenceKind: "staged_rows" as const,
          partitionCount: 2,
          rowCount: 2,
          byteSize: 200,
          objects: [],
        },
        rows: (async function* () {
          yield {
            datasetVersionId,
            importBatchId,
            partitionNumber: 0,
            stagedRow: stagedRow(1),
          };
          yield {
            datasetVersionId,
            importBatchId,
            partitionNumber: 1,
            stagedRow: stagedRow(2),
          };
        })(),
      })),
    };
    const service = createBoundedRaceArchiveRebuildSession({
      rehydrator,
      repository,
      coreLocatorRepository,
      maximumRowsPerWrite: 1,
      maximumCoreLocators: 10,
      maximumPartitionsPerCore: 1,
      now: () => new Date("2026-08-25T00:03:00Z"),
    });

    await expect(
      service.rebuild({
        ownerId: "user_owner",
        datasetVersionId,
        maximumPartitions: 2,
      }),
    ).rejects.toThrow("Core partition count exceeds its bound");

    expect(stageRows).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledWith({
      datasetVersionId,
      importBatchId,
      reason: "locator_failed",
    });
  });
});
