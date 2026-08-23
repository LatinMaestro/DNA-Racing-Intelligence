import {
  createDatasetEvidenceCommitCoordinator,
  type DatasetEvidenceCommitCoordinator,
} from "./dataset-evidence-commit-coordinator";
import type { DatasetEvidenceManifestRegistrationService } from "./dataset-evidence-manifest-registration-service";
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
  commitAndRegister: <Committed>(
    commit: () => Committed | Promise<Committed>,
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
  registrationService: DatasetEvidenceManifestRegistrationService;
  recovery: EvidenceRecovery;
  maximumUncompressedBytes: number;
  maximumRowsPerPartition: number;
  now?: () => Date;
}): DurableImportPreviewEvidenceLifecycle {
  const ownerId = input.ownerId;
  const coordinator: DatasetEvidenceCommitCoordinator =
    createDatasetEvidenceCommitCoordinator({
      registrationService: input.registrationService,
      recovery: input.recovery,
    });
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
        objectKind: "normalized_partition",
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

      return Object.freeze({
        append(rows: readonly DurablePreviewStagedRow[]) {
          return writer.append(evidenceRows(rows));
        },
        async commitAndRegister<Committed>(
          commit: () => Committed | Promise<Committed>,
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
            await coordinator.commitAndRegister({
              stored: partial,
              commit: () => {
                throw storageError;
              },
            });
            throw storageError;
          }

          const result = await coordinator.commitAndRegister({
            stored,
            commit: async () => {
              const committed = await commit();
              databaseCommitted = true;
              return committed;
            },
          });
          completed = true;
          return result.committed;
        },
        async abort() {
          if (completed || databaseCommitted) return;
          await cleanup(await writer.abort());
        },
      });
    },
  });
}
