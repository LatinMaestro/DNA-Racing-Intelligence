import type { DnaPopulationEntrantAuthorityR2ChunkReceipt } from "./dna-population-entrant-authority-r2-store";

export type DnaPopulationEntrantAuthorityCheckpointAuthority = Readonly<{
  version: 1;
  generationId: string;
  unresolvedRaceCount: number;
  unresolvedRaceSetSha256: string;
}>;

export type DnaPopulationEntrantAuthorityCheckpoint =
  DnaPopulationEntrantAuthorityCheckpointAuthority &
    Readonly<{
      chunkCount: number;
      persistedRaceCount: number;
      lastSourceRaceId: string | null;
      startedAt: string;
      updatedAt: string;
    }>;

export type DnaPopulationEntrantAuthorityChunkManifest =
  DnaPopulationEntrantAuthorityR2ChunkReceipt &
    Readonly<{
      registeredAt: string;
    }>;

export type DnaPopulationEntrantAuthorityCheckpointRepository = Readonly<{
  begin: (
    ownerId: string,
    request: Readonly<{
      authority: DnaPopulationEntrantAuthorityCheckpointAuthority;
      startedAt: string;
    }>,
  ) => Promise<DnaPopulationEntrantAuthorityCheckpoint>;
  registerChunk: (
    ownerId: string,
    request: Readonly<{
      generationId: string;
      receipt: DnaPopulationEntrantAuthorityR2ChunkReceipt;
      registeredAt: string;
    }>,
  ) => Promise<DnaPopulationEntrantAuthorityCheckpoint>;
  read: (
    ownerId: string,
    request: Readonly<{
      generationId: string;
    }>,
  ) => Promise<DnaPopulationEntrantAuthorityCheckpoint>;
  listChunkManifests: (
    ownerId: string,
    request: Readonly<{
      generationId: string;
      afterChunkOrdinal: number;
      limit: number;
    }>,
  ) => Promise<readonly DnaPopulationEntrantAuthorityChunkManifest[]>;
}>;
