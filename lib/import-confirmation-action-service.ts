import {
  activateConfirmedDataUpdate,
  type ImportActivationCapabilities,
  type ImportActivationResult,
} from "./import-activation-service";

export type ImportConfirmationActionDependencies = Readonly<{
  resolveAuthenticatedOwnerId: () => Promise<string | null>;
  configuredOwnerId: string | null;
  now: () => Date;
  activationCapabilities: ImportActivationCapabilities;
}>;

export async function confirmOwnerDataUpdate(
  input: Readonly<{
    previewId: string;
    previewFingerprintSha256: string;
    idempotencyKey: string;
    explicitlyConfirmed: boolean;
  }>,
  dependencies: ImportConfirmationActionDependencies,
): Promise<ImportActivationResult> {
  const authenticatedOwnerId = await dependencies.resolveAuthenticatedOwnerId();

  return activateConfirmedDataUpdate({
    authenticatedOwnerId,
    configuredOwnerId: dependencies.configuredOwnerId,
    previewId: input.previewId,
    previewFingerprintSha256: input.previewFingerprintSha256,
    idempotencyKey: input.idempotencyKey,
    explicitlyConfirmed: input.explicitlyConfirmed,
    capabilities: dependencies.activationCapabilities,
    now: dependencies.now(),
  });
}
