import { deriveFreshness, type FreshnessState } from "@/domain/freshness";
import type { ImportSourceType } from "@/domain/import-contract";

export const historicalImportSources = [
  "race_merge",
  "core_details",
  "current_vault",
  "current_arena",
] as const satisfies readonly ImportSourceType[];

export type HistoricalImportSource = (typeof historicalImportSources)[number];
export type ImportBatchStatus =
  "uploaded" | "validating" | "quarantined" | "accepted" | "rolled_back";

export type ImportIssueCount = Readonly<{
  code: string;
  severity: "info" | "warning" | "error";
  occurrenceCount: number;
}>;

export type PrivateImportBatch = Readonly<{
  batchId: string;
  sourceType: HistoricalImportSource;
  status: ImportBatchStatus;
  uploadedAt: string;
  importCompletedAt: string | null;
  dataCurrentThrough: string | null;
  aggregateRefreshedAt: string | null;
  sourceRows: number;
  acceptedRows: number;
  rejectedRows: number;
  warningRows: number;
  isActive: boolean;
  priorVersionAvailable: boolean;
  identityReviewCount: number;
  reconciliationReviewCount: number;
  issueCounts: readonly ImportIssueCount[];
}>;

export type SourceImportStatus = Readonly<{
  sourceType: HistoricalImportSource;
  latestBatchStatus: ImportBatchStatus | "not_imported";
  latestBatchUploadedAt: string | null;
  activeBatchId: string | null;
  dataCurrentThrough: string | null;
  lastImportedAt: string | null;
  aggregateRefreshedAt: string | null;
  freshness: FreshnessState;
  acceptedRows: number | null;
  rejectedRows: number | null;
  warningRows: number | null;
}>;

export type RecoveryQueueItem = Readonly<{
  key: string;
  batchId: string;
  sourceType: HistoricalImportSource;
  kind:
    | "rollback_available"
    | "identity_review"
    | "reconciliation_review"
    | "aggregate_pending";
  count: number;
}>;

export type ImportWorkspace = Readonly<{
  sources: readonly SourceImportStatus[];
  recentBatches: readonly PrivateImportBatch[];
  recoveryQueue: readonly RecoveryQueueItem[];
}>;

export type RedactedImportBatchSummary = Readonly<{
  sourceType: HistoricalImportSource;
  status: ImportBatchStatus;
  sourceRows: number;
  acceptedRows: number;
  rejectedRows: number;
  warningRows: number;
  issueCounts: readonly ImportIssueCount[];
}>;

function canonicalTimestamp(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical ISO-8601 timestamp`);
  }
  return parsed;
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
}

function assertBatch(batch: PrivateImportBatch): void {
  if (!batch.batchId.trim()) throw new Error("batchId is required");
  const uploadedAt = canonicalTimestamp(batch.uploadedAt, "uploadedAt");
  const completedAt = batch.importCompletedAt
    ? canonicalTimestamp(batch.importCompletedAt, "importCompletedAt")
    : null;
  const currentThrough = batch.dataCurrentThrough
    ? canonicalTimestamp(batch.dataCurrentThrough, "dataCurrentThrough")
    : null;
  const refreshedAt = batch.aggregateRefreshedAt
    ? canonicalTimestamp(batch.aggregateRefreshedAt, "aggregateRefreshedAt")
    : null;

  for (const field of [
    "sourceRows",
    "acceptedRows",
    "rejectedRows",
    "warningRows",
    "identityReviewCount",
    "reconciliationReviewCount",
  ] as const) {
    assertNonNegativeInteger(batch[field], field);
  }
  if (batch.acceptedRows + batch.rejectedRows !== batch.sourceRows) {
    throw new Error("acceptedRows plus rejectedRows must equal sourceRows");
  }
  if (batch.warningRows > batch.sourceRows) {
    throw new Error("warningRows cannot exceed sourceRows");
  }
  if (completedAt && completedAt < uploadedAt) {
    throw new Error("import completion cannot precede upload");
  }
  if (["accepted", "rolled_back"].includes(batch.status) && !completedAt) {
    throw new Error("completed imports require importCompletedAt");
  }
  if (batch.isActive && batch.status !== "accepted") {
    throw new Error("only an accepted batch can be active");
  }
  if (refreshedAt && (!completedAt || refreshedAt < completedAt)) {
    throw new Error("aggregate refresh cannot precede import completion");
  }
  if (currentThrough && currentThrough > new Date("9999-12-31T23:59:59.999Z")) {
    throw new Error("dataCurrentThrough is outside the supported range");
  }

  for (const issue of batch.issueCounts) {
    if (!issue.code.trim()) throw new Error("issue code is required");
    if (
      !Number.isSafeInteger(issue.occurrenceCount) ||
      issue.occurrenceCount <= 0
    ) {
      throw new Error("issue occurrenceCount must be a positive safe integer");
    }
  }
}

function byUploadedDescending(
  left: PrivateImportBatch,
  right: PrivateImportBatch,
): number {
  return Date.parse(right.uploadedAt) - Date.parse(left.uploadedAt);
}

function sourceStatus(
  sourceType: HistoricalImportSource,
  batches: readonly PrivateImportBatch[],
  now: Date,
): SourceImportStatus {
  const sourceBatches = batches
    .filter((batch) => batch.sourceType === sourceType)
    .sort(byUploadedDescending);
  const latest = sourceBatches[0];
  const active = sourceBatches.find((batch) => batch.isActive);

  return {
    sourceType,
    latestBatchStatus: latest?.status ?? "not_imported",
    latestBatchUploadedAt: latest?.uploadedAt ?? null,
    activeBatchId: active?.batchId ?? null,
    dataCurrentThrough: active?.dataCurrentThrough ?? null,
    lastImportedAt: active?.importCompletedAt ?? null,
    aggregateRefreshedAt: active?.aggregateRefreshedAt ?? null,
    freshness: deriveFreshness(
      active?.dataCurrentThrough ? new Date(active.dataCurrentThrough) : null,
      now,
    ),
    acceptedRows: active?.acceptedRows ?? null,
    rejectedRows: active?.rejectedRows ?? null,
    warningRows: active?.warningRows ?? null,
  };
}

function recoveryItems(batch: PrivateImportBatch): RecoveryQueueItem[] {
  if (!batch.isActive) return [];
  const items: RecoveryQueueItem[] = [];
  if (batch.priorVersionAvailable) {
    items.push({
      key: `${batch.batchId}:rollback`,
      batchId: batch.batchId,
      sourceType: batch.sourceType,
      kind: "rollback_available",
      count: 1,
    });
  }
  if (batch.identityReviewCount > 0) {
    items.push({
      key: `${batch.batchId}:identity`,
      batchId: batch.batchId,
      sourceType: batch.sourceType,
      kind: "identity_review",
      count: batch.identityReviewCount,
    });
  }
  if (batch.reconciliationReviewCount > 0) {
    items.push({
      key: `${batch.batchId}:reconciliation`,
      batchId: batch.batchId,
      sourceType: batch.sourceType,
      kind: "reconciliation_review",
      count: batch.reconciliationReviewCount,
    });
  }
  if (batch.aggregateRefreshedAt === null) {
    items.push({
      key: `${batch.batchId}:aggregate`,
      batchId: batch.batchId,
      sourceType: batch.sourceType,
      kind: "aggregate_pending",
      count: 1,
    });
  }
  return items;
}

export function buildImportWorkspace(
  batches: readonly PrivateImportBatch[],
  now: Date,
): ImportWorkspace {
  if (Number.isNaN(now.getTime())) throw new Error("now must be valid");
  batches.forEach(assertBatch);
  if (new Set(batches.map(({ batchId }) => batchId)).size !== batches.length) {
    throw new Error("batchId must be unique");
  }

  for (const sourceType of historicalImportSources) {
    const activeCount = batches.filter(
      (batch) => batch.sourceType === sourceType && batch.isActive,
    ).length;
    if (activeCount > 1) {
      throw new Error(
        `source ${sourceType} cannot have multiple active batches`,
      );
    }
  }

  const recentBatches = [...batches].sort(byUploadedDescending);
  return {
    sources: historicalImportSources.map((sourceType) =>
      sourceStatus(sourceType, batches, now),
    ),
    recentBatches,
    recoveryQueue: recentBatches.flatMap(recoveryItems),
  };
}

export function redactImportBatchSummary(
  batch: PrivateImportBatch,
): RedactedImportBatchSummary {
  assertBatch(batch);
  return {
    sourceType: batch.sourceType,
    status: batch.status,
    sourceRows: batch.sourceRows,
    acceptedRows: batch.acceptedRows,
    rejectedRows: batch.rejectedRows,
    warningRows: batch.warningRows,
    issueCounts: batch.issueCounts.map((issue) => ({ ...issue })),
  };
}
