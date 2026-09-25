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

export type DnaPopulationEntrantAuthorityR2StoragePort = Pick<
  PrivateDatasetEvidenceObjectStoragePort,
  "readBucketPrivacy" | "putObjectIfAbsent" | "headObject"
> &
  Pick<PrivateDatasetEvidenceObjectReadableStoragePort, "getObject">;

export type DnaPopulationEntrantAuthorityR2ChunkReceipt =
  DnaPopulationEntrantAuthorityChunkReceipt &
    Readonly<{
      objectKey: string;
    }>;

export type DnaPopulationEntrantAuthorityR2ChunkWrite = Readonly<{
  receipt: DnaPopulationEntrantAuthorityR2ChunkReceipt;
  storageStatus: "created" | "existing";
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

function objectKey(
  ownerId: string,
  receipt: DnaPopulationEntrantAuthorityChunkReceipt,
): string {
  return [
    "dna-open-lab",
    "v1",
    ownerPrefix(ownerId),
    "population-entrant-authority",
    "generations",
    receipt.generationId,
    "chunks",
    `${String(receipt.chunkOrdinal).padStart(6, "0")}-${receipt.bodySha256}.json`,
  ].join("/");
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
    lastSourceRaceId: safeText(
      input.lastSourceRaceId,
      "lastSourceRaceId",
      512,
    ),
    raceSetSha256: sha256(input.raceSetSha256, "raceSetSha256"),
    recordSetSha256: sha256(input.recordSetSha256, "recordSetSha256"),
  });
}

function exactHead(
  value: Awaited<
    ReturnType<PrivateDatasetEvidenceObjectStoragePort["headObject"]>
  >,
  receipt: DnaPopulationEntrantAuthorityChunkReceipt,
): void {
  const metadata = exactMetadata(receipt);
  if (
    value.status !== "ready" ||
    value.contentType !== JSON_CONTENT_TYPE ||
    value.byteLength !== receipt.byteLength ||
    value.checksumSha256 !== receipt.bodySha256 ||
    Object.entries(metadata).some(
      ([key, expected]) => value.metadata[key] !== expected,
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

/**
 * Stores and re-opens immutable compact population entrant-authority chunks in
 * a private R2 bucket. The object key is owner-derived and content-addressed.
 *
 * This adapter is not a collection loop and performs no provider access. A
 * caller must separately satisfy the audited unresolved-Race binding, capacity,
 * checkpoint and write-arming gates before invoking write in a connected flow.
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
      exactHead(
        await input.storage.headObject({ bucketName, key }),
        receipt,
      );
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
  });
}
