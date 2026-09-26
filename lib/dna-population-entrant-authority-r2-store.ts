import { createHash } from "node:crypto";

import {
  buildDnaPopulationEntrantAuthorityChunk,
  decodeDnaPopulationEntrantAuthorityChunk,
  type DnaPopulationEntrantAuthorityChunk,
  type DnaPopulationEntrantAuthorityChunkReceipt,
} from "./dna-population-entrant-authority-archive";
import type { DnaPopulationEntrantAuthorityRecord } from "./dna-population-entrant-authority-record";
import {
  DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_BYTES,
  DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS,
} from "./dna-population-race-index-r2-chunk";
import type { PrivateDatasetEvidenceObjectReadableStoragePort } from "./private-dataset-evidence-object-reader";
import type { PrivateDatasetEvidenceObjectStoragePort } from "./private-dataset-evidence-object-writer";

const JSON_CONTENT_TYPE = "application/json";
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const SOURCE_VERSION = "population-entrant-authority-r2-v1";
const PENDING_DISCOVERY_LIMIT = 2 as const;

export type DnaPopulationEntrantAuthorityR2ListedObject = Readonly<{
  key: string;
}>;

export type DnaPopulationEntrantAuthorityR2StoragePort = Pick<
  PrivateDatasetEvidenceObjectStoragePort,
  "readBucketPrivacy" | "putObjectIfAbsent" | "headObject"
> &
  Pick<PrivateDatasetEvidenceObjectReadableStoragePort, "getObject"> &
  Readonly<{
    listObjects: (input: {
      bucketName: string;
      prefix: string;
      limit: typeof PENDING_DISCOVERY_LIMIT;
    }) => Promise<
      Readonly<{
        objects: readonly DnaPopulationEntrantAuthorityR2ListedObject[];
        truncated: boolean;
      }>
    >;
  }>;

export type DnaPopulationEntrantAuthorityR2ChunkReceipt =
  DnaPopulationEntrantAuthorityChunkReceipt &
    Readonly<{
      objectKey: string;
    }>;

export type DnaPopulationEntrantAuthorityR2ChunkWrite = Readonly<{
  receipt: DnaPopulationEntrantAuthorityR2ChunkReceipt;
  storageStatus: "created" | "existing";
}>;

export type DnaPopulationEntrantAuthorityR2PendingChunk = Readonly<{
  receipt: DnaPopulationEntrantAuthorityR2ChunkReceipt;
  chunk: DnaPopulationEntrantAuthorityChunk;
}>;

function storageError(message: string): never {
  throw new Error(`Population entrant authority R2 store: ${message}`);
}

function safeText(value: string, field: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > maximum ||
    CONTROL_PATTERN.test(value)
  ) {
    storageError(`${field} is invalid`);
  }
  return value;
}

function sha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) {
    storageError(`${field} is invalid`);
  }
  return normalized;
}

function positiveInteger(
  value: number,
  field: string,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    storageError(`${field} is invalid`);
  }
  return value;
}

function ownerPrefix(ownerId: string): string {
  return createHash("sha256")
    .update(`dna-population-entrant-authority-owner\u0000${ownerId}`)
    .digest("hex");
}

function chunkObjectPrefix(input: {
  ownerId: string;
  generationId: string;
  chunkOrdinal: number;
}): string {
  return [
    "dna-open-lab",
    "v1",
    ownerPrefix(input.ownerId),
    "population-entrant-authority",
    "generations",
    input.generationId,
    "chunks",
    `${String(input.chunkOrdinal).padStart(6, "0")}-`,
  ].join("/");
}

function objectKey(
  ownerId: string,
  receipt: DnaPopulationEntrantAuthorityChunkReceipt,
): string {
  return `${chunkObjectPrefix({
    ownerId,
    generationId: receipt.generationId,
    chunkOrdinal: receipt.chunkOrdinal,
  })}${receipt.bodySha256}.json`;
}

function exactMetadata(
  receipt: DnaPopulationEntrantAuthorityChunkReceipt,
): Readonly<Record<string, string>> {
  return Object.freeze({
    "dna-source": "dna_open_lab",
    "dna-version": SOURCE_VERSION,
    "dna-generation": receipt.generationId,
    "dna-chunk": String(receipt.chunkOrdinal),
    "dna-rows": String(receipt.rowCount),
    "dna-race-set": receipt.raceSetSha256,
    "dna-record-set": receipt.recordSetSha256,
  });
}

function assertPrivateBucket(input: {
  publicAccessDisabled: boolean;
  r2DevDisabled: boolean;
  customDomainCount: number;
}): void {
  if (
    input.publicAccessDisabled !== true ||
    input.r2DevDisabled !== true ||
    input.customDomainCount !== 0
  ) {
    storageError("R2 bucket is not private");
  }
}

function oneChunk(body: Uint8Array): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield body;
  })();
}

function chunkReceipt(
  input: DnaPopulationEntrantAuthorityR2ChunkReceipt,
): DnaPopulationEntrantAuthorityChunkReceipt {
  if (input.version !== 1) {
    storageError("receipt version is invalid");
  }
  return Object.freeze({
    version: 1 as const,
    generationId: sha256(input.generationId, "generationId"),
    chunkOrdinal: positiveInteger(
      input.chunkOrdinal,
      "chunkOrdinal",
      1_000_000,
    ),
    bodySha256: sha256(input.bodySha256, "bodySha256"),
    byteLength: positiveInteger(
      input.byteLength,
      "byteLength",
      DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_BYTES,
    ),
    rowCount: positiveInteger(
      input.rowCount,
      "rowCount",
      DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS,
    ),
    firstSourceRaceId: safeText(
      input.firstSourceRaceId,
      "firstSourceRaceId",
      512,
    ),
    lastSourceRaceId: safeText(input.lastSourceRaceId, "lastSourceRaceId", 512),
    raceSetSha256: sha256(input.raceSetSha256, "raceSetSha256"),
    recordSetSha256: sha256(input.recordSetSha256, "recordSetSha256"),
  });
}

type ReadyHead = Extract<
  Awaited<ReturnType<PrivateDatasetEvidenceObjectStoragePort["headObject"]>>,
  { status: "ready" }
>;

function readyHead(
  value: Awaited<
    ReturnType<PrivateDatasetEvidenceObjectStoragePort["headObject"]>
  >,
): ReadyHead {
  if (
    value.status !== "ready" ||
    value.contentType !== JSON_CONTENT_TYPE ||
    !Number.isSafeInteger(value.byteLength) ||
    value.byteLength < 1 ||
    value.byteLength > DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_BYTES ||
    !SHA_256_PATTERN.test(value.checksumSha256)
  ) {
    storageError("stored chunk head is invalid");
  }
  return value;
}

function exactHead(
  value: Awaited<
    ReturnType<PrivateDatasetEvidenceObjectStoragePort["headObject"]>
  >,
  receipt: DnaPopulationEntrantAuthorityChunkReceipt,
): void {
  const head = readyHead(value);
  const metadata = exactMetadata(receipt);
  if (
    head.byteLength !== receipt.byteLength ||
    head.checksumSha256 !== receipt.bodySha256 ||
    Object.entries(metadata).some(
      ([key, expected]) => head.metadata[key] !== expected,
    )
  ) {
    storageError("stored chunk head conflicts with its receipt");
  }
}

async function collectExactBody(input: {
  body: AsyncIterable<Uint8Array>;
  byteLength: number;
  checksumSha256: string;
}): Promise<Uint8Array> {
  const output = new Uint8Array(input.byteLength);
  const digest = createHash("sha256");
  let offset = 0;
  for await (const chunk of input.body) {
    if (
      !(chunk instanceof Uint8Array) ||
      offset + chunk.byteLength > input.byteLength
    ) {
      storageError("stored chunk body is invalid");
    }
    output.set(chunk, offset);
    digest.update(chunk);
    offset += chunk.byteLength;
  }
  if (
    offset !== input.byteLength ||
    digest.digest("hex") !== input.checksumSha256
  ) {
    storageError("stored chunk body checksum disagrees");
  }
  return output;
}

function pendingRecords(
  body: Uint8Array,
): readonly DnaPopulationEntrantAuthorityRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    storageError("pending chunk body is not valid canonical JSON");
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !Array.isArray((parsed as Record<string, unknown>).records)
  ) {
    storageError("pending chunk envelope is invalid");
  }
  return (parsed as { records: DnaPopulationEntrantAuthorityRecord[] }).records;
}

/**
 * Stores and re-opens immutable compact population entrant-authority chunks in
 * a private R2 bucket. The object key is owner-derived and content-addressed.
 *
 * The bounded pending lookup exists only to recover an R2-first interruption:
 * it searches the exact owner/generation/chunk-ordinal prefix with limit 2,
 * refuses ambiguity, and fully rebuilds the immutable body before records are
 * exposed. It performs no provider access and no persistence.
 */
export function createDnaPopulationEntrantAuthorityR2ChunkStore(input: {
  ownerId: string;
  bucketName: string;
  storage: DnaPopulationEntrantAuthorityR2StoragePort;
}): Readonly<{
  write: (request: {
    generationId: string;
    chunkOrdinal: number;
    records: readonly DnaPopulationEntrantAuthorityRecord[];
  }) => Promise<DnaPopulationEntrantAuthorityR2ChunkWrite>;
  read: (
    receipt: DnaPopulationEntrantAuthorityR2ChunkReceipt,
  ) => Promise<DnaPopulationEntrantAuthorityChunk>;
  findPending: (request: {
    generationId: string;
    chunkOrdinal: number;
  }) => Promise<DnaPopulationEntrantAuthorityR2PendingChunk | null>;
}> {
  const ownerId = safeText(input.ownerId, "ownerId", 512);
  const bucketName = safeText(input.bucketName, "bucketName", 255);
  let privacy: Promise<void> | null = null;

  async function privateStorage(): Promise<void> {
    privacy ??= input.storage
      .readBucketPrivacy({ bucketName })
      .then(assertPrivateBucket);
    await privacy;
  }

  return Object.freeze({
    async write(request) {
      const chunk = buildDnaPopulationEntrantAuthorityChunk(request);
      const key = objectKey(ownerId, chunk.receipt);
      const receipt = chunkReceipt({
        ...chunk.receipt,
        objectKey: key,
      });
      const metadata = exactMetadata(receipt);
      await privateStorage();
      const stored = await input.storage.putObjectIfAbsent({
        bucketName,
        key,
        body: oneChunk(chunk.body),
        contentType: JSON_CONTENT_TYPE,
        byteLength: receipt.byteLength,
        checksumSha256: receipt.bodySha256,
        metadata,
      });
      if (stored.status !== "created" && stored.status !== "existing") {
        storageError("R2 write returned an invalid status");
      }
      exactHead(await input.storage.headObject({ bucketName, key }), receipt);
      return Object.freeze({
        receipt: Object.freeze({
          ...receipt,
          objectKey: key,
        }),
        storageStatus: stored.status,
      });
    },

    async read(storedReceipt) {
      const receipt = chunkReceipt(storedReceipt);
      const expectedObjectKey = objectKey(ownerId, receipt);
      if (
        safeText(storedReceipt.objectKey, "objectKey", 2_048) !==
        expectedObjectKey
      ) {
        storageError("object key conflicts with its deterministic identity");
      }
      await privateStorage();
      exactHead(
        await input.storage.headObject({
          bucketName,
          key: expectedObjectKey,
        }),
        receipt,
      );
      const object = await input.storage.getObject({
        bucketName,
        key: expectedObjectKey,
      });
      if (object.status !== "ready") {
        storageError("stored chunk body is unavailable");
      }
      const body = await collectExactBody({
        body: object.body,
        byteLength: receipt.byteLength,
        checksumSha256: receipt.bodySha256,
      });
      return decodeDnaPopulationEntrantAuthorityChunk({ receipt, body });
    },

    async findPending(request) {
      const generationId = sha256(request.generationId, "generationId");
      const chunkOrdinal = positiveInteger(
        request.chunkOrdinal,
        "chunkOrdinal",
        1_000_000,
      );
      const prefix = chunkObjectPrefix({
        ownerId,
        generationId,
        chunkOrdinal,
      });
      await privateStorage();

      let page: Awaited<
        ReturnType<DnaPopulationEntrantAuthorityR2StoragePort["listObjects"]>
      >;
      try {
        page = await input.storage.listObjects({
          bucketName,
          prefix,
          limit: PENDING_DISCOVERY_LIMIT,
        });
      } catch {
        storageError("pending chunk discovery failed");
      }
      if (
        page === null ||
        typeof page !== "object" ||
        !Array.isArray(page.objects) ||
        typeof page.truncated !== "boolean" ||
        page.objects.length > PENDING_DISCOVERY_LIMIT
      ) {
        storageError("pending chunk discovery response is invalid");
      }
      if (page.truncated || page.objects.length > 1) {
        storageError("pending chunk discovery is ambiguous");
      }
      if (page.objects.length === 0) return null;

      const listedKey = safeText(
        page.objects[0]!.key,
        "listed object key",
        2_048,
      );
      if (!listedKey.startsWith(prefix)) {
        storageError("pending chunk escaped its deterministic prefix");
      }
      const suffix = listedKey.slice(prefix.length);
      const match = /^([a-f0-9]{64})\.json$/u.exec(suffix);
      if (match === null) {
        storageError("pending chunk object key is invalid");
      }

      const head = readyHead(
        await input.storage.headObject({ bucketName, key: listedKey }),
      );
      if (head.checksumSha256 !== match[1]) {
        storageError("pending chunk key conflicts with stored checksum");
      }
      const object = await input.storage.getObject({
        bucketName,
        key: listedKey,
      });
      if (object.status !== "ready") {
        storageError("pending chunk body is unavailable");
      }
      const body = await collectExactBody({
        body: object.body,
        byteLength: head.byteLength,
        checksumSha256: head.checksumSha256,
      });
      const rebuilt = buildDnaPopulationEntrantAuthorityChunk({
        generationId,
        chunkOrdinal,
        records: pendingRecords(body),
      });
      const expectedObjectKey = objectKey(ownerId, rebuilt.receipt);
      if (expectedObjectKey !== listedKey) {
        storageError("pending chunk body conflicts with its object key");
      }
      exactHead(head, rebuilt.receipt);
      const chunk = decodeDnaPopulationEntrantAuthorityChunk({
        receipt: rebuilt.receipt,
        body,
      });
      return Object.freeze({
        receipt: Object.freeze({
          ...rebuilt.receipt,
          objectKey: listedKey,
        }),
        chunk,
      });
    },
  });
}
