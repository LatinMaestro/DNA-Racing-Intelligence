import { createHash } from "node:crypto";

import type {
  DnaPopulationEntrantAuthorityCheckpointRepository,
  DnaPopulationEntrantAuthorityChunkManifest,
} from "./dna-population-entrant-authority-checkpoint";
import type { DnaPopulationEntrantAuthorityCapacityGate } from "./dna-population-entrant-authority-commit-protocol";
import type { DnaPopulationEntrantAuthorityLiveAuditSource } from "./dna-population-entrant-authority-cohort-command";
import {
  recoverDnaPopulationEntrantAuthority,
  type DnaPopulationEntrantAuthorityR2RecoveryPort,
} from "./dna-population-entrant-authority-recovery";

const GIT_OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export const DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_READINESS_VERSION =
  "dna-population-entrant-authority-continuation-readiness/v1" as const;

export type DnaPopulationEntrantAuthorityContinuationReadinessReceipt =
  Readonly<{
    version: typeof DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_READINESS_VERSION;
    status: "ready_for_continuation";
    exactCodeHeadSha: string;
    unresolvedRaceCount: number;
    unresolvedRaceSetSha256: string;
    recoveredChunkCount: number;
    recoveredRaceCount: number;
    nextChunkOrdinal: number;
    checkpointUpdatedAt: string;
    capacityObservedAt: string;
    durableBoundarySha256: string;
    previewOnly: true;
    providerRequestPerformed: false;
    persistentWritePerformed: false;
    providerWritePerformed: false;
    paidUsageAllowed: false;
  }>;

export class DnaPopulationEntrantAuthorityContinuationReadinessError extends Error {
  constructor() {
    super("Population entrant continuation readiness is unavailable");
    this.name = "DnaPopulationEntrantAuthorityContinuationReadinessError";
  }
}

function unavailable(): never {
  throw new DnaPopulationEntrantAuthorityContinuationReadinessError();
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

function positiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) unavailable();
  return value;
}

function canonicalManifest(
  manifest: DnaPopulationEntrantAuthorityChunkManifest,
) {
  return Object.freeze({
    version: manifest.version,
    generationId: sha256(manifest.generationId),
    chunkOrdinal: positiveInteger(manifest.chunkOrdinal),
    bodySha256: sha256(manifest.bodySha256),
    byteLength: positiveInteger(manifest.byteLength),
    rowCount: positiveInteger(manifest.rowCount),
    firstSourceRaceId: identity(manifest.firstSourceRaceId),
    lastSourceRaceId: identity(manifest.lastSourceRaceId),
    raceSetSha256: sha256(manifest.raceSetSha256),
    recordSetSha256: sha256(manifest.recordSetSha256),
    registeredAt: exactTimestamp(manifest.registeredAt),
  });
}

function durableBoundarySha256(input: {
  exactCodeHeadSha: string;
  unresolvedRaceCount: number;
  unresolvedRaceSetSha256: string;
  recoveredChunkCount: number;
  recoveredRaceCount: number;
  nextChunkOrdinal: number;
  lastSourceRaceId: string;
  checkpointUpdatedAt: string;
  manifests: readonly DnaPopulationEntrantAuthorityChunkManifest[];
}): string {
  const manifests = input.manifests.map(canonicalManifest);
  const canonical = JSON.stringify({
    version: DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_READINESS_VERSION,
    exactCodeHeadSha: input.exactCodeHeadSha,
    unresolvedRaceCount: input.unresolvedRaceCount,
    unresolvedRaceSetSha256: input.unresolvedRaceSetSha256,
    recoveredChunkCount: input.recoveredChunkCount,
    recoveredRaceCount: input.recoveredRaceCount,
    nextChunkOrdinal: input.nextChunkOrdinal,
    lastSourceRaceId: input.lastSourceRaceId,
    checkpointUpdatedAt: input.checkpointUpdatedAt,
    manifests,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function capacityObservedAt(input: {
  authority: {
    version: 1;
    generationId: string;
    unresolvedRaceCount: number;
    unresolvedRaceSetSha256: string;
  };
  approval: Awaited<
    ReturnType<
      DnaPopulationEntrantAuthorityCapacityGate["assertFreshCurrentCapacity"]
    >
  >;
}): string {
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
    unavailable();
  }
  return exactTimestamp(input.approval.observedAt);
}

export function createDnaPopulationEntrantAuthorityContinuationReadinessInspector(input: {
  ownerId: string;
  exactCodeHeadSha: string;
  authoritySource: DnaPopulationEntrantAuthorityLiveAuditSource;
  capacityGate: DnaPopulationEntrantAuthorityCapacityGate;
  checkpointRepository: Pick<
    DnaPopulationEntrantAuthorityCheckpointRepository,
    "read" | "listChunkManifests"
  >;
  r2Store: DnaPopulationEntrantAuthorityR2RecoveryPort;
}): Readonly<{
  inspect: () => Promise<DnaPopulationEntrantAuthorityContinuationReadinessReceipt>;
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
          audit.authority.version !== 1 ||
          audit.authority.generationId !==
            audit.authority.unresolvedRaceSetSha256
        ) {
          unavailable();
        }

        const approval = await input.capacityGate.assertFreshCurrentCapacity(
          audit.authority,
        );
        const observedAt = capacityObservedAt({
          authority: audit.authority,
          approval,
        });

        const recovery = await recoverDnaPopulationEntrantAuthority({
          ownerId,
          authority: audit.authority,
          checkpointRepository: input.checkpointRepository,
          r2Store: input.r2Store,
        });

        if (
          recovery.complete ||
          recovery.recoveredChunkCount < 1 ||
          recovery.recoveredRaceCount < 1 ||
          recovery.nextChunkOrdinal !== recovery.recoveredChunkCount + 1 ||
          recovery.checkpoint.chunkCount !== recovery.recoveredChunkCount ||
          recovery.checkpoint.persistedRaceCount !==
            recovery.recoveredRaceCount ||
          recovery.checkpoint.lastSourceRaceId === null
        ) {
          unavailable();
        }

        const checkpointUpdatedAt = exactTimestamp(
          recovery.checkpoint.updatedAt,
        );
        const boundarySha256 = durableBoundarySha256({
          exactCodeHeadSha,
          unresolvedRaceCount: audit.authority.unresolvedRaceCount,
          unresolvedRaceSetSha256: sha256(
            audit.authority.unresolvedRaceSetSha256,
          ),
          recoveredChunkCount: recovery.recoveredChunkCount,
          recoveredRaceCount: recovery.recoveredRaceCount,
          nextChunkOrdinal: recovery.nextChunkOrdinal,
          lastSourceRaceId: identity(recovery.checkpoint.lastSourceRaceId),
          checkpointUpdatedAt,
          manifests: recovery.manifests,
        });

        return Object.freeze({
          version:
            DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_READINESS_VERSION,
          status: "ready_for_continuation" as const,
          exactCodeHeadSha,
          unresolvedRaceCount: audit.authority.unresolvedRaceCount,
          unresolvedRaceSetSha256: sha256(
            audit.authority.unresolvedRaceSetSha256,
          ),
          recoveredChunkCount: recovery.recoveredChunkCount,
          recoveredRaceCount: recovery.recoveredRaceCount,
          nextChunkOrdinal: recovery.nextChunkOrdinal,
          checkpointUpdatedAt,
          capacityObservedAt: observedAt,
          durableBoundarySha256: boundarySha256,
          previewOnly: true as const,
          providerRequestPerformed: false as const,
          persistentWritePerformed: false as const,
          providerWritePerformed: false as const,
          paidUsageAllowed: false as const,
        });
      } catch (error) {
        if (
          error instanceof
          DnaPopulationEntrantAuthorityContinuationReadinessError
        ) {
          throw error;
        }
        unavailable();
      }
    },
  });
}
