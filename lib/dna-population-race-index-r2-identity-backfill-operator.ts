import type { DnaPopulationRaceIndexBaselineReadPort } from "./dna-population-race-index-checkpoint";
import type { DnaPopulationRaceIndexGenerationRepository } from "./dna-population-race-index-generation";
import type { DnaPopulationRaceIndexR2ChunkReceipt } from "./dna-population-race-index-r2-chunk";
import { DNA_POPULATION_RACE_INDEX_P5_AUTHORITY } from "./dna-population-race-index-private-preview-operator";
import {
  DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT,
  DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION,
  type DnaOpenLabProviderCapacityPreflight,
} from "./dna-open-lab-provider-capacity-preflight";
import type { DnaOpenLabProviderCapacityBlockerId } from "./dna-open-lab-zero-cost-provider-capacity";

export const DNA_POPULATION_RACE_INDEX_R2_IDENTITY_BACKFILL_OPERATOR_VERSION =
  "dna-population-race-index-r2-identity-backfill/v1" as const;
export const DNA_POPULATION_RACE_INDEX_R2_IDENTITY_BACKFILL_INTENT =
  "backfill_private_preview_population_race_identity_index" as const;

export const DNA_POPULATION_RACE_INDEX_R2_IDENTITY_BACKFILL_PLANNED_R2_USAGE =
  Object.freeze({
    storageBytes: 0,
    classAOperations: 0,
    classBOperations: 2,
  });

export const DNA_POPULATION_RACE_INDEX_R2_IDENTITY_BACKFILL_PLANNED_NEON_USAGE =
  Object.freeze({
    storageBytes: 1024 * 1024,
    computeMilliCuHours: 1_000,
  });

export type DnaPopulationRaceIndexR2IdentityBackfillInvocation = Readonly<{
  operatorVersion: typeof DNA_POPULATION_RACE_INDEX_R2_IDENTITY_BACKFILL_OPERATOR_VERSION;
  intent: typeof DNA_POPULATION_RACE_INDEX_R2_IDENTITY_BACKFILL_INTENT;
  allowPersistentWrite: true;
  authenticatedOwnerId: string;
  exactCodeHeadSha: string;
  workerId: string;
  attemptedAt: string;
}>;

export type DnaPopulationRaceIndexR2IdentityBackfillReceipt = Readonly<{
  status: "advanced" | "complete" | "held";
  reason: string | null;
  exactCodeHeadSha: string;
  generationId: string;
  beforeIdentityChunkCount: number;
  afterIdentityChunkCount: number;
  r2ChunkCount: number;
  uniqueRaceCount: number;
  providerCapacityBlockerIds: readonly DnaOpenLabProviderCapacityBlockerId[];
  r2ReadPerformed: boolean;
  persistentWriteArmed: true;
  previewOnly: true;
  dnaProviderRequestCount: 0;
  paidUsageAllowed: false;
  preserveLastGood: true;
}>;

const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const WORKER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

function backfillError(message: string): never {
  throw new Error(`DNA population race index R2 identity backfill: ${message}`);
}

function identity(value: string, field: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 512 ||
    CONTROL_PATTERN.test(normalized)
  ) {
    backfillError(`${field} is invalid`);
  }
  return normalized;
}

function timestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    backfillError("attemptedAt is invalid");
  }
  return value;
}

function receipt(
  input: Omit<
    DnaPopulationRaceIndexR2IdentityBackfillReceipt,
    | "persistentWriteArmed"
    | "previewOnly"
    | "dnaProviderRequestCount"
    | "paidUsageAllowed"
    | "preserveLastGood"
  >,
): DnaPopulationRaceIndexR2IdentityBackfillReceipt {
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

export function createDnaPopulationRaceIndexR2IdentityBackfillOperator(input: {
  configuredOwnerId: string;
  baseline: Pick<DnaPopulationRaceIndexBaselineReadPort, "load">;
  repository: DnaPopulationRaceIndexGenerationRepository;
  capacityPreflight: DnaOpenLabProviderCapacityPreflight;
  chunkStore: Readonly<{
    read: (receipt: DnaPopulationRaceIndexR2ChunkReceipt) => Promise<
      readonly Readonly<{
        sourceRaceId: string;
        rawEvidenceSha256: string;
      }>[]
    >;
  }>;
}): Readonly<{
  execute: (
    invocation: DnaPopulationRaceIndexR2IdentityBackfillInvocation,
  ) => Promise<DnaPopulationRaceIndexR2IdentityBackfillReceipt>;
}> {
  const configuredOwnerId = identity(
    input.configuredOwnerId,
    "configured owner",
  );

  return Object.freeze({
    async execute(invocation) {
      if (
        invocation.operatorVersion !==
          DNA_POPULATION_RACE_INDEX_R2_IDENTITY_BACKFILL_OPERATOR_VERSION ||
        invocation.intent !==
          DNA_POPULATION_RACE_INDEX_R2_IDENTITY_BACKFILL_INTENT ||
        invocation.allowPersistentWrite !== true
      ) {
        backfillError("invocation is not explicitly armed");
      }
      const ownerId = identity(
        invocation.authenticatedOwnerId,
        "authenticated owner",
      );
      if (ownerId !== configuredOwnerId) backfillError("owner scope denied");
      const exactCodeHeadSha = invocation.exactCodeHeadSha.trim().toLowerCase();
      if (!COMMIT_PATTERN.test(exactCodeHeadSha)) {
        backfillError("exact code head is invalid");
      }
      if (!WORKER_PATTERN.test(invocation.workerId)) {
        backfillError("workerId is invalid");
      }
      const attemptedAt = timestamp(invocation.attemptedAt);

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
        backfillError("immutable P5 baseline authority is unavailable");
      }

      const generationId = baseline.completionSha256;
      let checkpoint = await input.repository.load(ownerId, generationId);
      if (
        checkpoint === null ||
        checkpoint.storageLayout !== "r2_chunked_v1" ||
        checkpoint.compactedAt === null ||
        checkpoint.legacyStorageRetiredAt === null
      ) {
        backfillError("R2 cutover authority is unavailable");
      }
      if (checkpoint.r2IdentityChunkCount > checkpoint.r2ChunkCount) {
        backfillError("identity backfill counter exceeds R2 manifests");
      }
      const beforeIdentityChunkCount = checkpoint.r2IdentityChunkCount;
      if (beforeIdentityChunkCount === checkpoint.r2ChunkCount) {
        return receipt({
          status: "complete",
          reason: null,
          exactCodeHeadSha,
          generationId,
          beforeIdentityChunkCount,
          afterIdentityChunkCount: beforeIdentityChunkCount,
          r2ChunkCount: checkpoint.r2ChunkCount,
          uniqueRaceCount: checkpoint.uniqueRaceCount,
          providerCapacityBlockerIds: [],
          r2ReadPerformed: false,
        });
      }

      const preflight = await input.capacityPreflight.inspect({
        preflightVersion: DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION,
        intent: DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT,
        authenticatedOwnerId: ownerId,
        exactCodeHeadSha,
        refreshCycleId: generationId,
        budgetWindowId: generationId,
        projectionHorizon: "single_refresh",
        plannedR2UsagePerRefresh:
          DNA_POPULATION_RACE_INDEX_R2_IDENTITY_BACKFILL_PLANNED_R2_USAGE,
        plannedNeonUsagePerRefresh:
          DNA_POPULATION_RACE_INDEX_R2_IDENTITY_BACKFILL_PLANNED_NEON_USAGE,
      });
      if (preflight.status !== "ready") {
        return receipt({
          status: "held",
          reason: `provider_capacity_${preflight.reason}`,
          exactCodeHeadSha,
          generationId,
          beforeIdentityChunkCount,
          afterIdentityChunkCount: beforeIdentityChunkCount,
          r2ChunkCount: checkpoint.r2ChunkCount,
          uniqueRaceCount: checkpoint.uniqueRaceCount,
          providerCapacityBlockerIds: preflight.blockerIds,
          r2ReadPerformed: false,
        });
      }

      const manifests = await input.repository.listR2ChunkManifests(ownerId, {
        generationId,
        afterChunkOrdinal: beforeIdentityChunkCount,
        limit: 1,
      });
      if (
        manifests.length !== 1 ||
        manifests[0]!.chunkOrdinal !== beforeIdentityChunkCount + 1 ||
        manifests[0]!.identityRegisteredAt !== null
      ) {
        backfillError("next R2 identity manifest is unavailable");
      }
      const manifest = manifests[0]!;
      const documents = await input.chunkStore.read(manifest);
      const identities = Object.freeze(
        documents.map((document) =>
          Object.freeze({
            sourceRaceId: document.sourceRaceId,
            rawEvidenceSha256: document.rawEvidenceSha256,
          }),
        ),
      );
      checkpoint = await input.repository.registerCompactIdentityChunk(
        ownerId,
        {
          workerId: invocation.workerId,
          generationId,
          chunkOrdinal: manifest.chunkOrdinal,
          identities,
          registeredAt: attemptedAt,
        },
      );
      if (
        checkpoint.r2IdentityChunkCount !== beforeIdentityChunkCount + 1 ||
        checkpoint.r2IdentityChunkCount > checkpoint.r2ChunkCount
      ) {
        backfillError(
          "identity backfill checkpoint did not advance exactly once",
        );
      }

      return receipt({
        status:
          checkpoint.r2IdentityChunkCount === checkpoint.r2ChunkCount
            ? "complete"
            : "advanced",
        reason: null,
        exactCodeHeadSha,
        generationId,
        beforeIdentityChunkCount,
        afterIdentityChunkCount: checkpoint.r2IdentityChunkCount,
        r2ChunkCount: checkpoint.r2ChunkCount,
        uniqueRaceCount: checkpoint.uniqueRaceCount,
        providerCapacityBlockerIds: [],
        r2ReadPerformed: true,
      });
    },
  });
}
