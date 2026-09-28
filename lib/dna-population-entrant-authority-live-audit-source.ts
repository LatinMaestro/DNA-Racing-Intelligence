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
import {
  DnaOpenLabProviderCapacityMeasurementError,
  type DnaOpenLabProviderCapacityMeasurementFailureId,
  type DnaOpenLabProviderCapacityMeasurementSource,
} from "./dna-open-lab-provider-capacity-preflight";
import type { CanonicalRaceDocumentMetadata } from "./dna-open-lab-v1-adapters";
import type { NeonDnaOpenLabSyncPublicationRepository } from "./neon-dna-open-lab-sync-publication";
import type { PrivateDatasetEvidenceObjectReadableStoragePort } from "./private-dataset-evidence-object-reader";
import type { PrivateDatasetEvidenceObjectStoragePort } from "./private-dataset-evidence-object-writer";
import { DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS } from "./dna-open-lab-zero-cost-refresh-policy";

const GIT_OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const MANIFEST_PAGE_LIMIT = 100 as const;
const CHUNK_READ_CONCURRENCY = 24 as const;

export type DnaPopulationEntrantAuthorityLiveAuditDiagnostic =
  | "request_binding_unavailable"
  | "cached_authority_unavailable"
  | "authority_capacity_not_configured"
  | "authority_capacity_measurement_unavailable"
  | `authority_capacity_measurement_${DnaOpenLabProviderCapacityMeasurementFailureId}`
  | "authority_capacity_storage_class_unavailable"
  | "authority_capacity_read_budget_unavailable"
  | "baseline_authority_unavailable"
  | "population_index_unavailable"
  | "manifest_authority_unavailable"
  | "serving_history_unavailable"
  | "combined_history_unavailable"
  | "acquisition_plan_unavailable";

export class DnaPopulationEntrantAuthorityLiveAuditError extends Error {
  readonly diagnostic: DnaPopulationEntrantAuthorityLiveAuditDiagnostic;

  constructor(diagnostic: DnaPopulationEntrantAuthorityLiveAuditDiagnostic) {
    super(`Population entrant live audit is unavailable: ${diagnostic}`);
    this.name = "DnaPopulationEntrantAuthorityLiveAuditError";
    this.diagnostic = diagnostic;
  }
}

function liveAuditUnavailable(
  diagnostic: DnaPopulationEntrantAuthorityLiveAuditDiagnostic,
): never {
  throw new DnaPopulationEntrantAuthorityLiveAuditError(diagnostic);
}

function liveAuditStage<T>(
  diagnostic: DnaPopulationEntrantAuthorityLiveAuditDiagnostic,
  operation: () => T,
): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof DnaPopulationEntrantAuthorityLiveAuditError) {
      throw error;
    }
    liveAuditUnavailable(diagnostic);
  }
}

function liveAuditFailure(
  diagnostic: DnaPopulationEntrantAuthorityLiveAuditDiagnostic,
  error: unknown,
): never {
  if (error instanceof DnaPopulationEntrantAuthorityLiveAuditError) {
    throw error;
  }
  liveAuditUnavailable(diagnostic);
}

function liveAuditCapacityFailure(error: unknown): never {
  if (error instanceof DnaOpenLabProviderCapacityMeasurementError) {
    liveAuditUnavailable(`authority_capacity_measurement_${error.failureId}`);
  }
  liveAuditUnavailable("authority_capacity_measurement_unavailable");
}

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
  fullAuditReuseCount?: number;
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
  const fullAuditReuseCount = input.fullAuditReuseCount ?? 0;
  if (
    !Number.isSafeInteger(fullAuditReuseCount) ||
    fullAuditReuseCount < 0 ||
    fullAuditReuseCount > 64
  ) {
    auditError("full audit reuse configuration is invalid");
  }
  let cachedAudit: Awaited<
    ReturnType<DnaPopulationEntrantAuthorityLiveAuditSource["load"]>
  > | null = null;
  let cachedAuthorityFingerprint: string | null = null;
  let cachedBaselineCompletionSha256: string | null = null;
  let remainingAuditReuses = 0;

  function fingerprint(input: {
    baseline: unknown;
    populationIndex: unknown;
    history: unknown;
  }): string {
    return JSON.stringify({
      baseline: input.baseline,
      populationIndex: input.populationIndex,
      history: input.history,
    });
  }

  return Object.freeze({
    async load(request) {
      liveAuditStage("request_binding_unavailable", () =>
        sameRequest({
          configuredOwnerId,
          configuredHead,
          requestedOwnerId: request.ownerId,
          requestedHead: request.exactCodeHeadSha,
        }),
      );

      if (
        cachedAudit !== null &&
        cachedAuthorityFingerprint !== null &&
        remainingAuditReuses > 0
      ) {
        const completionSha256 = cachedBaselineCompletionSha256;
        if (completionSha256 === null) {
          liveAuditUnavailable("cached_authority_unavailable");
        }
        const [baseline, populationIndex, history] = await Promise.all([
          input.baseline.load(),
          input.populationIndex.load(configuredOwnerId, completionSha256),
          input.historySource.readServingFinishedHistory({
            ownerId: configuredOwnerId,
          }),
        ]).catch((error: unknown) =>
          liveAuditFailure("cached_authority_unavailable", error),
        );
        if (
          baseline === null ||
          populationIndex === null ||
          fingerprint({
            baseline,
            populationIndex,
            history,
          }) !== cachedAuthorityFingerprint
        ) {
          cachedAudit = null;
          cachedAuthorityFingerprint = null;
          cachedBaselineCompletionSha256 = null;
          remainingAuditReuses = 0;
          liveAuditUnavailable("cached_authority_unavailable");
        }
        remainingAuditReuses -= 1;
        const reused = cachedAudit;
        if (remainingAuditReuses === 0) {
          cachedAudit = null;
          cachedAuthorityFingerprint = null;
          cachedBaselineCompletionSha256 = null;
        }
        return reused;
      }

      if (input.capacitySource.status !== "ready") {
        liveAuditUnavailable("authority_capacity_not_configured");
      }
      const capacity = await input.capacitySource
        .measure({ ownerId: configuredOwnerId })
        .catch((error: unknown) => liveAuditCapacityFailure(error));
      if (capacity.r2StorageClass !== "Standard") {
        liveAuditUnavailable("authority_capacity_storage_class_unavailable");
      }
      const baseline = await input.baseline
        .load()
        .catch((error: unknown) =>
          liveAuditFailure("baseline_authority_unavailable", error),
        );
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
        liveAuditUnavailable("baseline_authority_unavailable");
      }

      const populationIndex = await input.populationIndex
        .load(configuredOwnerId, baseline.completionSha256)
        .catch((error: unknown) =>
          liveAuditFailure("population_index_unavailable", error),
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
        liveAuditUnavailable("population_index_unavailable");
      }

      const manifests: DnaPopulationRaceIndexR2ChunkManifest[] = [];
      let afterChunkOrdinal = 0;
      while (manifests.length < populationIndex.r2ChunkCount) {
        const page = await input.populationIndex
          .listPublishedR2ChunkManifests(configuredOwnerId, {
            generationId: baseline.completionSha256,
            afterChunkOrdinal,
            limit: MANIFEST_PAGE_LIMIT,
          })
          .catch((error: unknown) =>
            liveAuditFailure("manifest_authority_unavailable", error),
          );
        if (
          page.length < 1 ||
          page.length > MANIFEST_PAGE_LIMIT ||
          manifests.length + page.length > populationIndex.r2ChunkCount
        ) {
          liveAuditUnavailable("manifest_authority_unavailable");
        }
        manifests.push(...page);
        afterChunkOrdinal = page.at(-1)!.chunkOrdinal;
      }

      liveAuditStage("manifest_authority_unavailable", () =>
        validateManifestSequence({
          manifests,
          expectedCount: populationIndex.r2ChunkCount,
          expectedRaceCount: populationIndex.uniqueRaceCount,
        }),
      );

      const raceDocuments: CanonicalRaceDocumentMetadata[] = [];
      const seenRaceIds = new Set<string>();
      const baselineR2ClassBOperations = manifests.length * 2;
      if (
        !Number.isSafeInteger(baselineR2ClassBOperations) ||
        baselineR2ClassBOperations < 1 ||
        baselineR2ClassBOperations >
          DNA_POPULATION_ENTRANT_LIVE_AUDIT_MAXIMUM_CLASS_B_OPERATIONS
      ) {
        liveAuditUnavailable("manifest_authority_unavailable");
      }

      const history = await input.historySource
        .readServingFinishedHistory({ ownerId: configuredOwnerId })
        .catch((error: unknown) =>
          liveAuditFailure("serving_history_unavailable", error),
        );
      const maximumClassBOperations = liveAuditStage(
        "authority_capacity_read_budget_unavailable",
        () => {
          // Each baseline chunk, incremental manifest and Race document
          // consumes one HEAD plus one GET. Their counts are known before any
          // R2 evidence read, so the complete known floor must fit first.
          // Quarantine count is intentionally enforced later by the evidence
          // reader's reserve-before-access guard as manifests reveal it.
          const knownIncrementalObjectCount = safeAdd(
            history.receiptCount,
            history.documentCount,
          );
          const minimumKnownReadOperations = safeAdd(
            baselineR2ClassBOperations,
            safeAdd(knownIncrementalObjectCount, knownIncrementalObjectCount),
          );
          if (
            safeAdd(
              capacity.currentR2Usage.classBOperations,
              minimumKnownReadOperations,
            ) > DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.classBOperations
          ) {
            liveAuditUnavailable("authority_capacity_read_budget_unavailable");
          }
          return Math.min(
            DNA_POPULATION_ENTRANT_LIVE_AUDIT_MAXIMUM_CLASS_B_OPERATIONS,
            DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.classBOperations -
              capacity.currentR2Usage.classBOperations,
          );
        },
      );
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
          maximumClassBOperations,
          paidUsageAllowed: false as const,
        }),
        canonicalPurpose: "population_inventory",
        onCanonicalRaceDocument: (document) => {
          raceDocuments.push(document);
        },
      }).catch((error: unknown) =>
        liveAuditFailure("combined_history_unavailable", error),
      );

      if (
        assessment.authority !==
          "complete_serving_generation_combined_finished_history" ||
        assessment.uniqueRaceCount !== raceDocuments.length ||
        assessment.conflictingRaceEvidenceCount !== 0 ||
        assessment.persistentWritePerformed !== false ||
        assessment.paidUsageAllowed !== false
      ) {
        liveAuditUnavailable("combined_history_unavailable");
      }

      const plan = liveAuditStage("acquisition_plan_unavailable", () =>
        planDnaPopulationHistoryAcquisition({
          raceDocuments: Object.freeze(raceDocuments),
        }),
      );
      const authority = liveAuditStage("acquisition_plan_unavailable", () =>
        entrantAuthority(plan),
      );

      const audit = Object.freeze({
        exactCodeHeadSha: configuredHead,
        plan,
        raceDocuments: Object.freeze(raceDocuments),
        authority,
      });
      if (fullAuditReuseCount > 0) {
        cachedAudit = audit;
        cachedBaselineCompletionSha256 = baseline.completionSha256;
        cachedAuthorityFingerprint = fingerprint({
          baseline,
          populationIndex,
          history,
        });
        remainingAuditReuses = fullAuditReuseCount;
      }
      return audit;
    },
  });
}
