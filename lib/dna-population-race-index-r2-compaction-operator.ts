import { DNA_POPULATION_RACE_INDEX_P5_AUTHORITY } from "./dna-population-race-index-private-preview-operator";
import type {
  DnaPopulationRaceIndexBaselineReadPort,
  DnaPopulationRaceIndexDocument,
} from "./dna-population-race-index-checkpoint";
import type {
  DnaPopulationRaceIndexCompactIdentity,
  DnaPopulationRaceIndexGenerationRepository,
} from "./dna-population-race-index-generation";
import {
  fitDnaPopulationRaceIndexR2ChunkDocuments,
  type DnaPopulationRaceIndexR2ChunkWrite,
} from "./dna-population-race-index-r2-chunk";
import {
  DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT,
  DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION,
  type DnaOpenLabProviderCapacityPreflight,
} from "./dna-open-lab-provider-capacity-preflight";
import type { DnaOpenLabProviderCapacityBlockerId } from "./dna-open-lab-zero-cost-provider-capacity";

export const DNA_POPULATION_RACE_INDEX_R2_COMPACTION_OPERATOR_VERSION =
  "dna-population-race-index-r2-compaction/v2" as const;
export const DNA_POPULATION_RACE_INDEX_R2_COMPACTION_INTENT =
  "compact_private_preview_population_race_index_to_r2" as const;

export const DNA_POPULATION_RACE_INDEX_R2_COMPACTION_PLANNED_R2_USAGE =
  Object.freeze({
    storageBytes: 8 * 1024 * 1024,
    classAOperations: 1,
    classBOperations: 2,
  });

export const DNA_POPULATION_RACE_INDEX_R2_COMPACTION_PLANNED_NEON_USAGE =
  Object.freeze({
    // The manifest registration and matching legacy-row retirement are one
    // transaction. The operation is storage-negative even though the generic
    // capacity projection cannot express a negative storage delta.
    storageBytes: 0,
    computeMilliCuHours: 1_000,
  });

function isStorageReliefEligible(
  preflight: Readonly<{
    status: "ready" | "held";
    reason?: string;
    blockerIds?: readonly DnaOpenLabProviderCapacityBlockerId[];
  }>,
): boolean {
  return (
    preflight.status === "held" &&
    preflight.reason === "capacity_blocked" &&
    preflight.blockerIds?.length === 1 &&
    preflight.blockerIds[0] === "neon_storage_budget_exhausted"
  );
}

export type DnaPopulationRaceIndexR2CompactionInvocation = Readonly<{
  operatorVersion: typeof DNA_POPULATION_RACE_INDEX_R2_COMPACTION_OPERATOR_VERSION;
  intent: typeof DNA_POPULATION_RACE_INDEX_R2_COMPACTION_INTENT;
  allowPersistentWrite: true;
  authenticatedOwnerId: string;
  exactCodeHeadSha: string;
  workerId: string;
  attemptedAt: string;
  maximumRows: number;
}>;

export type DnaPopulationRaceIndexR2CompactionReceipt = Readonly<{
  status: "advanced" | "complete" | "held";
  reason: string | null;
  exactCodeHeadSha: string;
  generationId: string;
  beforeCompactedRaceCount: number;
  afterCompactedRaceCount: number;
  uniqueRaceCount: number;
  r2ChunkCount: number;
  storageLayout: "legacy_neon_v1" | "r2_chunked_v1";
  providerCapacityBlockerIds: readonly DnaOpenLabProviderCapacityBlockerId[];
  r2ObjectCreated: boolean;
  persistentWriteArmed: true;
  previewOnly: true;
  dnaProviderRequestCount: 0;
  paidUsageAllowed: false;
  preserveLastGood: true;
}>;

const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const WORKER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

function compactionError(message: string): never {
  throw new Error(`DNA population race index R2 compaction: ${message}`);
}

function identity(value: string, field: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 512 ||
    CONTROL_PATTERN.test(normalized)
  ) {
    compactionError(`${field} is invalid`);
  }
  return normalized;
}

function timestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    compactionError("attemptedAt is invalid");
  }
  return value;
}

function safeReceipt(
  input: Omit<
    DnaPopulationRaceIndexR2CompactionReceipt,
    | "persistentWriteArmed"
    | "previewOnly"
    | "dnaProviderRequestCount"
    | "paidUsageAllowed"
    | "preserveLastGood"
  >,
): DnaPopulationRaceIndexR2CompactionReceipt {
  return Object.freeze({
    ...input,
    providerCapacityBlockerIds: Object.freeze([
      ...input.providerCapacityBlockerIds,
    ]),
    persistentWriteArmed: true as const,
    previewOnly: true as const,
    dnaProviderRequestCount: 0 as const,
    paidUsageAllowed: false as const,
    preserveLastGood: true as const,
  });
}

function compactIdentities(
  documents: readonly Readonly<{
    sourceRaceId: string;
    rawEvidenceSha256: string;
  }>[],
): readonly DnaPopulationRaceIndexCompactIdentity[] {
  return Object.freeze(
    documents.map((document) =>
      Object.freeze({
        sourceRaceId: document.sourceRaceId,
        rawEvidenceSha256: document.rawEvidenceSha256,
      }),
    ),
  );
}

export function createDnaPopulationRaceIndexR2CompactionOperator(input: {
  configuredOwnerId: string;
  baseline: Pick<DnaPopulationRaceIndexBaselineReadPort, "load">;
  repository: DnaPopulationRaceIndexGenerationRepository;
  capacityPreflight: DnaOpenLabProviderCapacityPreflight;
  chunkStore: Readonly<{
    write: (request: {
      generationId: string;
      chunkOrdinal: number;
      documents: readonly DnaPopulationRaceIndexDocument[];
    }) => Promise<DnaPopulationRaceIndexR2ChunkWrite>;
  }>;
}): Readonly<{
  execute: (
    invocation: DnaPopulationRaceIndexR2CompactionInvocation,
  ) => Promise<DnaPopulationRaceIndexR2CompactionReceipt>;
}> {
  const configuredOwnerId = identity(
    input.configuredOwnerId,
    "configured owner",
  );

  return Object.freeze({
    async execute(invocation) {
      if (
        invocation.operatorVersion !==
          DNA_POPULATION_RACE_INDEX_R2_COMPACTION_OPERATOR_VERSION ||
        invocation.intent !== DNA_POPULATION_RACE_INDEX_R2_COMPACTION_INTENT ||
        invocation.allowPersistentWrite !== true
      ) {
        compactionError("invocation is not explicitly armed");
      }
      const ownerId = identity(
        invocation.authenticatedOwnerId,
        "authenticated owner",
      );
      if (ownerId !== configuredOwnerId) compactionError("owner scope denied");
      const exactCodeHeadSha = invocation.exactCodeHeadSha.trim().toLowerCase();
      if (!COMMIT_PATTERN.test(exactCodeHeadSha)) {
        compactionError("exact code head is invalid");
      }
      if (!WORKER_PATTERN.test(invocation.workerId)) {
        compactionError("workerId is invalid");
      }
      const attemptedAt = timestamp(invocation.attemptedAt);
      if (
        !Number.isSafeInteger(invocation.maximumRows) ||
        invocation.maximumRows < 1 ||
        invocation.maximumRows > 5_000
      ) {
        compactionError("row bound is invalid");
      }

      const baseline = await input.baseline.load();
      if (
        baseline === null ||
        baseline.status !== "complete" ||
        baseline.completionSha256 === null ||
        baseline.logicalRequestCount !==
          DNA_POPULATION_RACE_INDEX_P5_AUTHORITY.logicalRequestCount ||
        baseline.retainedR2Bytes !==
          DNA_POPULATION_RACE_INDEX_P5_AUTHORITY.retainedR2Bytes ||
        baseline.omittedIdentityObservationCount !==
          DNA_POPULATION_RACE_INDEX_P5_AUTHORITY.omittedIdentityObservationCount
      ) {
        compactionError("immutable P5 baseline authority is unavailable");
      }
      const generationId = baseline.completionSha256;
      let checkpoint = await input.repository.load(ownerId, generationId);
      if (checkpoint === null) {
        compactionError("population race generation is unavailable");
      }
      if (checkpoint.storageLayout === "r2_chunked_v1") {
        return safeReceipt({
          status: "complete",
          reason: null,
          exactCodeHeadSha,
          generationId,
          beforeCompactedRaceCount: checkpoint.r2CompactedRaceCount,
          afterCompactedRaceCount: checkpoint.r2CompactedRaceCount,
          uniqueRaceCount: checkpoint.uniqueRaceCount,
          r2ChunkCount: checkpoint.r2ChunkCount,
          storageLayout: checkpoint.storageLayout,
          providerCapacityBlockerIds: [],
          r2ObjectCreated: false,
        });
      }
      if (checkpoint.legacyStorageRetiredAt !== null) {
        compactionError("legacy population storage was already retired");
      }

      const beforeCompactedRaceCount = checkpoint.r2CompactedRaceCount;
      const preflight = await input.capacityPreflight.inspect({
        preflightVersion: DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION,
        intent: DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT,
        authenticatedOwnerId: ownerId,
        exactCodeHeadSha,
        refreshCycleId: generationId,
        budgetWindowId: generationId,
        projectionHorizon: "single_refresh",
        plannedR2UsagePerRefresh:
          DNA_POPULATION_RACE_INDEX_R2_COMPACTION_PLANNED_R2_USAGE,
        plannedNeonUsagePerRefresh:
          DNA_POPULATION_RACE_INDEX_R2_COMPACTION_PLANNED_NEON_USAGE,
      });
      if (preflight.status !== "ready" && !isStorageReliefEligible(preflight)) {
        return safeReceipt({
          status: "held",
          reason: `provider_capacity_${preflight.reason}`,
          exactCodeHeadSha,
          generationId,
          beforeCompactedRaceCount,
          afterCompactedRaceCount: beforeCompactedRaceCount,
          uniqueRaceCount: checkpoint.uniqueRaceCount,
          r2ChunkCount: checkpoint.r2ChunkCount,
          storageLayout: checkpoint.storageLayout,
          providerCapacityBlockerIds: preflight.blockerIds,
          r2ObjectCreated: false,
        });
      }

      const legacy = await input.repository.readLegacyChunk(ownerId, {
        generationId,
        afterSourceRaceId: checkpoint.r2LastSourceRaceId,
        limit: invocation.maximumRows,
      });
      if (legacy.documents.length === 0) {
        if (checkpoint.r2CompactedRaceCount !== checkpoint.uniqueRaceCount) {
          compactionError("legacy reader ended before exact race count");
        }
        checkpoint = await input.repository.finalizeCompaction(ownerId, {
          workerId: invocation.workerId,
          generationId,
          compactedAt: attemptedAt,
        });
        return safeReceipt({
          status: "complete",
          reason: null,
          exactCodeHeadSha,
          generationId,
          beforeCompactedRaceCount,
          afterCompactedRaceCount: checkpoint.r2CompactedRaceCount,
          uniqueRaceCount: checkpoint.uniqueRaceCount,
          r2ChunkCount: checkpoint.r2ChunkCount,
          storageLayout: checkpoint.storageLayout,
          providerCapacityBlockerIds: [],
          r2ObjectCreated: false,
        });
      }

      const documents = fitDnaPopulationRaceIndexR2ChunkDocuments({
        generationId,
        chunkOrdinal: checkpoint.r2ChunkCount + 1,
        documents: legacy.documents,
      });
      const stored = await input.chunkStore.write({
        generationId,
        chunkOrdinal: checkpoint.r2ChunkCount + 1,
        documents,
      });
      checkpoint = await input.repository.registerCompactionChunk(ownerId, {
        workerId: invocation.workerId,
        generationId,
        receipt: stored.receipt,
        identities: compactIdentities(documents),
        registeredAt: attemptedAt,
      });
      if (checkpoint.r2CompactedRaceCount === checkpoint.uniqueRaceCount) {
        checkpoint = await input.repository.finalizeCompaction(ownerId, {
          workerId: invocation.workerId,
          generationId,
          compactedAt: attemptedAt,
        });
      }

      return safeReceipt({
        status:
          checkpoint.storageLayout === "r2_chunked_v1"
            ? "complete"
            : "advanced",
        reason: null,
        exactCodeHeadSha,
        generationId,
        beforeCompactedRaceCount,
        afterCompactedRaceCount: checkpoint.r2CompactedRaceCount,
        uniqueRaceCount: checkpoint.uniqueRaceCount,
        r2ChunkCount: checkpoint.r2ChunkCount,
        storageLayout: checkpoint.storageLayout,
        providerCapacityBlockerIds: [],
        r2ObjectCreated: stored.storageStatus === "created",
      });
    },
  });
}
