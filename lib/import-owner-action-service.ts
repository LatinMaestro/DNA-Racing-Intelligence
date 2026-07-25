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

export async function beginOwnerImportUpload(
  input: Readonly<{
    idempotencyKey: string;
    files: readonly ImportUploadCandidate[];
  }>,
  dependencies: ImportOwnerActionDependencies,
): Promise<ImportUploadIntakeResult> {
  const authenticatedOwnerId = await dependencies.resolveAuthenticatedOwnerId();

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
  }>,
  dependencies: ImportOwnerActionDependencies,
): Promise<ImportUploadCompletionResult> {
  const authenticatedOwnerId = await dependencies.resolveAuthenticatedOwnerId();

  return completePrivateImportUpload({
    authenticatedOwnerId,
    configuredOwnerId: dependencies.configuredOwnerId,
    uploadBatchId: input.uploadBatchId,
    idempotencyKey: input.idempotencyKey,
    now: dependencies.now(),
    capabilities: dependencies.uploadCompletionCapabilities,
  });
}
