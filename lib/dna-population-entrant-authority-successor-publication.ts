import {
  replayDnaPopulationEntrantAuthorityArchive,
  type DnaPopulationEntrantAuthorityChunk,
} from "./dna-population-entrant-authority-archive";
import type {
  DnaPopulationEntrantAuthorityRecord,
  DnaPopulationEntrantAuthorityResolvedRecord,
} from "./dna-population-entrant-authority-record";
import {
  planDnaPopulationEntrantAuthoritySuccessor,
  type DnaPopulationEntrantAuthoritySuccessorPlan,
} from "./dna-population-entrant-authority-successor-plan";

export const DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_PUBLICATION_PROOF_VERSION =
  "dna-population-entrant-authority-successor-publication-proof/v1" as const;

export type DnaPopulationEntrantAuthoritySuccessorPublicationProof = Readonly<{
  version: typeof DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_PUBLICATION_PROOF_VERSION;
  baseGenerationId: string;
  baseRecordSetSha256: string;
  successorGenerationId: string;
  successorRecordSetSha256: string;
  archiveRecordSetSha256: string;
  unresolvedRaceCount: number;
  unresolvedRaceSetSha256: string;
  replacementRaceCount: number;
  replacementRaceSetSha256: string;
  replacementRecordSetSha256: string;
  chunkCount: number;
  quarantinedRaceCountBefore: number;
  quarantinedRaceCountAfter: number;
  publicationIntegrityStatus: "proven_immutable_successor_archive";
  lastGoodBasePreserved: true;
  providerRequestPerformed: false;
  persistentWritePerformed: false;
  publicationAllowed: false;
  paidUsageAllowed: false;
}>;

function publicationError(message: string): never {
  throw new Error(
    `Population entrant authority successor publication: ${message}`,
  );
}

/**
 * Independently proves that a complete immutable archive is the exact
 * deterministic successor of one accepted entrant-authority generation.
 *
 * The verifier reconstructs the successor from the base plus resolved
 * replacements, then re-opens every archive chunk before comparing the full
 * record-set checksum. It cannot publish or persist anything; a separately
 * authorized connected path must consume the proof and repeat its own
 * authority, capacity and last-good checks.
 */
export function verifyDnaPopulationEntrantAuthoritySuccessorPublication(input: {
  baseGenerationId: string;
  baseRecords: readonly DnaPopulationEntrantAuthorityRecord[];
  expectedUnresolvedRaceCount: number;
  expectedUnresolvedRaceSetSha256: string;
  expectedBaseRecordSetSha256: string;
  replacements: readonly DnaPopulationEntrantAuthorityResolvedRecord[];
  successorChunks: readonly DnaPopulationEntrantAuthorityChunk[];
}): DnaPopulationEntrantAuthoritySuccessorPublicationProof {
  const plan: DnaPopulationEntrantAuthoritySuccessorPlan =
    planDnaPopulationEntrantAuthoritySuccessor({
      baseGenerationId: input.baseGenerationId,
      baseRecords: input.baseRecords,
      expectedUnresolvedRaceCount: input.expectedUnresolvedRaceCount,
      expectedUnresolvedRaceSetSha256: input.expectedUnresolvedRaceSetSha256,
      expectedBaseRecordSetSha256: input.expectedBaseRecordSetSha256,
      replacements: input.replacements,
    });

  const archive = replayDnaPopulationEntrantAuthorityArchive({
    generationId: plan.successorGenerationId,
    expectedUnresolvedRaceCount: plan.unresolvedRaceCount,
    expectedUnresolvedRaceSetSha256: plan.unresolvedRaceSetSha256,
    chunks: input.successorChunks,
  });

  if (
    archive.rowCount !== plan.unresolvedRaceCount ||
    archive.replay.recordSetSha256 !== plan.successorRecordSetSha256 ||
    archive.quarantinedRaceCount !== plan.quarantinedRaceCountAfter
  ) {
    publicationError("archive disagrees with the deterministic successor");
  }

  return Object.freeze({
    version:
      DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_PUBLICATION_PROOF_VERSION,
    baseGenerationId: plan.baseGenerationId,
    baseRecordSetSha256: plan.baseRecordSetSha256,
    successorGenerationId: plan.successorGenerationId,
    successorRecordSetSha256: plan.successorRecordSetSha256,
    archiveRecordSetSha256: archive.archiveRecordSetSha256,
    unresolvedRaceCount: plan.unresolvedRaceCount,
    unresolvedRaceSetSha256: plan.unresolvedRaceSetSha256,
    replacementRaceCount: plan.replacementRaceCount,
    replacementRaceSetSha256: plan.replacementRaceSetSha256,
    replacementRecordSetSha256: plan.replacementRecordSetSha256,
    chunkCount: archive.chunkCount,
    quarantinedRaceCountBefore: plan.quarantinedRaceCountBefore,
    quarantinedRaceCountAfter: plan.quarantinedRaceCountAfter,
    publicationIntegrityStatus: "proven_immutable_successor_archive" as const,
    lastGoodBasePreserved: true as const,
    providerRequestPerformed: false as const,
    persistentWritePerformed: false as const,
    publicationAllowed: false as const,
    paidUsageAllowed: false as const,
  });
}
