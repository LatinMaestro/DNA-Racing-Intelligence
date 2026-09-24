import { createHash } from "node:crypto";

import type {
  DnaPopulationRaceIndexDocument,
  DnaPopulationRaceIndexReceiptBatch,
} from "./dna-population-race-index-checkpoint";
import type { DnaPopulationRaceIndexR2ChunkReceipt } from "./dna-population-race-index-r2-chunk";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export const DNA_POPULATION_RACE_INDEX_MAXIMUM_RECEIPTS_PER_WRITE = 100;
export const DNA_POPULATION_RACE_INDEX_MAXIMUM_DOCUMENTS_PER_WRITE = 5_000;
export const DNA_POPULATION_RACE_INDEX_MAXIMUM_WRITE_BYTES = 8 * 1024 * 1024;

export type DnaPopulationRaceIndexAuthority = Readonly<{
  version: 1;
  generationId: string;
  baselineCompletionSha256: string;
  baselineLogicalRequestCount: number;
  baselineRetainedR2Bytes: number;
  baselineOmittedIdentityObservationCount: number;
}>;

export type DnaPopulationRaceIndexCheckpoint = DnaPopulationRaceIndexAuthority &
  Readonly<{
    state: "staging" | "complete" | "published";
    lastRequestOrdinal: number;
    processedReceiptCount: number;
    processedReceiptBytes: number;
    processedIdentityOmissionCount: number;
    finishedRaceReceiptCount: number;
    canonicalDocumentObservationCount: number;
    uniqueRaceCount: number;
    uniqueEntrantCoreCount: number;
    storageLayout: "legacy_neon_v1" | "r2_chunked_v1";
    r2ChunkCount: number;
    r2IdentityChunkCount: number;
    r2CompactedRaceCount: number;
    r2LastSourceRaceId: string | null;
    compactedAt: string | null;
    legacyStorageRetiredAt: string | null;
    updatedAt: string;
    completedAt: string | null;
    publishedAt: string | null;
  }>;

export type DnaPopulationRaceIndexWriteBatch = Readonly<{
  version: 1;
  generationId: string;
  batchSha256: string;
  afterRequestOrdinal: number;
  nextRequestOrdinal: number;
  processedReceiptCount: number;
  processedReceiptBytes: number;
  processedIdentityOmissionCount: number;
  finishedRaceReceiptCount: number;
  canonicalDocumentObservationCount: number;
  documents: readonly DnaPopulationRaceIndexDocument[];
  complete: boolean;
}>;

export type DnaPopulationRaceIndexCompactIdentity = Readonly<{
  sourceRaceId: string;
  rawEvidenceSha256: string;
}>;

export type DnaPopulationRaceIndexR2ChunkManifest =
  DnaPopulationRaceIndexR2ChunkReceipt &
    Readonly<{
      registeredAt: string;
      identityRegisteredAt: string | null;
    }>;

export type DnaPopulationRaceIndexLegacyChunk = Readonly<{
  documents: readonly DnaPopulationRaceIndexDocument[];
}>;

export type DnaPopulationRaceIndexGenerationRepository = Readonly<{
  begin: (
    ownerId: string,
    request: Readonly<{
      workerId: string;
      authority: DnaPopulationRaceIndexAuthority;
      startedAt: string;
    }>,
  ) => Promise<DnaPopulationRaceIndexCheckpoint>;
  readLegacyChunk: (
    ownerId: string,
    request: Readonly<{
      generationId: string;
      afterSourceRaceId: string | null;
      limit: number;
    }>,
  ) => Promise<DnaPopulationRaceIndexLegacyChunk>;
  registerCompactionChunk: (
    ownerId: string,
    request: Readonly<{
      workerId: string;
      generationId: string;
      receipt: DnaPopulationRaceIndexR2ChunkReceipt;
      identities: readonly DnaPopulationRaceIndexCompactIdentity[];
      registeredAt: string;
    }>,
  ) => Promise<DnaPopulationRaceIndexCheckpoint>;
  finalizeCompaction: (
    ownerId: string,
    request: Readonly<{
      workerId: string;
      generationId: string;
      compactedAt: string;
    }>,
  ) => Promise<DnaPopulationRaceIndexCheckpoint>;
  listR2ChunkManifests: (
    ownerId: string,
    request: Readonly<{
      generationId: string;
      afterChunkOrdinal: number;
      limit: number;
    }>,
  ) => Promise<readonly DnaPopulationRaceIndexR2ChunkManifest[]>;
  listPublishedR2ChunkManifests: (
    ownerId: string,
    request: Readonly<{
      generationId: string;
      afterChunkOrdinal: number;
      limit: number;
    }>,
  ) => Promise<readonly DnaPopulationRaceIndexR2ChunkManifest[]>;
  registerCompactIdentityChunk: (
    ownerId: string,
    request: Readonly<{
      workerId: string;
      generationId: string;
      chunkOrdinal: number;
      identities: readonly DnaPopulationRaceIndexCompactIdentity[];
      registeredAt: string;
    }>,
  ) => Promise<DnaPopulationRaceIndexCheckpoint>;
  lookupIdentities: (
    ownerId: string,
    request: Readonly<{
      generationId: string;
      sourceRaceIds: readonly string[];
    }>,
  ) => Promise<readonly DnaPopulationRaceIndexCompactIdentity[]>;
  appendR2Batch: (
    ownerId: string,
    request: Readonly<{
      workerId: string;
      batch: DnaPopulationRaceIndexWriteBatch;
      newIdentities: readonly DnaPopulationRaceIndexCompactIdentity[];
      chunk: DnaPopulationRaceIndexR2ChunkReceipt | null;
      writtenAt: string;
    }>,
  ) => Promise<DnaPopulationRaceIndexCheckpoint>;
  publish: (
    ownerId: string,
    request: Readonly<{
      workerId: string;
      generationId: string;
      publishedAt: string;
    }>,
  ) => Promise<DnaPopulationRaceIndexCheckpoint>;
  load: (
    ownerId: string,
    generationId: string,
  ) => Promise<DnaPopulationRaceIndexCheckpoint | null>;
}>;

function generationError(message: string): never {
  throw new Error(`DNA population race index generation: ${message}`);
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    generationError(`${field} is invalid`);
  }
  return Number(value);
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = nonNegativeInteger(value, field);
  if (parsed < 1) generationError(`${field} is invalid`);
  return parsed;
}

function sha256(value: unknown, field: string): string {
  if (typeof value !== "string" || !SHA_256_PATTERN.test(value)) {
    generationError(`${field} is invalid`);
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) generationError("canonical value is invalid");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value !== "object") generationError("canonical value is invalid");
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function validateDocument(
  document: DnaPopulationRaceIndexDocument,
  afterRequestOrdinal: number,
  nextRequestOrdinal: number,
): void {
  const requestOrdinal = positiveInteger(
    document.requestOrdinal,
    "document.requestOrdinal",
  );
  if (
    requestOrdinal <= afterRequestOrdinal ||
    requestOrdinal >= nextRequestOrdinal ||
    (document.endpoint !== "races.finished" &&
      document.endpoint !== "races.docs") ||
    typeof document.observedAt !== "string" ||
    Number.isNaN(new Date(document.observedAt).getTime()) ||
    typeof document.sourceRaceId !== "string" ||
    document.sourceRaceId.trim() !== document.sourceRaceId ||
    document.sourceRaceId === "" ||
    CONTROL_PATTERN.test(document.sourceRaceId) ||
    document.canonical.sourceType !== "race_document" ||
    document.canonical.sourceRaceId !== document.sourceRaceId
  ) {
    generationError("document authority is invalid");
  }
  sha256(document.rawEvidenceSha256, "document.rawEvidenceSha256");
}

export function createDnaPopulationRaceIndexAuthority(input: {
  baselineCompletionSha256: string;
  baselineLogicalRequestCount: number;
  baselineRetainedR2Bytes: number;
  baselineOmittedIdentityObservationCount: number;
}): DnaPopulationRaceIndexAuthority {
  const completionSha256 = sha256(
    input.baselineCompletionSha256,
    "baselineCompletionSha256",
  );
  return Object.freeze({
    version: 1,
    generationId: completionSha256,
    baselineCompletionSha256: completionSha256,
    baselineLogicalRequestCount: positiveInteger(
      input.baselineLogicalRequestCount,
      "baselineLogicalRequestCount",
    ),
    baselineRetainedR2Bytes: positiveInteger(
      input.baselineRetainedR2Bytes,
      "baselineRetainedR2Bytes",
    ),
    baselineOmittedIdentityObservationCount: nonNegativeInteger(
      input.baselineOmittedIdentityObservationCount,
      "baselineOmittedIdentityObservationCount",
    ),
  });
}

export function createDnaPopulationRaceIndexWriteBatch(
  input: DnaPopulationRaceIndexReceiptBatch,
): DnaPopulationRaceIndexWriteBatch {
  const generationId = sha256(
    input.baselineCompletionSha256,
    "baselineCompletionSha256",
  );
  const afterRequestOrdinal = nonNegativeInteger(
    input.afterRequestOrdinal,
    "afterRequestOrdinal",
  );
  const nextRequestOrdinal = positiveInteger(
    input.nextRequestOrdinal,
    "nextRequestOrdinal",
  );
  const processedReceiptCount = positiveInteger(
    input.processedReceiptCount,
    "processedReceiptCount",
  );
  if (
    processedReceiptCount >
      DNA_POPULATION_RACE_INDEX_MAXIMUM_RECEIPTS_PER_WRITE ||
    nextRequestOrdinal !== afterRequestOrdinal + processedReceiptCount + 1 ||
    input.documents.length >
      DNA_POPULATION_RACE_INDEX_MAXIMUM_DOCUMENTS_PER_WRITE ||
    input.canonicalDocumentObservationCount !== input.documents.length
  ) {
    generationError("batch bounds are invalid");
  }
  for (const document of input.documents) {
    validateDocument(document, afterRequestOrdinal, nextRequestOrdinal);
  }
  const batchWithoutSha = {
    version: 1 as const,
    generationId,
    afterRequestOrdinal,
    nextRequestOrdinal,
    processedReceiptCount,
    processedReceiptBytes: positiveInteger(
      input.processedReceiptBytes,
      "processedReceiptBytes",
    ),
    processedIdentityOmissionCount: nonNegativeInteger(
      input.processedIdentityOmissionCount,
      "processedIdentityOmissionCount",
    ),
    finishedRaceReceiptCount: nonNegativeInteger(
      input.finishedRaceReceiptCount,
      "finishedRaceReceiptCount",
    ),
    canonicalDocumentObservationCount: nonNegativeInteger(
      input.canonicalDocumentObservationCount,
      "canonicalDocumentObservationCount",
    ),
    documents: input.documents,
    complete: input.complete,
  };
  const canonical = canonicalJson(batchWithoutSha);
  if (
    Buffer.byteLength(canonical, "utf8") >
    DNA_POPULATION_RACE_INDEX_MAXIMUM_WRITE_BYTES
  ) {
    generationError("batch payload is too large");
  }
  return Object.freeze({
    ...batchWithoutSha,
    batchSha256: createHash("sha256").update(canonical, "utf8").digest("hex"),
    documents: Object.freeze([...input.documents]),
  });
}
export type DnaPopulationRaceIndexR2AppendPlan = Readonly<{
  newDocuments: readonly DnaPopulationRaceIndexDocument[];
  newIdentities: readonly DnaPopulationRaceIndexCompactIdentity[];
}>;

export function createDnaPopulationRaceIndexR2AppendPlan(input: {
  batch: DnaPopulationRaceIndexWriteBatch;
  existingIdentities: readonly DnaPopulationRaceIndexCompactIdentity[];
}): DnaPopulationRaceIndexR2AppendPlan {
  const existing = new Map<string, string>();
  for (const identity of input.existingIdentities) {
    if (
      typeof identity.sourceRaceId !== "string" ||
      identity.sourceRaceId.trim() !== identity.sourceRaceId ||
      identity.sourceRaceId.length < 1 ||
      CONTROL_PATTERN.test(identity.sourceRaceId) ||
      !SHA_256_PATTERN.test(identity.rawEvidenceSha256) ||
      existing.has(identity.sourceRaceId)
    ) {
      generationError("existing compact race identity is invalid");
    }
    existing.set(identity.sourceRaceId, identity.rawEvidenceSha256);
  }

  const latest = new Map<string, DnaPopulationRaceIndexDocument>();
  for (const document of input.batch.documents) {
    validateDocument(
      document,
      input.batch.afterRequestOrdinal,
      input.batch.nextRequestOrdinal,
    );
    const prior = latest.get(document.sourceRaceId);
    if (prior !== undefined) {
      if (prior.rawEvidenceSha256 !== document.rawEvidenceSha256) {
        generationError("race evidence drifted within one immutable batch");
      }
      if (document.requestOrdinal > prior.requestOrdinal) {
        latest.set(document.sourceRaceId, document);
      }
      continue;
    }
    latest.set(document.sourceRaceId, document);
  }

  const newDocuments: DnaPopulationRaceIndexDocument[] = [];
  const newIdentities: DnaPopulationRaceIndexCompactIdentity[] = [];
  for (const document of latest.values()) {
    const retained = existing.get(document.sourceRaceId);
    if (retained !== undefined) {
      if (retained !== document.rawEvidenceSha256) {
        generationError("race evidence drifted from durable compact identity");
      }
      continue;
    }
    newDocuments.push(document);
    newIdentities.push(
      Object.freeze({
        sourceRaceId: document.sourceRaceId,
        rawEvidenceSha256: document.rawEvidenceSha256,
      }),
    );
  }

  return Object.freeze({
    newDocuments: Object.freeze(newDocuments),
    newIdentities: Object.freeze(newIdentities),
  });
}
