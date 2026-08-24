import { createHash } from "node:crypto";

import type { AdaptedSourceRow } from "@/domain/source-adapters";
import type { DurablePreviewStagedRow } from "./durable-import-preview-staging-sink";
import type {
  SealedRaceArchiveManifest,
} from "./neon-sealed-race-archive-manifest-repository";
import type {
  DecodedSealedRaceArchivePartition,
  SealedRaceArchiveReader,
} from "./sealed-race-archive-reader";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type RehydratedRaceStagedRow = Readonly<{
  datasetVersionId: string;
  importBatchId: string;
  partitionNumber: number;
  stagedRow: DurablePreviewStagedRow;
}>;

export type RaceStagedRowRehydrator = Readonly<{
  open: (input: {
    ownerId: string;
    datasetVersionId: string;
    maximumPartitions: number;
  }) => Promise<
    | Readonly<{ status: "missing" }>
    | Readonly<{
        status: "ready";
        manifest: SealedRaceArchiveManifest;
        rows: AsyncIterable<RehydratedRaceStagedRow>;
      }>
  >;
}>;

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(field + " must be an object");
  }
  return value as Record<string, unknown>;
}

function positiveSafeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(field + " must be a positive safe integer");
  }
  return value;
}

function safeText(value: unknown, field: string, maximumLength = 512): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new Error(field + " is invalid");
  }
  return value;
}

function nullableNaturalKey(value: unknown): string | null {
  if (value === null) return null;
  return safeText(value, "Archived Race staged-row naturalKey");
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

function expectedFingerprint(recordValue: unknown): string {
  return createHash("sha256").update(canonicalJson(recordValue)).digest("hex");
}

function validateRaceSourceRow(value: unknown): AdaptedSourceRow {
  const row = record(value, "Archived Race staged-row row");
  if (row.sourceType !== "race_merge") {
    throw new Error("Archived Race staged-row source type is invalid.");
  }
  if (!Array.isArray(row.provenance) || !Array.isArray(row.issues)) {
    throw new Error("Archived Race staged-row evidence arrays are invalid.");
  }
  if (row.status !== "ready" && row.status !== "quarantined") {
    throw new Error("Archived Race staged-row status is invalid.");
  }
  if (row.status === "quarantined") {
    if (row.record !== null) {
      throw new Error("Quarantined Race staged-row unexpectedly contains a record.");
    }
    return row as unknown as AdaptedSourceRow;
  }

  const race = record(row.record, "Archived ready Race staged-row record");
  if (race.sourceType !== "race_merge") {
    throw new Error("Archived ready Race record source type is invalid.");
  }
  safeText(race.sourceEventId, "Archived Race sourceEventId");
  safeText(race.sourceCoreId, "Archived Race sourceCoreId");
  return row as unknown as AdaptedSourceRow;
}

function decodeStagedRow(input: {
  partition: DecodedSealedRaceArchivePartition;
  index: number;
  expectedSourceRowNumber: number;
}): DurablePreviewStagedRow {
  const evidenceRow = input.partition.rows[input.index];
  if (evidenceRow === undefined) {
    throw new Error("Archived Race partition row is unavailable.");
  }
  const value = record(evidenceRow.value, "Archived Race staged-row value");
  const sourceRowNumber = positiveSafeInteger(
    value.sourceRowNumber,
    "Archived Race sourceRowNumber",
  );
  if (sourceRowNumber !== input.expectedSourceRowNumber) {
    throw new Error("Archived Race source-row sequence is not contiguous.");
  }

  const naturalKey = nullableNaturalKey(value.naturalKey);
  if (naturalKey !== evidenceRow.naturalKey) {
    throw new Error("Archived Race staged-row natural key conflicts with its envelope.");
  }
  const fingerprintSha256 = value.fingerprintSha256;
  if (
    fingerprintSha256 !== null &&
    (typeof fingerprintSha256 !== "string" ||
      !SHA_256_PATTERN.test(fingerprintSha256))
  ) {
    throw new Error("Archived Race staged-row fingerprint is invalid.");
  }

  const row = validateRaceSourceRow(value.row);
  if (row.status === "quarantined") {
    if (naturalKey !== null || fingerprintSha256 !== null) {
      throw new Error("Quarantined Race staged-row unexpectedly contains identity evidence.");
    }
  } else {
    const race = record(row.record, "Archived ready Race staged-row record");
    const expectedNaturalKey = `${safeText(
      race.sourceEventId,
      "Archived Race sourceEventId",
    )}:${safeText(race.sourceCoreId, "Archived Race sourceCoreId")}`;
    if (naturalKey !== expectedNaturalKey) {
      throw new Error("Archived ready Race staged-row natural key is invalid.");
    }
    if (
      typeof fingerprintSha256 !== "string" ||
      fingerprintSha256 !== expectedFingerprint(row.record)
    ) {
      throw new Error("Archived ready Race staged-row fingerprint does not match its record.");
    }
  }

  return Object.freeze({
    sourceRowNumber,
    naturalKey,
    fingerprintSha256,
    row,
  });
}

export function createRaceStagedRowRehydrator(input: {
  archiveReader: SealedRaceArchiveReader;
}): RaceStagedRowRehydrator {
  return Object.freeze({
    async open(request) {
      const opened = await input.archiveReader.open(request);
      if (opened.status === "missing") return opened;
      if (opened.manifest.evidenceKind !== "staged_rows") {
        throw new Error(
          "Sealed Race archive does not contain staged-row evidence for rehydration.",
        );
      }

      const manifest = opened.manifest;
      const rows = (async function* () {
        let expectedSourceRowNumber = 1;
        let observedRowCount = 0;
        for await (const partition of opened.partitions) {
          for (let index = 0; index < partition.rows.length; index += 1) {
            const stagedRow = decodeStagedRow({
              partition,
              index,
              expectedSourceRowNumber,
            });
            yield Object.freeze({
              datasetVersionId: manifest.datasetVersionId,
              importBatchId: manifest.importBatchId,
              partitionNumber: partition.registration.partitionNumber,
              stagedRow,
            });
            expectedSourceRowNumber += 1;
            observedRowCount += 1;
          }
        }
        if (observedRowCount !== manifest.rowCount) {
          throw new Error(
            "Rehydrated Race staged-row coverage conflicts with the sealed manifest.",
          );
        }
      })();

      return Object.freeze({
        status: "ready" as const,
        manifest,
        rows,
      });
    },
  });
}
