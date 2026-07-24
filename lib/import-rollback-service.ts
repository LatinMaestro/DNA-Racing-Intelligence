import type { HistoricalImportSource } from "@/domain/import-workflow";

export type ImportRollbackRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      rollbackActiveSourceVersion: (input: {
        ownerId: string;
        batchId: string;
        reason: string;
        idempotencyKey: string;
        requestedAt: string;
      }) => Promise<
        | Readonly<{ status: "not_found" }>
        | Readonly<{ status: "not_active" }>
        | Readonly<{ status: "no_prior_version" }>
        | Readonly<{
            status: "restored";
            disposition: "created" | "existing";
            rollbackId: string;
            sourceType: HistoricalImportSource;
            restoredBatchId: string;
            aggregateRefreshId: string;
          }>
      >;
    }>;

export type ImportRollbackResult =
  | Readonly<{ status: "identity_not_connected" }>
  | Readonly<{ status: "persistence_not_configured" }>
  | Readonly<{ status: "not_found" | "not_active" | "no_prior_version" }>
  | Readonly<{
      status: "restored";
      disposition: "created" | "existing";
      rollbackId: string;
      sourceType: HistoricalImportSource;
      restoredBatchId: string;
      aggregateRefreshId: string;
      aggregateStatus: "pending";
      provenanceRetained: true;
    }>;

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

function identity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function safeIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function reason(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 10 || normalized.length > 500) {
    throw new Error(
      "Rollback reason must contain between 10 and 500 characters",
    );
  }
  return normalized;
}

export async function rollbackAcceptedImport(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    batchId: string;
    rollbackReason: string;
    idempotencyKey: string;
    explicitlyConfirmed: boolean;
    requestedAt: Date;
    repository: ImportRollbackRepository;
  }>,
): Promise<ImportRollbackResult> {
  const authenticatedOwnerId = identity(input.authenticatedOwnerId);
  const configuredOwnerId = identity(input.configuredOwnerId);
  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return { status: "identity_not_connected" };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Import rollback access denied.");
  }
  if (input.repository.status === "not_configured") {
    return { status: "persistence_not_configured" };
  }
  if (!input.explicitlyConfirmed) {
    throw new Error("Explicit owner confirmation is required.");
  }
  if (Number.isNaN(input.requestedAt.getTime())) {
    throw new Error("requestedAt must be valid");
  }

  const result = await input.repository.rollbackActiveSourceVersion({
    ownerId: authenticatedOwnerId,
    batchId: safeIdentifier(input.batchId, "batchId"),
    reason: reason(input.rollbackReason),
    idempotencyKey: safeIdentifier(input.idempotencyKey, "idempotencyKey"),
    requestedAt: input.requestedAt.toISOString(),
  });
  if (result.status !== "restored") return result;

  return {
    status: "restored",
    disposition: result.disposition,
    rollbackId: safeIdentifier(result.rollbackId, "rollbackId"),
    sourceType: result.sourceType,
    restoredBatchId: safeIdentifier(result.restoredBatchId, "restoredBatchId"),
    aggregateRefreshId: safeIdentifier(
      result.aggregateRefreshId,
      "aggregateRefreshId",
    ),
    aggregateStatus: "pending",
    provenanceRetained: true,
  };
}
