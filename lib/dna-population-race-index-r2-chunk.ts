import { createHash } from "node:crypto";

import type { DnaPopulationRaceIndexDocument } from "./dna-population-race-index-checkpoint";
import type { PrivateDatasetEvidenceObjectReadableStoragePort } from "./private-dataset-evidence-object-reader";
import type { PrivateDatasetEvidenceObjectStoragePort } from "./private-dataset-evidence-object-writer";

const JSON_CONTENT_TYPE = "application/json";
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export const DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_BYTES = 8 * 1024 * 1024;
export const DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS = 5_000;

export type DnaPopulationRaceIndexR2ChunkStoragePort = Pick<
  PrivateDatasetEvidenceObjectStoragePort,
  "readBucketPrivacy" | "putObjectIfAbsent" | "headObject"
> &
  Pick<PrivateDatasetEvidenceObjectReadableStoragePort, "getObject">;

export type DnaPopulationRaceIndexR2ChunkReceipt = Readonly<{
  version: 1;
  generationId: string;
  chunkOrdinal: number;
  objectKey: string;
  bodySha256: string;
  byteLength: number;
  rowCount: number;
  firstSourceRaceId: string;
  lastSourceRaceId: string;
}>;

export type DnaPopulationRaceIndexR2ChunkWrite = Readonly<{
  receipt: DnaPopulationRaceIndexR2ChunkReceipt;
  storageStatus: "created" | "existing";
}>;

function chunkError(message: string): never {
  throw new Error(`DNA population race index R2 chunk: ${message}`);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      chunkError("body contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value !== "object") chunkError("body contains a non-JSON value");
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeText(value: string, field: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > maximum ||
    CONTROL_PATTERN.test(value)
  ) {
    chunkError(`${field} is invalid`);
  }
  return value;
}

function generationId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) chunkError("generationId is invalid");
  return normalized;
}

function positiveInteger(
  value: number,
  field: string,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    chunkError(`${field} is invalid`);
  }
  return value;
}

function oneChunk(body: Uint8Array): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield body;
  })();
}

function ownerPrefix(ownerId: string): string {
  return sha256(`dna-population-race-index-owner\u0000${ownerId}`);
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
    chunkError("R2 bucket is not private");
  }
}

function documentIdentity(document: DnaPopulationRaceIndexDocument): string {
  const sourceRaceId = safeText(document.sourceRaceId, "sourceRaceId", 512);
  if (
    document.canonical.sourceType !== "race_document" ||
    document.canonical.sourceRaceId !== sourceRaceId ||
    !SHA_256_PATTERN.test(document.rawEvidenceSha256)
  ) {
    chunkError("document authority is invalid");
  }
  return sourceRaceId;
}

function sortedUniqueDocuments(
  documents: readonly DnaPopulationRaceIndexDocument[],
): readonly DnaPopulationRaceIndexDocument[] {
  if (
    documents.length < 1 ||
    documents.length > DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS
  ) {
    chunkError("document count is invalid");
  }
  const sorted = [...documents].sort((left, right) => {
    const a = documentIdentity(left);
    const b = documentIdentity(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1]!.sourceRaceId === sorted[index]!.sourceRaceId) {
      chunkError("chunk contains a duplicate race identity");
    }
  }
  return Object.freeze(sorted);
}

function chunkBody(input: {
  generationId: string;
  chunkOrdinal: number;
  documents: readonly DnaPopulationRaceIndexDocument[];
}): Readonly<{ canonical: string; body: Uint8Array }> {
  const canonical = canonicalJson({
    version: 1,
    source: "dna_open_lab",
    sourceVersion: "population-race-index-r2-v1",
    generationId: input.generationId,
    chunkOrdinal: input.chunkOrdinal,
    documents: input.documents,
  });
  return Object.freeze({
    canonical,
    body: new TextEncoder().encode(canonical),
  });
}

export function fitDnaPopulationRaceIndexR2ChunkDocuments(input: {
  generationId: string;
  chunkOrdinal: number;
  documents: readonly DnaPopulationRaceIndexDocument[];
}): readonly DnaPopulationRaceIndexDocument[] {
  const generation = generationId(input.generationId);
  const chunkOrdinal = positiveInteger(
    input.chunkOrdinal,
    "chunkOrdinal",
    1_000_000,
  );
  const documents = sortedUniqueDocuments(input.documents);
  let lower = 1;
  let upper = documents.length;
  let fittingCount = 0;

  while (lower <= upper) {
    const candidateCount = Math.floor((lower + upper) / 2);
    const { body } = chunkBody({
      generationId: generation,
      chunkOrdinal,
      documents: documents.slice(0, candidateCount),
    });
    if (body.byteLength <= DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_BYTES) {
      fittingCount = candidateCount;
      lower = candidateCount + 1;
    } else {
      upper = candidateCount - 1;
    }
  }

  if (fittingCount < 1) {
    chunkError("one document exceeds the bounded byte capacity");
  }
  return Object.freeze(documents.slice(0, fittingCount));
}

async function collectExactBody(input: {
  body: AsyncIterable<Uint8Array>;
  byteLength: number;
  checksumSha256: string;
}): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(input.byteLength) ||
    input.byteLength < 1 ||
    input.byteLength > DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_BYTES
  ) {
    chunkError("stored chunk byte length is invalid");
  }
  const output = new Uint8Array(input.byteLength);
  const digest = createHash("sha256");
  let offset = 0;
  for await (const chunk of input.body) {
    if (
      !(chunk instanceof Uint8Array) ||
      offset + chunk.byteLength > input.byteLength
    ) {
      chunkError("stored chunk body is invalid");
    }
    output.set(chunk, offset);
    digest.update(chunk);
    offset += chunk.byteLength;
  }
  if (
    offset !== input.byteLength ||
    digest.digest("hex") !== input.checksumSha256
  ) {
    chunkError("stored chunk body checksum disagrees");
  }
  return output;
}

function exactReceiptMetadata(receipt: DnaPopulationRaceIndexR2ChunkReceipt) {
  return Object.freeze({
    "dna-source": "dna_open_lab",
    "dna-version": "population-race-index-r2-v1",
    "dna-generation": receipt.generationId,
    "dna-chunk": String(receipt.chunkOrdinal),
    "dna-rows": String(receipt.rowCount),
    "dna-first-race": receipt.firstSourceRaceId,
    "dna-last-race": receipt.lastSourceRaceId,
  });
}

export function createDnaPopulationRaceIndexR2ChunkStore(input: {
  ownerId: string;
  bucketName: string;
  storage: DnaPopulationRaceIndexR2ChunkStoragePort;
}): Readonly<{
  write: (request: {
    generationId: string;
    chunkOrdinal: number;
    documents: readonly DnaPopulationRaceIndexDocument[];
  }) => Promise<DnaPopulationRaceIndexR2ChunkWrite>;
  read: (
    receipt: DnaPopulationRaceIndexR2ChunkReceipt,
  ) => Promise<readonly DnaPopulationRaceIndexDocument[]>;
}> {
  const ownerId = safeText(input.ownerId, "ownerId", 512);
  const bucketName = safeText(input.bucketName, "bucketName", 255);
  const prefix = ownerPrefix(ownerId);
  let privacy: Promise<void> | null = null;

  async function privateStorage(): Promise<void> {
    privacy ??= input.storage
      .readBucketPrivacy({ bucketName })
      .then(assertPrivateBucket);
    await privacy;
  }

  return Object.freeze({
    async read(receipt) {
      const generation = generationId(receipt.generationId);
      const chunkOrdinal = positiveInteger(
        receipt.chunkOrdinal,
        "chunkOrdinal",
        1_000_000,
      );
      const rowCount = positiveInteger(
        receipt.rowCount,
        "rowCount",
        DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS,
      );
      const objectKey = safeText(receipt.objectKey, "objectKey", 2048);
      if (
        !SHA_256_PATTERN.test(receipt.bodySha256) ||
        !Number.isSafeInteger(receipt.byteLength) ||
        receipt.byteLength < 1 ||
        receipt.byteLength > DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_BYTES
      ) {
        chunkError("chunk receipt is invalid");
      }
      const expected = Object.freeze({
        ...receipt,
        generationId: generation,
        chunkOrdinal,
        rowCount,
        objectKey,
        firstSourceRaceId: safeText(
          receipt.firstSourceRaceId,
          "firstSourceRaceId",
          512,
        ),
        lastSourceRaceId: safeText(
          receipt.lastSourceRaceId,
          "lastSourceRaceId",
          512,
        ),
      });
      await privateStorage();
      const head = await input.storage.headObject({
        bucketName,
        key: objectKey,
      });
      const metadata = exactReceiptMetadata(expected);
      if (
        head.status !== "ready" ||
        head.contentType !== JSON_CONTENT_TYPE ||
        head.byteLength !== expected.byteLength ||
        head.checksumSha256 !== expected.bodySha256 ||
        Object.entries(metadata).some(
          ([key, value]) => head.metadata[key] !== value,
        )
      ) {
        chunkError("stored chunk head conflicts with its receipt");
      }
      const object = await input.storage.getObject({
        bucketName,
        key: objectKey,
      });
      if (object.status !== "ready") {
        chunkError("stored chunk body is unavailable");
      }
      const bytes = await collectExactBody({
        body: object.body,
        byteLength: expected.byteLength,
        checksumSha256: expected.bodySha256,
      });
      let parsed: unknown;
      try {
        parsed = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
      } catch {
        chunkError("stored chunk is not valid UTF-8 JSON");
      }
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        chunkError("stored chunk envelope is invalid");
      }
      const envelope = parsed as Record<string, unknown>;
      if (
        envelope.version !== 1 ||
        envelope.source !== "dna_open_lab" ||
        envelope.sourceVersion !== "population-race-index-r2-v1" ||
        envelope.generationId !== generation ||
        envelope.chunkOrdinal !== chunkOrdinal ||
        !Array.isArray(envelope.documents) ||
        envelope.documents.length !== rowCount ||
        canonicalJson(envelope) !== new TextDecoder().decode(bytes)
      ) {
        chunkError("stored chunk envelope conflicts with its receipt");
      }
      const documents = sortedUniqueDocuments(
        envelope.documents as DnaPopulationRaceIndexDocument[],
      );
      if (
        documents[0]?.sourceRaceId !== expected.firstSourceRaceId ||
        documents.at(-1)?.sourceRaceId !== expected.lastSourceRaceId
      ) {
        chunkError("stored chunk race range conflicts with its receipt");
      }
      return documents;
    },

    async write(request) {
      const generation = generationId(request.generationId);
      const chunkOrdinal = positiveInteger(
        request.chunkOrdinal,
        "chunkOrdinal",
        1_000_000,
      );
      const documents = sortedUniqueDocuments(request.documents);
      const firstSourceRaceId = documents[0]!.sourceRaceId;
      const lastSourceRaceId = documents.at(-1)!.sourceRaceId;
      const { canonical, body } = chunkBody({
        generationId: generation,
        chunkOrdinal,
        documents,
      });
      if (
        body.byteLength < 1 ||
        body.byteLength > DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_BYTES
      ) {
        chunkError("chunk exceeds the bounded byte capacity");
      }
      const bodySha256 = sha256(canonical);
      const objectKey = [
        "dna-open-lab",
        "v1",
        prefix,
        "population-race-index",
        "generations",
        generation,
        "chunks",
        `${String(chunkOrdinal).padStart(6, "0")}-${bodySha256}.json`,
      ].join("/");
      const metadata = Object.freeze({
        "dna-source": "dna_open_lab",
        "dna-version": "population-race-index-r2-v1",
        "dna-generation": generation,
        "dna-chunk": String(chunkOrdinal),
        "dna-rows": String(documents.length),
        "dna-first-race": firstSourceRaceId,
        "dna-last-race": lastSourceRaceId,
      });
      await privateStorage();
      const stored = await input.storage.putObjectIfAbsent({
        bucketName,
        key: objectKey,
        body: oneChunk(body),
        contentType: JSON_CONTENT_TYPE,
        byteLength: body.byteLength,
        checksumSha256: bodySha256,
        metadata,
      });
      const head = await input.storage.headObject({
        bucketName,
        key: objectKey,
      });
      if (
        head.status !== "ready" ||
        head.contentType !== JSON_CONTENT_TYPE ||
        head.byteLength !== body.byteLength ||
        head.checksumSha256 !== bodySha256 ||
        Object.entries(metadata).some(
          ([key, value]) => head.metadata[key] !== value,
        )
      ) {
        chunkError("stored chunk conflicts with its deterministic identity");
      }
      return Object.freeze({
        receipt: Object.freeze({
          version: 1 as const,
          generationId: generation,
          chunkOrdinal,
          objectKey,
          bodySha256,
          byteLength: body.byteLength,
          rowCount: documents.length,
          firstSourceRaceId,
          lastSourceRaceId,
        }),
        storageStatus: stored.status,
      });
    },
  });
}
