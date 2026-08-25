import type { RaceMode } from "@/domain/import-contract";
import type { StarDataStatus } from "@/domain/source-adapters";
import type { RaceArchiveCoreAnalyticalObservation } from "./race-archive-core-analytical-observations";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const RACE_MODES = new Set<RaceMode>(["bike", "car", "horse"]);
const STAR_DATA_STATUSES = new Set<StarDataStatus>([
  "complete",
  "partial",
  "missing",
  "invalid",
]);

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Race archive scratch observation must be an object.");
  }
  return value as Readonly<Record<string, unknown>>;
}

function safeText(value: unknown, field: string, maximumLength = 512): string {
  if (typeof value !== "string") throw new Error(`${field} is invalid`);
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function nullableText(value: unknown, field: string): string | null {
  return value === null ? null : safeText(value, field);
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${field} is invalid`);
  }
  return value as number;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${field} is invalid`);
  }
  return value as number;
}

function nullableBoolean(value: unknown, field: string): boolean | null {
  if (value !== null && typeof value !== "boolean") {
    throw new Error(`${field} is invalid`);
  }
  return value as boolean | null;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} is invalid`);
  return value;
}

function mode(value: unknown): RaceMode {
  if (typeof value !== "string" || !RACE_MODES.has(value as RaceMode)) {
    throw new Error("mode is invalid");
  }
  return value as RaceMode;
}

function starDataStatus(value: unknown): StarDataStatus {
  if (
    typeof value !== "string" ||
    !STAR_DATA_STATUSES.has(value as StarDataStatus)
  ) {
    throw new Error("starDataStatus is invalid");
  }
  return value as StarDataStatus;
}

function timestamp(value: unknown, field: string): string {
  const normalized = safeText(value, field);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

export function normalizeRaceArchiveAnalyticalObservation(
  value: unknown,
): RaceArchiveCoreAnalyticalObservation {
  const input = record(value);
  const fingerprintSha256 = safeText(
    input.fingerprintSha256,
    "fingerprintSha256",
    64,
  );
  if (!SHA_256_PATTERN.test(fingerprintSha256)) {
    throw new Error("fingerprintSha256 is invalid");
  }
  const sourceEventId = safeText(input.sourceEventId, "sourceEventId");
  const sourceCoreId = safeText(input.sourceCoreId, "sourceCoreId");
  const naturalKey = safeText(input.naturalKey, "naturalKey");
  if (naturalKey !== `${sourceEventId}:${sourceCoreId}`) {
    throw new Error("naturalKey is inconsistent");
  }

  return Object.freeze({
    datasetVersionId: safeText(input.datasetVersionId, "datasetVersionId"),
    importBatchId: safeText(input.importBatchId, "importBatchId"),
    versionNumber: positiveInteger(input.versionNumber, "versionNumber"),
    partitionNumber: nonNegativeInteger(
      input.partitionNumber,
      "partitionNumber",
    ),
    sourceRowNumber: positiveInteger(input.sourceRowNumber, "sourceRowNumber"),
    naturalKey,
    fingerprintSha256,
    sourceEventId,
    sourceCoreId,
    eventAt: timestamp(input.eventAt, "eventAt"),
    mode: mode(input.mode),
    distance: positiveInteger(input.distance, "distance"),
    gateCount: positiveInteger(input.gateCount, "gateCount"),
    goldStarEligible: boolean(input.goldStarEligible, "goldStarEligible"),
    goldStar: nullableBoolean(input.goldStar, "goldStar"),
    blueStar: nullableBoolean(input.blueStar, "blueStar"),
    starDataStatus: starDataStatus(input.starDataStatus),
    finishPosition: positiveInteger(input.finishPosition, "finishPosition"),
    elapsedMilliseconds: positiveInteger(
      input.elapsedMilliseconds,
      "elapsedMilliseconds",
    ),
    payoutMechanismSourceValue: nullableText(
      input.payoutMechanismSourceValue,
      "payoutMechanismSourceValue",
    ),
    sourceFormat: nullableText(input.sourceFormat, "sourceFormat"),
    sourceRaceClass: nullableText(input.sourceRaceClass, "sourceRaceClass"),
  });
}

export function encodeRaceArchiveAnalyticalObservation(
  value: RaceArchiveCoreAnalyticalObservation,
): Uint8Array {
  const normalized = normalizeRaceArchiveAnalyticalObservation(value);
  return new TextEncoder().encode(`${JSON.stringify(normalized)}\n`);
}

export function decodeRaceArchiveAnalyticalObservationLine(
  value: string,
): RaceArchiveCoreAnalyticalObservation {
  if (value.length < 1 || value.length > 1024 * 1024) {
    throw new Error("Race archive scratch observation line is invalid.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Race archive scratch observation JSON is invalid.");
  }
  return normalizeRaceArchiveAnalyticalObservation(parsed);
}
