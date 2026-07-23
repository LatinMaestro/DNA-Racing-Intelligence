export type SnapshotSource =
  "race_merge" | "core_details" | "current_vault" | "current_arena";

export type SnapshotFreshnessInput = Readonly<{
  snapshotId: string;
  source: SnapshotSource;
  dataCurrentThrough: string | null;
  lastImportedAt: string | null;
  aggregateRefreshedAt: string | null;
  evaluatedAt: string;
  currentMaximumAgeDays: number;
  ageingMaximumAgeDays: number;
}>;

export type SnapshotFreshnessResult = Readonly<{
  snapshotId: string;
  source: SnapshotSource;
  dataCurrentThrough: string | null;
  lastImportedAt: string | null;
  aggregateRefreshedAt: string | null;
  evaluatedAt: string;
  ageMilliseconds: number | null;
  freshness: "not_imported" | "unknown" | "current" | "ageing" | "stale";
  aggregateStatus: "not_available" | "pending" | "refreshed";
  confidenceTreatment:
    | "unavailable"
    | "unknown_age"
    | "no_freshness_penalty"
    | "warning_required"
    | "review_required";
  historicalSnapshot: true;
  liveStateClaimAllowed: false;
  acceptedHistoricalFactsChanged: false;
  warnings: readonly string[];
}>;

const DAY_MILLISECONDS = 86_400_000;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function timestamp(value: string, label: string): string {
  const parsed = Date.parse(required(value, label));
  if (Number.isNaN(parsed)) throw new Error(`${label} must be valid.`);
  return new Date(parsed).toISOString();
}

function threshold(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

export function validateSnapshotFreshness(
  input: SnapshotFreshnessInput,
): SnapshotFreshnessResult {
  const snapshotId = required(input.snapshotId, "Snapshot ID");
  if (
    !["race_merge", "core_details", "current_vault", "current_arena"].includes(
      input.source,
    )
  ) {
    throw new Error("Snapshot source is invalid.");
  }
  const evaluatedAt = timestamp(input.evaluatedAt, "Evaluation time");
  const currentMaximumAgeDays = threshold(
    input.currentMaximumAgeDays,
    "Current maximum age",
  );
  const ageingMaximumAgeDays = threshold(
    input.ageingMaximumAgeDays,
    "Ageing maximum age",
  );
  if (ageingMaximumAgeDays < currentMaximumAgeDays) {
    throw new Error(
      "Ageing maximum age cannot be below the current maximum age.",
    );
  }

  if (input.lastImportedAt === null) {
    if (
      input.dataCurrentThrough !== null ||
      input.aggregateRefreshedAt !== null
    ) {
      throw new Error(
        "A not-imported source cannot have coverage or aggregate timestamps.",
      );
    }
    return {
      snapshotId,
      source: input.source,
      dataCurrentThrough: null,
      lastImportedAt: null,
      aggregateRefreshedAt: null,
      evaluatedAt,
      ageMilliseconds: null,
      freshness: "not_imported",
      aggregateStatus: "not_available",
      confidenceTreatment: "unavailable",
      historicalSnapshot: true,
      liveStateClaimAllowed: false,
      acceptedHistoricalFactsChanged: false,
      warnings: ["This source has not been imported."],
    };
  }

  const lastImportedAt = timestamp(input.lastImportedAt, "Last imported time");
  if (Date.parse(lastImportedAt) > Date.parse(evaluatedAt)) {
    throw new Error("Last imported time cannot be in the future.");
  }
  const dataCurrentThrough =
    input.dataCurrentThrough === null
      ? null
      : timestamp(input.dataCurrentThrough, "Data current-through time");
  if (
    dataCurrentThrough !== null &&
    Date.parse(dataCurrentThrough) > Date.parse(lastImportedAt)
  ) {
    throw new Error(
      "Data current-through time cannot postdate the completed import.",
    );
  }
  const aggregateRefreshedAt =
    input.aggregateRefreshedAt === null
      ? null
      : timestamp(input.aggregateRefreshedAt, "Aggregate refresh time");
  if (
    aggregateRefreshedAt !== null &&
    (Date.parse(aggregateRefreshedAt) < Date.parse(lastImportedAt) ||
      Date.parse(aggregateRefreshedAt) > Date.parse(evaluatedAt))
  ) {
    throw new Error(
      "Aggregate refresh time must follow import and not be in the future.",
    );
  }

  if (dataCurrentThrough === null) {
    return {
      snapshotId,
      source: input.source,
      dataCurrentThrough: null,
      lastImportedAt,
      aggregateRefreshedAt,
      evaluatedAt,
      ageMilliseconds: null,
      freshness: "unknown",
      aggregateStatus: aggregateRefreshedAt === null ? "pending" : "refreshed",
      confidenceTreatment: "unknown_age",
      historicalSnapshot: true,
      liveStateClaimAllowed: false,
      acceptedHistoricalFactsChanged: false,
      warnings: [
        "The source was imported but its data current-through time is unknown.",
      ],
    };
  }

  const ageMilliseconds =
    Date.parse(evaluatedAt) - Date.parse(dataCurrentThrough);
  const currentLimit = currentMaximumAgeDays * DAY_MILLISECONDS;
  const ageingLimit = ageingMaximumAgeDays * DAY_MILLISECONDS;
  const freshness =
    ageMilliseconds <= currentLimit
      ? "current"
      : ageMilliseconds <= ageingLimit
        ? "ageing"
        : "stale";
  const warnings: string[] = [];
  if (freshness === "ageing") {
    warnings.push("Imported historical evidence is ageing.");
  }
  if (freshness === "stale") {
    warnings.push("Imported historical evidence is stale and requires review.");
  }
  if (aggregateRefreshedAt === null) {
    warnings.push("Derived aggregates have not completed refresh.");
  }

  return {
    snapshotId,
    source: input.source,
    dataCurrentThrough,
    lastImportedAt,
    aggregateRefreshedAt,
    evaluatedAt,
    ageMilliseconds,
    freshness,
    aggregateStatus: aggregateRefreshedAt === null ? "pending" : "refreshed",
    confidenceTreatment:
      freshness === "current"
        ? "no_freshness_penalty"
        : freshness === "ageing"
          ? "warning_required"
          : "review_required",
    historicalSnapshot: true,
    liveStateClaimAllowed: false,
    acceptedHistoricalFactsChanged: false,
    warnings,
  };
}
