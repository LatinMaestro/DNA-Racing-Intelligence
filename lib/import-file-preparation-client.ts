import type { DirectImportUploadFile } from "./import-direct-upload-client";
import {
  importUploadSourceFamilies,
  type ImportUploadCandidate,
  type ImportUploadSourceFamily,
} from "./import-upload-intake-service";

export type SelectedImportUploadFile = Readonly<{
  clientFileId: string;
  sourceFamily: ImportUploadSourceFamily;
  originalFileName: string;
  contentType: string;
  body: Blob;
}>;

export type IncrementalSha256 = Readonly<{
  update: (chunk: Uint8Array) => Promise<void> | void;
  digestHex: () => Promise<string> | string;
}>;

export type PreparedImportUploadFiles = Readonly<{
  candidates: readonly ImportUploadCandidate[];
  files: readonly DirectImportUploadFile[];
}>;

export type ImportFilePreparationProgress = Readonly<{
  clientFileId: string;
  processedByteLength: number;
  totalByteLength: number;
}>;

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_FILES_PER_BATCH = 24;
const MIN_CHUNK_BYTES = 64 * 1024;
const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
const MAX_FILE_NAME_LENGTH = 255;
const ALLOWED_CONTENT_TYPES = new Set([
  "application/csv",
  "application/octet-stream",
  "application/vnd.ms-excel",
  "text/csv",
  "text/plain",
]);

function requireSafeIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function normalizeFileName(value: string): string {
  const normalized = value.trim();
  if (
    normalized === "" ||
    normalized.length > MAX_FILE_NAME_LENGTH ||
    /[/\\\u0000-\u001f\u007f]/.test(normalized) ||
    !normalized.toLowerCase().endsWith(".csv")
  ) {
    throw new Error("originalFileName is invalid");
  }
  return normalized;
}

function normalizeContentType(value: string): string {
  const normalized = value.trim().toLowerCase().split(";", 1)[0] ?? "";
  if (!ALLOWED_CONTENT_TYPES.has(normalized)) {
    throw new Error("contentType is unsupported");
  }
  return normalized;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new Error("file preparation aborted");
  }
}

function validateSelections(
  selections: readonly SelectedImportUploadFile[],
): readonly SelectedImportUploadFile[] {
  if (selections.length === 0 || selections.length > MAX_FILES_PER_BATCH) {
    throw new Error("files must contain between 1 and 24 selections");
  }
  const clientFileIds = new Set<string>();
  const replacementFamilies = new Set<ImportUploadSourceFamily>();
  return selections.map((selection) => {
    const clientFileId = requireSafeIdentifier(
      selection.clientFileId,
      "clientFileId",
    );
    if (clientFileIds.has(clientFileId)) {
      throw new Error("clientFileId must be unique within the batch");
    }
    clientFileIds.add(clientFileId);
    if (!importUploadSourceFamilies.includes(selection.sourceFamily)) {
      throw new Error("sourceFamily is invalid");
    }
    if (selection.sourceFamily !== "race_merge") {
      if (replacementFamilies.has(selection.sourceFamily)) {
        throw new Error(
          `${selection.sourceFamily} accepts one replacement candidate per batch`,
        );
      }
      replacementFamilies.add(selection.sourceFamily);
    }
    if (
      !Number.isSafeInteger(selection.body.size) ||
      selection.body.size <= 0 ||
      selection.body.size > MAX_FILE_BYTES
    ) {
      throw new Error("selected file size is outside the supported boundary");
    }
    return {
      clientFileId,
      sourceFamily: selection.sourceFamily,
      originalFileName: normalizeFileName(selection.originalFileName),
      contentType: normalizeContentType(selection.contentType),
      body: selection.body,
    };
  });
}

export async function prepareImportUploadFiles(
  input: Readonly<{
    selections: readonly SelectedImportUploadFile[];
    chunkByteLength: number;
    createSha256: () => IncrementalSha256;
    onProgress?: (progress: ImportFilePreparationProgress) => void;
    signal?: AbortSignal;
  }>,
): Promise<PreparedImportUploadFiles> {
  if (
    !Number.isSafeInteger(input.chunkByteLength) ||
    input.chunkByteLength < MIN_CHUNK_BYTES ||
    input.chunkByteLength > MAX_CHUNK_BYTES
  ) {
    throw new Error("chunkByteLength must be between 65536 and 16777216 bytes");
  }
  const selections = validateSelections(input.selections);
  const candidates: ImportUploadCandidate[] = [];
  const files: DirectImportUploadFile[] = [];

  for (const selection of selections) {
    const sha256 = input.createSha256();
    let processedByteLength = 0;
    while (processedByteLength < selection.body.size) {
      throwIfAborted(input.signal);
      const end = Math.min(
        processedByteLength + input.chunkByteLength,
        selection.body.size,
      );
      const buffer = await selection.body
        .slice(processedByteLength, end)
        .arrayBuffer();
      await sha256.update(new Uint8Array(buffer));
      throwIfAborted(input.signal);
      processedByteLength = end;
      input.onProgress?.({
        clientFileId: selection.clientFileId,
        processedByteLength,
        totalByteLength: selection.body.size,
      });
    }
    const digest = (await sha256.digestHex()).trim().toLowerCase();
    if (!SHA_256_PATTERN.test(digest)) {
      throw new Error("incremental SHA-256 digest is invalid");
    }
    candidates.push({
      clientFileId: selection.clientFileId,
      sourceFamily: selection.sourceFamily,
      originalFileName: selection.originalFileName,
      contentType: selection.contentType,
      byteLength: selection.body.size,
      sha256: digest,
    });
    files.push({
      clientFileId: selection.clientFileId,
      body: selection.body,
    });
  }

  return { candidates, files };
}
