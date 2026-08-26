import type { DurablePreviewStagedRow } from "./durable-import-preview-staging-sink";
import type {
  RaceArchiveAcceptanceGroup,
  SpillableRaceArchiveAcceptanceStream,
} from "./race-archive-acceptance-stream";
import type { RaceArchiveExternalSortedRunStore } from "./race-archive-external-sort";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;

export type RacePreactivationMaterializationRecord = Readonly<{
  naturalKey: string;
  fingerprintSha256: string;
  canonicalRow: DurablePreviewStagedRow;
}>;

export type PreparedRacePreactivationMaterialization = Readonly<{
  sourceRowCount: number;
  readyRowCount: number;
  quarantinedRowCount: number;
  acceptedNaturalKeyCount: number;
  duplicateReadyRowCount: number;
  readBatches: () => AsyncIterable<
    readonly RacePreactivationMaterializationRecord[]
  >;
  cleanup: () => Promise<void>;
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

function positiveBound(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} is outside its bound`);
  }
  return value;
}

function validateMaterializationRecord(
  value: RacePreactivationMaterializationRecord,
): RacePreactivationMaterializationRecord {
  const naturalKey = safeText(value.naturalKey, "naturalKey");
  const fingerprintSha256 = safeText(
    value.fingerprintSha256,
    "fingerprintSha256",
    64,
  );
  if (!SHA_256_PATTERN.test(fingerprintSha256)) {
    throw new Error("fingerprintSha256 must be a lowercase SHA-256 digest");
  }
  if (
    value.canonicalRow.row.status !== "ready" ||
    value.canonicalRow.naturalKey !== naturalKey ||
    value.canonicalRow.fingerprintSha256 !== fingerprintSha256
  ) {
    throw new Error("Race preactivation materialization record is inconsistent.");
  }
  return value;
}

function acceptedRecord(
  group: Extract<RaceArchiveAcceptanceGroup, { status: "accepted" }>,
): RacePreactivationMaterializationRecord {
  return validateMaterializationRecord(
    Object.freeze({
      naturalKey: group.naturalKey,
      fingerprintSha256: group.fingerprintSha256,
      canonicalRow: group.canonicalRow,
    }),
  );
}

export async function prepareRacePreactivationMaterializationSpool(input: {
  acceptance: SpillableRaceArchiveAcceptanceStream;
  store: RaceArchiveExternalSortedRunStore<RacePreactivationMaterializationRecord>;
  runId: string;
  maximumMaterializationBatchRecords: number;
}): Promise<PreparedRacePreactivationMaterialization> {
  const runId = safeText(input.runId, "runId", 512);
  const maximumMaterializationBatchRecords = positiveBound(
    input.maximumMaterializationBatchRecords,
    "maximumMaterializationBatchRecords",
    5_000,
  );

  let acceptedNaturalKeyCount = 0;
  let duplicateReadyRowCount = 0;
  let coveredReadyRowCount = 0;
  let fingerprintConflictCount = 0;
  let cleaned = false;
  let consumed = false;

  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    await input.store.deleteRun({ runId });
    cleaned = true;
  };

  const records = (async function* () {
    for await (const group of input.acceptance.readGroups()) {
      coveredReadyRowCount += group.sourceRowCount;
      if (!Number.isSafeInteger(coveredReadyRowCount)) {
        throw new Error("Race preactivation ready-row coverage is unsafe.");
      }
      if (group.status === "fingerprint_conflict") {
        fingerprintConflictCount += 1;
        continue;
      }
      acceptedNaturalKeyCount += 1;
      duplicateReadyRowCount += group.duplicateRowCount;
      if (
        !Number.isSafeInteger(acceptedNaturalKeyCount) ||
        !Number.isSafeInteger(duplicateReadyRowCount)
      ) {
        throw new Error("Race preactivation materialization totals are unsafe.");
      }
      yield acceptedRecord(group);
    }
  })();

  try {
    await input.store.writeRun({ runId, records });
    if (
      coveredReadyRowCount !== input.acceptance.readyRowCount ||
      input.acceptance.readyRowCount + input.acceptance.quarantinedRowCount !==
        input.acceptance.sourceRowCount
    ) {
      throw new Error("Race preactivation acceptance coverage changed.");
    }
    if (fingerprintConflictCount > 0) {
      throw new Error(
        `Race preactivation contains ${fingerprintConflictCount} fingerprint conflict group(s).`,
      );
    }
    if (acceptedNaturalKeyCount < 1) {
      throw new Error("Race preactivation has no accepted natural keys.");
    }
  } catch (error) {
    await input.store.deleteRun({ runId }).catch(() => undefined);
    cleaned = true;
    await input.acceptance.cleanup().catch(() => undefined);
    throw error;
  }

  return Object.freeze({
    sourceRowCount: input.acceptance.sourceRowCount,
    readyRowCount: input.acceptance.readyRowCount,
    quarantinedRowCount: input.acceptance.quarantinedRowCount,
    acceptedNaturalKeyCount,
    duplicateReadyRowCount,
    readBatches() {
      if (cleaned) {
        throw new Error("Race preactivation materialization spool is cleaned.");
      }
      if (consumed) {
        throw new Error(
          "Race preactivation materialization spool can only be consumed once.",
        );
      }
      consumed = true;
      return (async function* () {
        let batch: RacePreactivationMaterializationRecord[] = [];
        let observed = 0;
        try {
          for await (const raw of input.store.readRun({ runId })) {
            const record = validateMaterializationRecord(raw);
            observed += 1;
            batch.push(record);
            if (batch.length >= maximumMaterializationBatchRecords) {
              yield Object.freeze(batch);
              batch = [];
            }
          }
          if (batch.length > 0) yield Object.freeze(batch);
          if (observed !== acceptedNaturalKeyCount) {
            throw new Error(
              "Race preactivation materialization spool coverage changed.",
            );
          }
        } finally {
          await cleanup();
        }
      })();
    },
    cleanup,
  });
}
