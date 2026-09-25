import type {
  DnaPopulationEntrantAuthorityCheckpoint,
  DnaPopulationEntrantAuthorityCheckpointAuthority,
  DnaPopulationEntrantAuthorityCheckpointRepository,
} from "./dna-population-entrant-authority-checkpoint";
import { buildDnaPopulationEntrantAuthorityChunk } from "./dna-population-entrant-authority-archive";
import type { DnaPopulationEntrantAuthorityRecord } from "./dna-population-entrant-authority-record";
import {
  recoverDnaPopulationEntrantAuthority,
  type DnaPopulationEntrantAuthorityR2RecoveryPort,
} from "./dna-population-entrant-authority-recovery";
import type {
  DnaPopulationEntrantAuthorityR2ChunkReceipt,
  DnaPopulationEntrantAuthorityR2ChunkWrite,
} from "./dna-population-entrant-authority-r2-store";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;

export type DnaPopulationEntrantAuthorityCapacityApproval = Readonly<{
  version: 1;
  generationId: string;
  unresolvedRaceCount: number;
  unresolvedRaceSetSha256: string;
  observedAt: string;
  capacityAllowed: true;
  paidUsageAllowed: false;
}>;

export type DnaPopulationEntrantAuthorityCapacityGate = Readonly<{
  assertFreshCurrentCapacity: (
    authority: DnaPopulationEntrantAuthorityCheckpointAuthority,
  ) => Promise<DnaPopulationEntrantAuthorityCapacityApproval>;
}>;

export type DnaPopulationEntrantAuthorityR2CommitPort =
  DnaPopulationEntrantAuthorityR2RecoveryPort &
    Readonly<{
      write: (request: {
        generationId: string;
        chunkOrdinal: number;
        records: readonly DnaPopulationEntrantAuthorityRecord[];
      }) => Promise<DnaPopulationEntrantAuthorityR2ChunkWrite>;
    }>;

export type DnaPopulationEntrantAuthorityCommitResult = Readonly<{
  checkpointBefore: DnaPopulationEntrantAuthorityCheckpoint;
  checkpointAfter: DnaPopulationEntrantAuthorityCheckpoint;
  receipt: DnaPopulationEntrantAuthorityR2ChunkReceipt;
  storageStatus: "created" | "existing";
  capacityObservedAt: string;
  providerRequestPerformed: false;
  persistentWritePerformed: true;
  providerWritePerformed: false;
  paidUsageAllowed: false;
}>;

function commitError(message: string): never {
  throw new Error(`Population entrant authority commit: ${message}`);
}

function sha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) {
    commitError(`${field} is invalid`);
  }
  return normalized;
}

function positive(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    commitError(`${field} is invalid`);
  }
  return value;
}

function timestamp(value: string, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    Number.isNaN(Date.parse(value))
  ) {
    commitError(`${field} is invalid`);
  }
  return new Date(value).toISOString();
}

function validateAuthority(
  value: DnaPopulationEntrantAuthorityCheckpointAuthority,
): DnaPopulationEntrantAuthorityCheckpointAuthority {
  const generationId = sha256(value.generationId, "generationId");
  const unresolvedRaceSetSha256 = sha256(
    value.unresolvedRaceSetSha256,
    "unresolvedRaceSetSha256",
  );
  if (value.version !== 1 || generationId !== unresolvedRaceSetSha256) {
    commitError("audited authority binding is invalid");
  }
  return Object.freeze({
    version: 1 as const,
    generationId,
    unresolvedRaceCount: positive(
      value.unresolvedRaceCount,
      "unresolvedRaceCount",
    ),
    unresolvedRaceSetSha256,
  });
}

function validateCapacityApproval(input: {
  authority: DnaPopulationEntrantAuthorityCheckpointAuthority;
  approval: DnaPopulationEntrantAuthorityCapacityApproval;
}): string {
  const observedAt = timestamp(
    input.approval.observedAt,
    "capacity observedAt",
  );
  if (
    input.approval.version !== 1 ||
    input.approval.capacityAllowed !== true ||
    input.approval.paidUsageAllowed !== false ||
    input.approval.generationId !== input.authority.generationId ||
    input.approval.unresolvedRaceCount !==
      input.authority.unresolvedRaceCount ||
    input.approval.unresolvedRaceSetSha256 !==
      input.authority.unresolvedRaceSetSha256
  ) {
    commitError("fresh current capacity approval disagrees with authority");
  }
  return observedAt;
}

function validatePreparedRecords(input: {
  records: readonly DnaPopulationEntrantAuthorityRecord[];
  persistedRaceCount: number;
  unresolvedRaceCount: number;
  resumeAfterSourceRaceId: string | null;
}): void {
  if (
    input.records.length < 1 ||
    input.records.length > input.unresolvedRaceCount - input.persistedRaceCount
  ) {
    commitError("prepared chunk row count is invalid");
  }
  const sourceRaceIds = input.records.map((record) => record.sourceRaceId);
  if (
    sourceRaceIds.some(
      (raceId) =>
        typeof raceId !== "string" ||
        raceId.trim() !== raceId ||
        raceId.length < 1,
    ) ||
    new Set(sourceRaceIds).size !== sourceRaceIds.length
  ) {
    commitError("prepared chunk Race identities are invalid");
  }
  const sorted = [...sourceRaceIds].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  if (
    input.resumeAfterSourceRaceId !== null &&
    sorted[0]! <= input.resumeAfterSourceRaceId
  ) {
    commitError("prepared chunk does not advance the recovered Race boundary");
  }
}

function validateWriteReceipt(input: {
  receipt: DnaPopulationEntrantAuthorityR2ChunkReceipt;
  authority: DnaPopulationEntrantAuthorityCheckpointAuthority;
  chunkOrdinal: number;
  records: readonly DnaPopulationEntrantAuthorityRecord[];
  resumeAfterSourceRaceId: string | null;
}): void {
  const expected = buildDnaPopulationEntrantAuthorityChunk({
    generationId: input.authority.generationId,
    chunkOrdinal: input.chunkOrdinal,
    records: input.records,
  }).receipt;
  if (
    input.receipt.version !== expected.version ||
    input.receipt.generationId !== expected.generationId ||
    input.receipt.chunkOrdinal !== expected.chunkOrdinal ||
    input.receipt.bodySha256 !== expected.bodySha256 ||
    input.receipt.byteLength !== expected.byteLength ||
    input.receipt.rowCount !== expected.rowCount ||
    input.receipt.firstSourceRaceId !== expected.firstSourceRaceId ||
    input.receipt.lastSourceRaceId !== expected.lastSourceRaceId ||
    input.receipt.raceSetSha256 !== expected.raceSetSha256 ||
    input.receipt.recordSetSha256 !== expected.recordSetSha256 ||
    (input.resumeAfterSourceRaceId !== null &&
      input.receipt.firstSourceRaceId <= input.resumeAfterSourceRaceId)
  ) {
    commitError("immutable R2 receipt disagrees with prepared chunk");
  }
}

function validateCheckpointAdvance(input: {
  before: DnaPopulationEntrantAuthorityCheckpoint;
  after: DnaPopulationEntrantAuthorityCheckpoint;
  receipt: DnaPopulationEntrantAuthorityR2ChunkReceipt;
}): void {
  if (
    input.after.version !== input.before.version ||
    input.after.generationId !== input.before.generationId ||
    input.after.unresolvedRaceCount !== input.before.unresolvedRaceCount ||
    input.after.unresolvedRaceSetSha256 !==
      input.before.unresolvedRaceSetSha256 ||
    input.after.chunkCount !== input.before.chunkCount + 1 ||
    input.after.persistedRaceCount !==
      input.before.persistedRaceCount + input.receipt.rowCount ||
    input.after.lastSourceRaceId !== input.receipt.lastSourceRaceId ||
    new Date(input.after.updatedAt).getTime() <
      new Date(input.before.updatedAt).getTime()
  ) {
    commitError(
      "checkpoint did not advance exactly to the immutable R2 receipt",
    );
  }
}

/**
 * Commits one already-prepared compact entrant-authority chunk.
 *
 * The protocol is intentionally strict:
 * 1. recover and verify all existing manifests/R2 objects;
 * 2. require a fresh current zero-cost capacity approval bound to that authority;
 * 3. write and verify the immutable R2 object;
 * 4. only then register the matching Neon manifest/checkpoint.
 *
 * If step 4 is interrupted, replay repeats the deterministic R2 write as an
 * exact idempotent "existing" object before retrying manifest registration.
 *
 * This function does not discover Race IDs, call DNA, create compact records,
 * expose a command/workflow, or enable paid usage. It is a code-level commit
 * primitive for later commissioning only.
 */
export async function commitDnaPopulationEntrantAuthorityChunk(input: {
  ownerId: string;
  authority: DnaPopulationEntrantAuthorityCheckpointAuthority;
  records: readonly DnaPopulationEntrantAuthorityRecord[];
  capacityGate: DnaPopulationEntrantAuthorityCapacityGate;
  checkpointRepository: Pick<
    DnaPopulationEntrantAuthorityCheckpointRepository,
    "read" | "listChunkManifests" | "registerChunk"
  >;
  r2Store: DnaPopulationEntrantAuthorityR2CommitPort;
  registeredAt: string;
}): Promise<DnaPopulationEntrantAuthorityCommitResult> {
  const authority = validateAuthority(input.authority);
  const recovery = await recoverDnaPopulationEntrantAuthority({
    ownerId: input.ownerId,
    authority,
    checkpointRepository: input.checkpointRepository,
    r2Store: input.r2Store,
  });
  if (recovery.complete) {
    commitError("audited entrant authority is already complete");
  }

  validatePreparedRecords({
    records: input.records,
    persistedRaceCount: recovery.recoveredRaceCount,
    unresolvedRaceCount: authority.unresolvedRaceCount,
    resumeAfterSourceRaceId: recovery.resumeAfterSourceRaceId,
  });

  const approval =
    await input.capacityGate.assertFreshCurrentCapacity(authority);
  const capacityObservedAt = validateCapacityApproval({ authority, approval });

  const stored = await input.r2Store.write({
    generationId: authority.generationId,
    chunkOrdinal: recovery.nextChunkOrdinal,
    records: input.records,
  });
  if (
    stored.storageStatus !== "created" &&
    stored.storageStatus !== "existing"
  ) {
    commitError("immutable R2 write returned an invalid status");
  }
  validateWriteReceipt({
    receipt: stored.receipt,
    authority,
    chunkOrdinal: recovery.nextChunkOrdinal,
    records: input.records,
    resumeAfterSourceRaceId: recovery.resumeAfterSourceRaceId,
  });

  const registeredAt = timestamp(input.registeredAt, "registeredAt");
  const checkpointAfter = await input.checkpointRepository.registerChunk(
    input.ownerId,
    {
      generationId: authority.generationId,
      receipt: stored.receipt,
      registeredAt,
    },
  );
  validateCheckpointAdvance({
    before: recovery.checkpoint,
    after: checkpointAfter,
    receipt: stored.receipt,
  });

  return Object.freeze({
    checkpointBefore: recovery.checkpoint,
    checkpointAfter,
    receipt: stored.receipt,
    storageStatus: stored.storageStatus,
    capacityObservedAt,
    providerRequestPerformed: false as const,
    persistentWritePerformed: true as const,
    providerWritePerformed: false as const,
    paidUsageAllowed: false as const,
  });
}
