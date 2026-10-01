import {
  replayDnaPopulationEntrantAuthorityArchive,
  type DnaPopulationEntrantAuthorityChunk,
  type DnaPopulationEntrantAuthorityChunkReceipt,
} from "./dna-population-entrant-authority-archive";
import type {
  DnaPopulationEntrantAuthoritySuccessorCheckpoint,
  DnaPopulationEntrantAuthoritySuccessorCheckpointAuthority,
  DnaPopulationEntrantAuthoritySuccessorCheckpointRepository,
  DnaPopulationEntrantAuthoritySuccessorChunkManifest,
} from "./dna-population-entrant-authority-successor-checkpoint";
import {
  DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_PUBLICATION_PROOF_VERSION,
  type DnaPopulationEntrantAuthoritySuccessorPublicationProof,
} from "./dna-population-entrant-authority-successor-publication";
import type {
  DnaPopulationEntrantAuthorityR2ChunkReceipt,
  DnaPopulationEntrantAuthorityR2ChunkWrite,
} from "./dna-population-entrant-authority-r2-store";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const MANIFEST_PAGE_LIMIT = 100 as const;

export type DnaPopulationEntrantAuthoritySuccessorCapacityApproval = Readonly<{
  version: 1;
  successorGenerationId: string;
  successorRecordSetSha256: string;
  unresolvedRaceCount: number;
  observedAt: string;
  capacityAllowed: true;
  paidUsageAllowed: false;
}>;

export type DnaPopulationEntrantAuthoritySuccessorCapacityGate = Readonly<{
  assertFreshCurrentCapacity: (
    authority: DnaPopulationEntrantAuthoritySuccessorCheckpointAuthority,
  ) => Promise<DnaPopulationEntrantAuthoritySuccessorCapacityApproval>;
}>;

export type DnaPopulationEntrantAuthoritySuccessorR2CommitPort = Readonly<{
  write: (request: {
    generationId: string;
    chunkOrdinal: number;
    records: DnaPopulationEntrantAuthorityChunk["records"];
  }) => Promise<DnaPopulationEntrantAuthorityR2ChunkWrite>;
  verify: (
    receipt: DnaPopulationEntrantAuthorityR2ChunkReceipt,
  ) => Promise<void>;
}>;

export type DnaPopulationEntrantAuthoritySuccessorCommitResult = Readonly<{
  checkpointBefore: DnaPopulationEntrantAuthoritySuccessorCheckpoint;
  checkpointAfter: DnaPopulationEntrantAuthoritySuccessorCheckpoint;
  receipts: readonly DnaPopulationEntrantAuthorityR2ChunkReceipt[];
  storageStatuses: readonly ("created" | "existing")[];
  capacityObservedAt: string;
  resumedRegisteredChunkCount: number;
  providerRequestPerformed: false;
  persistentWritePerformed: true;
  providerWritePerformed: false;
  publicationActivated: false;
  lastGoodBasePreserved: true;
  paidUsageAllowed: false;
}>;

function commitError(message: string): never {
  throw new Error(`Population entrant authority successor commit: ${message}`);
}

function sha256(value: unknown, field: string): string {
  if (typeof value !== "string" || !SHA_256_PATTERN.test(value)) {
    commitError(`${field} is invalid`);
  }
  return value;
}

function count(value: unknown, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    commitError(`${field} is invalid`);
  }
  return value as number;
}

function timestamp(value: unknown, field: string): string {
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
  value: DnaPopulationEntrantAuthoritySuccessorCheckpointAuthority,
): DnaPopulationEntrantAuthoritySuccessorCheckpointAuthority {
  const authority = Object.freeze({
    version: value.version,
    baseGenerationId: sha256(value.baseGenerationId, "baseGenerationId"),
    baseRecordSetSha256: sha256(
      value.baseRecordSetSha256,
      "baseRecordSetSha256",
    ),
    successorGenerationId: sha256(
      value.successorGenerationId,
      "successorGenerationId",
    ),
    successorRecordSetSha256: sha256(
      value.successorRecordSetSha256,
      "successorRecordSetSha256",
    ),
    unresolvedRaceCount: count(
      value.unresolvedRaceCount,
      "unresolvedRaceCount",
      1,
    ),
    unresolvedRaceSetSha256: sha256(
      value.unresolvedRaceSetSha256,
      "unresolvedRaceSetSha256",
    ),
    replacementRaceCount: count(
      value.replacementRaceCount,
      "replacementRaceCount",
      1,
    ),
    replacementRaceSetSha256: sha256(
      value.replacementRaceSetSha256,
      "replacementRaceSetSha256",
    ),
    replacementRecordSetSha256: sha256(
      value.replacementRecordSetSha256,
      "replacementRecordSetSha256",
    ),
    quarantinedRaceCountBefore: count(
      value.quarantinedRaceCountBefore,
      "quarantinedRaceCountBefore",
      1,
    ),
    quarantinedRaceCountAfter: count(
      value.quarantinedRaceCountAfter,
      "quarantinedRaceCountAfter",
    ),
  });
  if (
    authority.version !==
      "dna-population-entrant-authority-successor-checkpoint/v1" ||
    authority.baseGenerationId !== authority.unresolvedRaceSetSha256 ||
    authority.successorGenerationId === authority.baseGenerationId ||
    authority.replacementRaceCount > authority.unresolvedRaceCount ||
    authority.quarantinedRaceCountBefore > authority.unresolvedRaceCount ||
    authority.quarantinedRaceCountAfter >=
      authority.quarantinedRaceCountBefore ||
    authority.quarantinedRaceCountBefore -
      authority.quarantinedRaceCountAfter !==
      authority.replacementRaceCount
  ) {
    commitError("successor checkpoint authority is inconsistent");
  }
  return authority;
}

function sameAuthority(
  checkpoint: DnaPopulationEntrantAuthoritySuccessorCheckpoint,
  authority: DnaPopulationEntrantAuthoritySuccessorCheckpointAuthority,
): boolean {
  return (
    checkpoint.version === authority.version &&
    checkpoint.baseGenerationId === authority.baseGenerationId &&
    checkpoint.baseRecordSetSha256 === authority.baseRecordSetSha256 &&
    checkpoint.successorGenerationId === authority.successorGenerationId &&
    checkpoint.successorRecordSetSha256 ===
      authority.successorRecordSetSha256 &&
    checkpoint.unresolvedRaceCount === authority.unresolvedRaceCount &&
    checkpoint.unresolvedRaceSetSha256 === authority.unresolvedRaceSetSha256 &&
    checkpoint.replacementRaceCount === authority.replacementRaceCount &&
    checkpoint.replacementRaceSetSha256 ===
      authority.replacementRaceSetSha256 &&
    checkpoint.replacementRecordSetSha256 ===
      authority.replacementRecordSetSha256 &&
    checkpoint.quarantinedRaceCountBefore ===
      authority.quarantinedRaceCountBefore &&
    checkpoint.quarantinedRaceCountAfter === authority.quarantinedRaceCountAfter
  );
}

function sameReceipt(
  left: DnaPopulationEntrantAuthorityChunkReceipt,
  right: DnaPopulationEntrantAuthorityChunkReceipt,
): boolean {
  return (
    left.version === right.version &&
    left.generationId === right.generationId &&
    left.chunkOrdinal === right.chunkOrdinal &&
    left.bodySha256 === right.bodySha256 &&
    left.byteLength === right.byteLength &&
    left.rowCount === right.rowCount &&
    left.firstSourceRaceId === right.firstSourceRaceId &&
    left.lastSourceRaceId === right.lastSourceRaceId &&
    left.raceSetSha256 === right.raceSetSha256 &&
    left.recordSetSha256 === right.recordSetSha256
  );
}

function sameR2Receipt(
  left: DnaPopulationEntrantAuthorityR2ChunkReceipt,
  right: DnaPopulationEntrantAuthorityR2ChunkReceipt,
): boolean {
  return sameReceipt(left, right) && left.objectKey === right.objectKey;
}

function validateR2Receipt(
  receipt: DnaPopulationEntrantAuthorityR2ChunkReceipt,
): void {
  if (
    typeof receipt.objectKey !== "string" ||
    receipt.objectKey.trim() !== receipt.objectKey ||
    receipt.objectKey.length < 1 ||
    receipt.objectKey.length > 2048 ||
    CONTROL_PATTERN.test(receipt.objectKey)
  ) {
    commitError("immutable R2 receipt object key is invalid");
  }
}

function validatePublication(input: {
  authority: DnaPopulationEntrantAuthoritySuccessorCheckpointAuthority;
  proof: DnaPopulationEntrantAuthoritySuccessorPublicationProof;
  chunks: readonly DnaPopulationEntrantAuthorityChunk[];
}): void {
  const archive = replayDnaPopulationEntrantAuthorityArchive({
    generationId: input.authority.successorGenerationId,
    expectedUnresolvedRaceCount: input.authority.unresolvedRaceCount,
    expectedUnresolvedRaceSetSha256: input.authority.unresolvedRaceSetSha256,
    chunks: input.chunks,
  });
  const proof = input.proof;
  if (
    proof.version !==
      DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_PUBLICATION_PROOF_VERSION ||
    proof.baseGenerationId !== input.authority.baseGenerationId ||
    proof.baseRecordSetSha256 !== input.authority.baseRecordSetSha256 ||
    proof.successorGenerationId !== input.authority.successorGenerationId ||
    proof.successorRecordSetSha256 !==
      input.authority.successorRecordSetSha256 ||
    proof.unresolvedRaceCount !== input.authority.unresolvedRaceCount ||
    proof.unresolvedRaceSetSha256 !== input.authority.unresolvedRaceSetSha256 ||
    proof.replacementRaceCount !== input.authority.replacementRaceCount ||
    proof.replacementRaceSetSha256 !==
      input.authority.replacementRaceSetSha256 ||
    proof.replacementRecordSetSha256 !==
      input.authority.replacementRecordSetSha256 ||
    proof.quarantinedRaceCountBefore !==
      input.authority.quarantinedRaceCountBefore ||
    proof.quarantinedRaceCountAfter !==
      input.authority.quarantinedRaceCountAfter ||
    proof.chunkCount !== input.chunks.length ||
    proof.archiveRecordSetSha256 !== archive.archiveRecordSetSha256 ||
    archive.replay.recordSetSha256 !==
      input.authority.successorRecordSetSha256 ||
    archive.quarantinedRaceCount !==
      input.authority.quarantinedRaceCountAfter ||
    proof.publicationIntegrityStatus !== "proven_immutable_successor_archive" ||
    proof.lastGoodBasePreserved !== true ||
    proof.providerRequestPerformed !== false ||
    proof.persistentWritePerformed !== false ||
    proof.publicationAllowed !== false ||
    proof.paidUsageAllowed !== false
  ) {
    commitError("publication proof disagrees with successor authority");
  }
}

function validateCapacityApproval(input: {
  authority: DnaPopulationEntrantAuthoritySuccessorCheckpointAuthority;
  approval: DnaPopulationEntrantAuthoritySuccessorCapacityApproval;
}): string {
  const observedAt = timestamp(
    input.approval.observedAt,
    "capacity observedAt",
  );
  if (
    input.approval.version !== 1 ||
    input.approval.successorGenerationId !==
      input.authority.successorGenerationId ||
    input.approval.successorRecordSetSha256 !==
      input.authority.successorRecordSetSha256 ||
    input.approval.unresolvedRaceCount !==
      input.authority.unresolvedRaceCount ||
    input.approval.capacityAllowed !== true ||
    input.approval.paidUsageAllowed !== false
  ) {
    commitError("fresh current capacity approval disagrees with successor");
  }
  return observedAt;
}

function validateCheckpoint(input: {
  checkpoint: DnaPopulationEntrantAuthoritySuccessorCheckpoint;
  authority: DnaPopulationEntrantAuthoritySuccessorCheckpointAuthority;
  expectedReceipts: readonly DnaPopulationEntrantAuthorityR2ChunkReceipt[];
}): void {
  const { checkpoint, authority, expectedReceipts } = input;
  const expectedRows = expectedReceipts.reduce(
    (total, receipt) => total + receipt.rowCount,
    0,
  );
  if (
    !sameAuthority(checkpoint, authority) ||
    checkpoint.chunkCount !== expectedReceipts.length ||
    checkpoint.persistedRaceCount !== expectedRows ||
    checkpoint.lastSourceRaceId !==
      (expectedReceipts.at(-1)?.lastSourceRaceId ?? null) ||
    Number.isNaN(Date.parse(checkpoint.startedAt)) ||
    Number.isNaN(Date.parse(checkpoint.updatedAt)) ||
    Date.parse(checkpoint.updatedAt) < Date.parse(checkpoint.startedAt)
  ) {
    commitError("successor checkpoint disagrees with registered receipts");
  }
}

async function listManifests(input: {
  ownerId: string;
  successorGenerationId: string;
  chunkCount: number;
  repository: Pick<
    DnaPopulationEntrantAuthoritySuccessorCheckpointRepository,
    "listChunkManifests"
  >;
}): Promise<readonly DnaPopulationEntrantAuthoritySuccessorChunkManifest[]> {
  const manifests: DnaPopulationEntrantAuthoritySuccessorChunkManifest[] = [];
  while (manifests.length < input.chunkCount) {
    const page = await input.repository.listChunkManifests(input.ownerId, {
      successorGenerationId: input.successorGenerationId,
      afterChunkOrdinal: manifests.at(-1)?.chunkOrdinal ?? 0,
      limit: MANIFEST_PAGE_LIMIT,
    });
    if (
      page.length < 1 ||
      page.length > MANIFEST_PAGE_LIMIT ||
      manifests.length + page.length > input.chunkCount
    ) {
      commitError("successor manifest pagination is invalid");
    }
    for (const manifest of page) {
      if (manifest.chunkOrdinal !== manifests.length + 1) {
        commitError("successor manifests are not contiguous");
      }
      manifests.push(manifest);
    }
  }
  return Object.freeze(manifests);
}

/**
 * Commits one independently proven, complete successor archive.
 *
 * Every deterministic object is written and re-opened in private R2 before
 * the successor generation or any receipt is recorded in Neon. An interrupted
 * Neon phase is restart-safe: replay reuses the exact content-addressed R2
 * objects, verifies the already-registered manifest prefix, and continues with
 * only the next receipt. The function never calls DNA, changes the active
 * last-good generation, enables paid use, or exposes a connected command.
 */
export async function commitDnaPopulationEntrantAuthoritySuccessor(input: {
  ownerId: string;
  authority: DnaPopulationEntrantAuthoritySuccessorCheckpointAuthority;
  publicationProof: DnaPopulationEntrantAuthoritySuccessorPublicationProof;
  successorChunks: readonly DnaPopulationEntrantAuthorityChunk[];
  capacityGate: DnaPopulationEntrantAuthoritySuccessorCapacityGate;
  checkpointRepository: DnaPopulationEntrantAuthoritySuccessorCheckpointRepository;
  r2Store: DnaPopulationEntrantAuthoritySuccessorR2CommitPort;
  startedAt: string;
  registeredAt: string;
}): Promise<DnaPopulationEntrantAuthoritySuccessorCommitResult> {
  if (
    typeof input.ownerId !== "string" ||
    input.ownerId.trim() !== input.ownerId ||
    input.ownerId.length < 1
  ) {
    commitError("ownerId is invalid");
  }
  const authority = validateAuthority(input.authority);
  validatePublication({
    authority,
    proof: input.publicationProof,
    chunks: input.successorChunks,
  });
  const startedAt = timestamp(input.startedAt, "startedAt");
  const registeredAt = timestamp(input.registeredAt, "registeredAt");
  if (Date.parse(registeredAt) < Date.parse(startedAt)) {
    commitError("registeredAt precedes startedAt");
  }

  const approval =
    await input.capacityGate.assertFreshCurrentCapacity(authority);
  const capacityObservedAt = validateCapacityApproval({ authority, approval });

  const receipts: DnaPopulationEntrantAuthorityR2ChunkReceipt[] = [];
  const storageStatuses: ("created" | "existing")[] = [];
  for (const chunk of input.successorChunks) {
    const stored = await input.r2Store.write({
      generationId: authority.successorGenerationId,
      chunkOrdinal: chunk.receipt.chunkOrdinal,
      records: chunk.records,
    });
    if (
      (stored.storageStatus !== "created" &&
        stored.storageStatus !== "existing") ||
      !sameReceipt(stored.receipt, chunk.receipt)
    ) {
      commitError("immutable R2 receipt disagrees with successor archive");
    }
    validateR2Receipt(stored.receipt);
    await input.r2Store.verify(stored.receipt);
    receipts.push(stored.receipt);
    storageStatuses.push(stored.storageStatus);
  }

  const checkpointBefore = await input.checkpointRepository.begin(
    input.ownerId,
    { authority, startedAt },
  );
  const existingManifests = await listManifests({
    ownerId: input.ownerId,
    successorGenerationId: authority.successorGenerationId,
    chunkCount: checkpointBefore.chunkCount,
    repository: input.checkpointRepository,
  });
  if (
    existingManifests.some(
      (manifest, index) =>
        receipts[index] === undefined ||
        !sameR2Receipt(manifest, receipts[index]!),
    )
  ) {
    commitError("durable successor manifest prefix disagrees with R2");
  }
  validateCheckpoint({
    checkpoint: checkpointBefore,
    authority,
    expectedReceipts: receipts.slice(0, existingManifests.length),
  });

  let checkpointAfter = checkpointBefore;
  for (const receipt of receipts.slice(existingManifests.length)) {
    checkpointAfter = await input.checkpointRepository.registerChunk(
      input.ownerId,
      {
        successorGenerationId: authority.successorGenerationId,
        receipt,
        registeredAt,
      },
    );
    validateCheckpoint({
      checkpoint: checkpointAfter,
      authority,
      expectedReceipts: receipts.slice(0, receipt.chunkOrdinal),
    });
  }
  if (
    checkpointAfter.chunkCount !== input.publicationProof.chunkCount ||
    checkpointAfter.persistedRaceCount !== authority.unresolvedRaceCount ||
    checkpointAfter.lastSourceRaceId !== receipts.at(-1)!.lastSourceRaceId
  ) {
    commitError("durable successor coverage is incomplete");
  }

  const finalManifests = await listManifests({
    ownerId: input.ownerId,
    successorGenerationId: authority.successorGenerationId,
    chunkCount: checkpointAfter.chunkCount,
    repository: input.checkpointRepository,
  });
  if (
    finalManifests.length !== receipts.length ||
    finalManifests.some(
      (manifest, index) => !sameR2Receipt(manifest, receipts[index]!),
    )
  ) {
    commitError("final durable successor manifests disagree with R2");
  }

  return Object.freeze({
    checkpointBefore,
    checkpointAfter,
    receipts: Object.freeze(receipts),
    storageStatuses: Object.freeze(storageStatuses),
    capacityObservedAt,
    resumedRegisteredChunkCount: existingManifests.length,
    providerRequestPerformed: false as const,
    persistentWritePerformed: true as const,
    providerWritePerformed: false as const,
    publicationActivated: false as const,
    lastGoodBasePreserved: true as const,
    paidUsageAllowed: false as const,
  });
}
