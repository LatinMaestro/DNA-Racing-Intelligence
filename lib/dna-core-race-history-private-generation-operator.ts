import type { DnaCoreRaceHistoryAcquisitionRepository } from "./dna-core-race-history-acquisition-cycle";
import type { DnaCoreRaceHistoryClient } from "./dna-core-race-history-client";
import {
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
import {
  DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
  type DnaOpenLabRequestBudget,
} from "./dna-open-lab-request-budget";
import type { DnaOpenLabR2BudgetRepository } from "./dna-open-lab-r2-budget-repository";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";
import type { DnaOpenLabClient } from "./dna-open-lab-v1-client";
import { hydrateDnaRaceDocuments } from "./dna-open-lab-race-document-hydrator";
import { DNA_OPEN_LAB_MAX_RECURRING_R2_OPERATIONS_PER_DAILY_REFRESH } from "./dna-open-lab-zero-cost-refresh-policy";

export const DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_OPERATOR_VERSION =
  "dna-core-race-history-private-generation/v1" as const;
export const DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_INTENT =
  "advance_private_core_result_generation" as const;

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
  loadServingOwnedCores: () => Promise<
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
      DNA_OPEN_LAB_MAX_RECURRING_R2_OPERATIONS_PER_DAILY_REFRESH.classBOperations
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
  maximumClassBOperations: number;
}): Readonly<{ reservationId: string; requestSha256: string }> {
  const value = Object.freeze({
    version: DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_OPERATOR_VERSION,
    ownerId: input.ownerId,
    cycleId: input.cycleId,
    attemptNumber: input.attemptNumber,
    purpose: "materialize_complete_generation" as const,
    plannedUsage: Object.freeze({
      storageBytes: 0,
      classAOperations: 0,
      classBOperations: input.maximumClassBOperations,
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
        loadServingOwnedCores: input.sources.loadServingOwnedCores,
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

      const authority = materializationBudgetAuthority({
        ownerId,
        cycleId: step.stored.cycle.cycleId,
        attemptNumber: step.stored.cycle.attemptNumber,
        maximumClassBOperations,
      });
      const plannedUsage = Object.freeze({
        storageBytes: 0,
        classAOperations: 0,
        classBOperations: maximumClassBOperations,
      });
      const decision = await input.repositories.budget.reserve({
        ownerId,
        windowId: budgetWindowId,
        refreshCycleId: authority.reservationId,
        requestSha256: authority.requestSha256,
        plannedUsage,
      });
      if (
        decision.paidUsageAllowed !== false ||
        decision.preserveLastGood !== true
      ) {
        operatorError("materialization budget authority is unsafe");
      }
      if (!decision.allowed || decision.reservationStatus === null) {
        return Object.freeze({
          kind: "materialization_budget_blocked" as const,
          blockerIds: Object.freeze([...decision.blockerIds]),
        });
      }

      // Charge the entire approved ceiling before any retained read. This is
      // intentionally conservative: a crash can never restore free headroom
      // for operations whose outcome is unknown.
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
          maximumClassBOperations,
          paidUsageAllowed: false,
        },
      });
      return Object.freeze({ kind: "generation" as const, result });
    },
  });
}
