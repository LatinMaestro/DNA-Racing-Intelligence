import {
  historicalImportSources,
  type HistoricalImportSource,
} from "@/domain/import-workflow";

export const updateTreatments = [
  "append_history",
  "versioned_upsert",
  "replacement_snapshot",
] as const;
export type UpdateTreatment = (typeof updateTreatments)[number];

export type StagedUpdateFile = Readonly<{
  uploadId: string;
  sourceType: HistoricalImportSource;
  checksumSha256: string;
  schemaVersion: string;
  schemaSupported: boolean;
  sourceRows: number;
  acceptedRows: number;
  exactReplayRows: number;
  exactDuplicateRows: number;
  conflictingRows: number;
  malformedRows: number;
  warningRows: number;
  minimumEventAt: string | null;
  maximumEventAt: string | null;
}>;

export type SourceUpdatePreview = Readonly<{
  sourceType: HistoricalImportSource;
  treatment: UpdateTreatment;
  orderedUploadIds: readonly string[];
  sourceRows: number;
  acceptedRows: number;
  ignoredReplayRows: number;
  ignoredDuplicateRows: number;
  conflictingRows: number;
  malformedRows: number;
  warningRows: number;
  minimumEventAt: string | null;
  maximumEventAt: string | null;
  readiness: "ready" | "blocked";
  blockers: readonly string[];
}>;

export type DataUpdatePreview = Readonly<{
  sources: readonly SourceUpdatePreview[];
  totals: Readonly<{
    files: number;
    sourceRows: number;
    acceptedRows: number;
    ignoredReplayRows: number;
    ignoredDuplicateRows: number;
    conflictingRows: number;
    malformedRows: number;
    warningRows: number;
  }>;
  confirmation: Readonly<{
    allowed: boolean;
    requiresExplicitOwnerConfirmation: true;
    startsBackgroundProcessing: true;
  }>;
}>;

const SHA_256_PATTERN = /^[a-f0-9]{64}$/;

function treatment(sourceType: HistoricalImportSource): UpdateTreatment {
  if (sourceType === "race_merge") return "append_history";
  if (sourceType === "core_details") return "versioned_upsert";
  return "replacement_snapshot";
}

function requireNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
}

function canonicalTimestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical ISO-8601 timestamp`);
  }
  return value;
}

function assertFile(file: StagedUpdateFile): void {
  if (file.uploadId.trim() === "") throw new Error("uploadId is required");
  if (!historicalImportSources.includes(file.sourceType)) {
    throw new Error(`Unsupported source type for ${file.uploadId}`);
  }
  if (!SHA_256_PATTERN.test(file.checksumSha256)) {
    throw new Error(`Invalid checksum for ${file.uploadId}`);
  }
  if (file.schemaVersion.trim() === "") {
    throw new Error(`schemaVersion is required for ${file.uploadId}`);
  }

  for (const field of [
    "sourceRows",
    "acceptedRows",
    "exactReplayRows",
    "exactDuplicateRows",
    "conflictingRows",
    "malformedRows",
    "warningRows",
  ] as const) {
    requireNonNegativeInteger(file[field], `${file.uploadId}.${field}`);
  }
  if (
    file.acceptedRows +
      file.exactReplayRows +
      file.exactDuplicateRows +
      file.conflictingRows +
      file.malformedRows !==
    file.sourceRows
  ) {
    throw new Error(
      `Preview row classifications must equal sourceRows for ${file.uploadId}`,
    );
  }
  if (file.warningRows > file.sourceRows) {
    throw new Error(
      `warningRows cannot exceed sourceRows for ${file.uploadId}`,
    );
  }

  const hasMinimum = file.minimumEventAt !== null;
  const hasMaximum = file.maximumEventAt !== null;
  if (hasMinimum !== hasMaximum) {
    throw new Error(
      `Race coverage bounds must both be present or absent for ${file.uploadId}`,
    );
  }
  if (file.sourceType === "race_merge" && file.sourceRows > 0 && !hasMinimum) {
    throw new Error(`Race Merge coverage is required for ${file.uploadId}`);
  }
  if (file.sourceType !== "race_merge" && hasMinimum) {
    throw new Error(
      `Event coverage is only valid for Race Merge file ${file.uploadId}`,
    );
  }
  if (file.minimumEventAt && file.maximumEventAt) {
    const minimum = canonicalTimestamp(
      file.minimumEventAt,
      `${file.uploadId}.minimumEventAt`,
    );
    const maximum = canonicalTimestamp(
      file.maximumEventAt,
      `${file.uploadId}.maximumEventAt`,
    );
    if (minimum > maximum) {
      throw new Error(`Race coverage is reversed for ${file.uploadId}`);
    }
  }
}

function sum(
  files: readonly StagedUpdateFile[],
  field:
    | "sourceRows"
    | "acceptedRows"
    | "exactReplayRows"
    | "exactDuplicateRows"
    | "conflictingRows"
    | "malformedRows"
    | "warningRows",
): number {
  const total = files.reduce((result, file) => result + file[field], 0);
  if (!Number.isSafeInteger(total)) {
    throw new Error(`${field} total must be a non-negative safe integer`);
  }
  return total;
}

function sourcePreview(
  sourceType: HistoricalImportSource,
  files: readonly StagedUpdateFile[],
): SourceUpdatePreview {
  const ordered = [...files].sort((left, right) => {
    if (sourceType === "race_merge") {
      return (
        Date.parse(left.minimumEventAt ?? "") -
          Date.parse(right.minimumEventAt ?? "") ||
        Date.parse(left.maximumEventAt ?? "") -
          Date.parse(right.maximumEventAt ?? "") ||
        left.uploadId.localeCompare(right.uploadId)
      );
    }
    return left.uploadId.localeCompare(right.uploadId);
  });

  const blockers: string[] = [];
  if (sourceType !== "race_merge" && ordered.length > 1) {
    blockers.push("multiple_snapshot_candidates");
  }
  if (ordered.some((file) => !file.schemaSupported)) {
    blockers.push("unsupported_schema");
  }
  if (sum(ordered, "conflictingRows") > 0) {
    blockers.push("conflicting_rows");
  }
  if (sum(ordered, "malformedRows") > 0) {
    blockers.push("malformed_rows");
  }
  const minimumEventAt =
    ordered
      .flatMap((file) => (file.minimumEventAt ? [file.minimumEventAt] : []))
      .sort()[0] ?? null;
  const maximumEventAt =
    ordered
      .flatMap((file) => (file.maximumEventAt ? [file.maximumEventAt] : []))
      .sort()
      .at(-1) ?? null;

  return {
    sourceType,
    treatment: treatment(sourceType),
    orderedUploadIds: ordered.map(({ uploadId }) => uploadId),
    sourceRows: sum(ordered, "sourceRows"),
    acceptedRows: sum(ordered, "acceptedRows"),
    ignoredReplayRows: sum(ordered, "exactReplayRows"),
    ignoredDuplicateRows: sum(ordered, "exactDuplicateRows"),
    conflictingRows: sum(ordered, "conflictingRows"),
    malformedRows: sum(ordered, "malformedRows"),
    warningRows: sum(ordered, "warningRows"),
    minimumEventAt,
    maximumEventAt,
    readiness: blockers.length === 0 ? "ready" : "blocked",
    blockers,
  };
}

export function buildDataUpdatePreview(
  files: readonly StagedUpdateFile[],
): DataUpdatePreview {
  if (files.length === 0)
    throw new Error("At least one staged file is required");
  files.forEach(assertFile);
  if (new Set(files.map(({ uploadId }) => uploadId)).size !== files.length) {
    throw new Error("uploadId must be unique");
  }
  if (
    new Set(files.map(({ checksumSha256 }) => checksumSha256)).size !==
    files.length
  ) {
    throw new Error("Duplicate file checksums must be uploaded only once");
  }

  const sources = historicalImportSources
    .map((sourceType) => ({
      sourceType,
      files: files.filter((file) => file.sourceType === sourceType),
    }))
    .filter(({ files: sourceFiles }) => sourceFiles.length > 0)
    .map(({ sourceType, files: sourceFiles }) =>
      sourcePreview(sourceType, sourceFiles),
    );

  const totals = {
    files: files.length,
    sourceRows: sum(files, "sourceRows"),
    acceptedRows: sum(files, "acceptedRows"),
    ignoredReplayRows: sum(files, "exactReplayRows"),
    ignoredDuplicateRows: sum(files, "exactDuplicateRows"),
    conflictingRows: sum(files, "conflictingRows"),
    malformedRows: sum(files, "malformedRows"),
    warningRows: sum(files, "warningRows"),
  };

  return {
    sources,
    totals,
    confirmation: {
      allowed: sources.every(({ readiness }) => readiness === "ready"),
      requiresExplicitOwnerConfirmation: true,
      startsBackgroundProcessing: true,
    },
  };
}
