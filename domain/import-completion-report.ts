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
const outcomes = ["accepted", "quarantined", "exact_replay"] as const;
const aggregateStatuses = [
  "not_required",
  "pending",
  "completed",
  "failed",
  "superseded",
] as const;
const countFields = [
  "sourceRows",
  "acceptedRows",
  "duplicateRows",
  "quarantinedRows",
  "warningRows",
  "identityReviewCount",
  "reconciliationReviewCount",
] as const;

function safeIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} is invalid`);
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function canonicalTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a canonical timestamp`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical timestamp`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function safeAdd(left: number, right: number, field: string): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) {
    throw new Error(`${field} total must be a non-negative safe integer`);
  }
  return total;
}

function normalizeSource(value: unknown): CompletedSourceUpdate {
  if (typeof value !== "object" || value === null) {
    throw new Error("Completed source evidence is invalid");
  }
  const source = value as Record<string, unknown>;
  if (
    typeof source.sourceType !== "string" ||
    !historicalImportSources.some(
      (candidate) => candidate === source.sourceType,
    )
  ) {
    throw new Error("sourceType is invalid");
  }
  if (
    typeof source.outcome !== "string" ||
    !outcomes.some((candidate) => candidate === source.outcome)
  ) {
    throw new Error("outcome is invalid");
  }
  if (typeof source.priorVersionAvailable !== "boolean") {
    throw new Error("priorVersionAvailable must be a Boolean");
  }

  const counts = Object.fromEntries(
    countFields.map((field) => [
      field,
      nonNegativeInteger(source[field], field),
    ]),
  ) as Record<(typeof countFields)[number], number>;
  const classifiedRows = safeAdd(
    safeAdd(
      counts.acceptedRows,
      counts.duplicateRows,
      "Completion row classifications",
    ),
    counts.quarantinedRows,
    "Completion row classifications",
  );
  if (classifiedRows !== counts.sourceRows) {
    throw new Error("Completion row classifications must equal sourceRows");
  }
  if (counts.warningRows > counts.sourceRows) {
    throw new Error("warningRows cannot exceed sourceRows");
  }

  const dataCurrentThrough =
    source.dataCurrentThrough === null
      ? null
      : canonicalTimestamp(source.dataCurrentThrough, "dataCurrentThrough");
  if (source.outcome === "quarantined" && counts.acceptedRows !== 0) {
    throw new Error("A quarantined source cannot contain accepted rows");
  }
  if (
    source.outcome === "exact_replay" &&
    (counts.acceptedRows !== 0 || counts.quarantinedRows !== 0)
  ) {
    throw new Error("An exact replay cannot create or quarantine rows");
  }

  return {
    sourceType: source.sourceType as HistoricalImportSource,
    batchId: safeIdentifier(source.batchId, "batchId"),
    outcome: source.outcome as CompletedSourceUpdate["outcome"],
    ...counts,
    dataCurrentThrough,
    priorVersionAvailable: source.priorVersionAvailable,
  };
}

function normalizeAggregateStatus(
  value: unknown,
): ImportCompletionReport["aggregateStatus"] {
  if (
    typeof value !== "string" ||
    !aggregateStatuses.some((candidate) => candidate === value)
  ) {
    throw new Error("aggregateStatus is invalid");
  }
  return value as ImportCompletionReport["aggregateStatus"];
}

function sum(
  sources: readonly CompletedSourceUpdate[],
  field: (typeof countFields)[number],
): number {
  return sources.reduce(
    (total, source) => safeAdd(total, source[field], field),
    0,
  );
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
  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    throw new Error("At least one completed source is required");
  }
  const sources = input.sources.map((source) => normalizeSource(source));
  if (new Set(sources.map(({ batchId }) => batchId)).size !== sources.length) {
    throw new Error("Completion batch IDs must be unique");
  }
  const aggregateStatus = normalizeAggregateStatus(input.aggregateStatus);

  const acceptedRows = sum(sources, "acceptedRows");
  const quarantinedRows = sum(sources, "quarantinedRows");
  const identityReviewCount = sum(sources, "identityReviewCount");
  const reconciliationReviewCount = sum(sources, "reconciliationReviewCount");
  const acceptedChange = acceptedRows > 0;
  if (acceptedChange && aggregateStatus === "not_required") {
    throw new Error("Accepted changes require aggregate refresh evidence");
  }
  if (!acceptedChange && aggregateStatus === "completed") {
    throw new Error("Aggregate completion cannot be claimed without changes");
  }

  const reviewReasons: string[] = [];
  if (quarantinedRows > 0) reviewReasons.push("quarantined_rows");
  if (identityReviewCount > 0) reviewReasons.push("identity_review");
  if (reconciliationReviewCount > 0) {
    reviewReasons.push("reconciliation_review");
  }
  if (aggregateStatus === "pending") {
    reviewReasons.push("aggregate_refresh_pending");
  }
  if (aggregateStatus === "failed") {
    reviewReasons.push("aggregate_refresh_failed");
  }
  if (aggregateStatus === "superseded") {
    reviewReasons.push("aggregate_refresh_superseded");
  }

  const failed =
    sources.every(({ outcome }) => outcome === "quarantined") ||
    aggregateStatus === "failed";
  const ready =
    !failed &&
    reviewReasons.length === 0 &&
    (!acceptedChange || aggregateStatus === "completed");

  return {
    updateSessionId,
    completedAt,
    status: failed
      ? "failed"
      : reviewReasons.length > 0
        ? "completed_with_review"
        : "completed",
    aggregateStatus,
    recommendationReadiness: ready ? "ready" : failed ? "blocked" : "partial",
    sources,
    totals: {
      files: sources.length,
      sourceRows: sum(sources, "sourceRows"),
      acceptedRows,
      duplicateRows: sum(sources, "duplicateRows"),
      quarantinedRows,
      warningRows: sum(sources, "warningRows"),
      identityReviewCount,
      reconciliationReviewCount,
    },
    rollbackSourceTypes: historicalImportSources.filter((sourceType) =>
      sources.some(
        (source) =>
          source.sourceType === sourceType &&
          source.outcome === "accepted" &&
          source.priorVersionAvailable,
      ),
    ),
    reviewReasons,
  };
}
