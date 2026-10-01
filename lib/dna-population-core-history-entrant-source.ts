import type {
  DnaPopulationEntrantAuthorityCheckpointAuthority,
  DnaPopulationEntrantAuthorityCheckpointRepository,
} from "./dna-population-entrant-authority-checkpoint";
import type { DnaPopulationEntrantAuthorityRecord } from "./dna-population-entrant-authority-record";
import {
  recoverDnaPopulationEntrantAuthority,
  type DnaPopulationEntrantAuthorityR2RecoveryPort,
} from "./dna-population-entrant-authority-recovery";

const READ_CONCURRENCY = 4 as const;

export type DnaPopulationCoreHistoryEntrantAuthority = Readonly<{
  authority: DnaPopulationEntrantAuthorityCheckpointAuthority;
  records: readonly DnaPopulationEntrantAuthorityRecord[];
  recoveredChunkCount: number;
  recoveredRaceCount: number;
  checkpointUpdatedAt: string;
  providerRequestPerformed: false;
  persistentWritePerformed: false;
  paidUsageAllowed: false;
}>;

function sourceError(message: string): never {
  throw new Error(`Population Core history entrant source: ${message}`);
}

function sameReceipt(
  manifest: Readonly<{
    version: number;
    generationId: string;
    chunkOrdinal: number;
    bodySha256: string;
    byteLength: number;
    rowCount: number;
    firstSourceRaceId: string;
    lastSourceRaceId: string;
    raceSetSha256: string;
    recordSetSha256: string;
  }>,
  stored: Readonly<{
    version: number;
    generationId: string;
    chunkOrdinal: number;
    bodySha256: string;
    byteLength: number;
    rowCount: number;
    firstSourceRaceId: string;
    lastSourceRaceId: string;
    raceSetSha256: string;
    recordSetSha256: string;
  }>,
): boolean {
  return (
    manifest.version === stored.version &&
    manifest.generationId === stored.generationId &&
    manifest.chunkOrdinal === stored.chunkOrdinal &&
    manifest.bodySha256 === stored.bodySha256 &&
    manifest.byteLength === stored.byteLength &&
    manifest.rowCount === stored.rowCount &&
    manifest.firstSourceRaceId === stored.firstSourceRaceId &&
    manifest.lastSourceRaceId === stored.lastSourceRaceId &&
    manifest.raceSetSha256 === stored.raceSetSha256 &&
    manifest.recordSetSha256 === stored.recordSetSha256
  );
}

/**
 * Reopens the already-complete compact entrant authority and returns its exact
 * records for population Core-history planning. This is read-only and performs
 * no DNA request or persistent write.
 */
export async function loadDnaPopulationCoreHistoryEntrantAuthority(input: {
  ownerId: string;
  authority: DnaPopulationEntrantAuthorityCheckpointAuthority;
  checkpointRepository: Pick<
    DnaPopulationEntrantAuthorityCheckpointRepository,
    "read" | "listChunkManifests"
  >;
  r2Store: DnaPopulationEntrantAuthorityR2RecoveryPort;
}): Promise<DnaPopulationCoreHistoryEntrantAuthority> {
  const recovery = await recoverDnaPopulationEntrantAuthority(input);
  if (
    !recovery.complete ||
    recovery.recoveredRaceCount !== input.authority.unresolvedRaceCount ||
    recovery.manifests.length !== recovery.recoveredChunkCount
  ) {
    sourceError("entrant authority is not durably complete");
  }

  const records: DnaPopulationEntrantAuthorityRecord[] = [];
  for (
    let start = 0;
    start < recovery.manifests.length;
    start += READ_CONCURRENCY
  ) {
    const manifests = recovery.manifests.slice(
      start,
      start + READ_CONCURRENCY,
    );
    const chunks = await Promise.all(
      manifests.map((manifest) => input.r2Store.read(manifest)),
    );
    chunks.forEach((chunk, index) => {
      const manifest = manifests[index]!;
      if (
        !sameReceipt(manifest, chunk.receipt) ||
        chunk.records.length !== manifest.rowCount
      ) {
        sourceError("entrant chunk disagrees with its durable manifest");
      }
      records.push(...chunk.records);
    });
  }

  if (records.length !== recovery.recoveredRaceCount) {
    sourceError("entrant record count disagrees with completed authority");
  }

  return Object.freeze({
    authority: recovery.authority,
    records: Object.freeze(records),
    recoveredChunkCount: recovery.recoveredChunkCount,
    recoveredRaceCount: recovery.recoveredRaceCount,
    checkpointUpdatedAt: recovery.checkpoint.updatedAt,
    providerRequestPerformed: false as const,
    persistentWritePerformed: false as const,
    paidUsageAllowed: false as const,
  });
}
