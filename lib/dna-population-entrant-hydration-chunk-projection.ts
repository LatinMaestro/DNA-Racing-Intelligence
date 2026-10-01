import { DNA_RACE_DOCUMENT_BATCH_LIMIT } from "./dna-open-lab-race-document-hydrator";
import { DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS } from "./dna-open-lab-zero-cost-provider-capacity";
import { DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS } from "./dna-open-lab-zero-cost-refresh-policy";
import {
  DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_BYTES,
  DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS,
} from "./dna-population-race-index-r2-chunk";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const CHUNK_ENVELOPE_BYTES_CEILING = 1_024;
const NEON_GENERATION_BYTES_CEILING = 65_536;
const NEON_BYTES_PER_CHUNK_CEILING = 4_096;
const CLASS_A_OPERATIONS_PER_CHUNK_CEILING = 2;
const CLASS_B_OPERATIONS_PER_CHUNK_CEILING = 4;

export type DnaPopulationEntrantHydrationChunkProjection = Readonly<{
  authority: Readonly<{
    unresolvedRaceCount: number;
    unresolvedRaceSetSha256: string;
    maximumRaceDocumentBytes: number;
  }>;
  chunk: Readonly<{
    maximumBytes: number;
    maximumRows: number;
    projectedRowsPerChunk: number;
    projectedChunkCount: number;
  }>;
  provider: Readonly<{
    minimumRaceDocRequestCount: number;
    aggregateRequestsPerMinuteCeiling: 30;
  }>;
  projected: Readonly<{
    r2StorageBytes: number;
    r2ClassAOperations: number;
    r2ClassBOperations: number;
    neonStorageBytes: number;
  }>;
  projectedUsage: Readonly<{
    r2StorageBytes: number;
    r2ClassAOperations: number;
    r2ClassBOperations: number;
    neonStorageBytes: number;
  }>;
  allowed: boolean;
  blockerIds: readonly (
    | "r2_storage_budget_exhausted"
    | "r2_class_a_budget_exhausted"
    | "r2_class_b_budget_exhausted"
    | "neon_storage_budget_exhausted"
  )[];
  persistentWriteAllowed: false;
  paidUsageAllowed: false;
}>;

function projectionError(message: string): never {
  throw new Error(`Population entrant hydration chunk projection: ${message}`);
}

function positive(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    projectionError(`${field} is invalid`);
  }
  return value;
}

function nonNegative(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    projectionError(`${field} is invalid`);
  }
  return value;
}

function add(left: number, right: number, field: string): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) {
    projectionError(`${field} exceeds safe integer capacity`);
  }
  return value;
}

function multiply(left: number, right: number, field: string): number {
  const value = left * right;
  if (!Number.isSafeInteger(value) || value < 0) {
    projectionError(`${field} exceeds safe integer capacity`);
  }
  return value;
}

function sha256(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) {
    projectionError("unresolved Race set SHA-256 is invalid");
  }
  return normalized;
}

/**
 * Projects a compact immutable historical races.docs archive without writing
 * anything. It deliberately uses the larger of the connected sample maximum
 * and the maximum byte length already verified from durable incremental
 * races.docs evidence.
 *
 * The projection reserves 1 KiB of envelope capacity per chunk, one JSON
 * separator byte per Race, two Class A operations and four Class B operations
 * per chunk, plus a conservative 4 KiB Neon manifest allowance per chunk.
 * These are ceilings for commissioning, not an authorization to persist.
 */
export function projectDnaPopulationEntrantHydrationChunkArchive(input: {
  unresolvedRaceCount: number;
  unresolvedRaceSetSha256: string;
  measuredMaximumCanonicalRaceBytes: number;
  verifiedIncrementalMaximumRaceDocumentBytes: number;
  currentR2StorageBytes: number;
  currentR2ClassAOperations: number;
  currentR2ClassBOperations: number;
  currentNeonStorageBytes: number;
}): DnaPopulationEntrantHydrationChunkProjection {
  const unresolvedRaceCount = positive(
    input.unresolvedRaceCount,
    "unresolved Race count",
  );
  const maximumRaceDocumentBytes = Math.max(
    positive(
      input.measuredMaximumCanonicalRaceBytes,
      "measured maximum Race bytes",
    ),
    positive(
      input.verifiedIncrementalMaximumRaceDocumentBytes,
      "verified incremental maximum Race bytes",
    ),
  );
  const unresolvedRaceSetSha256 = sha256(input.unresolvedRaceSetSha256);
  const currentR2StorageBytes = nonNegative(
    input.currentR2StorageBytes,
    "current R2 storage",
  );
  const currentR2ClassAOperations = nonNegative(
    input.currentR2ClassAOperations,
    "current R2 Class A operations",
  );
  const currentR2ClassBOperations = nonNegative(
    input.currentR2ClassBOperations,
    "current R2 Class B operations",
  );
  const currentNeonStorageBytes = nonNegative(
    input.currentNeonStorageBytes,
    "current Neon storage",
  );

  const perRaceSerializedBytes = add(
    maximumRaceDocumentBytes,
    1,
    "per-Race serialized bytes",
  );
  const availableChunkPayloadBytes =
    DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_BYTES -
    CHUNK_ENVELOPE_BYTES_CEILING;
  const rowsByBytes = Math.floor(
    availableChunkPayloadBytes / perRaceSerializedBytes,
  );
  const projectedRowsPerChunk = Math.min(
    DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS,
    rowsByBytes,
  );
  if (projectedRowsPerChunk < 1) {
    projectionError("one Race document cannot fit the bounded chunk");
  }
  const projectedChunkCount = Math.ceil(
    unresolvedRaceCount / projectedRowsPerChunk,
  );

  const rawRaceBytes = multiply(
    unresolvedRaceCount,
    maximumRaceDocumentBytes,
    "raw Race bytes",
  );
  const separatorBytes = Math.max(0, unresolvedRaceCount - projectedChunkCount);
  const envelopeBytes = multiply(
    projectedChunkCount,
    CHUNK_ENVELOPE_BYTES_CEILING,
    "chunk envelope bytes",
  );
  const r2StorageBytes = add(
    add(rawRaceBytes, separatorBytes, "chunk payload bytes"),
    envelopeBytes,
    "projected R2 storage bytes",
  );
  const r2ClassAOperations = multiply(
    projectedChunkCount,
    CLASS_A_OPERATIONS_PER_CHUNK_CEILING,
    "projected R2 Class A operations",
  );
  const r2ClassBOperations = multiply(
    projectedChunkCount,
    CLASS_B_OPERATIONS_PER_CHUNK_CEILING,
    "projected R2 Class B operations",
  );
  const neonStorageBytes = add(
    NEON_GENERATION_BYTES_CEILING,
    multiply(
      projectedChunkCount,
      NEON_BYTES_PER_CHUNK_CEILING,
      "projected Neon chunk manifest bytes",
    ),
    "projected Neon storage bytes",
  );

  const projectedUsage = Object.freeze({
    r2StorageBytes: add(
      currentR2StorageBytes,
      r2StorageBytes,
      "total projected R2 storage",
    ),
    r2ClassAOperations: add(
      currentR2ClassAOperations,
      r2ClassAOperations,
      "total projected R2 Class A operations",
    ),
    r2ClassBOperations: add(
      currentR2ClassBOperations,
      r2ClassBOperations,
      "total projected R2 Class B operations",
    ),
    neonStorageBytes: add(
      currentNeonStorageBytes,
      neonStorageBytes,
      "total projected Neon storage",
    ),
  });

  const blockerIds: DnaPopulationEntrantHydrationChunkProjection["blockerIds"][number][] =
    [];
  if (
    projectedUsage.r2StorageBytes >
    DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.storageBytes
  ) {
    blockerIds.push("r2_storage_budget_exhausted");
  }
  if (
    projectedUsage.r2ClassAOperations >
    DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.classAOperations
  ) {
    blockerIds.push("r2_class_a_budget_exhausted");
  }
  if (
    projectedUsage.r2ClassBOperations >
    DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.classBOperations
  ) {
    blockerIds.push("r2_class_b_budget_exhausted");
  }
  if (
    projectedUsage.neonStorageBytes >
    DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.storageBytes
  ) {
    blockerIds.push("neon_storage_budget_exhausted");
  }

  return Object.freeze({
    authority: Object.freeze({
      unresolvedRaceCount,
      unresolvedRaceSetSha256,
      maximumRaceDocumentBytes,
    }),
    chunk: Object.freeze({
      maximumBytes: DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_BYTES,
      maximumRows: DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS,
      projectedRowsPerChunk,
      projectedChunkCount,
    }),
    provider: Object.freeze({
      minimumRaceDocRequestCount: Math.ceil(
        unresolvedRaceCount / DNA_RACE_DOCUMENT_BATCH_LIMIT,
      ),
      aggregateRequestsPerMinuteCeiling: 30 as const,
    }),
    projected: Object.freeze({
      r2StorageBytes,
      r2ClassAOperations,
      r2ClassBOperations,
      neonStorageBytes,
    }),
    projectedUsage,
    allowed: blockerIds.length === 0,
    blockerIds: Object.freeze(blockerIds),
    persistentWriteAllowed: false as const,
    paidUsageAllowed: false as const,
  });
}
