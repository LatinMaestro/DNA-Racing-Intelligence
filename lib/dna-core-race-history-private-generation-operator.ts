import type { DnaCoreRaceHistoryAcquisitionRepository } from "./dna-core-race-history-acquisition-cycle";
import type { DnaCoreRaceHistoryClient } from "./dna-core-race-history-client";
import {
  DNA_CORE_RACE_HISTORY_MATERIALIZER_MAXIMUM_PAGES,
  DNA_CORE_RACE_HISTORY_PAGE_READ_CLASS_B_OPERATION_CEILING,
  DNA_CORE_RACE_HISTORY_RACE_DOCUMENT_BATCH_SIZE,
  materializeAndPublishLatestDnaCoreRaceHistory,
  type DnaCoreRaceHistoryGenerationMaterializerResult,
} from "./dna-core-race-history-generation-materializer";
import type { DnaCoreRaceHistoryGenerationRepository } from "./dna-core-race-history-generation";
import {
  runDnaCoreRaceHistoryPrivateCollectorStep,
  type DnaCoreRaceHistoryPrivateCollectorResult,
  type DnaCoreRaceHistoryServingAuthorityRow,
} from "./dna-core-race-history-private-collector";
import type {
  DnaCoreRaceHistoryMaterializationEvidenceStore,
  DnaCoreRaceHistoryR2EvidenceStore,
} from "./dna-core-race-history-r2-evidence";
import { DNA_CORE_RACE_HISTORY_RACE_DOCUMENT_CACHE_MAXIMUM_OBJECT_BYTES } from "./dna-core-race-history-r2-evidence";
import {
  DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
  type DnaOpenLabRequestBudget,
} from "./dna-open-lab-request-budget";
import type {
  DnaOpenLabR2BudgetRepository,
  DnaOpenLabR2BudgetReservationDecision,
} from "./dna-open-lab-r2-budget-repository";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";
import type { DnaOpenLabClient } from "./dna-open-lab-v1-client";
import { hydrateDnaRaceDocuments } from "./dna-open-lab-race-document-hydrator";
import { DNA_OPEN_LAB_MAX_RECURRING_R2_OPERATIONS_PER_DAILY_REFRESH } from "./dna-open-lab-zero-cost-refresh-policy";

export const DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_OPERATOR_VERSION =
  "dna-core-race-history-private-generation/v1" as const;
export const DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_INTENT =
  "advance_private_core_result_generation" as const;
export const DNA_CORE_RACE_HISTORY_COMMISSIONING_MATERIALIZATION_CLASS_B_OPERATION_CEILING =
  DNA_CORE_RACE_HISTORY_MATERIALIZER_MAXIMUM_PAGES *
  DNA_CORE_RACE_HISTORY_PAGE_READ_CLASS_B_OPERATION_CEILING;

export type DnaCoreRaceHistoryPrivateGenerationInvocation = Readonly<{
  operatorVersion: typeof DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_OPERATOR_VERSION;
  intent: typeof DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_INTENT;
  allowPersistentWrite: true;
  authenticatedOwnerId: string;
  budgetWindowId: string;
  evaluatedAt: string;
  attemptedAt: string;
  workerId: string;
  materializedAt: string;
  publishedAt: string;
  maximumRetainedEvidenceClassBOperations: number;
  maximumAggregateRequestsPerMinute?: number;
}>;

export type DnaCoreRaceHistoryPrivateGenerationSources = Readonly<{
  loadServingCores: () => Promise<
    readonly DnaCoreRaceHistoryServingAuthorityRow[]
  >;
  client: DnaCoreRaceHistoryClient;
  requestBudget: DnaOpenLabRequestBudget;
  evidenceStore: DnaCoreRaceHistoryR2EvidenceStore &
    DnaCoreRaceHistoryMaterializationEvidenceStore;
  raceDocumentClient: Pick<DnaOpenLabClient, "raceDocs">;
}>;

export type DnaCoreRaceHistoryPrivateGenerationRepositories = Readonly<{
  acquisition: DnaCoreRaceHistoryAcquisitionRepository;
  budget: DnaOpenLabR2BudgetRepository;
  generation: DnaCoreRaceHistoryGenerationRepository;
}>;

export type DnaCoreRaceHistoryPrivateGenerationResult =
  | Readonly<{
      kind: "budget_unavailable";
      reason: "not_configured" | "window_missing" | "window_mismatch";
    }>
  | Readonly<{
      kind: "collection";
      step: DnaCoreRaceHistoryPrivateCollectorResult;
    }>
  | Readonly<{
      kind: "materialization_budget_blocked";
      blockerIds: readonly string[];
    }>
  | Readonly<{
      kind: "generation";
      result: DnaCoreRaceHistoryGenerationMaterializerResult;
    }>;

function operatorError(message: string): never {
  throw new Error(`DNA Core race history private generation: ${message}`);
}

function identity(value: string, field: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 512 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)
  ) {
    operatorError(`${field} is invalid`);
  }
  return normalized;
}

function operationCeiling(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value >
      DNA_CORE_RACE_HISTORY_COMMISSIONING_MATERIALIZATION_CLASS_B_OPERATION_CEILING
  ) {
    operatorError("retained-evidence Class B ceiling is invalid");
  }
  return value;
}

function assertConservativeRequestRate(input: {
  invocation: DnaCoreRaceHistoryPrivateGenerationInvocation;
  requestBudget: DnaOpenLabRequestBudget;
}): void {
  const requested =
    input.invocation.maximumAggregateRequestsPerMinute ??
    DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE;
  if (
    !Number.isSafeInteger(requested) ||
    requested < 1 ||
    requested > DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE ||
    input.requestBudget.snapshot().effectiveRequestsPerMinute > requested
  ) {
    operatorError("request rate exceeds the conservative aggregate limit");
  }
}

function materializationBudgetAuthority(input: {
  ownerId: string;
  cycleId: string;
  attemptNumber: number;
  requiredClassBOperations: number;
  chunkIndex: number;
  chunkCount: number;
  chunkClassBOperations: number;
}): Readonly<{ reservationId: string; requestSha256: string }> {
  const value = Object.freeze({
    version: "dna-core-race-history-materialization-budget/v2" as const,
    ownerId: input.ownerId,
    cycleId: input.cycleId,
    attemptNumber: input.attemptNumber,
    purpose: "materialize_complete_generation" as const,
    requiredClassBOperations: input.requiredClassBOperations,
    chunkIndex: input.chunkIndex,
    chunkCount: input.chunkCount,
    plannedUsage: Object.freeze({
      storageBytes: 0,
      classAOperations: 0,
      classBOperations: input.chunkClassBOperations,
    }),
  });
  return Object.freeze({
    reservationId: dnaOpenLabRawEvidenceSha256({
      domain: "dna-core-race-history-materialization-reservation/v1",
      value,
    }),
    requestSha256: dnaOpenLabRawEvidenceSha256({
      domain: "dna-core-race-history-materialization-request/v1",
      value,
    }),
  });
}

function materializationCacheBudgetAuthority(input: {
  ownerId: string;
  cycleId: string;
  attemptNumber: number;
  materializationAttemptedAt: string;
  batchCount: number;
  chunkIndex: number;
  chunkCount: number;
  chunkBatchCount: number;
}): Readonly<{
  reservationId: string;
  requestSha256: string;
  plannedUsage: Readonly<{
    storageBytes: number;
    classAOperations: number;
    classBOperations: number;
  }>;
}> {
  const plannedUsage = Object.freeze({
    storageBytes:
      input.chunkBatchCount *
      DNA_CORE_RACE_HISTORY_RACE_DOCUMENT_CACHE_MAXIMUM_OBJECT_BYTES,
    classAOperations: input.chunkBatchCount,
    classBOperations: input.chunkBatchCount * 2,
  });
  const value = Object.freeze({
    version: "dna-core-race-history-race-document-cache-budget/v1" as const,
    ownerId: input.ownerId,
    cycleId: input.cycleId,
    attemptNumber: input.attemptNumber,
    materializationAttemptedAt: input.materializationAttemptedAt,
    purpose: "retain_resumable_race_document_batches" as const,
    batchCount: input.batchCount,
    chunkIndex: input.chunkIndex,
    chunkCount: input.chunkCount,
    plannedUsage,
  });
  return Object.freeze({
    reservationId: dnaOpenLabRawEvidenceSha256({
      domain: "dna-core-race-history-race-document-cache-reservation/v1",
      value,
    }),
    requestSha256: dnaOpenLabRawEvidenceSha256({
      domain: "dna-core-race-history-race-document-cache-request/v1",
      value,
    }),
    plannedUsage,
  });
}

function requiredRetainedEvidenceClassBOperations(
  pageReceiptCount: number,
  maximumClassBOperations: number,
): number {
  if (!Number.isSafeInteger(pageReceiptCount) || pageReceiptCount < 1) {
    operatorError("complete page receipt count is invalid");
  }
  const required =
    pageReceiptCount *
    DNA_CORE_RACE_HISTORY_PAGE_READ_CLASS_B_OPERATION_CEILING;
  if (
    !Number.isSafeInteger(required) ||
    required < 1 ||
    required > maximumClassBOperations
  ) {
    operatorError("retained-evidence Class B requirement exceeds its ceiling");
  }
  return required;
}

function sameUsage(
  left: Readonly<{
    storageBytes: number;
    classAOperations: number;
    classBOperations: number;
  }> | null,
  right: Readonly<{
    storageBytes: number;
    classAOperations: number;
    classBOperations: number;
  }>,
): boolean {
  return (
    left !== null &&
    left.storageBytes === right.storageBytes &&
    left.classAOperations === right.classAOperations &&
    left.classBOperations === right.classBOperations
  );
}

function materializationBudgetDecision(
  decision: DnaOpenLabR2BudgetReservationDecision,
): "ready" | "blocked" {
  if (
    decision.paidUsageAllowed !== false ||
    decision.preserveLastGood !== true
  ) {
    return operatorError("materialization budget safety authority drifted");
  }
  if (decision.allowed) {
    if (
      (decision.reservationStatus !== "reserved" &&
        decision.reservationStatus !== "accounted") ||
      decision.blockerIds.length !== 0
    ) {
      return operatorError("materialization budget decision drifted");
    }
    return "ready";
  }
  if (decision.reservationStatus !== null || decision.blockerIds.length < 1) {
    return operatorError("materialization budget decision drifted");
  }
  return "blocked";
}

/**
 * Advances one owner-scoped Core-result page and, once the exact acquisition
 * is complete, crosses directly into all-or-nothing joined publication.
 * Retained evidence reads are durably reserved and conservatively accounted
 * before the first read, so a process failure cannot strand or understate R2
 * use. Replaying the same complete cycle reuses the same reservation and the
 * generation publisher's deterministic identity.
 */
export function createDnaCoreRaceHistoryPrivateGenerationOperator(input: {
  configuredOwnerId: string;
  sources: DnaCoreRaceHistoryPrivateGenerationSources;
  repositories: DnaCoreRaceHistoryPrivateGenerationRepositories;
}): Readonly<{
  execute: (
    invocation: DnaCoreRaceHistoryPrivateGenerationInvocation,
  ) => Promise<DnaCoreRaceHistoryPrivateGenerationResult>;
}> {
  const configuredOwnerId = identity(
    input.configuredOwnerId,
    "configured owner",
  );
  return Object.freeze({
    async execute(invocation) {
      if (
        invocation.operatorVersion !==
          DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_OPERATOR_VERSION ||
        invocation.intent !== DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_INTENT ||
        invocation.allowPersistentWrite !== true
      ) {
        operatorError("invocation is not explicitly armed");
      }
      const ownerId = identity(
        invocation.authenticatedOwnerId,
        "authenticated owner",
      );
      if (ownerId !== configuredOwnerId) operatorError("owner scope denied");
      const budgetWindowId = identity(
        invocation.budgetWindowId,
        "budget window",
      );
      const maximumClassBOperations = operationCeiling(
        invocation.maximumRetainedEvidenceClassBOperations,
      );
      assertConservativeRequestRate({
        invocation,
        requestBudget: input.sources.requestBudget,
      });

      if (input.repositories.budget.status !== "ready") {
        return Object.freeze({
          kind: "budget_unavailable" as const,
          reason: "not_configured" as const,
        });
      }
      const window = await input.repositories.budget.readWindow(ownerId);
      if (window === null) {
        return Object.freeze({
          kind: "budget_unavailable" as const,
          reason: "window_missing" as const,
        });
      }
      if (window.windowId !== budgetWindowId) {
        return Object.freeze({
          kind: "budget_unavailable" as const,
          reason: "window_mismatch" as const,
        });
      }

      const step = await runDnaCoreRaceHistoryPrivateCollectorStep({
        ownerId,
        budgetWindowId,
        evaluatedAt: invocation.evaluatedAt,
        attemptedAt: invocation.attemptedAt,
        loadServingCores: input.sources.loadServingCores,
        acquisitionRepository: input.repositories.acquisition,
        budgetRepository: input.repositories.budget,
        client: input.sources.client,
        requestBudget: input.sources.requestBudget,
        evidenceStore: input.sources.evidenceStore,
      });
      if (step.kind !== "collection_complete") {
        return Object.freeze({ kind: "collection" as const, step });
      }
      if (step.stored.cycle.previousCompletedCycleId !== null) {
        return Object.freeze({
          kind: "generation" as const,
          result: Object.freeze({
            kind: "authority_unavailable" as const,
            reason: "historical_lineage_required" as const,
          }),
        });
      }

      const completion = step.stored.cycle.completion;
      if (completion === null) {
        operatorError("complete collection has no completion authority");
      }
      const requiredClassBOperations = requiredRetainedEvidenceClassBOperations(
        completion.pageReceiptCount,
        maximumClassBOperations,
      );
      const chunkMaximum =
        DNA_OPEN_LAB_MAX_RECURRING_R2_OPERATIONS_PER_DAILY_REFRESH.classBOperations;
      const chunkCount = Math.ceil(requiredClassBOperations / chunkMaximum);

      // The durable budget API deliberately caps every reservation at the
      // recurring daily-refresh ceiling. Reserve and conservatively account
      // the exact completed-package requirement in deterministic chunks before
      // the first retained read. Replays reuse the same chunk identities.
      for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
        const chunkClassBOperations = Math.min(
          chunkMaximum,
          requiredClassBOperations - chunkIndex * chunkMaximum,
        );
        const authority = materializationBudgetAuthority({
          ownerId,
          cycleId: step.stored.cycle.cycleId,
          attemptNumber: step.stored.cycle.attemptNumber,
          requiredClassBOperations,
          chunkIndex,
          chunkCount,
          chunkClassBOperations,
        });
        const plannedUsage = Object.freeze({
          storageBytes: 0,
          classAOperations: 0,
          classBOperations: chunkClassBOperations,
        });
        const decision = await input.repositories.budget.reserve({
          ownerId,
          windowId: budgetWindowId,
          refreshCycleId: authority.reservationId,
          requestSha256: authority.requestSha256,
          plannedUsage,
        });
        if (materializationBudgetDecision(decision) === "blocked") {
          return Object.freeze({
            kind: "materialization_budget_blocked" as const,
            blockerIds: Object.freeze([...decision.blockerIds]),
          });
        }

        // Charge the whole approved chunk before any retained read. A crash
        // can therefore never restore free headroom for an uncertain outcome.
        const accounting = await input.repositories.budget.account({
          ownerId,
          windowId: budgetWindowId,
          refreshCycleId: authority.reservationId,
          requestSha256: authority.requestSha256,
          actualUsage: plannedUsage,
        });
        if (
          accounting.windowId !== budgetWindowId ||
          accounting.refreshCycleId !== authority.reservationId ||
          accounting.requestSha256 !== authority.requestSha256 ||
          accounting.status !== "accounted" ||
          !sameUsage(accounting.plannedUsage, plannedUsage) ||
          !sameUsage(accounting.actualUsage, plannedUsage)
        ) {
          operatorError("materialization budget accounting drifted");
        }
      }

      // A completed historical package can contain more race-document
      // requests than one bounded command can safely finish. Each completed
      // request batch is retained privately and replayed on the next command.
      // Reserve a conservative per-attempt ceiling before the first cache
      // read or write; storage and Class A are charged at the maximum object
      // size even when a replay finds an existing immutable batch.
      const raceDocumentBatchCount = Math.ceil(
        completion.acceptedResultCount /
          DNA_CORE_RACE_HISTORY_RACE_DOCUMENT_BATCH_SIZE,
      );
      const maximumCacheBatchesPerChunk = Math.min(
        DNA_OPEN_LAB_MAX_RECURRING_R2_OPERATIONS_PER_DAILY_REFRESH.classAOperations,
        Math.floor(
          DNA_OPEN_LAB_MAX_RECURRING_R2_OPERATIONS_PER_DAILY_REFRESH.classBOperations /
            2,
        ),
      );
      const cacheChunkCount = Math.ceil(
        raceDocumentBatchCount / maximumCacheBatchesPerChunk,
      );
      for (let chunkIndex = 0; chunkIndex < cacheChunkCount; chunkIndex += 1) {
        const chunkBatchCount = Math.min(
          maximumCacheBatchesPerChunk,
          raceDocumentBatchCount - chunkIndex * maximumCacheBatchesPerChunk,
        );
        const authority = materializationCacheBudgetAuthority({
          ownerId,
          cycleId: step.stored.cycle.cycleId,
          attemptNumber: step.stored.cycle.attemptNumber,
          materializationAttemptedAt: invocation.attemptedAt,
          batchCount: raceDocumentBatchCount,
          chunkIndex,
          chunkCount: cacheChunkCount,
          chunkBatchCount,
        });
        const decision = await input.repositories.budget.reserve({
          ownerId,
          windowId: budgetWindowId,
          refreshCycleId: authority.reservationId,
          requestSha256: authority.requestSha256,
          plannedUsage: authority.plannedUsage,
        });
        if (materializationBudgetDecision(decision) === "blocked") {
          return Object.freeze({
            kind: "materialization_budget_blocked" as const,
            blockerIds: Object.freeze([...decision.blockerIds]),
          });
        }
        const accounting = await input.repositories.budget.account({
          ownerId,
          windowId: budgetWindowId,
          refreshCycleId: authority.reservationId,
          requestSha256: authority.requestSha256,
          actualUsage: authority.plannedUsage,
        });
        if (
          accounting.windowId !== budgetWindowId ||
          accounting.refreshCycleId !== authority.reservationId ||
          accounting.requestSha256 !== authority.requestSha256 ||
          accounting.status !== "accounted" ||
          !sameUsage(accounting.plannedUsage, authority.plannedUsage) ||
          !sameUsage(accounting.actualUsage, authority.plannedUsage)
        ) {
          operatorError("materialization cache budget accounting drifted");
        }
      }
      const result = await materializeAndPublishLatestDnaCoreRaceHistory({
        ownerId,
        workerId: invocation.workerId,
        materializedAt: invocation.materializedAt,
        publishedAt: invocation.publishedAt,
        acquisitionRepository: input.repositories.acquisition,
        evidenceStore: input.sources.evidenceStore,
        loadRaceDocuments: async (sourceRaceIds) => {
          const hydrated = await hydrateDnaRaceDocuments({
            raceIds: sourceRaceIds,
            client: input.sources.raceDocumentClient,
            requestBudget: input.sources.requestBudget,
            observedAt: invocation.materializedAt,
          });
          return hydrated.documents;
        },
        generationRepository: input.repositories.generation,
        retainedEvidenceReadBudget: {
          maximumClassBOperations: requiredClassBOperations,
          paidUsageAllowed: false,
        },
      });
      return Object.freeze({ kind: "generation" as const, result });
    },
  });
}
