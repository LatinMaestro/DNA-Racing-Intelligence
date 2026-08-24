import type { RaceMode } from "@/domain/import-contract";
import type { StarDataStatus } from "@/domain/source-adapters";
import type {
  RaceArchiveCoreHistory,
  RaceArchiveCoreHistoryRow,
} from "./race-archive-core-history-service";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const POSITIVE_DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;

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

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value;
}

function timestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} must be a valid timestamp`);
  }
  return parsed.toISOString();
}

function elapsedMilliseconds(value: string): number {
  const normalized = value.trim();
  if (!POSITIVE_DECIMAL_PATTERN.test(normalized)) {
    throw new Error("Archived Race elapsed time must be a positive decimal.");
  }
  const [integerPart, fractionalPart = ""] = normalized.split(".");
  if (fractionalPart.length > 3) {
    const trailing = fractionalPart.slice(3);
    if (!/^0*$/.test(trailing)) {
      throw new Error(
        "Archived Race elapsed time cannot be represented as integer milliseconds.",
      );
    }
  }
  const millisecondFraction = (fractionalPart.slice(0, 3) + "000").slice(0, 3);
  const milliseconds =
    Number(integerPart) * 1000 + Number(millisecondFraction || "0");
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    throw new Error(
      "Archived Race elapsed time cannot be represented as integer milliseconds.",
    );
  }
  return milliseconds;
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
    partitionNumber: Number.isSafeInteger(historyRow.partitionNumber) && historyRow.partitionNumber >= 0
      ? historyRow.partitionNumber
      : (() => {
          throw new Error("partitionNumber must be a non-negative safe integer");
        })(),
    sourceRowNumber: positiveSafeInteger(
      historyRow.sourceRowNumber,
      "sourceRowNumber",
    ),
    naturalKey: safeText(historyRow.naturalKey, "naturalKey"),
    fingerprintSha256: safeText(
      historyRow.fingerprintSha256,
      "fingerprintSha256",
      64,
    ),
    sourceEventId,
    sourceCoreId: rowCoreId,
    eventAt: timestamp(race.eventAt, "Archived Race eventAt"),
    mode: race.mode,
    distance: positiveSafeInteger(race.distance, "Archived Race distance"),
    gateCount: positiveSafeInteger(race.gateCount, "Archived Race gateCount"),
    goldStarEligible: race.goldStarEligible,
    goldStar: race.goldStar,
    blueStar: race.blueStar,
    starDataStatus: race.starDataStatus,
    finishPosition: positiveSafeInteger(
      race.finishPosition,
      "Archived Race finishPosition",
    ),
    elapsedMilliseconds: elapsedMilliseconds(race.elapsedTimeSourceValue),
    payoutMechanismSourceValue: race.payoutMechanismSourceValue,
    sourceFormat: race.sourceFormat,
    sourceRaceClass: race.sourceRaceClass,
  });
}

export function analyticalObservationsFromRaceArchiveCoreHistory(
  history: RaceArchiveCoreHistory,
): RaceArchiveCoreAnalyticalObservationSet {
  const sourceCoreId = safeText(history.sourceCoreId, "sourceCoreId");
  if (!Number.isSafeInteger(history.locatorVersionCount) || history.locatorVersionCount < 0) {
    throw new Error("locatorVersionCount must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(history.selectedPartitionCount) || history.selectedPartitionCount < 0) {
    throw new Error("selectedPartitionCount must be a non-negative safe integer");
  }
  const observations = history.rows.map((row) => observation(row, sourceCoreId));
  return Object.freeze({
    sourceCoreId,
    locatorVersionCount: history.locatorVersionCount,
    selectedPartitionCount: history.selectedPartitionCount,
    observations: Object.freeze(observations),
  });
}
