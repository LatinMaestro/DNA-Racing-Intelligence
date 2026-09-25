import type {
  DnaPopulationEntrantAuthorityCheckpoint,
  DnaPopulationEntrantAuthorityCheckpointAuthority,
  DnaPopulationEntrantAuthorityCheckpointRepository,
  DnaPopulationEntrantAuthorityChunkManifest,
} from "./dna-population-entrant-authority-checkpoint";
import type {
  DnaPopulationEntrantAuthorityChunk,
  DnaPopulationEntrantAuthorityChunkReceipt,
} from "./dna-population-entrant-authority-archive";
import type { DnaPopulationEntrantAuthorityR2ChunkReceipt } from "./dna-population-entrant-authority-r2-store";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const MANIFEST_PAGE_LIMIT = 100 as const;

export type DnaPopulationEntrantAuthorityR2RecoveryPort = Readonly<{
  read: (
    receipt: DnaPopulationEntrantAuthorityR2ChunkReceipt,
  ) => Promise<DnaPopulationEntrantAuthorityChunk>;
}>;

export type DnaPopulationEntrantAuthorityRecovery = Readonly<{
  authority: DnaPopulationEntrantAuthorityCheckpointAuthority;
  checkpoint: DnaPopulationEntrantAuthorityCheckpoint;
  manifests: readonly DnaPopulationEntrantAuthorityChunkManifest[];
  recoveredChunkCount: number;
  recoveredRaceCount: number;
  nextChunkOrdinal: number;
  resumeAfterSourceRaceId: string | null;
  complete: boolean;
  providerRequestPerformed: false;
  persistentWritePerformed: false;
  paidUsageAllowed: false;
}>;

function recoveryError(message: string): never {
  throw new Error(`Population entrant authority recovery: ${message}`);
}

function sha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) {
    recoveryError(`${field} is invalid`);
  }
  return normalized;
}

function positive(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    recoveryError(`${field} is invalid`);
  }
  return value;
}

function authority(
  value: DnaPopulationEntrantAuthorityCheckpointAuthority,
): DnaPopulationEntrantAuthorityCheckpointAuthority {
  const generationId = sha256(value.generationId, "generationId");
  const unresolvedRaceSetSha256 = sha256(
    value.unresolvedRaceSetSha256,
    "unresolvedRaceSetSha256",
  );
  if (value.version !== 1 || generationId !== unresolvedRaceSetSha256) {
    recoveryError("authority binding is invalid");
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

function sameAuthority(
  checkpoint: DnaPopulationEntrantAuthorityCheckpoint,
  expected: DnaPopulationEntrantAuthorityCheckpointAuthority,
): boolean {
  return (
    checkpoint.version === expected.version &&
    checkpoint.generationId === expected.generationId &&
    checkpoint.unresolvedRaceCount === expected.unresolvedRaceCount &&
    checkpoint.unresolvedRaceSetSha256 === expected.unresolvedRaceSetSha256
  );
}

function sameReceipt(
  stored: DnaPopulationEntrantAuthorityChunkReceipt,
  manifest: DnaPopulationEntrantAuthorityChunkManifest,
): boolean {
  return (
    stored.version === manifest.version &&
    stored.generationId === manifest.generationId &&
    stored.chunkOrdinal === manifest.chunkOrdinal &&
    stored.bodySha256 === manifest.bodySha256 &&
    stored.byteLength === manifest.byteLength &&
    stored.rowCount === manifest.rowCount &&
    stored.firstSourceRaceId === manifest.firstSourceRaceId &&
    stored.lastSourceRaceId === manifest.lastSourceRaceId &&
    stored.raceSetSha256 === manifest.raceSetSha256 &&
    stored.recordSetSha256 === manifest.recordSetSha256
  );
}

function validateManifestSequence(input: {
  authority: DnaPopulationEntrantAuthorityCheckpointAuthority;
  checkpoint: DnaPopulationEntrantAuthorityCheckpoint;
  manifests: readonly DnaPopulationEntrantAuthorityChunkManifest[];
}): number {
  if (input.manifests.length !== input.checkpoint.chunkCount) {
    recoveryError("manifest count disagrees with checkpoint");
  }

  let recoveredRaceCount = 0;
  let previousLastRaceId: string | null = null;
  for (const [index, manifest] of input.manifests.entries()) {
    if (
      manifest.version !== 1 ||
      manifest.generationId !== input.authority.generationId ||
      manifest.chunkOrdinal !== index + 1 ||
      manifest.rowCount < 1 ||
      !Number.isSafeInteger(manifest.rowCount)
    ) {
      recoveryError("manifest sequence is invalid");
    }
    if (
      previousLastRaceId !== null &&
      manifest.firstSourceRaceId <= previousLastRaceId
    ) {
      recoveryError("manifest Race ranges overlap or are out of order");
    }
    recoveredRaceCount += manifest.rowCount;
    if (
      !Number.isSafeInteger(recoveredRaceCount) ||
      recoveredRaceCount > input.authority.unresolvedRaceCount
    ) {
      recoveryError("manifest Race total exceeds audited authority");
    }
    previousLastRaceId = manifest.lastSourceRaceId;
  }

  if (
    recoveredRaceCount !== input.checkpoint.persistedRaceCount ||
    (input.manifests.length === 0
      ? input.checkpoint.lastSourceRaceId !== null
      : input.checkpoint.lastSourceRaceId !==
        input.manifests.at(-1)!.lastSourceRaceId)
  ) {
    recoveryError("manifest counters disagree with checkpoint");
  }
  return recoveredRaceCount;
}

/**
 * Re-opens every durable manifest through the private immutable R2 store before
 * exposing a deterministic resume point.
 *
 * This is deliberately recovery-only. It performs no DNA provider request,
 * creates no checkpoint, writes no R2/Neon state, and cannot authorize paid
 * usage. A later collector must run a fresh current-capacity preflight before
 * any persistent cohort can be armed.
 */
export async function recoverDnaPopulationEntrantAuthority(input: {
  ownerId: string;
  authority: DnaPopulationEntrantAuthorityCheckpointAuthority;
  checkpointRepository: Pick<
    DnaPopulationEntrantAuthorityCheckpointRepository,
    "read" | "listChunkManifests"
  >;
  r2Store: DnaPopulationEntrantAuthorityR2RecoveryPort;
}): Promise<DnaPopulationEntrantAuthorityRecovery> {
  if (
    typeof input.ownerId !== "string" ||
    input.ownerId.trim() !== input.ownerId ||
    input.ownerId.length < 1
  ) {
    recoveryError("ownerId is invalid");
  }
  const expectedAuthority = authority(input.authority);
  const checkpoint = await input.checkpointRepository.read(input.ownerId, {
    generationId: expectedAuthority.generationId,
  });
  if (!sameAuthority(checkpoint, expectedAuthority)) {
    recoveryError("checkpoint disagrees with audited authority");
  }

  const manifests: DnaPopulationEntrantAuthorityChunkManifest[] = [];
  let afterChunkOrdinal = 0;
  while (manifests.length < checkpoint.chunkCount) {
    const page = await input.checkpointRepository.listChunkManifests(
      input.ownerId,
      {
        generationId: expectedAuthority.generationId,
        afterChunkOrdinal,
        limit: MANIFEST_PAGE_LIMIT,
      },
    );
    if (
      page.length < 1 ||
      page.length > MANIFEST_PAGE_LIMIT ||
      manifests.length + page.length > checkpoint.chunkCount
    ) {
      recoveryError("manifest pagination is invalid");
    }
    for (const manifest of page) {
      if (manifest.chunkOrdinal !== manifests.length + 1) {
        recoveryError("manifest pagination is non-contiguous");
      }
      manifests.push(manifest);
    }
    afterChunkOrdinal = manifests.at(-1)!.chunkOrdinal;
  }

  const recoveredRaceCount = validateManifestSequence({
    authority: expectedAuthority,
    checkpoint,
    manifests,
  });

  for (const manifest of manifests) {
    const stored = await input.r2Store.read(manifest);
    if (!sameReceipt(stored.receipt, manifest)) {
      recoveryError("R2 chunk disagrees with durable manifest");
    }
  }

  const complete =
    checkpoint.persistedRaceCount === expectedAuthority.unresolvedRaceCount;
  return Object.freeze({
    authority: expectedAuthority,
    checkpoint,
    manifests: Object.freeze([...manifests]),
    recoveredChunkCount: manifests.length,
    recoveredRaceCount,
    nextChunkOrdinal: manifests.length + 1,
    resumeAfterSourceRaceId: checkpoint.lastSourceRaceId,
    complete,
    providerRequestPerformed: false as const,
    persistentWritePerformed: false as const,
    paidUsageAllowed: false as const,
  });
}
