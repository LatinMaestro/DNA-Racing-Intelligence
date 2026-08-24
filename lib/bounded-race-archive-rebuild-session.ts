import type { DurablePreviewStagedRow } from "./durable-import-preview-staging-sink";
import type { SealedRaceArchiveManifest } from "./neon-sealed-race-archive-manifest-repository";
import type {
  RaceStagedRowRehydrator,
  RehydratedRaceStagedRow,
} from "./race-staged-row-rehydrator";

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export type RaceArchiveRebuildReceipt = Readonly<{
  datasetVersionId: string;
  importBatchId: string;
  processedRowCount: number;
  readyRowCount: number;
  quarantinedRowCount: number;
}>;

export type RaceArchiveRebuildTransaction = Readonly<{
  stageRows: (input: {
    datasetVersionId: string;
    importBatchId: string;
    rows: readonly DurablePreviewStagedRow[];
  }) => Promise<void>;
  commit: (receipt: RaceArchiveRebuildReceipt) => Promise<void>;
  rollback: (input: {
    datasetVersionId: string;
    importBatchId: string;
    reason: "archive_read_failed" | "stage_failed" | "commit_failed";
  }) => Promise<void>;
}>;

export type RaceArchiveRebuildRepository = Readonly<{
  begin: (input: {
    ownerId: string;
    datasetVersionId: string;
    importBatchId: string;
    expectedRowCount: number;
  }) => Promise<RaceArchiveRebuildTransaction>;
}>;

export type BoundedRaceArchiveRebuildSession = Readonly<{
  rebuild: (input: {
    ownerId: string;
    datasetVersionId: string;
    maximumPartitions: number;
  }) => Promise<
    | Readonly<{ status: "missing" }>
    | Readonly<{ status: "rebuilt"; receipt: RaceArchiveRebuildReceipt }>
  >;
}>;

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value;
}

function safeIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function assertManifest(manifest: SealedRaceArchiveManifest): void {
  if (manifest.sourceType !== "race_merge" || manifest.evidenceKind !== "staged_rows") {
    throw new Error("Race archive rebuild requires sealed staged-row evidence.");
  }
  positiveSafeInteger(manifest.rowCount, "manifest.rowCount");
  positiveSafeInteger(manifest.partitionCount, "manifest.partitionCount");
}

function assertRowIdentity(
  row: RehydratedRaceStagedRow,
  manifest: SealedRaceArchiveManifest,
): void {
  if (
    row.datasetVersionId !== manifest.datasetVersionId ||
    row.importBatchId !== manifest.importBatchId
  ) {
    throw new Error("Rehydrated Race row identity conflicts with the sealed manifest.");
  }
}

async function rollbackAfterFailure(input: {
  transaction: RaceArchiveRebuildTransaction;
  manifest: SealedRaceArchiveManifest;
  reason: "archive_read_failed" | "stage_failed" | "commit_failed";
  cause: unknown;
}): Promise<never> {
  try {
    await input.transaction.rollback({
      datasetVersionId: input.manifest.datasetVersionId,
      importBatchId: input.manifest.importBatchId,
      reason: input.reason,
    });
  } catch (rollbackCause) {
    throw new AggregateError(
      [input.cause, rollbackCause],
      "Race archive rebuild failed and rollback also failed.",
    );
  }
  throw input.cause;
}

export function createBoundedRaceArchiveRebuildSession(input: {
  rehydrator: RaceStagedRowRehydrator;
  repository: RaceArchiveRebuildRepository;
  maximumRowsPerWrite: number;
}): BoundedRaceArchiveRebuildSession {
  const maximumRowsPerWrite = positiveSafeInteger(
    input.maximumRowsPerWrite,
    "maximumRowsPerWrite",
  );

  return Object.freeze({
    async rebuild(request) {
      const ownerId = safeIdentifier(request.ownerId, "ownerId");
      const datasetVersionId = safeIdentifier(
        request.datasetVersionId,
        "datasetVersionId",
      );
      const maximumPartitions = positiveSafeInteger(
        request.maximumPartitions,
        "maximumPartitions",
      );
      const opened = await input.rehydrator.open({
        ownerId,
        datasetVersionId,
        maximumPartitions,
      });
      if (opened.status === "missing") return opened;

      const manifest = opened.manifest;
      assertManifest(manifest);
      if (manifest.datasetVersionId !== datasetVersionId) {
        throw new Error("Race archive manifest does not match the requested dataset version.");
      }
      const transaction = await input.repository.begin({
        ownerId,
        datasetVersionId: manifest.datasetVersionId,
        importBatchId: manifest.importBatchId,
        expectedRowCount: manifest.rowCount,
      });

      let processedRowCount = 0;
      let readyRowCount = 0;
      let quarantinedRowCount = 0;
      let batch: DurablePreviewStagedRow[] = [];

      try {
        for await (const row of opened.rows) {
          assertRowIdentity(row, manifest);
          processedRowCount += 1;
          if (processedRowCount > manifest.rowCount) {
            throw new Error("Race archive rebuild exceeded the sealed row count.");
          }
          if (row.stagedRow.row.status === "ready") {
            readyRowCount += 1;
          } else if (row.stagedRow.row.status === "quarantined") {
            quarantinedRowCount += 1;
          } else {
            throw new Error("Rehydrated Race row status is invalid.");
          }
          batch.push(row.stagedRow);
          if (batch.length === maximumRowsPerWrite) {
            const rows = Object.freeze(batch);
            try {
              await transaction.stageRows({
                datasetVersionId: manifest.datasetVersionId,
                importBatchId: manifest.importBatchId,
                rows,
              });
            } catch (cause) {
              return await rollbackAfterFailure({
                transaction,
                manifest,
                reason: "stage_failed",
                cause,
              });
            }
            batch = [];
          }
        }
      } catch (cause) {
        return await rollbackAfterFailure({
          transaction,
          manifest,
          reason: "archive_read_failed",
          cause,
        });
      }

      if (batch.length > 0) {
        try {
          await transaction.stageRows({
            datasetVersionId: manifest.datasetVersionId,
            importBatchId: manifest.importBatchId,
            rows: Object.freeze(batch),
          });
        } catch (cause) {
          return await rollbackAfterFailure({
            transaction,
            manifest,
            reason: "stage_failed",
            cause,
          });
        }
      }

      if (
        processedRowCount !== manifest.rowCount ||
        readyRowCount + quarantinedRowCount !== processedRowCount
      ) {
        return await rollbackAfterFailure({
          transaction,
          manifest,
          reason: "archive_read_failed",
          cause: new Error("Race archive rebuild row accounting is incomplete."),
        });
      }

      const receipt = Object.freeze({
        datasetVersionId: manifest.datasetVersionId,
        importBatchId: manifest.importBatchId,
        processedRowCount,
        readyRowCount,
        quarantinedRowCount,
      });
      try {
        await transaction.commit(receipt);
      } catch (cause) {
        return await rollbackAfterFailure({
          transaction,
          manifest,
          reason: "commit_failed",
          cause,
        });
      }

      return Object.freeze({ status: "rebuilt" as const, receipt });
    },
  });
}
