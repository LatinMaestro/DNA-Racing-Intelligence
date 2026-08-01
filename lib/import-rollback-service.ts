import {
  historicalImportSources,
  type HistoricalImportSource,
} from "@/domain/import-workflow";

type RepositoryRollbackResult =
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
    }>;

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
      }) => Promise<RepositoryRollbackResult>;
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
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

function identity(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error("Owner identity is invalid");
  }
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function safeIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} is invalid`);
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function reason(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Rollback reason must be text");
  }
  const normalized = value.trim();
  if (
    normalized.length < 10 ||
    normalized.length > 500 ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new Error(
      "Rollback reason must contain between 10 and 500 printable characters",
    );
  }
  return normalized;
}

function normalizeRepositoryResult(value: unknown): RepositoryRollbackResult {
  if (typeof value !== "object" || value === null) {
    throw new Error("Rollback repository result is invalid");
  }
  const result = value as Record<string, unknown>;
  if (
    result.status === "not_found" ||
    result.status === "not_active" ||
    result.status === "no_prior_version"
  ) {
    return { status: result.status };
  }
  if (result.status !== "restored") {
    throw new Error("Rollback repository status is invalid");
  }
  if (result.disposition !== "created" && result.disposition !== "existing") {
    throw new Error("Rollback disposition is invalid");
  }
  if (
    typeof result.sourceType !== "string" ||
    !historicalImportSources.some(
      (candidate) => candidate === result.sourceType,
    )
  ) {
    throw new Error("Rollback sourceType is invalid");
  }
  return {
    status: "restored",
    disposition: result.disposition,
    rollbackId: safeIdentifier(result.rollbackId, "rollbackId"),
    sourceType: result.sourceType as HistoricalImportSource,
    restoredBatchId: safeIdentifier(result.restoredBatchId, "restoredBatchId"),
    aggregateRefreshId: safeIdentifier(
      result.aggregateRefreshId,
      "aggregateRefreshId",
    ),
  };
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
  if (
    input.repository.status !== "ready" ||
    typeof input.repository.rollbackActiveSourceVersion !== "function"
  ) {
    throw new Error("Rollback repository is invalid");
  }
  if (input.explicitlyConfirmed !== true) {
    throw new Error("Explicit owner confirmation is required.");
  }
  if (
    !(input.requestedAt instanceof Date) ||
    Number.isNaN(input.requestedAt.getTime())
  ) {
    throw new Error("requestedAt must be valid");
  }

  const result = normalizeRepositoryResult(
    await input.repository.rollbackActiveSourceVersion({
      ownerId: authenticatedOwnerId,
      batchId: safeIdentifier(input.batchId, "batchId"),
      reason: reason(input.rollbackReason),
      idempotencyKey: safeIdentifier(input.idempotencyKey, "idempotencyKey"),
      requestedAt: input.requestedAt.toISOString(),
    }),
  );
  if (result.status !== "restored") return result;

  return {
    ...result,
    aggregateStatus: "pending",
    provenanceRetained: true,
  };
}
