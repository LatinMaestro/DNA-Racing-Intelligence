const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export type NormalizedAnalyticalArtifactSourceFamily =
  | "race_merge"
  | "core_details"
  | "current_arena";

export type NormalizedAnalyticalArtifactFormat = "parquet/v1";

export type NormalizedAnalyticalArtifactEvidence = Readonly<{
  sourceFamily: NormalizedAnalyticalArtifactSourceFamily;
  artifactFormat: NormalizedAnalyticalArtifactFormat;
  contentSha256: string;
  byteLength: number;
  sourceRowCount: number;
  readyRowCount: number;
  quarantinedRowCount: number;
  warningRowCount: number;
  naturalKeySetSha256: string;
  minimumEventAt: string | null;
  maximumEventAt: string | null;
}>;

export type CommittedNormalizedAnalyticalArtifact =
  NormalizedAnalyticalArtifactEvidence &
    Readonly<{
      objectId: string;
    }>;

export type PrivateNormalizedAnalyticalArtifactWriter = Readonly<{
  write: (chunk: Uint8Array) => Promise<void>;
  commit: (
    evidence: NormalizedAnalyticalArtifactEvidence,
  ) => Promise<CommittedNormalizedAnalyticalArtifact>;
  abort: (input: {
    reason:
      | "source_processing_failed"
      | "artifact_write_failed"
      | "artifact_verification_failed";
  }) => Promise<void>;
}>;

export type PrivateNormalizedAnalyticalArtifactStore = Readonly<{
  beginArtifact: (input: {
    ownerId: string;
    updateSessionId: string;
    importBatchId: string;
    sourceFamily: NormalizedAnalyticalArtifactSourceFamily;
    artifactFormat: NormalizedAnalyticalArtifactFormat;
  }) => Promise<PrivateNormalizedAnalyticalArtifactWriter>;
  openArtifact: (input: {
    ownerId: string;
    objectId: string;
    expectedByteLength: number;
    expectedContentSha256: string;
  }) => Promise<
    | Readonly<{ status: "missing" }>
    | Readonly<{
        status: "ready";
        advertisedByteLength: number;
        body: AsyncIterable<Uint8Array>;
      }>
  >;
  deleteArtifact: (input: {
    ownerId: string;
    objectId: string;
  }) => Promise<void>;
}>;

function nonNegativeSafeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function positiveSafeInteger(value: unknown, field: string): number {
  const result = nonNegativeSafeInteger(value, field);
  if (result === 0) throw new Error(`${field} must be positive`);
  return result;
}

function sha256(value: unknown, field: string): string {
  if (typeof value !== "string" || !SHA_256_PATTERN.test(value)) {
    throw new Error(`${field} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function canonicalTimestamp(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`${field} must be a canonical timestamp or null`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical timestamp or null`);
  }
  return value;
}

function sourceFamily(
  value: unknown,
): NormalizedAnalyticalArtifactSourceFamily {
  if (
    value !== "race_merge" &&
    value !== "core_details" &&
    value !== "current_arena"
  ) {
    throw new Error("sourceFamily is unsupported");
  }
  return value;
}

export function requirePrivateNormalizedArtifactObjectId(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("objectId must be a private opaque identifier");
  }
  const result = value.trim();
  if (
    result.length < 1 ||
    result.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(result) ||
    result.includes("://")
  ) {
    throw new Error("objectId must be a private opaque identifier");
  }
  return result;
}

export function validateNormalizedAnalyticalArtifactEvidence(
  value: NormalizedAnalyticalArtifactEvidence,
): NormalizedAnalyticalArtifactEvidence {
  const family = sourceFamily(value.sourceFamily);
  if (value.artifactFormat !== "parquet/v1") {
    throw new Error("artifactFormat is unsupported");
  }
  const byteLength = positiveSafeInteger(value.byteLength, "byteLength");
  const sourceRowCount = nonNegativeSafeInteger(
    value.sourceRowCount,
    "sourceRowCount",
  );
  const readyRowCount = nonNegativeSafeInteger(
    value.readyRowCount,
    "readyRowCount",
  );
  const quarantinedRowCount = nonNegativeSafeInteger(
    value.quarantinedRowCount,
    "quarantinedRowCount",
  );
  const warningRowCount = nonNegativeSafeInteger(
    value.warningRowCount,
    "warningRowCount",
  );
  if (readyRowCount + quarantinedRowCount !== sourceRowCount) {
    throw new Error("artifact row counts do not reconcile");
  }
  if (warningRowCount > sourceRowCount) {
    throw new Error("warningRowCount cannot exceed sourceRowCount");
  }

  const minimumEventAt = canonicalTimestamp(
    value.minimumEventAt,
    "minimumEventAt",
  );
  const maximumEventAt = canonicalTimestamp(
    value.maximumEventAt,
    "maximumEventAt",
  );
  if ((minimumEventAt === null) !== (maximumEventAt === null)) {
    throw new Error("artifact event bounds must both be present or absent");
  }
  if (
    minimumEventAt !== null &&
    maximumEventAt !== null &&
    maximumEventAt < minimumEventAt
  ) {
    throw new Error("artifact event bounds are reversed");
  }
  if (family !== "race_merge" && minimumEventAt !== null) {
    throw new Error("non-Race artifact cannot carry event-time bounds");
  }
  if (family === "race_merge" && readyRowCount > 0 && minimumEventAt === null) {
    throw new Error("ready Race artifact requires event-time bounds");
  }

  return Object.freeze({
    sourceFamily: family,
    artifactFormat: "parquet/v1",
    contentSha256: sha256(value.contentSha256, "contentSha256"),
    byteLength,
    sourceRowCount,
    readyRowCount,
    quarantinedRowCount,
    warningRowCount,
    naturalKeySetSha256: sha256(
      value.naturalKeySetSha256,
      "naturalKeySetSha256",
    ),
    minimumEventAt,
    maximumEventAt,
  });
}

export function validateNormalizedAnalyticalArtifactBegin(input: {
  ownerId: string;
  updateSessionId: string;
  importBatchId: string;
  sourceFamily: NormalizedAnalyticalArtifactSourceFamily;
  artifactFormat: NormalizedAnalyticalArtifactFormat;
}) {
  const ownerId = input.ownerId.trim();
  const updateSessionId = input.updateSessionId.trim();
  const importBatchId = input.importBatchId.trim();
  if (!SAFE_IDENTIFIER_PATTERN.test(ownerId)) {
    throw new Error("ownerId is invalid");
  }
  if (!SAFE_IDENTIFIER_PATTERN.test(updateSessionId)) {
    throw new Error("updateSessionId is invalid");
  }
  if (!UUID_PATTERN.test(importBatchId)) {
    throw new Error("importBatchId must be a UUID");
  }
  return Object.freeze({
    ownerId,
    updateSessionId,
    importBatchId,
    sourceFamily: sourceFamily(input.sourceFamily),
    artifactFormat:
      input.artifactFormat === "parquet/v1"
        ? ("parquet/v1" as const)
        : (() => {
            throw new Error("artifactFormat is unsupported");
          })(),
  });
}
