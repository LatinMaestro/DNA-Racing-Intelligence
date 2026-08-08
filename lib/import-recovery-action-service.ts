import {
  rollbackAcceptedImport,
  type ImportRollbackRepository,
  type ImportRollbackResult,
} from "./import-rollback-service";

export type ImportRecoveryActionDependencies = Readonly<{
  resolveAuthenticatedOwnerId: () => Promise<string | null>;
  configuredOwnerId: string | null;
  now: () => Date;
  rollbackRepository: ImportRollbackRepository;
}>;

async function resolveOwnerId(
  dependencies: ImportRecoveryActionDependencies,
): Promise<string | null> {
  try {
    return await dependencies.resolveAuthenticatedOwnerId();
  } catch {
    throw new Error("Owner authentication is unavailable.");
  }
}

export async function rollbackOwnerImport(
  input: Readonly<{
    batchId: string;
    rollbackReason: string;
    idempotencyKey: string;
    explicitlyConfirmed: boolean;
  }>,
  dependencies: ImportRecoveryActionDependencies,
): Promise<ImportRollbackResult> {
  const authenticatedOwnerId = await resolveOwnerId(dependencies);

  return rollbackAcceptedImport({
    authenticatedOwnerId,
    configuredOwnerId: dependencies.configuredOwnerId,
    batchId: input.batchId,
    rollbackReason: input.rollbackReason,
    idempotencyKey: input.idempotencyKey,
    explicitlyConfirmed: input.explicitlyConfirmed,
    requestedAt: dependencies.now(),
    repository: dependencies.rollbackRepository,
  });
}
