import { describe, expect, it, vi } from "vitest";

import type { DurablePreviewStagedRow } from "@/lib/durable-import-preview-staging-sink";
import type { SealedRaceArchiveManifest } from "@/lib/neon-sealed-race-archive-manifest-repository";
import type {
  RaceStagedRowRehydrator,
  RehydratedRaceStagedRow,
} from "@/lib/race-staged-row-rehydrator";
import {
  createBoundedRaceArchiveRebuildSession,
  type RaceArchiveRebuildRepository,
  type RaceArchiveRebuildTransaction,
} from "@/lib/bounded-race-archive-rebuild-session";

const ownerId = "user_owner";
const datasetVersionId = "11111111-1111-4111-8111-111111111111";
const importBatchId = "22222222-2222-4222-8222-222222222222";

function manifest(
  overrides: Partial<SealedRaceArchiveManifest> = {},
): SealedRaceArchiveManifest {
  return {
    datasetVersionId,
    importBatchId,
    sourceType: "race_merge",
    evidenceKind: "staged_rows",
    partitionCount: 1,
    rowCount: 1,
    byteSize: 100,
    objects: [],
    ...overrides,
  };
}

function stagedRow(
  sourceRowNumber: number,
  status: "ready" | "quarantined" = "ready",
): DurablePreviewStagedRow {
  return {
    sourceRowNumber,
    naturalKey:
      status === "ready" ? `event-${sourceRowNumber}:core-1` : null,
    fingerprintSha256: status === "ready" ? "a".repeat(64) : null,
    row:
      status === "ready"
        ? ({
            status: "ready",
            sourceType: "race_merge",
            record: {
              sourceType: "race_merge",
              sourceEventId: `event-${sourceRowNumber}`,
              sourceCoreId: "core-1",
            },
            provenance: [],
            issues: [],
          } as unknown as DurablePreviewStagedRow["row"])
        : ({
            status: "quarantined",
            sourceType: "race_merge",
            record: null,
            provenance: [],
            issues: [],
          } as unknown as DurablePreviewStagedRow["row"]),
  };
}

function rehydratedRow(
  sourceRowNumber: number,
  status: "ready" | "quarantined" = "ready",
  overrides: Partial<RehydratedRaceStagedRow> = {},
): RehydratedRaceStagedRow {
  return {
    datasetVersionId,
    importBatchId,
    partitionNumber: 0,
    stagedRow: stagedRow(sourceRowNumber, status),
    ...overrides,
  };
}

function rehydrator(input: {
  manifest?: SealedRaceArchiveManifest;
  rows?: readonly RehydratedRaceStagedRow[];
  failAfterRows?: number;
  events?: string[];
}) {
  const open = vi.fn(async () => {
    if (input.manifest === undefined) return { status: "missing" as const };
    return {
      status: "ready" as const,
      manifest: input.manifest,
      rows: (async function* () {
        let emitted = 0;
        for (const row of input.rows ?? []) {
          input.events?.push(`read:${row.stagedRow.sourceRowNumber}`);
          yield row;
          emitted += 1;
          if (input.failAfterRows === emitted) {
            throw new Error("archive read failed");
          }
        }
        input.events?.push("archive:complete");
      })(),
    };
  });
  return { open, value: { open } as RaceStagedRowRehydrator };
}

function repository(input: {
  events?: string[];
  stageFailureAtCall?: number;
  commitFailure?: boolean;
  rollbackFailure?: boolean;
}) {
  let stageCall = 0;
  const stageRows = vi.fn(
    async (value: Parameters<RaceArchiveRebuildTransaction["stageRows"]>[0]) => {
      stageCall += 1;
      input.events?.push(`stage:${value.rows.length}`);
      if (input.stageFailureAtCall === stageCall) {
        throw new Error("stage failed");
      }
    },
  );
  const commit = vi.fn(
    async (value: Parameters<RaceArchiveRebuildTransaction["commit"]>[0]) => {
      input.events?.push(`commit:${value.processedRowCount}`);
      if (input.commitFailure) throw new Error("commit failed");
    },
  );
  const rollback = vi.fn(
    async (value: Parameters<RaceArchiveRebuildTransaction["rollback"]>[0]) => {
      input.events?.push(`rollback:${value.reason}`);
      if (input.rollbackFailure) throw new Error("rollback failed");
    },
  );
  const transaction: RaceArchiveRebuildTransaction = {
    stageRows,
    commit,
    rollback,
  };
  const begin = vi.fn(async () => transaction);
  return {
    begin,
    stageRows,
    commit,
    rollback,
    value: { begin } as RaceArchiveRebuildRepository,
  };
}

describe("bounded Race archive rebuild session", () => {
  it("returns missing without opening a rebuild transaction", async () => {
    const source = rehydrator({});
    const sink = repository({});
    const service = createBoundedRaceArchiveRebuildSession({
      rehydrator: source.value,
      repository: sink.value,
      maximumRowsPerWrite: 2,
    });

    await expect(
      service.rebuild({ ownerId, datasetVersionId, maximumPartitions: 4 }),
    ).resolves.toEqual({ status: "missing" });
    expect(source.open).toHaveBeenCalledWith({
      ownerId,
      datasetVersionId,
      maximumPartitions: 4,
    });
    expect(sink.begin).not.toHaveBeenCalled();
  });

  it("stages bounded batches and commits only after complete archive consumption", async () => {
    const events: string[] = [];
    const rows = [
      rehydratedRow(1),
      rehydratedRow(2),
      rehydratedRow(3, "quarantined"),
      rehydratedRow(4),
      rehydratedRow(5, "quarantined"),
    ];
    const sealed = manifest({ rowCount: rows.length });
    const source = rehydrator({ manifest: sealed, rows, events });
    const sink = repository({ events });
    const service = createBoundedRaceArchiveRebuildSession({
      rehydrator: source.value,
      repository: sink.value,
      maximumRowsPerWrite: 2,
    });

    await expect(
      service.rebuild({ ownerId, datasetVersionId, maximumPartitions: 4 }),
    ).resolves.toEqual({
      status: "rebuilt",
      receipt: {
        datasetVersionId,
        importBatchId,
        processedRowCount: 5,
        readyRowCount: 3,
        quarantinedRowCount: 2,
      },
    });
    expect(sink.begin).toHaveBeenCalledWith({
      ownerId,
      datasetVersionId,
      importBatchId,
      expectedRowCount: 5,
    });
    expect(sink.stageRows).toHaveBeenCalledTimes(3);
    expect(sink.stageRows.mock.calls.map(([value]) => value.rows.length)).toEqual([
      2, 2, 1,
    ]);
    expect(sink.rollback).not.toHaveBeenCalled();
    expect(events.at(-2)).toBe("archive:complete");
    expect(events.at(-1)).toBe("commit:5");
  });

  it("rolls back once as archive_read_failed on manifest identity conflicts", async () => {
    const sealed = manifest();
    const source = rehydrator({
      manifest: sealed,
      rows: [
        rehydratedRow(1, "ready", {
          datasetVersionId: "33333333-3333-4333-8333-333333333333",
        }),
      ],
    });
    const sink = repository({});
    const service = createBoundedRaceArchiveRebuildSession({
      rehydrator: source.value,
      repository: sink.value,
      maximumRowsPerWrite: 2,
    });

    await expect(
      service.rebuild({ ownerId, datasetVersionId, maximumPartitions: 4 }),
    ).rejects.toThrow("identity conflicts with the sealed manifest");
    expect(sink.rollback).toHaveBeenCalledTimes(1);
    expect(sink.rollback).toHaveBeenCalledWith({
      datasetVersionId,
      importBatchId,
      reason: "archive_read_failed",
    });
    expect(sink.commit).not.toHaveBeenCalled();
  });

  it("rolls back exactly once with stage_failed and preserves the staging error", async () => {
    const rows = [rehydratedRow(1), rehydratedRow(2), rehydratedRow(3)];
    const source = rehydrator({
      manifest: manifest({ rowCount: rows.length }),
      rows,
    });
    const sink = repository({ stageFailureAtCall: 1 });
    const service = createBoundedRaceArchiveRebuildSession({
      rehydrator: source.value,
      repository: sink.value,
      maximumRowsPerWrite: 2,
    });

    await expect(
      service.rebuild({ ownerId, datasetVersionId, maximumPartitions: 4 }),
    ).rejects.toThrow("stage failed");
    expect(sink.rollback).toHaveBeenCalledTimes(1);
    expect(sink.rollback).toHaveBeenCalledWith({
      datasetVersionId,
      importBatchId,
      reason: "stage_failed",
    });
    expect(sink.commit).not.toHaveBeenCalled();
  });

  it("rolls back staged rows when archive verification fails during iteration", async () => {
    const rows = [rehydratedRow(1), rehydratedRow(2), rehydratedRow(3)];
    const source = rehydrator({
      manifest: manifest({ rowCount: rows.length }),
      rows,
      failAfterRows: 2,
    });
    const sink = repository({});
    const service = createBoundedRaceArchiveRebuildSession({
      rehydrator: source.value,
      repository: sink.value,
      maximumRowsPerWrite: 2,
    });

    await expect(
      service.rebuild({ ownerId, datasetVersionId, maximumPartitions: 4 }),
    ).rejects.toThrow("archive read failed");
    expect(sink.stageRows).toHaveBeenCalledTimes(1);
    expect(sink.rollback).toHaveBeenCalledWith({
      datasetVersionId,
      importBatchId,
      reason: "archive_read_failed",
    });
    expect(sink.commit).not.toHaveBeenCalled();
  });

  it("rolls back when commit fails", async () => {
    const source = rehydrator({ manifest: manifest(), rows: [rehydratedRow(1)] });
    const sink = repository({ commitFailure: true });
    const service = createBoundedRaceArchiveRebuildSession({
      rehydrator: source.value,
      repository: sink.value,
      maximumRowsPerWrite: 2,
    });

    await expect(
      service.rebuild({ ownerId, datasetVersionId, maximumPartitions: 4 }),
    ).rejects.toThrow("commit failed");
    expect(sink.rollback).toHaveBeenCalledWith({
      datasetVersionId,
      importBatchId,
      reason: "commit_failed",
    });
  });

  it("surfaces both the primary and rollback failures", async () => {
    const source = rehydrator({ manifest: manifest(), rows: [rehydratedRow(1)] });
    const sink = repository({ stageFailureAtCall: 1, rollbackFailure: true });
    const service = createBoundedRaceArchiveRebuildSession({
      rehydrator: source.value,
      repository: sink.value,
      maximumRowsPerWrite: 1,
    });

    const failure = service.rebuild({
      ownerId,
      datasetVersionId,
      maximumPartitions: 4,
    });
    await expect(failure).rejects.toBeInstanceOf(AggregateError);
    await expect(failure).rejects.toThrow(
      "rebuild failed and rollback also failed",
    );
    expect(sink.rollback).toHaveBeenCalledTimes(1);
  });

  it("validates bounded request parameters before opening archive evidence", async () => {
    const source = rehydrator({});
    const sink = repository({});
    const service = createBoundedRaceArchiveRebuildSession({
      rehydrator: source.value,
      repository: sink.value,
      maximumRowsPerWrite: 2,
    });

    await expect(
      service.rebuild({ ownerId, datasetVersionId, maximumPartitions: 0 }),
    ).rejects.toThrow("maximumPartitions must be a positive safe integer");
    expect(source.open).not.toHaveBeenCalled();
  });
});
