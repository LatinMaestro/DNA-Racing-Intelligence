import {
  beginPrivateImportUpload,
  type ImportUploadCandidate,
  type ImportUploadIntakeCapabilities,
  type ImportUploadIntakeResult,
} from "./import-upload-intake-service";
import {
  completePrivateImportUpload,
  type ImportUploadCompletionCapabilities,
  type ImportUploadCompletionResult,
} from "./import-upload-completion-service";

export type ImportOwnerActionDependencies = Readonly<{
  resolveAuthenticatedOwnerId: () => Promise<string | null>;
  configuredOwnerId: string | null;
  now: () => Date;
  uploadTargetLifetimeMilliseconds: number;
  uploadIntakeCapabilities: ImportUploadIntakeCapabilities;
  uploadCompletionCapabilities: ImportUploadCompletionCapabilities;
}>;

async function resolveOwnerId(
  dependencies: ImportOwnerActionDependencies,
): Promise<string | null> {
  try {
    return await dependencies.resolveAuthenticatedOwnerId();
  } catch {
    throw new Error("Owner authentication is unavailable.");
  }
}

export async function beginOwnerImportUpload(
  input: Readonly<{
    idempotencyKey: string;
    files: readonly ImportUploadCandidate[];
  }>,
  dependencies: ImportOwnerActionDependencies,
): Promise<ImportUploadIntakeResult> {
  const authenticatedOwnerId = await resolveOwnerId(dependencies);

  return beginPrivateImportUpload({
    authenticatedOwnerId,
    configuredOwnerId: dependencies.configuredOwnerId,
    idempotencyKey: input.idempotencyKey,
    files: input.files,
    now: dependencies.now(),
    targetLifetimeMilliseconds: dependencies.uploadTargetLifetimeMilliseconds,
    capabilities: dependencies.uploadIntakeCapabilities,
  });
}

export async function completeOwnerImportUpload(
  input: Readonly<{
    uploadBatchId: string;
    idempotencyKey: string;
    uploadRequestFingerprint: string;
  }>,
  dependencies: ImportOwnerActionDependencies,
): Promise<ImportUploadCompletionResult> {
  const authenticatedOwnerId = await resolveOwnerId(dependencies);

  return completePrivateImportUpload({
    authenticatedOwnerId,
    configuredOwnerId: dependencies.configuredOwnerId,
    uploadBatchId: input.uploadBatchId,
    idempotencyKey: input.idempotencyKey,
    uploadRequestFingerprint: input.uploadRequestFingerprint,
    now: dependencies.now(),
    capabilities: dependencies.uploadCompletionCapabilities,
  });
}
