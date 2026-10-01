import type { DnaPopulationEntrantAuthorityR2ChunkReceipt } from "./dna-population-entrant-authority-r2-store";
import {
  DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_PLAN_VERSION,
  type DnaPopulationEntrantAuthoritySuccessorPlan,
} from "./dna-population-entrant-authority-successor-plan";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;

export const DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_CHECKPOINT_VERSION =
  "dna-population-entrant-authority-successor-checkpoint/v1" as const;

export type DnaPopulationEntrantAuthoritySuccessorCheckpointAuthority =
  Readonly<{
    version: typeof DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_CHECKPOINT_VERSION;
    baseGenerationId: string;
    baseRecordSetSha256: string;
    successorGenerationId: string;
    successorRecordSetSha256: string;
    unresolvedRaceCount: number;
    unresolvedRaceSetSha256: string;
    replacementRaceCount: number;
    replacementRaceSetSha256: string;
    replacementRecordSetSha256: string;
    quarantinedRaceCountBefore: number;
    quarantinedRaceCountAfter: number;
  }>;

export type DnaPopulationEntrantAuthoritySuccessorCheckpoint =
  DnaPopulationEntrantAuthoritySuccessorCheckpointAuthority &
    Readonly<{
      chunkCount: number;
      persistedRaceCount: number;
      lastSourceRaceId: string | null;
      startedAt: string;
      updatedAt: string;
    }>;

export type DnaPopulationEntrantAuthoritySuccessorChunkManifest =
  DnaPopulationEntrantAuthorityR2ChunkReceipt &
    Readonly<{
      registeredAt: string;
    }>;

export type DnaPopulationEntrantAuthoritySuccessorCheckpointRepository =
  Readonly<{
    begin: (
      ownerId: string,
      request: Readonly<{
        authority: DnaPopulationEntrantAuthoritySuccessorCheckpointAuthority;
        startedAt: string;
      }>,
    ) => Promise<DnaPopulationEntrantAuthoritySuccessorCheckpoint>;
    registerChunk: (
      ownerId: string,
      request: Readonly<{
        successorGenerationId: string;
        receipt: DnaPopulationEntrantAuthorityR2ChunkReceipt;
        registeredAt: string;
      }>,
    ) => Promise<DnaPopulationEntrantAuthoritySuccessorCheckpoint>;
    read: (
      ownerId: string,
      request: Readonly<{
        successorGenerationId: string;
      }>,
    ) => Promise<DnaPopulationEntrantAuthoritySuccessorCheckpoint>;
    listChunkManifests: (
      ownerId: string,
      request: Readonly<{
        successorGenerationId: string;
        afterChunkOrdinal: number;
        limit: number;
      }>,
    ) => Promise<
      readonly DnaPopulationEntrantAuthoritySuccessorChunkManifest[]
    >;
  }>;

function checkpointError(message: string): never {
  throw new Error(
    `Population entrant authority successor checkpoint: ${message}`,
  );
}

function sha256(value: unknown, field: string): string {
  if (typeof value !== "string" || !SHA_256_PATTERN.test(value)) {
    checkpointError(`${field} is invalid`);
  }
  return value;
}

function count(value: unknown, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    checkpointError(`${field} is invalid`);
  }
  return value as number;
}

/**
 * Projects the immutable lineage needed to durably checkpoint one successor.
 *
 * The compact authority deliberately excludes records and connected-write
 * flags. Storage can bind progress to the already-proven lineage without
 * weakening the immutable v1 base-generation identity rule.
 */
export function createDnaPopulationEntrantAuthoritySuccessorCheckpointAuthority(
  plan: DnaPopulationEntrantAuthoritySuccessorPlan,
): DnaPopulationEntrantAuthoritySuccessorCheckpointAuthority {
  if (
    plan.version !== DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_PLAN_VERSION ||
    plan.lastGoodBasePreserved !== true ||
    plan.providerRequestPerformed !== false ||
    plan.persistentWriteAllowed !== false ||
    plan.paidUsageAllowed !== false
  ) {
    checkpointError("successor plan boundary is invalid");
  }

  const baseGenerationId = sha256(plan.baseGenerationId, "base generation ID");
  const baseRecordSetSha256 = sha256(
    plan.baseRecordSetSha256,
    "base record set SHA-256",
  );
  const successorGenerationId = sha256(
    plan.successorGenerationId,
    "successor generation ID",
  );
  const successorRecordSetSha256 = sha256(
    plan.successorRecordSetSha256,
    "successor record set SHA-256",
  );
  const unresolvedRaceSetSha256 = sha256(
    plan.unresolvedRaceSetSha256,
    "unresolved Race set SHA-256",
  );
  const replacementRaceSetSha256 = sha256(
    plan.replacementRaceSetSha256,
    "replacement Race set SHA-256",
  );
  const replacementRecordSetSha256 = sha256(
    plan.replacementRecordSetSha256,
    "replacement record set SHA-256",
  );
  const unresolvedRaceCount = count(
    plan.unresolvedRaceCount,
    "unresolved Race count",
    1,
  );
  const replacementRaceCount = count(
    plan.replacementRaceCount,
    "replacement Race count",
    1,
  );
  const quarantinedRaceCountBefore = count(
    plan.quarantinedRaceCountBefore,
    "quarantined Race count before",
    1,
  );
  const quarantinedRaceCountAfter = count(
    plan.quarantinedRaceCountAfter,
    "quarantined Race count after",
  );

  if (
    baseGenerationId !== unresolvedRaceSetSha256 ||
    successorGenerationId === baseGenerationId ||
    successorGenerationId === unresolvedRaceSetSha256 ||
    replacementRaceCount > unresolvedRaceCount ||
    quarantinedRaceCountBefore > unresolvedRaceCount ||
    quarantinedRaceCountAfter >= quarantinedRaceCountBefore ||
    quarantinedRaceCountBefore - quarantinedRaceCountAfter !==
      replacementRaceCount
  ) {
    checkpointError("successor lineage is inconsistent");
  }

  return Object.freeze({
    version: DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_CHECKPOINT_VERSION,
    baseGenerationId,
    baseRecordSetSha256,
    successorGenerationId,
    successorRecordSetSha256,
    unresolvedRaceCount,
    unresolvedRaceSetSha256,
    replacementRaceCount,
    replacementRaceSetSha256,
    replacementRecordSetSha256,
    quarantinedRaceCountBefore,
    quarantinedRaceCountAfter,
  });
}
