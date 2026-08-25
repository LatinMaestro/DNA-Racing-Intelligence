import {
  analyticalObservationFromRaceArchiveCoreHistoryRow,
  type RaceArchiveCoreAnalyticalObservation,
} from "./race-archive-core-analytical-observations";
import type { RaceArchiveAggregateRefreshPlanVersion } from "./race-archive-aggregate-refresher";
import type { RaceArchiveCoreHistoryRow } from "./race-archive-core-history-service";
import type { RaceStagedRowRehydrator } from "./race-staged-row-rehydrator";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;

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

function sha256(value: string, field: string): string {
  const normalized = safeText(value, field, 64);
  if (!SHA_256_PATTERN.test(normalized)) {
    throw new Error(`${field} must be a lowercase SHA-256 digest`);
  }
  return normalized;
}

function positiveBound(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} is outside its bound`);
  }
  return value;
}

function planVersion(
  value: RaceArchiveAggregateRefreshPlanVersion,
  index: number,
): RaceArchiveAggregateRefreshPlanVersion {
  const datasetVersionId = safeText(
    value.datasetVersionId,
    `versions[${index}].datasetVersionId`,
  );
  const importBatchId = safeText(
    value.importBatchId,
    `versions[${index}].importBatchId`,
  );
  const versionNumber = positiveBound(
    value.versionNumber,
    `versions[${index}].versionNumber`,
    1_000_000,
  );
  const sourceRowCount = positiveBound(
    value.sourceRowCount,
    `versions[${index}].sourceRowCount`,
    5_000_000,
  );
  const acceptedRowCount = positiveBound(
    value.acceptedRowCount,
    `versions[${index}].acceptedRowCount`,
    sourceRowCount,
  );
  const evidencePartitionCount = positiveBound(
    value.evidencePartitionCount,
    `versions[${index}].evidencePartitionCount`,
    10_000,
  );
  const evidenceRowCount = positiveBound(
    value.evidenceRowCount,
    `versions[${index}].evidenceRowCount`,
    5_000_000,
  );
  if (evidenceRowCount !== sourceRowCount) {
    throw new Error(
      "Race archive aggregate plan row coverage is inconsistent.",
    );
  }
  return Object.freeze({
    datasetVersionId,
    importBatchId,
    versionNumber,
    sourceRowCount,
    acceptedRowCount,
    evidencePartitionCount,
    evidenceRowCount,
  });
}

function historyRow(input: {
  version: RaceArchiveAggregateRefreshPlanVersion;
  partitionNumber: number;
  sourceRowNumber: number;
  naturalKey: string;
  fingerprintSha256: string;
  row: RaceArchiveCoreHistoryRow["row"];
}): RaceArchiveCoreHistoryRow {
  return Object.freeze({
    datasetVersionId: input.version.datasetVersionId,
    importBatchId: input.version.importBatchId,
    versionNumber: input.version.versionNumber,
    partitionNumber: input.partitionNumber,
    sourceRowNumber: input.sourceRowNumber,
    naturalKey: safeText(input.naturalKey, "naturalKey"),
    fingerprintSha256: sha256(input.fingerprintSha256, "fingerprintSha256"),
    row: input.row,
  });
}

export function raceArchiveObservationsFromRefreshPlan(input: {
  ownerId: string;
  versions: readonly RaceArchiveAggregateRefreshPlanVersion[];
  rehydrator: RaceStagedRowRehydrator;
  maximumArchivePartitions: number;
}): AsyncIterable<RaceArchiveCoreAnalyticalObservation> {
  const ownerId = safeText(input.ownerId, "ownerId", 128);
  const maximumArchivePartitions = positiveBound(
    input.maximumArchivePartitions,
    "maximumArchivePartitions",
    10_000,
  );
  const versions = Object.freeze(input.versions.map(planVersion));
  if (versions.length < 1 || versions.length > 10_000) {
    throw new Error(
      "Race archive aggregate plan version count is outside its bound.",
    );
  }

  return (async function* () {
    for (const version of versions) {
      const opened = await input.rehydrator.open({
        ownerId,
        datasetVersionId: version.datasetVersionId,
        maximumPartitions: maximumArchivePartitions,
      });
      if (opened.status === "missing") {
        throw new Error(
          "Race archive aggregate plan points to missing evidence.",
        );
      }
      if (
        opened.manifest.datasetVersionId !== version.datasetVersionId ||
        opened.manifest.importBatchId !== version.importBatchId ||
        opened.manifest.sourceType !== "race_merge" ||
        opened.manifest.evidenceKind !== "staged_rows" ||
        opened.manifest.rowCount !== version.evidenceRowCount ||
        opened.manifest.objects.length !== version.evidencePartitionCount
      ) {
        throw new Error(
          "Race archive aggregate evidence identity or coverage changed.",
        );
      }

      let sourceRowCount = 0;
      let readyRowCount = 0;
      for await (const rehydrated of opened.rows) {
        sourceRowCount += 1;
        if (
          rehydrated.datasetVersionId !== version.datasetVersionId ||
          rehydrated.importBatchId !== version.importBatchId
        ) {
          throw new Error(
            "Race archive aggregate row version identity changed.",
          );
        }
        const staged = rehydrated.stagedRow;
        if (staged.row.status === "quarantined") continue;
        readyRowCount += 1;
        if (
          staged.row.sourceType !== "race_merge" ||
          staged.row.record?.sourceType !== "race_merge" ||
          staged.naturalKey === null ||
          staged.fingerprintSha256 === null
        ) {
          throw new Error(
            "Race archive aggregate ready-row evidence is incomplete.",
          );
        }
        const sourceCoreId = safeText(
          staged.row.record.sourceCoreId,
          "sourceCoreId",
          256,
        );
        yield analyticalObservationFromRaceArchiveCoreHistoryRow(
          historyRow({
            version,
            partitionNumber: rehydrated.partitionNumber,
            sourceRowNumber: staged.sourceRowNumber,
            naturalKey: staged.naturalKey,
            fingerprintSha256: staged.fingerprintSha256,
            row: staged.row,
          }),
          sourceCoreId,
        );
      }
      if (
        sourceRowCount !== version.sourceRowCount ||
        readyRowCount !== version.acceptedRowCount
      ) {
        throw new Error("Race archive aggregate row accounting changed.");
      }
    }
  })();
}
