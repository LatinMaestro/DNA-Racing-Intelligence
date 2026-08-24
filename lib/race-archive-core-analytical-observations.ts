import type { RaceMode } from "@/domain/import-contract";
import type { StarDataStatus } from "@/domain/source-adapters";
import type {
  RaceArchiveCoreHistory,
  RaceArchiveCoreHistoryRow,
} from "./race-archive-core-history-service";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const POSITIVE_DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const RACE_MODES = new Set<RaceMode>(["bike", "car", "horse"]);
const STAR_DATA_STATUSES = new Set<StarDataStatus>([
  "complete",
  "partial",
  "missing",
  "invalid",
]);

export type RaceArchiveCoreAnalyticalObservation = Readonly<{
  datasetVersionId: string;
  importBatchId: string;
  versionNumber: number;
  partitionNumber: number;
  sourceRowNumber: number;
  naturalKey: string;
  fingerprintSha256: string;
  sourceEventId: string;
  sourceCoreId: string;
  eventAt: string;
  mode: RaceMode;
  distance: number;
  gateCount: number;
  goldStarEligible: boolean;
  goldStar: boolean | null;
  blueStar: boolean | null;
  starDataStatus: StarDataStatus;
  finishPosition: number;
  elapsedMilliseconds: number;
  payoutMechanismSourceValue: string | null;
  sourceFormat: string | null;
  sourceRaceClass: string | null;
}>;

export type RaceArchiveCoreAnalyticalObservationSet = Readonly<{
  sourceCoreId: string;
  locatorVersionCount: number;
  selectedPartitionCount: number;
  observations: readonly RaceArchiveCoreAnalyticalObservation[];
}>;

function safeText(value: string, field: string, maximumLength = 512): string {
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

function nullableText(
  value: string | null,
  field: string,
  maximumLength = 512,
): string | null {
  if (value === null) return null;
  return safeText(value, field, maximumLength);
}

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value;
}

function nonNegativeSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function nonNegativeCount(value: number, field: string): number {
  return nonNegativeSafeInteger(value, field);
}

function timestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} must be a valid timestamp`);
  }
  return parsed.toISOString();
}

function mode(value: RaceMode): RaceMode {
  if (!RACE_MODES.has(value)) {
    throw new Error("Archived Race mode is invalid.");
  }
  return value;
}

function starDataStatus(value: StarDataStatus): StarDataStatus {
  if (!STAR_DATA_STATUSES.has(value)) {
    throw new Error("Archived Race star data status is invalid.");
  }
  return value;
}

function nullableBoolean(value: boolean | null, field: string): boolean | null {
  if (value !== null && typeof value !== "boolean") {
    throw new Error(`${field} must be Boolean or null`);
  }
  return value;
}

function boolean(value: boolean, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be Boolean`);
  }
  return value;
}

function fingerprint(value: string): string {
  const normalized = safeText(value, "fingerprintSha256", 64);
  if (!SHA_256_PATTERN.test(normalized)) {
    throw new Error("fingerprintSha256 must be a lowercase SHA-256 digest");
  }
  return normalized;
}

function elapsedMilliseconds(value: string): number {
  const normalized = value.trim();
  if (!POSITIVE_DECIMAL_PATTERN.test(normalized)) {
    throw new Error("Archived Race elapsed time must be a positive decimal.");
  }
  const [integerPart = "", fractionalPart = ""] = normalized.split(".");
  if (fractionalPart.length > 3 && !/^0*$/.test(fractionalPart.slice(3))) {
    throw new Error(
      "Archived Race elapsed time cannot be represented as integer milliseconds.",
    );
  }
  const millisecondFraction = (fractionalPart.slice(0, 3) + "000").slice(0, 3);
  const milliseconds =
    BigInt(integerPart) * 1000n + BigInt(millisecondFraction || "0");
  if (milliseconds <= 0n || milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(
      "Archived Race elapsed time cannot be represented as integer milliseconds.",
    );
  }
  return Number(milliseconds);
}

function observation(
  historyRow: RaceArchiveCoreHistoryRow,
  sourceCoreId: string,
): RaceArchiveCoreAnalyticalObservation {
  if (historyRow.row.status !== "ready" || historyRow.row.record === null) {
    throw new Error("Archived Core analytical evidence must be a ready Race row.");
  }
  const race = historyRow.row.record;
  if (race.sourceType !== "race_merge") {
    throw new Error("Archived Core analytical evidence is not Race Merge data.");
  }
  const rowCoreId = safeText(race.sourceCoreId, "Archived Race sourceCoreId");
  if (rowCoreId !== sourceCoreId) {
    throw new Error("Archived analytical row changed Core identity.");
  }
  const sourceEventId = safeText(
    race.sourceEventId,
    "Archived Race sourceEventId",
  );
  if (historyRow.naturalKey !== `${sourceEventId}:${rowCoreId}`) {
    throw new Error("Archived analytical row natural key is inconsistent.");
  }
  return Object.freeze({
    datasetVersionId: safeText(historyRow.datasetVersionId, "datasetVersionId"),
    importBatchId: safeText(historyRow.importBatchId, "importBatchId"),
    versionNumber: positiveSafeInteger(historyRow.versionNumber, "versionNumber"),
    partitionNumber: nonNegativeSafeInteger(
      historyRow.partitionNumber,
      "partitionNumber",
    ),
    sourceRowNumber: positiveSafeInteger(
      historyRow.sourceRowNumber,
      "sourceRowNumber",
    ),
    naturalKey: safeText(historyRow.naturalKey, "naturalKey"),
    fingerprintSha256: fingerprint(historyRow.fingerprintSha256),
    sourceEventId,
    sourceCoreId: rowCoreId,
    eventAt: timestamp(race.eventAt, "Archived Race eventAt"),
    mode: mode(race.mode),
    distance: positiveSafeInteger(race.distance, "Archived Race distance"),
    gateCount: positiveSafeInteger(race.gateCount, "Archived Race gateCount"),
    goldStarEligible: boolean(
      race.goldStarEligible,
      "Archived Race goldStarEligible",
    ),
    goldStar: nullableBoolean(race.goldStar, "Archived Race goldStar"),
    blueStar: nullableBoolean(race.blueStar, "Archived Race blueStar"),
    starDataStatus: starDataStatus(race.starDataStatus),
    finishPosition: positiveSafeInteger(
      race.finishPosition,
      "Archived Race finishPosition",
    ),
    elapsedMilliseconds: elapsedMilliseconds(race.elapsedTimeSourceValue),
    payoutMechanismSourceValue: nullableText(
      race.payoutMechanismSourceValue,
      "Archived Race payout mechanism",
    ),
    sourceFormat: nullableText(race.sourceFormat, "Archived Race source format"),
    sourceRaceClass: nullableText(
      race.sourceRaceClass,
      "Archived Race source class",
    ),
  });
}

export function analyticalObservationsFromRaceArchiveCoreHistory(
  history: RaceArchiveCoreHistory,
): RaceArchiveCoreAnalyticalObservationSet {
  const sourceCoreId = safeText(history.sourceCoreId, "sourceCoreId");
  const locatorVersionCount = nonNegativeCount(
    history.locatorVersionCount,
    "locatorVersionCount",
  );
  const selectedPartitionCount = nonNegativeCount(
    history.selectedPartitionCount,
    "selectedPartitionCount",
  );
  const observations = history.rows.map((row) => observation(row, sourceCoreId));
  return Object.freeze({
    sourceCoreId,
    locatorVersionCount,
    selectedPartitionCount,
    observations: Object.freeze(observations),
  });
}
