import { createHash } from "node:crypto";

import { adaptDnaRaceMergeOutcomeSourceRow } from "./dna-population-core-outcome-gap-plan";
import {
  streamVerifiedPrivateRawImportObject,
  type PrivateRawImportObjectStore,
  type TransactionalRawImportSink,
} from "./private-raw-import-object-stream";
import {
  type RaceMergeOutcomeEvidenceRow,
  type RaceMergeOutcomeImportReference,
} from "./race-merge-outcome-ingestion-service";
import { StreamingCsvRecordDecoder } from "./streaming-csv-record-decoder";

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const REQUIRED_HEADERS = Object.freeze([
  "event_id",
  "token_id",
  "pos",
  "time",
] as const);

export const RACE_MERGE_CORE_OUTCOME_SOURCE_MAXIMUM_CORES = 100;

export type RaceMergeCoreOutcomeCohortSourceBounds = Readonly<{
  maximumFiles: number;
  maximumTotalBytes: number;
  maximumObjectBytes: number;
  maximumChunkBytes: number;
  maximumRowsPerObject: number;
  maximumRowsPerGeneration: number;
  maximumHeaderColumns: number;
  maximumFieldCharacters: number;
  maximumRowCharacters: number;
  maximumSelectedObservations: number;
}>;

export type RaceMergeCoreOutcomeSourceCohort = Readonly<{
  generationId: string;
  afterSourceCoreId: number;
  sourceManifestSha256: string;
  sourceObjectCount: number;
  sourceByteLength: number;
  sourceRowCount: number;
  selectedCoreCount: number;
  selectedObservationCount: number;
  selectedUniqueOutcomeCount: number;
  selectedExactReplayCount: number;
  firstSourceCoreId: number;
  lastSourceCoreId: number;
  cores: readonly Readonly<{
    sourceCoreId: number;
    observations: readonly RaceMergeOutcomeEvidenceRow[];
  }>[];
  dnaProviderRequestCount: 0;
  persistentWritePerformed: false;
  paidUsageAllowed: false;
}>;

type SelectedCore = {
  observations: RaceMergeOutcomeEvidenceRow[];
  outcomes: Map<
    string,
    Readonly<{ finishPosition: number; elapsedMilliseconds: number }>
  >;
  exactReplayCount: number;
};

function fail(message: string): never {
  throw new Error(`Race Merge Core outcome source: ${message}`);
}

function identifier(value: unknown, field: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) fail(`${field} is invalid`);
  return normalized;
}

function boundedPositive(
  value: unknown,
  field: string,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    fail(`${field} is outside its bound`);
  }
  return value;
}

function nonNegative(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(`${field} is invalid`);
  }
  return value;
}

function checkedBounds(
  value: RaceMergeCoreOutcomeCohortSourceBounds,
): RaceMergeCoreOutcomeCohortSourceBounds {
  const bounds = Object.freeze({
    maximumFiles: boundedPositive(value.maximumFiles, "maximumFiles", 24),
    maximumTotalBytes: boundedPositive(
      value.maximumTotalBytes,
      "maximumTotalBytes",
      9_500_000_000,
    ),
    maximumObjectBytes: boundedPositive(
      value.maximumObjectBytes,
      "maximumObjectBytes",
      5 * 1024 * 1024 * 1024,
    ),
    maximumChunkBytes: boundedPositive(
      value.maximumChunkBytes,
      "maximumChunkBytes",
      64 * 1024 * 1024,
    ),
    maximumRowsPerObject: boundedPositive(
      value.maximumRowsPerObject,
      "maximumRowsPerObject",
      100_000_000,
    ),
    maximumRowsPerGeneration: boundedPositive(
      value.maximumRowsPerGeneration,
      "maximumRowsPerGeneration",
      100_000_000,
    ),
    maximumHeaderColumns: boundedPositive(
      value.maximumHeaderColumns,
      "maximumHeaderColumns",
      10_000,
    ),
    maximumFieldCharacters: boundedPositive(
      value.maximumFieldCharacters,
      "maximumFieldCharacters",
      10_000_000,
    ),
    maximumRowCharacters: boundedPositive(
      value.maximumRowCharacters,
      "maximumRowCharacters",
      100_000_000,
    ),
    maximumSelectedObservations: boundedPositive(
      value.maximumSelectedObservations,
      "maximumSelectedObservations",
      10_000_000,
    ),
  });
  if (
    bounds.maximumChunkBytes > bounds.maximumObjectBytes ||
    bounds.maximumObjectBytes > bounds.maximumTotalBytes ||
    bounds.maximumRowsPerObject > bounds.maximumRowsPerGeneration ||
    bounds.maximumFieldCharacters > bounds.maximumRowCharacters
  ) {
    fail("bounds are inconsistent");
  }
  return bounds;
}

function checkedReferences(
  input: readonly RaceMergeOutcomeImportReference[],
  bounds: RaceMergeCoreOutcomeCohortSourceBounds,
): readonly RaceMergeOutcomeImportReference[] {
  if (input.length < 1 || input.length > bounds.maximumFiles) {
    fail("source object count is outside its bound");
  }
  const objectIds = new Set<string>();
  let totalBytes = 0;
  const references = input.map((raw) => {
    const objectId = identifier(raw.objectId, "objectId");
    if (raw.sourceFamily !== "race_merge") fail("source family is invalid");
    if (objectIds.has(objectId))
      fail("source object identities are not unique");
    objectIds.add(objectId);
    const expectedByteLength = boundedPositive(
      raw.expectedByteLength,
      "expectedByteLength",
      bounds.maximumObjectBytes,
    );
    if (!SHA_256_PATTERN.test(raw.expectedSha256)) {
      fail("expectedSha256 is invalid");
    }
    totalBytes += expectedByteLength;
    if (
      !Number.isSafeInteger(totalBytes) ||
      totalBytes > bounds.maximumTotalBytes
    ) {
      fail("source bytes exceed their bound");
    }
    return Object.freeze({
      objectId,
      sourceFamily: "race_merge" as const,
      expectedByteLength,
      expectedSha256: raw.expectedSha256,
    });
  });
  return Object.freeze(
    [...references].sort(
      (left, right) =>
        left.expectedSha256.localeCompare(right.expectedSha256) ||
        left.objectId.localeCompare(right.objectId),
    ),
  );
}

function sourceManifestSha256(
  references: readonly RaceMergeOutcomeImportReference[],
): string {
  const digest = createHash("sha256");
  for (const reference of references) {
    digest.update(
      `${reference.expectedSha256}\u0000${reference.expectedByteLength}\n`,
    );
  }
  return digest.digest("hex");
}

function requiredColumnIndexes(
  values: readonly string[],
  maximumColumns: number,
): Readonly<Record<(typeof REQUIRED_HEADERS)[number], number>> {
  if (
    values.length < REQUIRED_HEADERS.length ||
    values.length > maximumColumns
  ) {
    fail("CSV header column count is invalid");
  }
  const indexes = new Map<string, number>();
  values.forEach((raw, index) => {
    const normalized = (index === 0 ? raw.replace(/^\uFEFF/u, "") : raw)
      .trim()
      .toLowerCase();
    if (normalized === "" || indexes.has(normalized)) {
      fail("CSV header contains an empty or duplicate column");
    }
    indexes.set(normalized, index);
  });
  for (const required of REQUIRED_HEADERS) {
    if (!indexes.has(required)) fail(`CSV header is missing ${required}`);
  }
  return Object.freeze({
    event_id: indexes.get("event_id")!,
    token_id: indexes.get("token_id")!,
    pos: indexes.get("pos")!,
    time: indexes.get("time")!,
  });
}

function largestCoreId(selected: ReadonlyMap<number, SelectedCore>): number {
  let largest = 0;
  for (const sourceCoreId of selected.keys()) {
    if (sourceCoreId > largest) largest = sourceCoreId;
  }
  return largest;
}

/**
 * Reads every checksum-bound private Race Merge object and retains only the
 * next deterministic Core slice. No source row is persisted and no DNA call is
 * made. A selected Race/Core value conflict aborts before the write protocol.
 */
export async function materializeRaceMergeCoreOutcomeSourceCohort(
  input: Readonly<{
    ownerId: string;
    generationId: string;
    references: readonly RaceMergeOutcomeImportReference[];
    objectStore: PrivateRawImportObjectStore;
    afterSourceCoreId: number;
    maximumCores: number;
    bounds: RaceMergeCoreOutcomeCohortSourceBounds;
  }>,
): Promise<RaceMergeCoreOutcomeSourceCohort> {
  const ownerId = identifier(input.ownerId, "ownerId");
  const generationId = identifier(input.generationId, "generationId");
  const afterSourceCoreId = nonNegative(
    input.afterSourceCoreId,
    "afterSourceCoreId",
  );
  const maximumCores = boundedPositive(
    input.maximumCores,
    "maximumCores",
    RACE_MERGE_CORE_OUTCOME_SOURCE_MAXIMUM_CORES,
  );
  const bounds = checkedBounds(input.bounds);
  const references = checkedReferences(input.references, bounds);
  const selected = new Map<number, SelectedCore>();
  let sourceRowCount = 0;
  let selectedObservationCount = 0;

  const selectCore = (sourceCoreId: number): SelectedCore | null => {
    const existing = selected.get(sourceCoreId);
    if (existing !== undefined) return existing;
    if (sourceCoreId <= afterSourceCoreId) return null;
    if (selected.size >= maximumCores) {
      const largest = largestCoreId(selected);
      if (sourceCoreId >= largest) return null;
      const evicted = selected.get(largest)!;
      selectedObservationCount -= evicted.observations.length;
      selected.delete(largest);
    }
    const created: SelectedCore = {
      observations: [],
      outcomes: new Map(),
      exactReplayCount: 0,
    };
    selected.set(sourceCoreId, created);
    return created;
  };

  for (const reference of references) {
    let objectRowCount = 0;
    const sink: TransactionalRawImportSink<Readonly<{ rowCount: number }>> =
      Object.freeze({
        async beginObject(begin) {
          if (
            begin.sourceFamily !== "race_merge" ||
            begin.objectId !== reference.objectId ||
            begin.expectedSha256 !== reference.expectedSha256
          ) {
            fail("source authority changed");
          }
          const decoder = new TextDecoder("utf-8", { fatal: true });
          let headers: Readonly<
            Record<(typeof REQUIRED_HEADERS)[number], number>
          > | null = null;
          let columnCount = 0;
          const csv = new StreamingCsvRecordDecoder(
            async (values) => {
              if (headers === null) {
                headers = requiredColumnIndexes(
                  values,
                  bounds.maximumHeaderColumns,
                );
                columnCount = values.length;
                return;
              }
              if (values.length !== columnCount) {
                fail("CSV row column count does not match the header");
              }
              objectRowCount += 1;
              sourceRowCount += 1;
              if (
                objectRowCount > bounds.maximumRowsPerObject ||
                sourceRowCount > bounds.maximumRowsPerGeneration
              ) {
                fail("source row count exceeds its bound");
              }
              const compact = adaptDnaRaceMergeOutcomeSourceRow({
                event_id: values[headers.event_id],
                token_id: values[headers.token_id],
                pos: values[headers.pos],
                time: values[headers.time],
              });
              const core = selectCore(compact.sourceCoreId);
              if (core === null) return;
              const previous = core.outcomes.get(compact.sourceRaceId);
              if (
                previous !== undefined &&
                (previous.finishPosition !== compact.finishPosition ||
                  previous.elapsedMilliseconds !== compact.elapsedMilliseconds)
              ) {
                fail("selected Race/Core outcome conflict");
              }
              if (previous !== undefined) core.exactReplayCount += 1;
              else {
                core.outcomes.set(
                  compact.sourceRaceId,
                  Object.freeze({
                    finishPosition: compact.finishPosition,
                    elapsedMilliseconds: compact.elapsedMilliseconds,
                  }),
                );
              }
              core.observations.push(
                Object.freeze({
                  ...compact,
                  source: "race_merge" as const,
                  sourceObjectSha256: reference.expectedSha256,
                  sourceRowNumber: objectRowCount,
                }),
              );
              selectedObservationCount += 1;
              if (
                selectedObservationCount > bounds.maximumSelectedObservations
              ) {
                fail("selected observation count exceeds its bound");
              }
            },
            {
              maximumFieldCharacters: bounds.maximumFieldCharacters,
              maximumRowCharacters: bounds.maximumRowCharacters,
            },
          );
          return Object.freeze({
            async write(chunk: Uint8Array) {
              csv.push(decoder.decode(chunk, { stream: true }));
              await csv.settled();
            },
            async commitVerified() {
              csv.push(decoder.decode());
              await csv.finish();
              if (headers === null || objectRowCount < 1) {
                fail("CSV source contains no outcome rows");
              }
              return Object.freeze({ rowCount: objectRowCount });
            },
            async abort() {},
          });
        },
      });
    const verified = await streamVerifiedPrivateRawImportObject({
      ownerId,
      updateSessionId: generationId,
      reference,
      maximumObjectBytes: bounds.maximumObjectBytes,
      maximumChunkBytes: bounds.maximumChunkBytes,
      store: input.objectStore,
      sink,
    });
    if (verified.result.rowCount !== objectRowCount) {
      fail("verified source row count changed");
    }
  }

  const cores = Object.freeze(
    [...selected.entries()]
      .sort(([left], [right]) => left - right)
      .map(([sourceCoreId, value]) =>
        Object.freeze({
          sourceCoreId,
          observations: Object.freeze([...value.observations]),
        }),
      ),
  );
  if (cores.length < 1) fail("no Core exists after the checkpoint");
  const selectedUniqueOutcomeCount = [...selected.values()].reduce(
    (total, value) => total + value.outcomes.size,
    0,
  );
  const selectedExactReplayCount = [...selected.values()].reduce(
    (total, value) => total + value.exactReplayCount,
    0,
  );
  const sourceByteLength = references.reduce(
    (total, reference) => total + reference.expectedByteLength,
    0,
  );
  return Object.freeze({
    generationId,
    afterSourceCoreId,
    sourceManifestSha256: sourceManifestSha256(references),
    sourceObjectCount: references.length,
    sourceByteLength,
    sourceRowCount,
    selectedCoreCount: cores.length,
    selectedObservationCount,
    selectedUniqueOutcomeCount,
    selectedExactReplayCount,
    firstSourceCoreId: cores[0]!.sourceCoreId,
    lastSourceCoreId: cores.at(-1)!.sourceCoreId,
    cores,
    dnaProviderRequestCount: 0 as const,
    persistentWritePerformed: false as const,
    paidUsageAllowed: false as const,
  });
}
