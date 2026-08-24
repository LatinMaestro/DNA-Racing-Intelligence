import type { AdaptedRaceMergeRow } from "@/domain/source-adapters";
import type { RehydratedRaceStagedRow } from "./race-staged-row-rehydrator";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type RaceArchiveCoreLocator = Readonly<{
  datasetVersionId: string;
  importBatchId: string;
  sourceCoreId: string;
  partitionNumbers: readonly number[];
  readyRowCount: number;
  firstSourceRowNumber: number;
  lastSourceRowNumber: number;
}>;

export type RaceArchiveCoreLocatorAccumulator = Readonly<{
  append: (rows: readonly RehydratedRaceStagedRow[]) => void;
  finish: () => readonly RaceArchiveCoreLocator[];
}>;

type MutableLocator = {
  partitionNumbers: Set<number>;
  readyRowCount: number;
  firstSourceRowNumber: number;
  lastSourceRowNumber: number;
};

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

function identifier(value: string, field: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 512 ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function raceRecord(row: RehydratedRaceStagedRow): AdaptedRaceMergeRow | null {
  const staged = row.stagedRow.row;
  if (staged.status === "quarantined") return null;
  const record = staged.record;
  if (record === null || record.sourceType !== "race_merge") {
    throw new Error("Rehydrated ready Race row is missing its Race record.");
  }
  return record;
}

export function createRaceArchiveCoreLocatorAccumulator(input: {
  datasetVersionId: string;
  importBatchId: string;
  maximumCoreLocators: number;
  maximumPartitionsPerCore: number;
}): RaceArchiveCoreLocatorAccumulator {
  const datasetVersionId = identifier(
    input.datasetVersionId,
    "datasetVersionId",
  );
  const importBatchId = identifier(input.importBatchId, "importBatchId");
  const maximumCoreLocators = positiveSafeInteger(
    input.maximumCoreLocators,
    "maximumCoreLocators",
  );
  const maximumPartitionsPerCore = positiveSafeInteger(
    input.maximumPartitionsPerCore,
    "maximumPartitionsPerCore",
  );
  const locators = new Map<string, MutableLocator>();
  let finished = false;

  return Object.freeze({
    append(rows) {
      if (finished)
        throw new Error("Race archive Core locator accumulator is finished.");
      for (const row of rows) {
        if (
          row.datasetVersionId !== datasetVersionId ||
          row.importBatchId !== importBatchId
        ) {
          throw new Error(
            "Race archive locator row identity conflicts with the rebuild session.",
          );
        }
        const partitionNumber = nonNegativeSafeInteger(
          row.partitionNumber,
          "partitionNumber",
        );
        const record = raceRecord(row);
        if (record === null) continue;
        const sourceCoreId = identifier(record.sourceCoreId, "sourceCoreId");
        const sourceRowNumber = positiveSafeInteger(
          row.stagedRow.sourceRowNumber,
          "sourceRowNumber",
        );
        let locator = locators.get(sourceCoreId);
        if (locator === undefined) {
          if (locators.size >= maximumCoreLocators) {
            throw new Error("Race archive Core locator count exceeds its bound.");
          }
          locator = {
            partitionNumbers: new Set<number>(),
            readyRowCount: 0,
            firstSourceRowNumber: sourceRowNumber,
            lastSourceRowNumber: sourceRowNumber,
          };
          locators.set(sourceCoreId, locator);
        }
        locator.partitionNumbers.add(partitionNumber);
        if (locator.partitionNumbers.size > maximumPartitionsPerCore) {
          throw new Error(
            "Race archive Core partition count exceeds its bound.",
          );
        }
        locator.readyRowCount += 1;
        if (!Number.isSafeInteger(locator.readyRowCount)) {
          throw new Error(
            "Race archive Core row count exceeds safe integer bounds.",
          );
        }
        locator.firstSourceRowNumber = Math.min(
          locator.firstSourceRowNumber,
          sourceRowNumber,
        );
        locator.lastSourceRowNumber = Math.max(
          locator.lastSourceRowNumber,
          sourceRowNumber,
        );
      }
    },
    finish() {
      if (finished) {
        throw new Error("Race archive Core locator accumulator is finished.");
      }
      finished = true;
      return Object.freeze(
        [...locators.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([sourceCoreId, locator]) =>
            Object.freeze({
              datasetVersionId,
              importBatchId,
              sourceCoreId,
              partitionNumbers: Object.freeze(
                [...locator.partitionNumbers].sort(
                  (left, right) => left - right,
                ),
              ),
              readyRowCount: locator.readyRowCount,
              firstSourceRowNumber: locator.firstSourceRowNumber,
              lastSourceRowNumber: locator.lastSourceRowNumber,
            }),
          ),
      );
    },
  });
}
