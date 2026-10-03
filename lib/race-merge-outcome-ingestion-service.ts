import { createHash } from "node:crypto";

import {
  adaptDnaRaceMergeOutcomeSourceRow,
  type DnaCompactCoreOutcomeEvidence,
} from "./dna-population-core-outcome-gap-plan";
import {
  streamVerifiedPrivateRawImportObject,
  type PrivateRawImportObjectReference,
  type PrivateRawImportObjectStore,
  type RawImportObjectFailureCode,
  type TransactionalRawImportSink,
} from "./private-raw-import-object-stream";
import { StreamingCsvRecordDecoder } from "./streaming-csv-record-decoder";

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const REQUIRED_HEADERS = Object.freeze([
  "event_id",
  "token_id",
  "pos",
  "time",
] as const);

export type RaceMergeOutcomeImportReference = PrivateRawImportObjectReference &
  Readonly<{ sourceFamily: "race_merge" }>;

export type RaceMergeOutcomeEvidenceRow = DnaCompactCoreOutcomeEvidence &
  Readonly<{
    source: "race_merge";
    sourceObjectSha256: string;
    sourceRowNumber: number;
  }>;

export type RaceMergeOutcomeObjectReceipt = Readonly<{
  objectId: string;
  byteLength: number;
  sha256: string;
  rowCount: number;
  orderedOutcomeDigestSha256: string;
}>;

export type RaceMergeOutcomeIngestionResult = Readonly<{
  status: "complete";
  generationId: string;
  objectCount: number;
  sourceRowCount: number;
  uniqueOutcomeCount: number;
  exactReplayCount: number;
  manifestDigestSha256: string;
  outcomeSetDigestSha256: string;
  dnaProviderRequestCount: 0;
}>;

export type RaceMergeOutcomeObjectTransaction = Readonly<{
  appendOutcomes: (
    rows: readonly RaceMergeOutcomeEvidenceRow[],
  ) => Promise<void>;
  commitVerified: (input: {
    byteLength: number;
    sha256: string;
    chunkCount: number;
    rowCount: number;
    orderedOutcomeDigestSha256: string;
  }) => Promise<RaceMergeOutcomeObjectReceipt>;
  rollback: (input: { reason: RawImportObjectFailureCode }) => Promise<void>;
}>;

/**
 * The repository is responsible for enforcing the unique Race/Core natural
 * key across every object in a generation. Exact value replays are idempotent;
 * a different position or elapsed time for the same key must reject the write.
 */
export type RaceMergeOutcomeIngestionRepository = Readonly<{
  resumeObject: (input: {
    ownerId: string;
    generationId: string;
    objectId: string;
    expectedByteLength: number;
    expectedSha256: string;
  }) => Promise<RaceMergeOutcomeObjectReceipt | null>;
  beginObject: (input: {
    ownerId: string;
    generationId: string;
    manifestDigestSha256: string;
    objectId: string;
    expectedByteLength: number;
    expectedSha256: string;
  }) => Promise<RaceMergeOutcomeObjectTransaction>;
  finalizeGeneration: (input: {
    ownerId: string;
    generationId: string;
    manifestDigestSha256: string;
    objects: readonly RaceMergeOutcomeObjectReceipt[];
  }) => Promise<RaceMergeOutcomeIngestionResult>;
  abortGeneration: (input: {
    ownerId: string;
    generationId: string;
    reason: "object_failed" | "finalization_failed";
  }) => Promise<void>;
}>;

export type RaceMergeOutcomeGenerationReader = Readonly<{
  loadCoreOutcomes: (input: {
    ownerId: string;
    generationId: string;
    sourceCoreId: number;
  }) => Promise<readonly DnaCompactCoreOutcomeEvidence[]>;
}>;

export type RaceMergeOutcomeIngestionBounds = Readonly<{
  maximumFiles: number;
  maximumTotalBytes: number;
  maximumObjectBytes: number;
  maximumChunkBytes: number;
  maximumRowsPerObject: number;
  maximumRowsPerGeneration: number;
  maximumHeaderColumns: number;
  maximumFieldCharacters: number;
  maximumRowCharacters: number;
  rowsPerWrite: number;
}>;

export type RaceMergeOutcomeZeroCostCapacityGate = Readonly<{
  authorize: (input: {
    ownerId: string;
    generationId: string;
    manifestDigestSha256: string;
    sourceObjectCount: number;
    sourceByteLength: number;
    maximumRowsPerGeneration: number;
  }) => Promise<
    Readonly<{
      ownerId: string;
      generationId: string;
      manifestDigestSha256: string;
      measuredAt: string;
      validUntil: string;
      projectedR2RetainedBytes: number;
      projectedNeonStorageBytes: number;
      projectedPaidCostAud: 0;
    }>
  >;
}>;

function fail(message: string): never {
  throw new Error(`Race Merge outcome ingestion: ${message}`);
}

function safeIdentifier(value: unknown, field: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) fail(`${field} is invalid`);
  return normalized;
}

function positiveBound(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail(`${field} is outside its bound`);
  }
  return value;
}

function validatedBounds(
  input: RaceMergeOutcomeIngestionBounds,
): RaceMergeOutcomeIngestionBounds {
  const bounds = {
    maximumFiles: positiveBound(input.maximumFiles, "maximumFiles", 24),
    maximumTotalBytes: positiveBound(
      input.maximumTotalBytes,
      "maximumTotalBytes",
      9_500_000_000,
    ),
    maximumObjectBytes: positiveBound(
      input.maximumObjectBytes,
      "maximumObjectBytes",
      5 * 1024 * 1024 * 1024,
    ),
    maximumChunkBytes: positiveBound(
      input.maximumChunkBytes,
      "maximumChunkBytes",
      64 * 1024 * 1024,
    ),
    maximumRowsPerObject: positiveBound(
      input.maximumRowsPerObject,
      "maximumRowsPerObject",
      100_000_000,
    ),
    maximumRowsPerGeneration: positiveBound(
      input.maximumRowsPerGeneration,
      "maximumRowsPerGeneration",
      100_000_000,
    ),
    maximumHeaderColumns: positiveBound(
      input.maximumHeaderColumns,
      "maximumHeaderColumns",
      10_000,
    ),
    maximumFieldCharacters: positiveBound(
      input.maximumFieldCharacters,
      "maximumFieldCharacters",
      10_000_000,
    ),
    maximumRowCharacters: positiveBound(
      input.maximumRowCharacters,
      "maximumRowCharacters",
      100_000_000,
    ),
    rowsPerWrite: positiveBound(input.rowsPerWrite, "rowsPerWrite", 10_000),
  };
  if (
    bounds.maximumChunkBytes > bounds.maximumObjectBytes ||
    bounds.maximumObjectBytes > bounds.maximumTotalBytes ||
    bounds.maximumRowsPerObject > bounds.maximumRowsPerGeneration ||
    bounds.maximumFieldCharacters > bounds.maximumRowCharacters
  ) {
    fail("bounds are inconsistent");
  }
  return Object.freeze(bounds);
}

function validateReferences(
  references: readonly RaceMergeOutcomeImportReference[],
  bounds: RaceMergeOutcomeIngestionBounds,
): readonly RaceMergeOutcomeImportReference[] {
  if (references.length < 1 || references.length > bounds.maximumFiles) {
    fail("file count is outside its bound");
  }
  let totalBytes = 0;
  const objectIds = new Set<string>();
  const validated = references.map((reference) => {
    if (reference.sourceFamily !== "race_merge") {
      fail("source family is not Race Merge");
    }
    const objectId = safeIdentifier(reference.objectId, "objectId");
    if (objectIds.has(objectId)) fail("object identities are not unique");
    objectIds.add(objectId);
    if (
      !Number.isSafeInteger(reference.expectedByteLength) ||
      reference.expectedByteLength < 1 ||
      reference.expectedByteLength > bounds.maximumObjectBytes
    ) {
      fail("object byte length is outside its bound");
    }
    if (!SHA_256_PATTERN.test(reference.expectedSha256)) {
      fail("object checksum is invalid");
    }
    totalBytes += reference.expectedByteLength;
    if (
      !Number.isSafeInteger(totalBytes) ||
      totalBytes > bounds.maximumTotalBytes
    ) {
      fail("total input bytes exceed the approved bound");
    }
    return Object.freeze({
      objectId,
      sourceFamily: "race_merge" as const,
      expectedByteLength: reference.expectedByteLength,
      expectedSha256: reference.expectedSha256,
    });
  });
  return Object.freeze(
    [...validated].sort(
      (left, right) =>
        left.expectedSha256.localeCompare(right.expectedSha256) ||
        left.objectId.localeCompare(right.objectId),
    ),
  );
}

function manifestDigest(
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

function canonicalTimestamp(value: string, field: string): number {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(`${field} is invalid`);
  }
  return parsed.getTime();
}

async function assertZeroCostCapacity(input: {
  gate: RaceMergeOutcomeZeroCostCapacityGate;
  ownerId: string;
  generationId: string;
  manifestDigestSha256: string;
  references: readonly RaceMergeOutcomeImportReference[];
  maximumRowsPerGeneration: number;
  now: Date;
}): Promise<void> {
  const now = input.now.getTime();
  if (!Number.isFinite(now)) fail("capacity clock is invalid");
  const sourceByteLength = input.references.reduce(
    (total, reference) => total + reference.expectedByteLength,
    0,
  );
  const authority = await input.gate.authorize({
    ownerId: input.ownerId,
    generationId: input.generationId,
    manifestDigestSha256: input.manifestDigestSha256,
    sourceObjectCount: input.references.length,
    sourceByteLength,
    maximumRowsPerGeneration: input.maximumRowsPerGeneration,
  });
  const measuredAt = canonicalTimestamp(authority.measuredAt, "measuredAt");
  const validUntil = canonicalTimestamp(authority.validUntil, "validUntil");
  if (
    authority.ownerId !== input.ownerId ||
    authority.generationId !== input.generationId ||
    authority.manifestDigestSha256 !== input.manifestDigestSha256 ||
    measuredAt > now ||
    validUntil <= now ||
    validUntil <= measuredAt ||
    !Number.isSafeInteger(authority.projectedR2RetainedBytes) ||
    authority.projectedR2RetainedBytes < 0 ||
    authority.projectedR2RetainedBytes > 9_500_000_000 ||
    !Number.isSafeInteger(authority.projectedNeonStorageBytes) ||
    authority.projectedNeonStorageBytes < 0 ||
    authority.projectedNeonStorageBytes > 950_000_000 ||
    authority.projectedNeonStorageBytes >= 1_000_000_000 ||
    authority.projectedPaidCostAud !== 0
  ) {
    fail("fresh zero-cost capacity authority is invalid");
  }
}

function validateReceipt(
  receipt: RaceMergeOutcomeObjectReceipt,
  reference: RaceMergeOutcomeImportReference,
  bounds: RaceMergeOutcomeIngestionBounds,
): RaceMergeOutcomeObjectReceipt {
  if (
    receipt.objectId !== reference.objectId ||
    receipt.byteLength !== reference.expectedByteLength ||
    receipt.sha256 !== reference.expectedSha256 ||
    !Number.isSafeInteger(receipt.rowCount) ||
    receipt.rowCount < 1 ||
    receipt.rowCount > bounds.maximumRowsPerObject ||
    !SHA_256_PATTERN.test(receipt.orderedOutcomeDigestSha256)
  ) {
    fail("object receipt is inconsistent");
  }
  return Object.freeze({ ...receipt });
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

function objectSink(input: {
  repository: RaceMergeOutcomeIngestionRepository;
  generationId: string;
  manifestDigestSha256: string;
  bounds: RaceMergeOutcomeIngestionBounds;
  addGenerationRows: (count: number) => void;
}): TransactionalRawImportSink<RaceMergeOutcomeObjectReceipt> {
  return Object.freeze({
    async beginObject(begin) {
      if (begin.sourceFamily !== "race_merge") fail("source family changed");
      const transaction = await input.repository.beginObject({
        ownerId: begin.ownerId,
        generationId: input.generationId,
        manifestDigestSha256: input.manifestDigestSha256,
        objectId: begin.objectId,
        expectedByteLength: begin.expectedByteLength,
        expectedSha256: begin.expectedSha256,
      });
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const orderedDigest = createHash("sha256");
      let headers: Readonly<
        Record<(typeof REQUIRED_HEADERS)[number], number>
      > | null = null;
      let columnCount = 0;
      let rowCount = 0;
      let pending: RaceMergeOutcomeEvidenceRow[] = [];

      const flush = async () => {
        if (pending.length === 0) return;
        const rows = pending;
        pending = [];
        await transaction.appendOutcomes(rows);
      };
      const csv = new StreamingCsvRecordDecoder(
        async (values) => {
          if (headers === null) {
            headers = requiredColumnIndexes(
              values,
              input.bounds.maximumHeaderColumns,
            );
            columnCount = values.length;
            return;
          }
          if (values.length !== columnCount) {
            fail("CSV row column count does not match the header");
          }
          rowCount += 1;
          if (rowCount > input.bounds.maximumRowsPerObject) {
            fail("object row count exceeds its bound");
          }
          input.addGenerationRows(1);
          const compact = adaptDnaRaceMergeOutcomeSourceRow({
            event_id: values[headers.event_id],
            token_id: values[headers.token_id],
            pos: values[headers.pos],
            time: values[headers.time],
          });
          const outcome = Object.freeze({
            ...compact,
            source: "race_merge" as const,
            sourceObjectSha256: begin.expectedSha256,
            sourceRowNumber: rowCount,
          });
          orderedDigest.update(
            `${outcome.sourceCoreId}\u0000${outcome.sourceRaceId}\u0000${outcome.finishPosition}\u0000${outcome.elapsedMilliseconds}\n`,
          );
          pending.push(outcome);
          if (pending.length >= input.bounds.rowsPerWrite) await flush();
        },
        {
          maximumFieldCharacters: input.bounds.maximumFieldCharacters,
          maximumRowCharacters: input.bounds.maximumRowCharacters,
        },
      );

      return Object.freeze({
        async write(chunk: Uint8Array) {
          csv.push(decoder.decode(chunk, { stream: true }));
          await csv.settled();
        },
        async commitVerified(verified) {
          csv.push(decoder.decode());
          await csv.finish();
          await flush();
          if (headers === null || rowCount < 1) {
            fail("CSV object contains no outcome rows");
          }
          return transaction.commitVerified({
            ...verified,
            rowCount,
            orderedOutcomeDigestSha256: orderedDigest.digest("hex"),
          });
        },
        async abort({ reason }) {
          await transaction.rollback({ reason });
        },
      });
    },
  });
}

async function abortSafely(
  repository: RaceMergeOutcomeIngestionRepository,
  input: Parameters<RaceMergeOutcomeIngestionRepository["abortGeneration"]>[0],
): Promise<void> {
  try {
    await repository.abortGeneration(input);
  } catch {
    // Preserve the original sanitized failure.
  }
}

/**
 * Streams checksum-verified private Race Merge CSV objects into one compact,
 * replay-safe outcome generation. It accepts older exports without `rmode`;
 * Race metadata remains sourced from canonical Race authority during joins.
 */
export async function ingestRaceMergeOutcomeEvidence(
  input: Readonly<{
    ownerId: string;
    generationId: string;
    references: readonly RaceMergeOutcomeImportReference[];
    objectStore: PrivateRawImportObjectStore;
    repository: RaceMergeOutcomeIngestionRepository;
    zeroCostCapacityGate: RaceMergeOutcomeZeroCostCapacityGate;
    bounds: RaceMergeOutcomeIngestionBounds;
    now?: Date;
  }>,
): Promise<RaceMergeOutcomeIngestionResult> {
  const ownerId = safeIdentifier(input.ownerId, "ownerId");
  const generationId = safeIdentifier(input.generationId, "generationId");
  const bounds = validatedBounds(input.bounds);
  const references = validateReferences(input.references, bounds);
  const manifestDigestSha256 = manifestDigest(references);
  await assertZeroCostCapacity({
    gate: input.zeroCostCapacityGate,
    ownerId,
    generationId,
    manifestDigestSha256,
    references,
    maximumRowsPerGeneration: bounds.maximumRowsPerGeneration,
    now: input.now ?? new Date(),
  });
  const receipts: RaceMergeOutcomeObjectReceipt[] = [];
  let generationRows = 0;
  const addGenerationRows = (count: number) => {
    generationRows += count;
    if (
      !Number.isSafeInteger(generationRows) ||
      generationRows > bounds.maximumRowsPerGeneration
    ) {
      fail("generation row count exceeds its bound");
    }
  };

  try {
    for (const reference of references) {
      const resumed = await input.repository.resumeObject({
        ownerId,
        generationId,
        objectId: reference.objectId,
        expectedByteLength: reference.expectedByteLength,
        expectedSha256: reference.expectedSha256,
      });
      if (resumed !== null) {
        const receipt = validateReceipt(resumed, reference, bounds);
        addGenerationRows(receipt.rowCount);
        receipts.push(receipt);
        continue;
      }
      const verified = await streamVerifiedPrivateRawImportObject({
        ownerId,
        updateSessionId: generationId,
        reference,
        maximumObjectBytes: bounds.maximumObjectBytes,
        maximumChunkBytes: bounds.maximumChunkBytes,
        store: input.objectStore,
        sink: objectSink({
          repository: input.repository,
          generationId,
          manifestDigestSha256,
          bounds,
          addGenerationRows,
        }),
      });
      receipts.push(validateReceipt(verified.result, reference, bounds));
    }
  } catch (error) {
    await abortSafely(input.repository, {
      ownerId,
      generationId,
      reason: "object_failed",
    });
    throw error;
  }

  try {
    const result = await input.repository.finalizeGeneration({
      ownerId,
      generationId,
      manifestDigestSha256,
      objects: receipts,
    });
    if (
      result.status !== "complete" ||
      result.generationId !== generationId ||
      result.objectCount !== receipts.length ||
      result.sourceRowCount !== generationRows ||
      result.uniqueOutcomeCount < 0 ||
      result.exactReplayCount < 0 ||
      result.uniqueOutcomeCount + result.exactReplayCount !== generationRows ||
      result.manifestDigestSha256 !== manifestDigestSha256 ||
      !SHA_256_PATTERN.test(result.outcomeSetDigestSha256) ||
      result.dnaProviderRequestCount !== 0
    ) {
      fail("final generation receipt is inconsistent");
    }
    return Object.freeze({ ...result });
  } catch (error) {
    await abortSafely(input.repository, {
      ownerId,
      generationId,
      reason: "finalization_failed",
    });
    throw error;
  }
}

export function createRaceMergeOutcomeGenerationLoader(
  input: Readonly<{
    ownerId: string;
    generationId: string;
    reader: RaceMergeOutcomeGenerationReader;
  }>,
): (sourceCoreId: number) => Promise<readonly DnaCompactCoreOutcomeEvidence[]> {
  const ownerId = safeIdentifier(input.ownerId, "ownerId");
  const generationId = safeIdentifier(input.generationId, "generationId");
  return async (sourceCoreId) => {
    if (!Number.isSafeInteger(sourceCoreId) || sourceCoreId < 1) {
      fail("sourceCoreId is invalid");
    }
    return input.reader.loadCoreOutcomes({
      ownerId,
      generationId,
      sourceCoreId,
    });
  };
}
