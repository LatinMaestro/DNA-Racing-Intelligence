import {
  assessDnaOpenLabCombinedHistoryPerformanceEvidence,
  type DnaOpenLabP5FinishedHistoryReadPort,
} from "./dna-open-lab-combined-history-performance-evidence";
import type { DnaPopulationEntrantAuthorityCheckpointAuthority } from "./dna-population-entrant-authority-checkpoint";
import type { DnaPopulationEntrantAuthorityLiveAuditSource } from "./dna-population-entrant-authority-cohort-command";
import {
  planDnaPopulationHistoryAcquisition,
  type DnaPopulationHistoryAcquisitionPlan,
} from "./dna-population-history-acquisition-plan";
import type { DnaPopulationRaceIndexDocument } from "./dna-population-race-index-checkpoint";
import type {
  DnaPopulationRaceIndexGenerationRepository,
  DnaPopulationRaceIndexR2ChunkManifest,
} from "./dna-population-race-index-generation";
import { DNA_POPULATION_RACE_INDEX_P5_AUTHORITY } from "./dna-population-race-index-private-preview-operator";
import type { createDnaPopulationRaceIndexR2ChunkStore } from "./dna-population-race-index-r2-chunk";
import type { DnaOpenLabProviderCapacityMeasurementSource } from "./dna-open-lab-provider-capacity-preflight";
import type { CanonicalRaceDocumentMetadata } from "./dna-open-lab-v1-adapters";
import type { NeonDnaOpenLabSyncPublicationRepository } from "./neon-dna-open-lab-sync-publication";
import type { PrivateDatasetEvidenceObjectReadableStoragePort } from "./private-dataset-evidence-object-reader";
import type { PrivateDatasetEvidenceObjectStoragePort } from "./private-dataset-evidence-object-writer";
import { DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS } from "./dna-open-lab-zero-cost-refresh-policy";

const GIT_OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const MANIFEST_PAGE_LIMIT = 100 as const;
const CHUNK_READ_CONCURRENCY = 24 as const;

export const DNA_POPULATION_ENTRANT_LIVE_AUDIT_MAXIMUM_CLASS_B_OPERATIONS =
  100_000 as const;

type PopulationIndexReadRepository = Pick<
  DnaPopulationRaceIndexGenerationRepository,
  "load" | "listPublishedR2ChunkManifests"
>;

type PopulationChunkReadStore = Pick<
  ReturnType<typeof createDnaPopulationRaceIndexR2ChunkStore>,
  "read"
>;

type FinishedHistorySource = Pick<
  NeonDnaOpenLabSyncPublicationRepository,
  "readServingFinishedHistory"
>;

type ReadableEvidenceStorage = Pick<
  PrivateDatasetEvidenceObjectStoragePort,
  "readBucketPrivacy" | "headObject"
> &
  Pick<PrivateDatasetEvidenceObjectReadableStoragePort, "getObject">;

function auditError(message: string): never {
  throw new Error(`Population entrant live audit: ${message}`);
}

function identity(value: string, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 512 ||
    CONTROL_PATTERN.test(value)
  ) {
    auditError(`${field} is invalid`);
  }
  return value;
}

function exactHead(value: string): string {
  const normalized = identity(value, "exactCodeHeadSha").toLowerCase();
  if (!GIT_OBJECT_ID_PATTERN.test(normalized)) {
    auditError("exactCodeHeadSha is invalid");
  }
  return normalized;
}

function safeAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) {
    auditError("provider capacity accounting is invalid");
  }
  return value;
}

function sameRequest(input: {
  configuredOwnerId: string;
  configuredHead: string;
  requestedOwnerId: string;
  requestedHead: string;
}): void {
  if (
    identity(input.requestedOwnerId, "ownerId") !== input.configuredOwnerId ||
    exactHead(input.requestedHead) !== input.configuredHead
  ) {
    auditError("request binding is invalid");
  }
}

function validateManifestSequence(input: {
  manifests: readonly DnaPopulationRaceIndexR2ChunkManifest[];
  expectedCount: number;
  expectedRaceCount: number;
}): void {
  if (input.manifests.length !== input.expectedCount) {
    auditError("published manifest count is invalid");
  }
  let rowCount = 0;
  for (const [index, manifest] of input.manifests.entries()) {
    if (
      manifest.version !== 1 ||
      manifest.chunkOrdinal !== index + 1 ||
      manifest.identityRegisteredAt === null ||
      !Number.isSafeInteger(manifest.rowCount) ||
      manifest.rowCount < 1
    ) {
      auditError("published manifest sequence is invalid");
    }
    rowCount += manifest.rowCount;
    if (!Number.isSafeInteger(rowCount)) {
      auditError("published manifest row count is invalid");
    }
  }
  if (rowCount !== input.expectedRaceCount) {
    auditError("published manifest rows do not reconcile");
  }
}

function validateChunkDocuments(input: {
  manifest: DnaPopulationRaceIndexR2ChunkManifest;
  documents: readonly DnaPopulationRaceIndexDocument[];
  seenRaceIds: Set<string>;
}): void {
  if (
    input.documents.length !== input.manifest.rowCount ||
    input.documents[0]?.sourceRaceId !== input.manifest.firstSourceRaceId ||
    input.documents.at(-1)?.sourceRaceId !== input.manifest.lastSourceRaceId
  ) {
    auditError("published chunk disagrees with its manifest");
  }
  let last: string | null = null;
  for (const document of input.documents) {
    if (
      document.canonical.sourceType !== "race_document" ||
      document.canonical.sourceRaceId !== document.sourceRaceId ||
      document.sourceRaceId.trim() !== document.sourceRaceId ||
      document.sourceRaceId.length < 1 ||
      CONTROL_PATTERN.test(document.sourceRaceId) ||
      (last !== null && document.sourceRaceId <= last)
    ) {
      auditError("published Race document sequence is invalid");
    }
    if (input.seenRaceIds.has(document.sourceRaceId)) {
      auditError("published Race identity is duplicated across chunks");
    }
    input.seenRaceIds.add(document.sourceRaceId);
    last = document.sourceRaceId;
  }
}

function entrantAuthority(
  plan: DnaPopulationHistoryAcquisitionPlan,
): DnaPopulationEntrantAuthorityCheckpointAuthority {
  if (
    plan.status !== "held_incomplete_race_authority" ||
    plan.unresolvedRaceCount < 1 ||
    plan.unresolvedRaceSetSha256 === null
  ) {
    auditError("unresolved Race authority is unavailable");
  }
  return Object.freeze({
    version: 1 as const,
    generationId: plan.unresolvedRaceSetSha256,
    unresolvedRaceCount: plan.unresolvedRaceCount,
    unresolvedRaceSetSha256: plan.unresolvedRaceSetSha256,
  });
}

export function createDnaPopulationEntrantAuthorityLiveAuditSource(input: {
  configuredOwnerId: string;
  exactCodeHeadSha: string;
  bucketName: string;
  baseline: DnaOpenLabP5FinishedHistoryReadPort;
  historySource: FinishedHistorySource;
  populationIndex: PopulationIndexReadRepository;
  chunkStore: PopulationChunkReadStore;
  storage: ReadableEvidenceStorage;
  capacitySource: DnaOpenLabProviderCapacityMeasurementSource;
  assessCombinedHistory?: typeof assessDnaOpenLabCombinedHistoryPerformanceEvidence;
}): DnaPopulationEntrantAuthorityLiveAuditSource {
  const configuredOwnerId = identity(
    input.configuredOwnerId,
    "configuredOwnerId",
  );
  const configuredHead = exactHead(input.exactCodeHeadSha);
  const bucketName = identity(input.bucketName, "bucketName");
  const assessCombinedHistory =
    input.assessCombinedHistory ??
    assessDnaOpenLabCombinedHistoryPerformanceEvidence;

  return Object.freeze({
    async load(request) {
      sameRequest({
        configuredOwnerId,
        configuredHead,
        requestedOwnerId: request.ownerId,
        requestedHead: request.exactCodeHeadSha,
      });

      if (input.capacitySource.status !== "ready") {
        auditError("provider capacity measurement is unavailable");
      }
      const capacity = await input.capacitySource.measure({
        ownerId: configuredOwnerId,
      });
      if (
        capacity.r2StorageClass !== "Standard" ||
        safeAdd(
          capacity.currentR2Usage.classBOperations,
          DNA_POPULATION_ENTRANT_LIVE_AUDIT_MAXIMUM_CLASS_B_OPERATIONS,
        ) > DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.classBOperations
      ) {
        auditError("published Race audit read budget is unavailable");
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
        auditError("immutable P5 baseline authority is unavailable");
      }

      const populationIndex = await input.populationIndex.load(
        configuredOwnerId,
        baseline.completionSha256,
      );
      if (
        populationIndex === null ||
        populationIndex.state !== "published" ||
        populationIndex.generationId !== baseline.completionSha256 ||
        populationIndex.lastRequestOrdinal !== baseline.logicalRequestCount ||
        populationIndex.processedReceiptCount !==
          baseline.logicalRequestCount ||
        populationIndex.processedReceiptBytes !== baseline.retainedR2Bytes ||
        populationIndex.processedIdentityOmissionCount !==
          baseline.omittedIdentityObservationCount ||
        populationIndex.storageLayout !== "r2_chunked_v1" ||
        populationIndex.r2ChunkCount < 1 ||
        populationIndex.r2IdentityChunkCount !== populationIndex.r2ChunkCount ||
        populationIndex.r2CompactedRaceCount !==
          populationIndex.uniqueRaceCount ||
        populationIndex.r2LastSourceRaceId === null ||
        populationIndex.legacyStorageRetiredAt === null
      ) {
        auditError("published compact P5 population authority is unavailable");
      }

      const manifests: DnaPopulationRaceIndexR2ChunkManifest[] = [];
      let afterChunkOrdinal = 0;
      while (manifests.length < populationIndex.r2ChunkCount) {
        const page = await input.populationIndex.listPublishedR2ChunkManifests(
          configuredOwnerId,
          {
            generationId: baseline.completionSha256,
            afterChunkOrdinal,
            limit: MANIFEST_PAGE_LIMIT,
          },
        );
        if (
          page.length < 1 ||
          page.length > MANIFEST_PAGE_LIMIT ||
          manifests.length + page.length > populationIndex.r2ChunkCount
        ) {
          auditError("published manifest pagination is invalid");
        }
        manifests.push(...page);
        afterChunkOrdinal = page.at(-1)!.chunkOrdinal;
      }

      validateManifestSequence({
        manifests,
        expectedCount: populationIndex.r2ChunkCount,
        expectedRaceCount: populationIndex.uniqueRaceCount,
      });

      const raceDocuments: CanonicalRaceDocumentMetadata[] = [];
      const seenRaceIds = new Set<string>();
      const baselineR2ClassBOperations = manifests.length * 2;
      if (
        !Number.isSafeInteger(baselineR2ClassBOperations) ||
        baselineR2ClassBOperations < 1 ||
        baselineR2ClassBOperations >
          DNA_POPULATION_ENTRANT_LIVE_AUDIT_MAXIMUM_CLASS_B_OPERATIONS
      ) {
        auditError("compact P5 read budget is invalid");
      }

      const history = await input.historySource.readServingFinishedHistory({
        ownerId: configuredOwnerId,
      });
      const assessment = await assessCombinedHistory({
        ownerId: configuredOwnerId,
        bucketName,
        baselineAuthority: Object.freeze({
          logicalRequestCount: baseline.logicalRequestCount,
          retainedR2Bytes: baseline.retainedR2Bytes,
          omittedIdentityObservationCount:
            baseline.omittedIdentityObservationCount,
          completionSha256: baseline.completionSha256,
        }),
        baseline: input.baseline,
        baselineIndex: Object.freeze({
          scanDocuments: async (accept) => {
            let scannedRaceCount = 0;
            for (
              let start = 0;
              start < manifests.length;
              start += CHUNK_READ_CONCURRENCY
            ) {
              const batch = manifests.slice(
                start,
                start + CHUNK_READ_CONCURRENCY,
              );
              const chunks = await Promise.all(
                batch.map((manifest) => input.chunkStore.read(manifest)),
              );
              for (const [index, documents] of chunks.entries()) {
                validateChunkDocuments({
                  manifest: batch[index]!,
                  documents,
                  seenRaceIds,
                });
                for (const document of documents) {
                  accept(document);
                  scannedRaceCount += 1;
                }
              }
            }
            if (
              scannedRaceCount !== populationIndex.uniqueRaceCount ||
              seenRaceIds.size !== populationIndex.uniqueRaceCount
            ) {
              auditError("published Race documents do not reconcile");
            }
          },
          baselineReceiptCount: populationIndex.processedReceiptCount,
          baselineFinishedRaceReceiptCount:
            populationIndex.finishedRaceReceiptCount,
          baselineIdentityOmissionObservationCount:
            populationIndex.processedIdentityOmissionCount,
          r2ClassBOperationsUsed: baselineR2ClassBOperations,
        }),
        history,
        storage: input.storage,
        readBudget: Object.freeze({
          maximumClassBOperations:
            DNA_POPULATION_ENTRANT_LIVE_AUDIT_MAXIMUM_CLASS_B_OPERATIONS,
          paidUsageAllowed: false as const,
        }),
        canonicalPurpose: "population_inventory",
        onCanonicalRaceDocument: (document) => {
          raceDocuments.push(document);
        },
      });

      if (
        assessment.authority !==
          "complete_serving_generation_combined_finished_history" ||
        assessment.uniqueRaceCount !== raceDocuments.length ||
        assessment.conflictingRaceEvidenceCount !== 0 ||
        assessment.persistentWritePerformed !== false ||
        assessment.paidUsageAllowed !== false
      ) {
        auditError("combined Race authority did not reconcile");
      }

      const plan = planDnaPopulationHistoryAcquisition({
        raceDocuments: Object.freeze(raceDocuments),
      });
      const authority = entrantAuthority(plan);

      return Object.freeze({
        exactCodeHeadSha: configuredHead,
        plan,
        raceDocuments: Object.freeze(raceDocuments),
        authority,
      });
    },
  });
}
