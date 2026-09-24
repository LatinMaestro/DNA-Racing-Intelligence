import {
  createDnaPopulationRaceIndexAuthority,
  createDnaPopulationRaceIndexR2AppendPlan,
  createDnaPopulationRaceIndexWriteBatch,
  DNA_POPULATION_RACE_INDEX_MAXIMUM_RECEIPTS_PER_WRITE,
  type DnaPopulationRaceIndexGenerationRepository,
} from "./dna-population-race-index-generation";
import {
  readDnaPopulationRaceIndexReceiptBatch,
  type DnaPopulationRaceIndexBaselineReadPort,
} from "./dna-population-race-index-checkpoint";
import {
  DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT,
  DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION,
  type DnaOpenLabProviderCapacityPreflight,
} from "./dna-open-lab-provider-capacity-preflight";
import type { DnaOpenLabProviderCapacityBlockerId } from "./dna-open-lab-zero-cost-provider-capacity";
import type {
  DnaPopulationRaceIndexR2ChunkReceipt,
  DnaPopulationRaceIndexR2ChunkWrite,
} from "./dna-population-race-index-r2-chunk";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";

export const DNA_POPULATION_RACE_INDEX_PRIVATE_PREVIEW_OPERATOR_VERSION =
  "dna-population-race-index-private-preview/v1" as const;
export const DNA_POPULATION_RACE_INDEX_PRIVATE_PREVIEW_INTENT =
  "advance_private_preview_population_race_index" as const;

export const DNA_POPULATION_RACE_INDEX_P5_AUTHORITY = Object.freeze({
  logicalRequestCount: 17_464,
  retainedR2Bytes: 874_370_990,
  omittedIdentityObservationCount: 1,
});

export const DNA_POPULATION_RACE_INDEX_PREVIEW_PLANNED_R2_USAGE = Object.freeze(
  {
    storageBytes: 8 * 1024 * 1024,
    classAOperations: 1,
    classBOperations: DNA_POPULATION_RACE_INDEX_MAXIMUM_RECEIPTS_PER_WRITE + 2,
  },
);

export const DNA_POPULATION_RACE_INDEX_PREVIEW_PLANNED_NEON_USAGE =
  Object.freeze({
    storageBytes: 8 * 1024 * 1024,
    computeMilliCuHours: 1_000,
  });

export type DnaPopulationRaceIndexPrivatePreviewInvocation = Readonly<{
  operatorVersion: typeof DNA_POPULATION_RACE_INDEX_PRIVATE_PREVIEW_OPERATOR_VERSION;
  intent: typeof DNA_POPULATION_RACE_INDEX_PRIVATE_PREVIEW_INTENT;
  allowPersistentWrite: true;
  authenticatedOwnerId: string;
  exactCodeHeadSha: string;
  workerId: string;
  attemptedAt: string;
  maximumReceiptCount: number;
}>;

export type DnaPopulationRaceIndexPrivatePreviewReceipt = Readonly<{
  status: "advanced" | "complete" | "held";
  reason: string | null;
  exactCodeHeadSha: string;
  generationId: string;
  beforeRequestOrdinal: number;
  afterRequestOrdinal: number;
  processedReceiptCount: number;
  uniqueRaceCount: number;
  uniqueEntrantCoreCount: number;
  preflightSha256: string | null;
  providerCapacityBlockerIds: readonly DnaOpenLabProviderCapacityBlockerId[];
  persistentWriteArmed: true;
  previewOnly: true;
  dnaProviderRequestCount: 0;
  providerWritePerformed: boolean;
  paidUsageAllowed: false;
  preserveLastGood: true;
}>;

const GIT_OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const WORKER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

function operatorError(message: string): never {
  throw new Error(`DNA population race index private Preview: ${message}`);
}

function identity(value: string, field: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 512 ||
    CONTROL_PATTERN.test(normalized)
  ) {
    operatorError(`${field} is invalid`);
  }
  return normalized;
}

function timestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    operatorError("attemptedAt is invalid");
  }
  return parsed.toISOString();
}

function safeReceipt(input: {
  status: DnaPopulationRaceIndexPrivatePreviewReceipt["status"];
  reason: string | null;
  exactCodeHeadSha: string;
  generationId: string;
  beforeRequestOrdinal: number;
  afterRequestOrdinal: number;
  processedReceiptCount: number;
  uniqueRaceCount: number;
  uniqueEntrantCoreCount: number;
  preflightSha256: string | null;
  providerCapacityBlockerIds?: readonly DnaOpenLabProviderCapacityBlockerId[];
  providerWritePerformed?: boolean;
}): DnaPopulationRaceIndexPrivatePreviewReceipt {
  return Object.freeze({
    ...input,
    providerCapacityBlockerIds: Object.freeze([
      ...(input.providerCapacityBlockerIds ?? []),
    ]),
    persistentWriteArmed: true as const,
    previewOnly: true as const,
    dnaProviderRequestCount: 0 as const,
    providerWritePerformed: input.providerWritePerformed ?? false,
    paidUsageAllowed: false as const,
    preserveLastGood: true as const,
  });
}

/**
 * Advances one bounded, immutable P5 receipt slice into owner-isolated Neon
 * staging. Capacity is measured before the first R2 read or database write;
 * publication is delegated to the repository and occurs only after the exact
 * immutable P5 totals reconcile.
 */
export function createDnaPopulationRaceIndexPrivatePreviewOperator(input: {
  configuredOwnerId: string;
  baseline: DnaPopulationRaceIndexBaselineReadPort;
  repository: DnaPopulationRaceIndexGenerationRepository;
  capacityPreflight: DnaOpenLabProviderCapacityPreflight;
  chunkStore: Readonly<{
    write: (request: {
      generationId: string;
      chunkOrdinal: number;
      documents: readonly import("./dna-population-race-index-checkpoint").DnaPopulationRaceIndexDocument[];
    }) => Promise<DnaPopulationRaceIndexR2ChunkWrite>;
  }>;
}): Readonly<{
  execute: (
    invocation: DnaPopulationRaceIndexPrivatePreviewInvocation,
  ) => Promise<DnaPopulationRaceIndexPrivatePreviewReceipt>;
}> {
  const configuredOwnerId = identity(
    input.configuredOwnerId,
    "configured owner",
  );

  return Object.freeze({
    async execute(invocation) {
      if (
        invocation.operatorVersion !==
          DNA_POPULATION_RACE_INDEX_PRIVATE_PREVIEW_OPERATOR_VERSION ||
        invocation.intent !==
          DNA_POPULATION_RACE_INDEX_PRIVATE_PREVIEW_INTENT ||
        invocation.allowPersistentWrite !== true
      ) {
        operatorError("invocation is not explicitly armed");
      }
      const ownerId = identity(
        invocation.authenticatedOwnerId,
        "authenticated owner",
      );
      if (ownerId !== configuredOwnerId) operatorError("owner scope denied");
      const exactCodeHeadSha = invocation.exactCodeHeadSha.trim().toLowerCase();
      if (!GIT_OBJECT_ID_PATTERN.test(exactCodeHeadSha)) {
        operatorError("exact code head is invalid");
      }
      if (!WORKER_PATTERN.test(invocation.workerId)) {
        operatorError("workerId is invalid");
      }
      const attemptedAt = timestamp(invocation.attemptedAt);
      if (
        !Number.isSafeInteger(invocation.maximumReceiptCount) ||
        invocation.maximumReceiptCount < 1 ||
        invocation.maximumReceiptCount >
          DNA_POPULATION_RACE_INDEX_MAXIMUM_RECEIPTS_PER_WRITE
      ) {
        operatorError("receipt bound is invalid");
      }

      const baselineState = await input.baseline.load();
      if (
        baselineState === null ||
        baselineState.status !== "complete" ||
        baselineState.completionSha256 === null ||
        baselineState.logicalRequestCount !==
          DNA_POPULATION_RACE_INDEX_P5_AUTHORITY.logicalRequestCount ||
        baselineState.nextRequestOrdinal !==
          DNA_POPULATION_RACE_INDEX_P5_AUTHORITY.logicalRequestCount + 1 ||
        baselineState.retainedR2Bytes !==
          DNA_POPULATION_RACE_INDEX_P5_AUTHORITY.retainedR2Bytes ||
        baselineState.omittedIdentityObservationCount !==
          DNA_POPULATION_RACE_INDEX_P5_AUTHORITY.omittedIdentityObservationCount
      ) {
        operatorError("immutable P5 baseline authority is unavailable");
      }
      const authority = createDnaPopulationRaceIndexAuthority({
        baselineCompletionSha256: baselineState.completionSha256,
        baselineLogicalRequestCount: baselineState.logicalRequestCount,
        baselineRetainedR2Bytes: baselineState.retainedR2Bytes,
        baselineOmittedIdentityObservationCount:
          baselineState.omittedIdentityObservationCount,
      });
      const existing = await input.repository.load(
        ownerId,
        authority.generationId,
      );
      if (existing?.state === "published") {
        return safeReceipt({
          status: "complete",
          reason: null,
          exactCodeHeadSha,
          generationId: authority.generationId,
          beforeRequestOrdinal: existing.lastRequestOrdinal,
          afterRequestOrdinal: existing.lastRequestOrdinal,
          processedReceiptCount: 0,
          uniqueRaceCount: existing.uniqueRaceCount,
          uniqueEntrantCoreCount: existing.uniqueEntrantCoreCount,
          preflightSha256: null,
        });
      }

      if (existing?.storageLayout === "legacy_neon_v1") {
        return safeReceipt({
          status: "held",
          reason: "population_r2_compaction_required",
          exactCodeHeadSha,
          generationId: authority.generationId,
          beforeRequestOrdinal: existing.lastRequestOrdinal,
          afterRequestOrdinal: existing.lastRequestOrdinal,
          processedReceiptCount: 0,
          uniqueRaceCount: existing.uniqueRaceCount,
          uniqueEntrantCoreCount: existing.uniqueEntrantCoreCount,
          preflightSha256: null,
        });
      }
      if (
        existing?.storageLayout === "r2_chunked_v1" &&
        existing.legacyStorageRetiredAt === null
      ) {
        return safeReceipt({
          status: "held",
          reason: "population_legacy_storage_not_retired",
          exactCodeHeadSha,
          generationId: authority.generationId,
          beforeRequestOrdinal: existing.lastRequestOrdinal,
          afterRequestOrdinal: existing.lastRequestOrdinal,
          processedReceiptCount: 0,
          uniqueRaceCount: existing.uniqueRaceCount,
          uniqueEntrantCoreCount: existing.uniqueEntrantCoreCount,
          preflightSha256: null,
        });
      }

      const beforeRequestOrdinal = existing?.lastRequestOrdinal ?? 0;
      const refreshCycleId = dnaOpenLabRawEvidenceSha256({
        domain: "dna-population-race-index-preview-cycle/v1",
        generationId: authority.generationId,
        beforeRequestOrdinal,
      });
      const budgetWindowId = dnaOpenLabRawEvidenceSha256({
        domain: "dna-population-race-index-preview-budget/v1",
        generationId: authority.generationId,
        attemptedAt,
      });
      const preflight = await input.capacityPreflight.inspect({
        preflightVersion: DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION,
        intent: DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT,
        authenticatedOwnerId: ownerId,
        exactCodeHeadSha,
        refreshCycleId,
        budgetWindowId,
        projectionHorizon: "single_refresh",
        plannedR2UsagePerRefresh:
          DNA_POPULATION_RACE_INDEX_PREVIEW_PLANNED_R2_USAGE,
        plannedNeonUsagePerRefresh:
          DNA_POPULATION_RACE_INDEX_PREVIEW_PLANNED_NEON_USAGE,
      });
      if (preflight.status !== "ready") {
        return safeReceipt({
          status: "held",
          reason: `provider_capacity_${preflight.reason}`,
          exactCodeHeadSha,
          generationId: authority.generationId,
          beforeRequestOrdinal,
          afterRequestOrdinal: beforeRequestOrdinal,
          processedReceiptCount: 0,
          uniqueRaceCount: existing?.uniqueRaceCount ?? 0,
          uniqueEntrantCoreCount: existing?.uniqueEntrantCoreCount ?? 0,
          preflightSha256: null,
          providerCapacityBlockerIds: preflight.blockerIds,
        });
      }

      let providerWritePerformed = false;
      let checkpoint =
        existing ??
        (await input.repository.begin(ownerId, {
          workerId: invocation.workerId,
          authority,
          startedAt: attemptedAt,
        }));
      if (checkpoint.state === "complete") {
        checkpoint = await input.repository.publish(ownerId, {
          workerId: invocation.workerId,
          generationId: authority.generationId,
          publishedAt: attemptedAt,
        });
      } else {
        const batch = await readDnaPopulationRaceIndexReceiptBatch({
          baseline: input.baseline,
          baselineCompletionSha256: authority.baselineCompletionSha256,
          baselineLogicalRequestCount: authority.baselineLogicalRequestCount,
          baselineRetainedR2Bytes: authority.baselineRetainedR2Bytes,
          baselineOmittedIdentityObservationCount:
            authority.baselineOmittedIdentityObservationCount,
          afterRequestOrdinal: checkpoint.lastRequestOrdinal,
          maximumReceiptCount: invocation.maximumReceiptCount,
        });
        if (batch.processedReceiptCount < 1) {
          operatorError("staging generation produced an empty receipt slice");
        }
        const writeBatch = createDnaPopulationRaceIndexWriteBatch(batch);
        const sourceRaceIds = Object.freeze([
          ...new Set(writeBatch.documents.map((document) => document.sourceRaceId)),
        ]);
        const existingIdentities = await input.repository.lookupIdentities(
          ownerId,
          {
            generationId: authority.generationId,
            sourceRaceIds,
          },
        );
        const plan = createDnaPopulationRaceIndexR2AppendPlan({
          batch: writeBatch,
          existingIdentities,
        });
        let chunk: DnaPopulationRaceIndexR2ChunkReceipt | null = null;
        providerWritePerformed = false;
        if (plan.newDocuments.length > 0) {
          const stored = await input.chunkStore.write({
            generationId: authority.generationId,
            chunkOrdinal: checkpoint.r2ChunkCount + 1,
            documents: plan.newDocuments,
          });
          chunk = stored.receipt;
          providerWritePerformed = stored.storageStatus === "created";
        }
        checkpoint = await input.repository.appendR2Batch(ownerId, {
          workerId: invocation.workerId,
          batch: writeBatch,
          newIdentities: plan.newIdentities,
          chunk,
          writtenAt: attemptedAt,
        });
        if (checkpoint.state === "complete") {
          checkpoint = await input.repository.publish(ownerId, {
            workerId: invocation.workerId,
            generationId: authority.generationId,
            publishedAt: attemptedAt,
          });
        }
      }

      return safeReceipt({
        status: checkpoint.state === "published" ? "complete" : "advanced",
        reason: null,
        exactCodeHeadSha,
        generationId: authority.generationId,
        beforeRequestOrdinal,
        afterRequestOrdinal: checkpoint.lastRequestOrdinal,
        processedReceiptCount:
          checkpoint.lastRequestOrdinal - beforeRequestOrdinal,
        uniqueRaceCount: checkpoint.uniqueRaceCount,
        uniqueEntrantCoreCount: checkpoint.uniqueEntrantCoreCount,
        preflightSha256: preflight.preflightSha256,
        providerWritePerformed,
      });
    },
  });
}
