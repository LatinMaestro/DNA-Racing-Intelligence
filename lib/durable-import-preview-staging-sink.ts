import { createHash } from "node:crypto";

import {
  adaptSourceRow,
  type AdaptedSourceRow,
} from "@/domain/source-adapters";
import {
  stageSourceHeader,
  type StagedSourceSchema,
} from "@/domain/source-schema";
import type {
  ImportPreviewStagingSink,
  StagedImportPreviewObject,
} from "./bounded-import-preview-processor";
import type { DurableImportPreviewEvidenceLifecycle } from "./durable-import-preview-evidence-lifecycle";
import type { PreparedImportPreview } from "./import-preview-processing-service";
import type { DatasetEvidenceObjectRegistration } from "./neon-dataset-evidence-object-repository";
import type {
  PrivateRawImportSourceFamily,
  RawImportObjectFailureCode,
} from "./private-raw-import-object-stream";

export type DurablePreviewStagedRow = Readonly<{
  sourceRowNumber: number;
  naturalKey: string | null;
  fingerprintSha256: string | null;
  row: AdaptedSourceRow;
}>;

export type DurablePreviewObjectResult = Readonly<{
  importBatchId: string;
  sourceRowCount: number;
  readyRowCount: number;
  quarantinedRowCount: number;
  warningRowCount: number;
  blockingIssueCount: number;
}>;

export type DurablePreviewObjectTransaction = Readonly<{
  importBatchId: string;
  stageSchema: (schema: StagedSourceSchema) => Promise<void>;
  stageRows: (rows: readonly DurablePreviewStagedRow[]) => Promise<void>;
  commitVerified: (input: {
    byteLength: number;
    sha256: string;
    chunkCount: number;
    evidenceRegistrations?: readonly DatasetEvidenceObjectRegistration[];
  }) => Promise<DurablePreviewObjectResult>;
  rollback: (input: { reason: RawImportObjectFailureCode }) => Promise<void>;
}>;

export type DurableImportPreviewStagingRepository = Readonly<{
  resumeObject: (input: {
    ownerId: string;
    previewDispatchId: string;
    objectId: string;
    sourceFamily: "race_merge" | "core_details" | "current_arena";
    expectedByteLength: number;
    expectedSha256: string;
  }) => Promise<DurablePreviewObjectResult | null>;
  beginObject: (input: {
    ownerId: string;
    previewDispatchId: string;
    objectId: string;
    sourceFamily: "race_merge" | "core_details" | "current_arena";
    expectedByteLength: number;
    expectedSha256: string;
  }) => Promise<DurablePreviewObjectTransaction>;
  finalizePreviewEvidence: (input: {
    ownerId: string;
    importBatchIds: readonly string[];
  }) => Promise<void>;
  assertPreviewObjects: (input: {
    ownerId: string;
    uploadBatchId: string;
    previewDispatchId: string;
    uploadManifestFingerprintSha256: string;
    objects: readonly StagedImportPreviewObject[];
  }) => Promise<void>;
  abortPreview: (input: {
    ownerId: string;
    uploadBatchId: string;
    previewDispatchId: string;
    reason:
      | "attempt_restart"
      | "object_processing_failed"
      | "preview_finalization_failed";
  }) => Promise<void>;
}>;

const IMPORTED_FAMILIES = new Set<PrivateRawImportSourceFamily>([
  "race_merge",
  "core_details",
  "current_arena",
]);
const DEFAULT_HEADER_BYTES = 64 * 1024;
const DEFAULT_ROWS_PER_WRITE = 500;

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function rowIdentity(row: AdaptedSourceRow): {
  naturalKey: string | null;
  fingerprintSha256: string | null;
} {
  if (row.status !== "ready" || row.record === null) {
    return { naturalKey: null, fingerprintSha256: null };
  }
  const naturalKey =
    row.record.sourceType === "race_merge"
      ? `${row.record.sourceEventId}:${row.record.sourceCoreId}`
      : row.record.sourceCoreId;
  return {
    naturalKey,
    fingerprintSha256: createHash("sha256")
      .update(canonicalJson(row.record))
      .digest("hex"),
  };
}

class CsvRecordDecoder {
  private readonly emit: (values: readonly string[]) => Promise<void>;
  private value = "";
  private row: string[] = [];
  private quoted = false;
  private afterQuote = false;
  private pending: Promise<void> = Promise.resolve();

  constructor(emit: (values: readonly string[]) => Promise<void>) {
    this.emit = emit;
  }

  push(text: string): void {
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (character === undefined) continue;
      if (this.quoted) {
        if (character === '"') {
          if (text[index + 1] === '"') {
            this.value += '"';
            index += 1;
          } else {
            this.quoted = false;
            this.afterQuote = true;
          }
        } else {
          this.value += character;
        }
        continue;
      }
      if (this.afterQuote) {
        if (character === '"') {
          this.value += '"';
          this.quoted = true;
          this.afterQuote = false;
          continue;
        }
        if (character === ",") {
          this.finishValue();
          continue;
        }
        if (character === "\n" || character === "\r") {
          this.finishValue();
          this.finishRow();
          if (character === "\r" && text[index + 1] === "\n") index += 1;
          continue;
        }
        throw new Error("CSV contains characters after a closing quote");
      }
      if (character === '"') {
        if (this.value !== "") throw new Error("CSV quote is misplaced");
        this.quoted = true;
      } else if (character === ",") {
        this.finishValue();
      } else if (character === "\n" || character === "\r") {
        this.finishValue();
        this.finishRow();
        if (character === "\r" && text[index + 1] === "\n") index += 1;
      } else {
        this.value += character;
      }
    }
  }

  async finish(): Promise<void> {
    if (this.quoted) throw new Error("CSV has an unterminated quoted value");
    if (this.value !== "" || this.row.length > 0 || this.afterQuote) {
      this.finishValue();
      this.finishRow();
    }
    await this.pending;
  }

  async settled(): Promise<void> {
    await this.pending;
  }

  private finishValue(): void {
    this.row.push(this.value);
    this.value = "";
    this.afterQuote = false;
  }

  private finishRow(): void {
    const row = this.row;
    this.row = [];
    if (row.length === 1 && row[0] === "") return;
    this.pending = this.pending.then(() => this.emit(row));
  }
}

function previewSummary(input: {
  uploadManifestFingerprintSha256: string;
  objects: readonly StagedImportPreviewObject[];
}): PreparedImportPreview {
  const results = input.objects.map((object) => {
    const value = object.stagedResult as Partial<DurablePreviewObjectResult>;
    if (
      typeof value.importBatchId !== "string" ||
      !Number.isSafeInteger(value.sourceRowCount) ||
      !Number.isSafeInteger(value.blockingIssueCount)
    ) {
      throw new Error("Durable staged object result is invalid");
    }
    return value as DurablePreviewObjectResult;
  });
  const blockingIssueCount = results.reduce(
    (total, result) => total + result.blockingIssueCount,
    0,
  );
  const fingerprint = createHash("sha256")
    .update(
      canonicalJson({
        manifest: input.uploadManifestFingerprintSha256,
        objects: input.objects.map((object, index) => ({
          objectId: object.objectId,
          sourceFamily: object.sourceFamily,
          sha256: object.sha256,
          result: results[index],
        })),
      }),
    )
    .digest("hex");
  return {
    previewId: `preview-${fingerprint.slice(0, 32)}`,
    previewFingerprintSha256: fingerprint,
    uploadManifestFingerprintSha256: input.uploadManifestFingerprintSha256,
    fileCount: input.objects.length,
    sourceFamilyCount: new Set(
      input.objects.map(({ sourceFamily }) => sourceFamily),
    ).size,
    blockingIssueCount,
    confirmable: blockingIssueCount === 0,
  };
}

export function createDurableImportPreviewStagingSink(input: {
  repository: DurableImportPreviewStagingRepository;
  evidenceLifecycle?: DurableImportPreviewEvidenceLifecycle;
  maximumHeaderBytes?: number;
  rowsPerWrite?: number;
}): ImportPreviewStagingSink {
  const maximumHeaderBytes = positiveInteger(
    input.maximumHeaderBytes ?? DEFAULT_HEADER_BYTES,
    "maximumHeaderBytes",
  );
  const rowsPerWrite = positiveInteger(
    input.rowsPerWrite ?? DEFAULT_ROWS_PER_WRITE,
    "rowsPerWrite",
  );

  return {
    resumeObject(resumeInput) {
      if (!IMPORTED_FAMILIES.has(resumeInput.sourceFamily)) {
        throw new Error("Source family is not imported into Preview");
      }
      return input.repository.resumeObject({
        ...resumeInput,
        sourceFamily: resumeInput.sourceFamily as
          "race_merge" | "core_details" | "current_arena",
      });
    },
    async beginObject(beginInput) {
      if (!IMPORTED_FAMILIES.has(beginInput.sourceFamily)) {
        throw new Error("Source family is not imported into Preview");
      }
      const sourceFamily = beginInput.sourceFamily as
        "race_merge" | "core_details" | "current_arena";
      const transaction = await input.repository.beginObject({
        ownerId: beginInput.ownerId,
        previewDispatchId: beginInput.updateSessionId,
        objectId: beginInput.objectId,
        sourceFamily,
        expectedByteLength: beginInput.expectedByteLength,
        expectedSha256: beginInput.expectedSha256,
      });
      let evidence:
        | ReturnType<DurableImportPreviewEvidenceLifecycle["beginObject"]>
        | undefined;
      try {
        evidence = input.evidenceLifecycle?.beginObject({
          ownerId: beginInput.ownerId,
          importBatchId: transaction.importBatchId,
          sourceFamily,
        });
      } catch (error) {
        await transaction.rollback({ reason: "sink_failed" });
        throw error;
      }
      let header = new Uint8Array();
      let decoder: TextDecoder | null = null;
      let csv: CsvRecordDecoder | null = null;
      let schema: StagedSourceSchema | null = null;
      let rowNumber = 0;
      let pendingRows: DurablePreviewStagedRow[] = [];

      const flush = async () => {
        if (pendingRows.length === 0) return;
        const rows = pendingRows;
        pendingRows = [];
        await evidence?.append(rows);
        await transaction.stageRows(rows);
      };
      const emit = async (values: readonly string[]) => {
        if (schema === null) throw new Error("CSV schema is unavailable");
        rowNumber += 1;
        const row = adaptSourceRow(schema, values);
        const identity = rowIdentity(row);
        pendingRows.push({ sourceRowNumber: rowNumber, ...identity, row });
        if (pendingRows.length >= rowsPerWrite) await flush();
      };
      const initialize = async (headerBytes: Uint8Array) => {
        schema = stageSourceHeader({
          headerBytes,
          encodingProbeBytes: headerBytes,
          selectedSourceType: sourceFamily,
        });
        await transaction.stageSchema(schema);
        if (schema.status !== "ready")
          throw new Error("CSV schema is not ready");
        const initializedDecoder = new TextDecoder(
          schema.encoding === "windows_1252" ? "windows-1252" : "utf-8",
          { fatal: true },
        );
        const initializedCsv = new CsvRecordDecoder(emit);
        decoder = initializedDecoder;
        csv = initializedCsv;
        return { decoder: initializedDecoder, csv: initializedCsv };
      };

      return {
        async write(chunk) {
          if (decoder === null) {
            const combined = new Uint8Array(
              header.byteLength + chunk.byteLength,
            );
            combined.set(header);
            combined.set(chunk, header.byteLength);
            const newline = combined.findIndex(
              (byte) => byte === 10 || byte === 13,
            );
            if (newline < 0) {
              if (combined.byteLength > maximumHeaderBytes) {
                throw new Error("CSV header exceeds configured capacity");
              }
              header = combined;
              return;
            }
            const terminatorLength =
              combined[newline] === 13 && combined[newline + 1] === 10 ? 2 : 1;
            const headerBytes = combined.slice(0, newline + terminatorLength);
            if (headerBytes.byteLength > maximumHeaderBytes) {
              throw new Error("CSV header exceeds configured capacity");
            }
            const initialized = await initialize(headerBytes);
            const remainder = combined.slice(newline + terminatorLength);
            if (remainder.byteLength > 0) {
              initialized.csv.push(
                initialized.decoder.decode(remainder, { stream: true }),
              );
            }
          } else {
            csv?.push(decoder.decode(chunk, { stream: true }));
          }
          await csv?.settled();
        },
        async commitVerified(verified) {
          if (decoder === null || csv === null || schema === null) {
            throw new Error("CSV object has no complete header");
          }
          csv.push(decoder.decode());
          await csv.finish();
          await flush();
          if (evidence === undefined) {
            return transaction.commitVerified(verified);
          }
          return evidence.commitWithEvidenceReceipts((stored) =>
            transaction.commitVerified({
              ...verified,
              evidenceRegistrations: stored.map(
                ({ registration }) => registration,
              ),
            }),
          );
        },
        async abort({ reason }) {
          const results = await Promise.allSettled([
            transaction.rollback({ reason }),
            evidence?.abort() ?? Promise.resolve(),
          ]);
          const failures = results.flatMap((result) =>
            result.status === "rejected" ? [result.reason] : [],
          );
          if (failures.length === 1) throw failures[0];
          if (failures.length > 1) {
            throw new AggregateError(
              failures,
              "Durable Preview staging and evidence abort both failed.",
            );
          }
        },
      };
    },
    async completePreview(completeInput) {
      const summary = previewSummary(completeInput);
      const importBatchIds = completeInput.objects.map(
        ({ stagedResult }) =>
          (stagedResult as DurablePreviewObjectResult).importBatchId,
      );
      await input.repository.finalizePreviewEvidence({
        ownerId: completeInput.ownerId,
        importBatchIds,
      });
      await input.repository.assertPreviewObjects({
        ownerId: completeInput.ownerId,
        uploadBatchId: completeInput.uploadBatchId,
        previewDispatchId: completeInput.previewDispatchId,
        uploadManifestFingerprintSha256:
          completeInput.uploadManifestFingerprintSha256,
        objects: completeInput.objects,
      });
      return summary;
    },
    abortPreview(abortInput) {
      return input.repository.abortPreview(abortInput);
    },
  };
}
