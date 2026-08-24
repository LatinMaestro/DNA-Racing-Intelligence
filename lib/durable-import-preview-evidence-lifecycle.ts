import {
  createDeferredDatasetEvidenceNdjsonPartitionWriter,
  type DatasetEvidenceNdjsonRow,
} from "./dataset-evidence-ndjson-partition-writer";
import type { DurablePreviewStagedRow } from "./durable-import-preview-staging-sink";
import type {
  PrivateDatasetEvidenceObjectRecoveryReceipt,
  PrivateDatasetEvidenceObjectStorageWriter,
  StoredPrivateDatasetEvidenceObject,
} from "./private-dataset-evidence-object-writer";

export type DurableImportPreviewEvidenceSession = Readonly<{
  append: (rows: readonly DurablePreviewStagedRow[]) => Promise<void>;
  commitWithEvidenceReceipts: <Committed>(
    commit: (
      stored: readonly StoredPrivateDatasetEvidenceObject[],
    ) => Committed | Promise<Committed>,
  ) => Promise<Committed>;
  abort: () => Promise<void>;
}>;

export type DurableImportPreviewEvidenceLifecycle = Readonly<{
  beginObject: (input: {
    ownerId: string;
    importBatchId: string;
    sourceFamily: "race_merge" | "core_details" | "current_arena";
  }) => DurableImportPreviewEvidenceSession;
}>;

type EvidenceRecovery = Readonly<{
  cleanup: (
    stored: readonly StoredPrivateDatasetEvidenceObject[],
  ) => Promise<readonly PrivateDatasetEvidenceObjectRecoveryReceipt[]>;
}>;

function evidenceRows(
  rows: readonly DurablePreviewStagedRow[],
): readonly DatasetEvidenceNdjsonRow[] {
  return rows.map((row) => ({
    naturalKey: row.naturalKey,
    value: row,
  }));
}

export function createDurableImportPreviewEvidenceLifecycle(input: {
  ownerId: string;
  storageWriter: PrivateDatasetEvidenceObjectStorageWriter;
  recovery: EvidenceRecovery;
  maximumUncompressedBytes: number;
  maximumRowsPerPartition: number;
  now?: () => Date;
}): DurableImportPreviewEvidenceLifecycle {
  const ownerId = input.ownerId;
  const now = input.now ?? (() => new Date());

  return Object.freeze({
    beginObject(beginInput) {
      if (beginInput.ownerId !== ownerId) {
        throw new Error("Durable Preview evidence access denied.");
      }
      const writer = createDeferredDatasetEvidenceNdjsonPartitionWriter({
        storageWriter: input.storageWriter,
        ownerId,
        importBatchId: beginInput.importBatchId,
        sourceType: beginInput.sourceFamily,
        objectKind: "staged_rows",
        maximumUncompressedBytes: input.maximumUncompressedBytes,
        maximumRowsPerPartition: input.maximumRowsPerPartition,
        createdAt: now().toISOString(),
      });
      let commitRequested = false;
      let databaseCommitted = false;
      let completed = false;

      async function cleanup(
        stored: readonly StoredPrivateDatasetEvidenceObject[],
      ): Promise<void> {
        const newlyCreated = stored.filter(
          ({ storageStatus }) => storageStatus === "created",
        );
        if (newlyCreated.length > 0) {
          await input.recovery.cleanup(newlyCreated);
        }
      }

      async function failBeforeCommit(
        error: unknown,
        stored: readonly StoredPrivateDatasetEvidenceObject[],
      ): Promise<never> {
        try {
          await cleanup(stored);
        } catch (recoveryError) {
          throw new AggregateError(
            [error, recoveryError],
            "Dataset evidence staging failed and pre-commit recovery was incomplete.",
          );
        }
        throw error;
      }

      return Object.freeze({
        append(rows: readonly DurablePreviewStagedRow[]) {
          return writer.append(evidenceRows(rows));
        },
        async commitWithEvidenceReceipts<Committed>(
          commit: (
            stored: readonly StoredPrivateDatasetEvidenceObject[],
          ) => Committed | Promise<Committed>,
        ): Promise<Committed> {
          if (commitRequested) {
            throw new Error(
              "Durable Preview evidence commit was already requested.",
            );
          }
          commitRequested = true;
          let stored: readonly StoredPrivateDatasetEvidenceObject[];
          try {
            stored = await writer.finish();
          } catch (storageError) {
            const partial = await writer.abort();
            return failBeforeCommit(storageError, partial);
          }

          try {
            const committed = await commit(stored);
            databaseCommitted = true;
            completed = true;
            return committed;
          } catch (commitError) {
            return failBeforeCommit(commitError, stored);
          }
        },
        async abort() {
          if (completed || databaseCommitted) return;
          await cleanup(await writer.abort());
        },
      });
    },
  });
}
