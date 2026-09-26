import type {
  DnaPopulationEntrantAuthorityCheckpointRepository,
  DnaPopulationEntrantAuthorityChunkManifest,
} from "./dna-population-entrant-authority-checkpoint";
import type { DnaPopulationEntrantAuthorityLiveAuditSource } from "./dna-population-entrant-authority-cohort-command";
import {
  deriveDnaPopulationEntrantAuthorityUnresolvedRaceIds,
  dnaPopulationEntrantAuthorityRaceSetSha256,
} from "./dna-population-entrant-authority-cohort";
import { isDnaPopulationEntrantAuthorityQuarantineRecord } from "./dna-population-entrant-authority-record";
import {
  recoverDnaPopulationEntrantAuthority,
  type DnaPopulationEntrantAuthorityR2RecoveryPort,
} from "./dna-population-entrant-authority-recovery";

const GIT_OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type DnaPopulationEntrantAuthorityFirstCohortVerificationReceipt =
  Readonly<{
    status: "verified_first_cohort";
    exactCodeHeadSha: string;
    unresolvedRaceCount: number;
    unresolvedRaceSetSha256: string;
    chunkOrdinal: 1;
    rowCount: number;
    resolvedRaceCount: number;
    quarantinedRaceCount: number;
    bodySha256: string;
    raceSetSha256: string;
    recordSetSha256: string;
    registeredAt: string;
    checkpointUpdatedAt: string;
    nextChunkOrdinal: 2;
    authorityComplete: boolean;
    previewOnly: true;
    providerRequestPerformed: false;
    persistentWritePerformed: false;
    providerWritePerformed: false;
    paidUsageAllowed: false;
  }>;

export class DnaPopulationEntrantAuthorityFirstCohortVerificationError extends Error {
  constructor() {
    super("Population entrant first-cohort verification is unavailable");
    this.name = "DnaPopulationEntrantAuthorityFirstCohortVerificationError";
  }
}

function unavailable(): never {
  throw new DnaPopulationEntrantAuthorityFirstCohortVerificationError();
}

function identity(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 512 ||
    CONTROL_PATTERN.test(value)
  ) {
    unavailable();
  }
  return value;
}

function exactHead(value: string): string {
  const normalized = identity(value).toLowerCase();
  if (normalized !== value || !GIT_OBJECT_ID_PATTERN.test(normalized)) {
    unavailable();
  }
  return normalized;
}

function sha256(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.toLowerCase() !== value ||
    !SHA_256_PATTERN.test(value)
  ) {
    unavailable();
  }
  return value;
}

function exactTimestamp(value: string): string {
  if (typeof value !== "string") unavailable();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    unavailable();
  }
  return parsed.toISOString();
}

function sameReceipt(
  manifest: DnaPopulationEntrantAuthorityChunkManifest,
  stored: Awaited<ReturnType<DnaPopulationEntrantAuthorityR2RecoveryPort["read"]>>,
): boolean {
  const receipt = stored.receipt;
  return (
    receipt.version === manifest.version &&
    receipt.generationId === manifest.generationId &&
    receipt.chunkOrdinal === manifest.chunkOrdinal &&
    receipt.bodySha256 === manifest.bodySha256 &&
    receipt.byteLength === manifest.byteLength &&
    receipt.rowCount === manifest.rowCount &&
    receipt.firstSourceRaceId === manifest.firstSourceRaceId &&
    receipt.lastSourceRaceId === manifest.lastSourceRaceId &&
    receipt.raceSetSha256 === manifest.raceSetSha256 &&
    receipt.recordSetSha256 === manifest.recordSetSha256
  );
}

export function createDnaPopulationEntrantAuthorityFirstCohortVerifier(input: {
  ownerId: string;
  exactCodeHeadSha: string;
  authoritySource: DnaPopulationEntrantAuthorityLiveAuditSource;
  checkpointRepository: Pick<
    DnaPopulationEntrantAuthorityCheckpointRepository,
    "read" | "listChunkManifests"
  >;
  r2Store: DnaPopulationEntrantAuthorityR2RecoveryPort;
}): Readonly<{
  inspect: () => Promise<DnaPopulationEntrantAuthorityFirstCohortVerificationReceipt>;
}> {
  const ownerId = identity(input.ownerId);
  const exactCodeHeadSha = exactHead(input.exactCodeHeadSha);

  return Object.freeze({
    async inspect() {
      try {
        const audit = await input.authoritySource.load({
          ownerId,
          exactCodeHeadSha,
        });
        if (
          audit === null ||
          typeof audit !== "object" ||
          exactHead(audit.exactCodeHeadSha) !== exactCodeHeadSha ||
          audit.authority.version !== 1
        ) {
          unavailable();
        }

        const unresolvedRaceIds =
          deriveDnaPopulationEntrantAuthorityUnresolvedRaceIds(
            audit.raceDocuments,
          );
        const unresolvedRaceSetSha256 =
          dnaPopulationEntrantAuthorityRaceSetSha256(unresolvedRaceIds);
        if (
          unresolvedRaceIds.length < 1 ||
          audit.authority.generationId !== unresolvedRaceSetSha256 ||
          audit.authority.unresolvedRaceCount !== unresolvedRaceIds.length ||
          audit.authority.unresolvedRaceSetSha256 !== unresolvedRaceSetSha256
        ) {
          unavailable();
        }

        const recovery = await recoverDnaPopulationEntrantAuthority({
          ownerId,
          authority: audit.authority,
          checkpointRepository: input.checkpointRepository,
          r2Store: input.r2Store,
        });
        if (
          recovery.recoveredChunkCount !== 1 ||
          recovery.manifests.length !== 1 ||
          recovery.checkpoint.chunkCount !== 1 ||
          recovery.nextChunkOrdinal !== 2 ||
          recovery.recoveredRaceCount !==
            recovery.checkpoint.persistedRaceCount
        ) {
          unavailable();
        }

        const manifest = recovery.manifests[0]!;
        const expectedRaceIds = unresolvedRaceIds.slice(0, manifest.rowCount);
        if (
          manifest.version !== 1 ||
          manifest.chunkOrdinal !== 1 ||
          manifest.generationId !== unresolvedRaceSetSha256 ||
          expectedRaceIds.length !== manifest.rowCount ||
          manifest.firstSourceRaceId !== expectedRaceIds[0] ||
          manifest.lastSourceRaceId !== expectedRaceIds.at(-1) ||
          manifest.raceSetSha256 !==
            dnaPopulationEntrantAuthorityRaceSetSha256(expectedRaceIds) ||
          recovery.checkpoint.lastSourceRaceId !== manifest.lastSourceRaceId ||
          recovery.checkpoint.persistedRaceCount !== manifest.rowCount
        ) {
          unavailable();
        }

        const stored = await input.r2Store.read(manifest);
        if (
          !sameReceipt(manifest, stored) ||
          stored.records.length !== expectedRaceIds.length ||
          stored.records.some(
            (record, index) => record.sourceRaceId !== expectedRaceIds[index],
          )
        ) {
          unavailable();
        }

        const quarantinedRaceCount = stored.records.filter((record) =>
          isDnaPopulationEntrantAuthorityQuarantineRecord(record),
        ).length;
        const resolvedRaceCount = stored.records.length - quarantinedRaceCount;
        const registeredAt = exactTimestamp(manifest.registeredAt);
        const checkpointUpdatedAt = exactTimestamp(
          recovery.checkpoint.updatedAt,
        );
        if (
          Date.parse(checkpointUpdatedAt) < Date.parse(registeredAt) ||
          resolvedRaceCount + quarantinedRaceCount !== manifest.rowCount
        ) {
          unavailable();
        }

        return Object.freeze({
          status: "verified_first_cohort" as const,
          exactCodeHeadSha,
          unresolvedRaceCount: audit.authority.unresolvedRaceCount,
          unresolvedRaceSetSha256: sha256(unresolvedRaceSetSha256),
          chunkOrdinal: 1 as const,
          rowCount: manifest.rowCount,
          resolvedRaceCount,
          quarantinedRaceCount,
          bodySha256: sha256(manifest.bodySha256),
          raceSetSha256: sha256(manifest.raceSetSha256),
          recordSetSha256: sha256(manifest.recordSetSha256),
          registeredAt,
          checkpointUpdatedAt,
          nextChunkOrdinal: 2 as const,
          authorityComplete: recovery.complete,
          previewOnly: true as const,
          providerRequestPerformed: false as const,
          persistentWritePerformed: false as const,
          providerWritePerformed: false as const,
          paidUsageAllowed: false as const,
        });
      } catch (error) {
        if (
          error instanceof
          DnaPopulationEntrantAuthorityFirstCohortVerificationError
        ) {
          throw error;
        }
        unavailable();
      }
    },
  });
}
