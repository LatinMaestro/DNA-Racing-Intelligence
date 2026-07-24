import {
  historicalImportSources,
  type HistoricalImportSource,
} from "@/domain/import-workflow";

export type CompletedSourceUpdate = Readonly<{
  sourceType: HistoricalImportSource;
  batchId: string;
  outcome: "accepted" | "quarantined" | "exact_replay";
  sourceRows: number;
  acceptedRows: number;
  duplicateRows: number;
  quarantinedRows: number;
  warningRows: number;
  dataCurrentThrough: string | null;
  priorVersionAvailable: boolean;
  identityReviewCount: number;
  reconciliationReviewCount: number;
}>;

export type ImportCompletionReport = Readonly<{
  updateSessionId: string;
  completedAt: string;
  status: "completed" | "completed_with_review" | "failed";
  aggregateStatus:
    "not_required" | "pending" | "completed" | "failed" | "superseded";
  recommendationReadiness: "ready" | "partial" | "blocked";
  sources: readonly CompletedSourceUpdate[];
  totals: Readonly<{
    files: number;
    sourceRows: number;
    acceptedRows: number;
    duplicateRows: number;
    quarantinedRows: number;
    warningRows: number;
    identityReviewCount: number;
    reconciliationReviewCount: number;
  }>;
  rollbackSourceTypes: readonly HistoricalImportSource[];
  reviewReasons: readonly string[];
}>;

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

function safeIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function canonicalTimestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical timestamp`);
  }
  return value;
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function assertSource(source: CompletedSourceUpdate): void {
  if (!historicalImportSources.includes(source.sourceType)) {
    throw new Error("sourceType is invalid");
  }
  safeIdentifier(source.batchId, "batchId");
  for (const field of [
    "sourceRows",
    "acceptedRows",
    "duplicateRows",
    "quarantinedRows",
    "warningRows",
    "identityReviewCount",
    "reconciliationReviewCount",
  ] as const) {
    nonNegativeInteger(source[field], field);
  }
  if (
    source.acceptedRows + source.duplicateRows + source.quarantinedRows !==
    source.sourceRows
  ) {
    throw new Error("Completion row classifications must equal sourceRows");
  }
  if (source.warningRows > source.sourceRows) {
    throw new Error("warningRows cannot exceed sourceRows");
  }
  if (source.dataCurrentThrough !== null) {
    canonicalTimestamp(source.dataCurrentThrough, "dataCurrentThrough");
  }
  if (source.outcome === "quarantined" && source.acceptedRows !== 0) {
    throw new Error("A quarantined source cannot contain accepted rows");
  }
  if (
    source.outcome === "exact_replay" &&
    (source.acceptedRows !== 0 || source.quarantinedRows !== 0)
  ) {
    throw new Error("An exact replay cannot create or quarantine rows");
  }
}

function sum(
  sources: readonly CompletedSourceUpdate[],
  field:
    | "sourceRows"
    | "acceptedRows"
    | "duplicateRows"
    | "quarantinedRows"
    | "warningRows"
    | "identityReviewCount"
    | "reconciliationReviewCount",
): number {
  return sources.reduce((total, source) => total + source[field], 0);
}

export function buildImportCompletionReport(
  input: Readonly<{
    updateSessionId: string;
    completedAt: string;
    sources: readonly CompletedSourceUpdate[];
    aggregateStatus: ImportCompletionReport["aggregateStatus"];
  }>,
): ImportCompletionReport {
  const updateSessionId = safeIdentifier(
    input.updateSessionId,
    "updateSessionId",
  );
  const completedAt = canonicalTimestamp(input.completedAt, "completedAt");
  if (input.sources.length === 0) {
    throw new Error("At least one completed source is required");
  }
  input.sources.forEach(assertSource);
  if (
    new Set(input.sources.map(({ batchId }) => batchId)).size !==
    input.sources.length
  ) {
    throw new Error("Completion batch IDs must be unique");
  }

  const acceptedRows = sum(input.sources, "acceptedRows");
  const quarantinedRows = sum(input.sources, "quarantinedRows");
  const identityReviewCount = sum(input.sources, "identityReviewCount");
  const reconciliationReviewCount = sum(
    input.sources,
    "reconciliationReviewCount",
  );
  const acceptedChange = acceptedRows > 0;
  if (acceptedChange && input.aggregateStatus === "not_required") {
    throw new Error("Accepted changes require aggregate refresh evidence");
  }
  if (!acceptedChange && input.aggregateStatus === "completed") {
    throw new Error("Aggregate completion cannot be claimed without changes");
  }

  const reviewReasons: string[] = [];
  if (quarantinedRows > 0) reviewReasons.push("quarantined_rows");
  if (identityReviewCount > 0) reviewReasons.push("identity_review");
  if (reconciliationReviewCount > 0) {
    reviewReasons.push("reconciliation_review");
  }
  if (input.aggregateStatus === "pending") {
    reviewReasons.push("aggregate_refresh_pending");
  }
  if (input.aggregateStatus === "failed") {
    reviewReasons.push("aggregate_refresh_failed");
  }
  if (input.aggregateStatus === "superseded") {
    reviewReasons.push("aggregate_refresh_superseded");
  }

  const failed =
    input.sources.every(({ outcome }) => outcome === "quarantined") ||
    input.aggregateStatus === "failed";
  const ready =
    !failed &&
    reviewReasons.length === 0 &&
    (!acceptedChange || input.aggregateStatus === "completed");

  return {
    updateSessionId,
    completedAt,
    status: failed
      ? "failed"
      : reviewReasons.length > 0
        ? "completed_with_review"
        : "completed",
    aggregateStatus: input.aggregateStatus,
    recommendationReadiness: ready ? "ready" : failed ? "blocked" : "partial",
    sources: input.sources.map((source) => ({ ...source })),
    totals: {
      files: input.sources.length,
      sourceRows: sum(input.sources, "sourceRows"),
      acceptedRows,
      duplicateRows: sum(input.sources, "duplicateRows"),
      quarantinedRows,
      warningRows: sum(input.sources, "warningRows"),
      identityReviewCount,
      reconciliationReviewCount,
    },
    rollbackSourceTypes: historicalImportSources.filter((sourceType) =>
      input.sources.some(
        (source) =>
          source.sourceType === sourceType &&
          source.outcome === "accepted" &&
          source.priorVersionAvailable,
      ),
    ),
    reviewReasons,
  };
}
