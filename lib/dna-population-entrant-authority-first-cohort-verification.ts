import type {
  DnaPopulationEntrantAuthorityCheckpointAuthority,
  DnaPopulationEntrantAuthorityCheckpointRepository,
} from "./dna-population-entrant-authority-checkpoint";
import { DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_MAXIMUM_RACES } from "./dna-population-entrant-authority-cohort";
import {
  recoverDnaPopulationEntrantAuthority,
  type DnaPopulationEntrantAuthorityR2RecoveryPort,
} from "./dna-population-entrant-authority-recovery";

export type DnaPopulationEntrantAuthorityFirstCohortEvidence = Readonly<{
  exactCodeHeadSha: string;
  rowCount: number;
  bodySha256: string;
  raceSetSha256: string;
  recordSetSha256: string;
  authorityComplete: boolean;
}>;

export type DnaPopulationEntrantAuthorityFirstCohortVerification = Readonly<{
  status: "verified";
  exactCodeHeadSha: string;
  generationId: string;
  unresolvedRaceCount: number;
  chunkCount: 1;
  persistedRaceCount: number;
  bodySha256: string;
  raceSetSha256: string;
  recordSetSha256: string;
  authorityComplete: boolean;
  nextChunkOrdinal: 2;
  providerRequestPerformed: false;
  persistentWritePerformed: false;
  paidUsageAllowed: false;
}>;

function fail(): never {
  throw new Error("Population entrant first-cohort durability verification failed");
}

export async function verifyDnaPopulationEntrantAuthorityFirstCohort(input: {
  ownerId: string;
  exactCodeHeadSha: string;
  authority: DnaPopulationEntrantAuthorityCheckpointAuthority;
  expected: DnaPopulationEntrantAuthorityFirstCohortEvidence;
  checkpointRepository: Pick<
    DnaPopulationEntrantAuthorityCheckpointRepository,
    "read" | "listChunkManifests"
  >;
  r2Store: DnaPopulationEntrantAuthorityR2RecoveryPort;
}): Promise<DnaPopulationEntrantAuthorityFirstCohortVerification> {
  if (
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(input.exactCodeHeadSha) ||
    input.expected.exactCodeHeadSha !== input.exactCodeHeadSha ||
    !Number.isSafeInteger(input.expected.rowCount) ||
    input.expected.rowCount < 1 ||
    input.expected.rowCount > DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_MAXIMUM_RACES
  ) {
    fail();
  }

  const recovery = await recoverDnaPopulationEntrantAuthority({
    ownerId: input.ownerId,
    authority: input.authority,
    checkpointRepository: input.checkpointRepository,
    r2Store: input.r2Store,
  });
  const manifest = recovery.manifests[0];

  if (
    recovery.recoveredChunkCount !== 1 ||
    recovery.manifests.length !== 1 ||
    recovery.checkpoint.chunkCount !== 1 ||
    recovery.nextChunkOrdinal !== 2 ||
    recovery.recoveredRaceCount !== input.expected.rowCount ||
    recovery.checkpoint.persistedRaceCount !== input.expected.rowCount ||
    manifest === undefined ||
    manifest.chunkOrdinal !== 1 ||
    manifest.rowCount !== input.expected.rowCount ||
    manifest.bodySha256 !== input.expected.bodySha256 ||
    manifest.raceSetSha256 !== input.expected.raceSetSha256 ||
    manifest.recordSetSha256 !== input.expected.recordSetSha256 ||
    recovery.complete !== input.expected.authorityComplete ||
    recovery.complete !==
      (input.expected.rowCount === input.authority.unresolvedRaceCount)
  ) {
    fail();
  }

  return Object.freeze({
    status: "verified" as const,
    exactCodeHeadSha: input.exactCodeHeadSha,
    generationId: input.authority.generationId,
    unresolvedRaceCount: input.authority.unresolvedRaceCount,
    chunkCount: 1 as const,
    persistedRaceCount: recovery.recoveredRaceCount,
    bodySha256: manifest.bodySha256,
    raceSetSha256: manifest.raceSetSha256,
    recordSetSha256: manifest.recordSetSha256,
    authorityComplete: recovery.complete,
    nextChunkOrdinal: 2 as const,
    providerRequestPerformed: false as const,
    persistentWritePerformed: false as const,
    paidUsageAllowed: false as const,
  });
}
