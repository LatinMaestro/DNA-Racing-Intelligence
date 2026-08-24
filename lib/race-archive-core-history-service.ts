import { createHash } from "node:crypto";

import type { AdaptedSourceRow } from "@/domain/source-adapters";
import type {
  NeonRaceArchiveCoreLocatorRepository,
  PersistedRaceArchiveCoreLocator,
} from "./neon-race-archive-core-locator-repository";
import type {
  DecodedSealedRaceArchivePartition,
  SealedRaceArchiveReader,
} from "./sealed-race-archive-reader";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;

export type RaceArchiveCoreHistoryRow = Readonly<{
  datasetVersionId: string;
  importBatchId: string;
  versionNumber: number;
  partitionNumber: number;
  sourceRowNumber: number;
  naturalKey: string;
  fingerprintSha256: string;
  row: AdaptedSourceRow;
}>;

export type RaceArchiveCoreHistory = Readonly<{
  sourceCoreId: string;
  locatorVersionCount: number;
  selectedPartitionCount: number;
  rows: readonly RaceArchiveCoreHistoryRow[];
}>;

export type RaceArchiveCoreHistoryService = Readonly<{
  load: (input: {
    ownerId: string;
    sourceCoreId: string;
  }) => Promise<RaceArchiveCoreHistory>;
}>;

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function safeText(value: unknown, field: string, maximumLength = 512): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new Error(`${field} is invalid`);
  }
  return value;
}

function positiveSafeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value;
}

function positiveBound(value: number, field: string): number {
  return positiveSafeInteger(value, field);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

function expectedFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function locatorIdentity(
  locator: PersistedRaceArchiveCoreLocator,
  sourceCoreId: string,
): void {
  if (locator.sourceCoreId !== sourceCoreId) {
    throw new Error("Race archive Core locator returned a different Core identity.");
  }
  positiveSafeInteger(locator.versionNumber, "locator.versionNumber");
  positiveSafeInteger(locator.readyRowCount, "locator.readyRowCount");
  positiveSafeInteger(
    locator.firstSourceRowNumber,
    "locator.firstSourceRowNumber",
  );
  positiveSafeInteger(locator.lastSourceRowNumber, "locator.lastSourceRowNumber");
  if (locator.lastSourceRowNumber < locator.firstSourceRowNumber) {
    throw new Error("Race archive Core locator source-row range is invalid.");
  }
  if (locator.partitionNumbers.length < 1) {
    throw new Error("Race archive Core locator has no selected partitions.");
  }
}

function readyCoreHistoryRow(input: {
  partition: DecodedSealedRaceArchivePartition;
  evidenceValue: unknown;
  evidenceNaturalKey: string | null;
  locator: PersistedRaceArchiveCoreLocator;
  ownerId: string;
  sourceCoreId: string;
}): RaceArchiveCoreHistoryRow | null {
  if (input.partition.registration.ownerId !== input.ownerId) {
    throw new Error("Selected Race archive partition owner identity changed.");
  }
  if (input.partition.registration.sourceType !== "race_merge") {
    throw new Error("Selected Race archive partition source type changed.");
  }
  if (!input.locator.partitionNumbers.includes(input.partition.registration.partitionNumber)) {
    throw new Error("Race archive reader returned an unselected partition.");
  }

  const value = record(input.evidenceValue, "Archived Race staged-row value");
  const sourceRowNumber = positiveSafeInteger(
    value.sourceRowNumber,
    "Archived Race sourceRowNumber",
  );
  const row = record(value.row, "Archived Race staged-row row");
  if (row.sourceType !== "race_merge") {
    throw new Error("Archived Race staged-row source type is invalid.");
  }
  if (row.status !== "ready" && row.status !== "quarantined") {
    throw new Error("Archived Race staged-row status is invalid.");
  }
  if (row.status === "quarantined") {
    if (value.naturalKey !== null || value.fingerprintSha256 !== null) {
      throw new Error(
        "Quarantined Race staged-row unexpectedly contains identity evidence.",
      );
    }
    return null;
  }

  const race = record(row.record, "Archived ready Race record");
  if (race.sourceType !== "race_merge") {
    throw new Error("Archived ready Race record source type is invalid.");
  }
  const rowCoreId = safeText(race.sourceCoreId, "Archived Race sourceCoreId");
  if (rowCoreId !== input.sourceCoreId) return null;

  if (
    sourceRowNumber < input.locator.firstSourceRowNumber ||
    sourceRowNumber > input.locator.lastSourceRowNumber
  ) {
    throw new Error("Archived Core history row is outside its locator range.");
  }
  const sourceEventId = safeText(race.sourceEventId, "Archived Race sourceEventId");
  const naturalKey = safeText(value.naturalKey, "Archived Race naturalKey");
  if (
    input.evidenceNaturalKey !== naturalKey ||
    naturalKey !== `${sourceEventId}:${rowCoreId}`
  ) {
    throw new Error("Archived Core history natural key is invalid.");
  }
  const fingerprintSha256 = safeText(
    value.fingerprintSha256,
    "Archived Race fingerprintSha256",
    64,
  );
  if (
    !SHA_256_PATTERN.test(fingerprintSha256) ||
    fingerprintSha256 !== expectedFingerprint(row.record)
  ) {
    throw new Error("Archived Core history fingerprint is invalid.");
  }

  return Object.freeze({
    datasetVersionId: input.locator.datasetVersionId,
    importBatchId: input.locator.importBatchId,
    versionNumber: input.locator.versionNumber,
    partitionNumber: input.partition.registration.partitionNumber,
    sourceRowNumber,
    naturalKey,
    fingerprintSha256,
    row: row as unknown as AdaptedSourceRow,
  });
}

async function readLocator(input: {
  archiveReader: SealedRaceArchiveReader;
  locator: PersistedRaceArchiveCoreLocator;
  ownerId: string;
  sourceCoreId: string;
  maximumArchivePartitions: number;
}): Promise<Readonly<{ rows: readonly RaceArchiveCoreHistoryRow[]; partitions: number }>> {
  locatorIdentity(input.locator, input.sourceCoreId);
  const opened = await input.archiveReader.openSelected({
    ownerId: input.ownerId,
    datasetVersionId: input.locator.datasetVersionId,
    maximumPartitions: input.maximumArchivePartitions,
    partitionNumbers: input.locator.partitionNumbers,
  });
  if (opened.status === "missing") {
    throw new Error("Race archive Core locator points to missing sealed evidence.");
  }
  if (
    opened.manifest.datasetVersionId !== input.locator.datasetVersionId ||
    opened.manifest.importBatchId !== input.locator.importBatchId ||
    opened.manifest.sourceType !== "race_merge" ||
    opened.manifest.evidenceKind !== "staged_rows"
  ) {
    throw new Error("Race archive Core locator conflicts with sealed evidence identity.");
  }

  const rows: RaceArchiveCoreHistoryRow[] = [];
  const observedPartitions = new Set<number>();
  let minimumSourceRowNumber: number | undefined;
  let maximumSourceRowNumber: number | undefined;
  for await (const partition of opened.partitions) {
    observedPartitions.add(partition.registration.partitionNumber);
    for (const evidenceRow of partition.rows) {
      const historyRow = readyCoreHistoryRow({
        partition,
        evidenceValue: evidenceRow.value,
        evidenceNaturalKey: evidenceRow.naturalKey,
        locator: input.locator,
        ownerId: input.ownerId,
        sourceCoreId: input.sourceCoreId,
      });
      if (historyRow === null) continue;
      rows.push(historyRow);
      minimumSourceRowNumber =
        minimumSourceRowNumber === undefined
          ? historyRow.sourceRowNumber
          : Math.min(minimumSourceRowNumber, historyRow.sourceRowNumber);
      maximumSourceRowNumber =
        maximumSourceRowNumber === undefined
          ? historyRow.sourceRowNumber
          : Math.max(maximumSourceRowNumber, historyRow.sourceRowNumber);
    }
  }

  if (
    observedPartitions.size !== input.locator.partitionNumbers.length ||
    input.locator.partitionNumbers.some(
      (partitionNumber) => !observedPartitions.has(partitionNumber),
    )
  ) {
    throw new Error("Selected Race archive partition coverage is incomplete.");
  }
  if (
    rows.length !== input.locator.readyRowCount ||
    minimumSourceRowNumber !== input.locator.firstSourceRowNumber ||
    maximumSourceRowNumber !== input.locator.lastSourceRowNumber
  ) {
    throw new Error("Archived Core history coverage conflicts with its locator.");
  }

  return Object.freeze({
    rows: Object.freeze(rows),
    partitions: observedPartitions.size,
  });
}

export function createRaceArchiveCoreHistoryService(input: {
  locatorRepository: NeonRaceArchiveCoreLocatorRepository;
  archiveReader: SealedRaceArchiveReader;
  maximumVersions: number;
  maximumArchivePartitions: number;
  maximumHistoryRows: number;
}): RaceArchiveCoreHistoryService {
  const maximumVersions = positiveBound(input.maximumVersions, "maximumVersions");
  const maximumArchivePartitions = positiveBound(
    input.maximumArchivePartitions,
    "maximumArchivePartitions",
  );
  const maximumHistoryRows = positiveBound(
    input.maximumHistoryRows,
    "maximumHistoryRows",
  );

  return Object.freeze({
    async load(request) {
      const ownerId = safeText(request.ownerId, "ownerId");
      const sourceCoreId = safeText(request.sourceCoreId, "sourceCoreId");
      const locators = await input.locatorRepository.listForCore({
        ownerId,
        sourceCoreId,
        maximumVersions,
      });
      if (locators.length > maximumVersions) {
        throw new Error("Race archive Core locator version bound was exceeded.");
      }

      const rows: RaceArchiveCoreHistoryRow[] = [];
      const fingerprintsByNaturalKey = new Map<string, string>();
      let selectedPartitionCount = 0;
      let previousVersionNumber: number | undefined;
      for (const locator of locators) {
        locatorIdentity(locator, sourceCoreId);
        if (
          previousVersionNumber !== undefined &&
          locator.versionNumber <= previousVersionNumber
        ) {
          throw new Error("Race archive Core locator versions are not ordered.");
        }
        previousVersionNumber = locator.versionNumber;
        const history = await readLocator({
          archiveReader: input.archiveReader,
          locator,
          ownerId,
          sourceCoreId,
          maximumArchivePartitions,
        });
        selectedPartitionCount += history.partitions;
        if (!Number.isSafeInteger(selectedPartitionCount)) {
          throw new Error("Race archive selected partition total is unsafe.");
        }
        for (const row of history.rows) {
          const existingFingerprint = fingerprintsByNaturalKey.get(row.naturalKey);
          if (existingFingerprint !== undefined) {
            if (existingFingerprint !== row.fingerprintSha256) {
              throw new Error("Archived Core history contains conflicting replay evidence.");
            }
            continue;
          }
          fingerprintsByNaturalKey.set(row.naturalKey, row.fingerprintSha256);
          rows.push(row);
          if (rows.length > maximumHistoryRows) {
            throw new Error("Archived Core history exceeds the configured row bound.");
          }
        }
      }

      return Object.freeze({
        sourceCoreId,
        locatorVersionCount: locators.length,
        selectedPartitionCount,
        rows: Object.freeze(rows),
      });
    },
  });
}
