export const importProgressStages = [
  "received",
  "validation",
  "activation",
  "aggregate_refresh",
  "ready",
] as const;

export type ImportProgressStage = (typeof importProgressStages)[number];
export type ImportProgressStageState =
  "complete" | "current" | "waiting" | "blocked" | "recovered";

export type ImportProgressBatch = Readonly<{
  batchId: string;
  sourceType: "race_merge" | "core_details" | "current_vault" | "current_arena";
  status:
    "uploaded" | "validating" | "quarantined" | "accepted" | "rolled_back";
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
}>;

export type ImportProgressStep = Readonly<{
  stage: ImportProgressStage;
  state: ImportProgressStageState;
}>;

export type ImportReadiness =
  "not_ready" | "review_required" | "historical_views_ready" | "recovered";

export type ImportProgressProjection = Readonly<{
  key: string;
  sourceType: ImportProgressBatch["sourceType"];
  headline:
    | "Received"
    | "Validating"
    | "Validation blocked"
    | "Aggregate refresh pending"
    | "Imported with review work"
    | "Historical views ready"
    | "Rolled back";
  readiness: ImportReadiness;
  steps: readonly ImportProgressStep[];
  acceptedRows: number;
  rejectedRows: number;
  warningRows: number;
  identityReviewCount: number;
  reconciliationReviewCount: number;
  dataCurrentThrough: string | null;
  lastImportedAt: string | null;
  aggregateRefreshedAt: string | null;
  rollbackAvailable: boolean;
  aggregateRefreshPending: boolean;
}>;

function assertNonNegativeSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
}

function assertBatch(batch: ImportProgressBatch): void {
  if (!batch.batchId.trim()) throw new Error("batchId is required");

  for (const field of [
    "sourceRows",
    "acceptedRows",
    "rejectedRows",
    "warningRows",
    "identityReviewCount",
    "reconciliationReviewCount",
  ] as const) {
    assertNonNegativeSafeInteger(batch[field], field);
  }

  if (batch.acceptedRows + batch.rejectedRows !== batch.sourceRows) {
    throw new Error("acceptedRows plus rejectedRows must equal sourceRows");
  }
  if (batch.warningRows > batch.sourceRows) {
    throw new Error("warningRows cannot exceed sourceRows");
  }
  if (batch.status === "accepted" && batch.importCompletedAt === null) {
    throw new Error("accepted batches require importCompletedAt");
  }
  if (
    batch.aggregateRefreshedAt !== null &&
    (batch.status !== "accepted" || batch.importCompletedAt === null)
  ) {
    throw new Error("aggregate refresh requires an accepted completed batch");
  }
  if (batch.isActive && batch.status !== "accepted") {
    throw new Error("only an accepted batch can be active");
  }
}

function step(
  stage: ImportProgressStage,
  state: ImportProgressStageState,
): ImportProgressStep {
  return { stage, state };
}

function projectSteps(
  batch: ImportProgressBatch,
): readonly ImportProgressStep[] {
  switch (batch.status) {
    case "uploaded":
      return [
        step("received", "complete"),
        step("validation", "current"),
        step("activation", "waiting"),
        step("aggregate_refresh", "waiting"),
        step("ready", "waiting"),
      ];
    case "validating":
      return [
        step("received", "complete"),
        step("validation", "current"),
        step("activation", "waiting"),
        step("aggregate_refresh", "waiting"),
        step("ready", "waiting"),
      ];
    case "quarantined":
      return [
        step("received", "complete"),
        step("validation", "blocked"),
        step("activation", "waiting"),
        step("aggregate_refresh", "waiting"),
        step("ready", "blocked"),
      ];
    case "rolled_back":
      return [
        step("received", "complete"),
        step("validation", "complete"),
        step("activation", "recovered"),
        step("aggregate_refresh", "waiting"),
        step("ready", "waiting"),
      ];
    case "accepted": {
      const reviewRequired =
        batch.rejectedRows > 0 ||
        batch.identityReviewCount > 0 ||
        batch.reconciliationReviewCount > 0;
      const refreshed = batch.aggregateRefreshedAt !== null;

      return [
        step("received", "complete"),
        step("validation", "complete"),
        step("activation", "complete"),
        step("aggregate_refresh", refreshed ? "complete" : "current"),
        step(
          "ready",
          refreshed ? (reviewRequired ? "blocked" : "complete") : "waiting",
        ),
      ];
    }
  }
}

function projectionState(
  batch: ImportProgressBatch,
): Pick<ImportProgressProjection, "headline" | "readiness"> {
  if (batch.status === "uploaded") {
    return { headline: "Received", readiness: "not_ready" };
  }
  if (batch.status === "validating") {
    return { headline: "Validating", readiness: "not_ready" };
  }
  if (batch.status === "quarantined") {
    return { headline: "Validation blocked", readiness: "not_ready" };
  }
  if (batch.status === "rolled_back") {
    return { headline: "Rolled back", readiness: "recovered" };
  }
  if (batch.aggregateRefreshedAt === null) {
    return { headline: "Aggregate refresh pending", readiness: "not_ready" };
  }
  if (
    batch.rejectedRows > 0 ||
    batch.identityReviewCount > 0 ||
    batch.reconciliationReviewCount > 0
  ) {
    return {
      headline: "Imported with review work",
      readiness: "review_required",
    };
  }
  return {
    headline: "Historical views ready",
    readiness: "historical_views_ready",
  };
}

export function projectImportProgress(
  batch: ImportProgressBatch,
): ImportProgressProjection {
  assertBatch(batch);
  const state = projectionState(batch);

  return {
    key: batch.batchId,
    sourceType: batch.sourceType,
    ...state,
    steps: projectSteps(batch),
    acceptedRows: batch.acceptedRows,
    rejectedRows: batch.rejectedRows,
    warningRows: batch.warningRows,
    identityReviewCount: batch.identityReviewCount,
    reconciliationReviewCount: batch.reconciliationReviewCount,
    dataCurrentThrough: batch.dataCurrentThrough,
    lastImportedAt: batch.importCompletedAt,
    aggregateRefreshedAt: batch.aggregateRefreshedAt,
    rollbackAvailable:
      batch.isActive &&
      batch.status === "accepted" &&
      batch.priorVersionAvailable,
    aggregateRefreshPending:
      batch.isActive &&
      batch.status === "accepted" &&
      batch.aggregateRefreshedAt === null,
  };
}

export function projectRecentImportProgress(
  batches: readonly ImportProgressBatch[],
  limit = 3,
): readonly ImportProgressProjection[] {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new Error("limit must be a non-negative safe integer");
  }

  const projections = batches.slice(0, limit).map(projectImportProgress);
  if (new Set(projections.map(({ key }) => key)).size !== projections.length) {
    throw new Error("progress projection keys must be unique");
  }
  return projections;
}
