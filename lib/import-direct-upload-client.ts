import type { ImportUploadCompletionResult } from "./import-upload-completion-service";
import type {
  ImportUploadCandidate,
  ImportUploadIntakeResult,
  ImportUploadTarget,
} from "./import-upload-intake-service";

type ReadyImportUpload = Extract<ImportUploadIntakeResult, { status: "ready" }>;

export type DirectImportUploadFile = Readonly<{
  clientFileId: string;
  body: Blob;
}>;

export type DirectImportUploadTransport = Readonly<{
  putPrivateObject: (input: {
    targetToken: string;
    method: "PUT";
    contentType: string;
    byteLength: number;
    sha256: string;
    body: Blob;
  }) => Promise<void>;
}>;

export type DirectImportUploadCompletion = Readonly<{
  completeUpload: (input: {
    uploadBatchId: string;
    idempotencyKey: string;
  }) => Promise<ImportUploadCompletionResult>;
}>;

export type DirectImportUploadResult =
  | Readonly<{
      status: "completed";
      completion: ImportUploadCompletionResult;
    }>
  | Readonly<{
      status: "upload_failed";
      clientFileId: string;
    }>;

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;

function requireSafeIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function requireValidTimestamp(value: string, field: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`${field} must be a valid timestamp`);
  }
  return milliseconds;
}

function indexedCandidates(
  candidates: readonly ImportUploadCandidate[],
): ReadonlyMap<string, ImportUploadCandidate> {
  const indexed = new Map<string, ImportUploadCandidate>();
  for (const candidate of candidates) {
    const clientFileId = requireSafeIdentifier(
      candidate.clientFileId,
      "clientFileId",
    );
    if (indexed.has(clientFileId)) {
      throw new Error("candidate clientFileId values must be unique");
    }
    if (
      !Number.isSafeInteger(candidate.byteLength) ||
      candidate.byteLength <= 0
    ) {
      throw new Error("candidate byteLength is invalid");
    }
    if (!SHA_256_PATTERN.test(candidate.sha256)) {
      throw new Error("candidate sha256 is invalid");
    }
    indexed.set(clientFileId, candidate);
  }
  return indexed;
}

function indexedFiles(
  files: readonly DirectImportUploadFile[],
): ReadonlyMap<string, DirectImportUploadFile> {
  const indexed = new Map<string, DirectImportUploadFile>();
  for (const file of files) {
    const clientFileId = requireSafeIdentifier(
      file.clientFileId,
      "clientFileId",
    );
    if (indexed.has(clientFileId)) {
      throw new Error("file clientFileId values must be unique");
    }
    indexed.set(clientFileId, file);
  }
  return indexed;
}

function validatedTargets(
  targets: readonly ImportUploadTarget[],
): readonly ImportUploadTarget[] {
  const clientFileIds = new Set<string>();
  const uploadFileIds = new Set<string>();
  return targets.map((target) => {
    const clientFileId = requireSafeIdentifier(
      target.clientFileId,
      "clientFileId",
    );
    const uploadFileId = requireSafeIdentifier(
      target.uploadFileId,
      "uploadFileId",
    );
    if (
      clientFileIds.has(clientFileId) ||
      uploadFileIds.has(uploadFileId) ||
      target.method !== "PUT" ||
      target.targetToken.trim() === ""
    ) {
      throw new Error("upload target set is inconsistent");
    }
    clientFileIds.add(clientFileId);
    uploadFileIds.add(uploadFileId);
    return {
      clientFileId,
      uploadFileId,
      method: target.method,
      targetToken: target.targetToken,
    };
  });
}

export async function uploadReservedImportFiles(
  input: Readonly<{
    reservation: ReadyImportUpload;
    candidates: readonly ImportUploadCandidate[];
    files: readonly DirectImportUploadFile[];
    completionIdempotencyKey: string;
    now: Date;
    transport: DirectImportUploadTransport;
    completion: DirectImportUploadCompletion;
  }>,
): Promise<DirectImportUploadResult> {
  const uploadBatchId = requireSafeIdentifier(
    input.reservation.uploadBatchId,
    "uploadBatchId",
  );
  const completionIdempotencyKey = requireSafeIdentifier(
    input.completionIdempotencyKey,
    "completionIdempotencyKey",
  );
  const expiresAt = requireValidTimestamp(
    input.reservation.expiresAt,
    "expiresAt",
  );
  if (Number.isNaN(input.now.getTime())) {
    throw new Error("now must be valid");
  }
  if (input.now.getTime() >= expiresAt) {
    throw new Error("upload targets have expired");
  }

  const candidates = indexedCandidates(input.candidates);
  const files = indexedFiles(input.files);
  const targets = validatedTargets(input.reservation.targets);
  if (
    targets.length === 0 ||
    candidates.size !== targets.length ||
    files.size !== targets.length
  ) {
    throw new Error("candidate, file and upload target counts must agree");
  }

  for (const target of targets) {
    const candidate = candidates.get(target.clientFileId);
    const file = files.get(target.clientFileId);
    if (candidate === undefined || file === undefined) {
      throw new Error(
        "candidate, file and upload target identities must agree",
      );
    }
    if (file.body.size !== candidate.byteLength) {
      throw new Error(
        "selected file byte length no longer matches its preview",
      );
    }
  }

  for (const target of targets) {
    const candidate = candidates.get(target.clientFileId);
    const file = files.get(target.clientFileId);
    if (candidate === undefined || file === undefined) {
      throw new Error("validated upload identity unexpectedly disappeared");
    }
    try {
      await input.transport.putPrivateObject({
        targetToken: target.targetToken,
        method: target.method,
        contentType: candidate.contentType,
        byteLength: candidate.byteLength,
        sha256: candidate.sha256,
        body: file.body,
      });
    } catch {
      return {
        status: "upload_failed",
        clientFileId: target.clientFileId,
      };
    }
  }

  return {
    status: "completed",
    completion: await input.completion.completeUpload({
      uploadBatchId,
      idempotencyKey: completionIdempotencyKey,
    }),
  };
}
