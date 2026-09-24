import { createHash } from "node:crypto";

import type { DnaPopulationRaceIndexDocument } from "./dna-population-race-index-checkpoint";
import type { PrivateDatasetEvidenceObjectStoragePort } from "./private-dataset-evidence-object-writer";

const JSON_CONTENT_TYPE = "application/json";
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export const DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_BYTES =
  8 * 1024 * 1024;
export const DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS = 5_000;

export type DnaPopulationRaceIndexR2ChunkStoragePort = Pick<
  PrivateDatasetEvidenceObjectStoragePort,
  "readBucketPrivacy" | "putObjectIfAbsent" | "headObject"
>;

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
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) chunkError("body contains a non-finite number");
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

function positiveInteger(value: number, field: string, maximum: number): number {
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
      const canonical = canonicalJson({
        version: 1,
        source: "dna_open_lab",
        sourceVersion: "population-race-index-r2-v1",
        generationId: generation,
        chunkOrdinal,
        documents,
      });
      const body = new TextEncoder().encode(canonical);
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
