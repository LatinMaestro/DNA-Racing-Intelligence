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

export async function rollbackOwnerImport(
  input: Readonly<{
    batchId: string;
    rollbackReason: string;
    idempotencyKey: string;
    explicitlyConfirmed: boolean;
  }>,
  dependencies: ImportRecoveryActionDependencies,
): Promise<ImportRollbackResult> {
  const authenticatedOwnerId = await dependencies.resolveAuthenticatedOwnerId();

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
