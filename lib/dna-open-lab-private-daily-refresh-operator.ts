import type {
  DnaFinishedRaceIdentityConflictQuarantine,
  DnaFinishedRaceWindowPublisher,
} from "./dna-open-lab-finished-race-backfill";
import type {
  DnaFinishedRaceIncrementalCycleRepository,
  DnaFinishedRaceIncrementalPauseReason,
} from "./dna-open-lab-finished-race-incremental-cycle";
import {
  publishDnaFinishedRaceIncrementalCycle,
  type DnaFinishedRaceIncrementalPublicationRepository,
} from "./dna-open-lab-finished-race-incremental-publication";
import {
  runDnaFinishedRaceIncrementalStep,
  type DnaFinishedRaceIncrementalStepResult,
} from "./dna-open-lab-finished-race-incremental-runner";
import {
  DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
  type DnaOpenLabRequestBudget,
} from "./dna-open-lab-request-budget";
import {
  runDnaOpenLabDailyRefreshStep,
  type DnaOpenLabDailyRefreshGenerationRepository,
  type DnaOpenLabDailyRefreshStepResult,
} from "./dna-open-lab-daily-refresh-coordinator";
import {
  runDnaCurrentStateOperatorStep,
  type DnaCurrentStateOperatorStepResult,
} from "./dna-open-lab-current-state-operator";
import type { DnaCurrentStateAcquisitionGroup } from "./dna-open-lab-current-state-acquisition-cadence";
import type {
  DnaCurrentStateAcquisitionCycleCheckpointRepository,
  DnaCurrentStateAcquisitionEvidenceReceipt,
} from "./dna-open-lab-current-state-acquisition-runner";
import type { DnaOpenLabClientPool } from "./dna-open-lab-client-pool";
import type { DnaOpenLabStoredCurrentStateEvidence } from "./dna-open-lab-r2-current-state-evidence";
import type { DnaOpenLabR2BudgetRepository } from "./dna-open-lab-r2-budget-repository";
import type { DnaCurrentStateRequest } from "./dna-open-lab-current-state-sync-plan";
import type {
  DnaOpenLabClient,
  DnaOpenLabResponse,
  DnaRaceMode,
} from "./dna-open-lab-v1-client";
import type { DnaOpenLabR2Usage } from "./dna-open-lab-zero-cost-refresh-policy";
import {
  DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT,
  DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION,
  type DnaOpenLabProviderCapacityPreflight,
  type DnaOpenLabProviderCapacityPreflightReceipt,
} from "./dna-open-lab-provider-capacity-preflight";
import type { DnaOpenLabNeonUsage } from "./dna-open-lab-zero-cost-provider-capacity";
import { createNeonDnaCurrentStateAcquisitionCycleCheckpointRepository } from "./neon-dna-open-lab-current-state-acquisition-cycle";
import { neonDnaOpenLabDailyRefreshGenerationRepositoryFromEnvironment } from "./neon-dna-open-lab-daily-refresh-generation-repository";
import { createNeonDnaFinishedRaceIncrementalCycleRepository } from "./neon-dna-open-lab-finished-race-incremental-cycle";
import { createNeonDnaFinishedRaceIncrementalPublicationRepository } from "./neon-dna-open-lab-finished-race-incremental-publication";
import { neonDnaOpenLabR2BudgetRepositoryFromEnvironment } from "./neon-dna-open-lab-r2-budget-repository";
import {
  createNeonDnaOpenLabSyncPublicationRepository,
  type NeonDnaOpenLabSyncPublicationRepository,
} from "./neon-dna-open-lab-sync-publication";
import type { NeonImportPersistenceSessionFactory } from "./neon-import-persistence-driver";

export const DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_OPERATOR_VERSION =
  "dna-open-lab-private-daily-refresh/v1" as const;
export const DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_INTENT =
  "advance_private_daily_refresh" as const;

export type DnaOpenLabPrivateDailyRefreshInvocation = Readonly<{
  operatorVersion: typeof DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_OPERATOR_VERSION;
  intent: typeof DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_INTENT;
  allowPersistentWrite: true;
  authenticatedOwnerId: string;
  exactCodeHeadSha: string;
  refreshCycleId: string;
  budgetWindowId: string;
  plannedR2Usage: DnaOpenLabR2Usage;
  plannedNeonUsage: DnaOpenLabNeonUsage;
  currentR2Usage: DnaOpenLabR2Usage;
  finishedHistoryUpperBoundAt: string;
  currentStateCycleId: string;
  evaluatedAt: string;
  attemptedAt: string;
  recordedAt: string;
  acceptedAt: string;
  publishedAt: string;
  vault: string;
  spliceModes?: readonly DnaRaceMode[];
  minimumHistoryWindowMilliseconds?: number;
  maximumAggregateRequestsPerMinute?: number;
}>;

export type DnaOpenLabPrivateDailyRefreshSources = Readonly<{
  providerCapacityPreflight: DnaOpenLabProviderCapacityPreflight;
  finishedHistoryClient: Pick<DnaOpenLabClient, "racesFinished" | "raceDocs">;
  requestBudget: DnaOpenLabRequestBudget;
  finishedHistoryPublisher: DnaFinishedRaceWindowPublisher;
  identityConflictQuarantine: DnaFinishedRaceIdentityConflictQuarantine;
  currentStatePool: DnaOpenLabClientPool;
  persistCurrentStateEvidence: (input: {
    cycleId: string;
    group: DnaCurrentStateAcquisitionGroup;
    requestKey: string;
    request: DnaCurrentStateRequest;
    response: DnaOpenLabResponse<unknown>;
    observedAt: string;
  }) => Promise<DnaCurrentStateAcquisitionEvidenceReceipt>;
  readCurrentStateEvidence: (input: {
    cycleId: string;
    receipt: DnaCurrentStateAcquisitionEvidenceReceipt;
  }) => Promise<DnaOpenLabStoredCurrentStateEvidence>;
  measureActualR2Usage: () => Promise<DnaOpenLabR2Usage>;
}>;

export type DnaOpenLabPrivateDailyRefreshRepositories = Readonly<{
  budget: DnaOpenLabR2BudgetRepository;
  finishedHistoryCycle: DnaFinishedRaceIncrementalCycleRepository;
  finishedHistoryPublication: DnaFinishedRaceIncrementalPublicationRepository;
  currentStateCycle: DnaCurrentStateAcquisitionCycleCheckpointRepository;
  currentStatePublication: NeonDnaOpenLabSyncPublicationRepository;
  generation: DnaOpenLabDailyRefreshGenerationRepository;
}>;

export type DnaOpenLabPrivateDailyRefreshOperator =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      execute: (invocation: DnaOpenLabPrivateDailyRefreshInvocation) => Promise<
        | DnaOpenLabDailyRefreshStepResult
        | Readonly<{
            kind: "provider_capacity_held";
            preflight: Extract<
              DnaOpenLabProviderCapacityPreflightReceipt,
              { status: "held" }
            >;
          }>
      >;
    }>;

function requiredIdentity(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 512) {
    throw new Error(`DNA Open Lab private daily refresh ${field} is invalid.`);
  }
  return normalized;
}

function syncPauseReason(
  value: DnaFinishedRaceIncrementalPauseReason,
): Parameters<NeonDnaOpenLabSyncPublicationRepository["pause"]>[0]["reason"] {
  switch (value) {
    case "rate_limited":
      return "rate_limited";
    case "tier_ineligible":
      return "api_ineligible";
    case "api_unavailable":
      return "api_unavailable";
    case "invalid_response":
      return "invalid_payload";
    case "budget_closed":
    case "operator_hold":
      return "partial_refresh";
  }
}

function assertConservativeRateSafety(input: {
  invocation: DnaOpenLabPrivateDailyRefreshInvocation;
  sources: DnaOpenLabPrivateDailyRefreshSources;
}): void {
  const requested =
    input.invocation.maximumAggregateRequestsPerMinute ??
    DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE;
  if (
    !Number.isSafeInteger(requested) ||
    requested < 1 ||
    requested > DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE
  ) {
    throw new Error(
      "DNA Open Lab private daily refresh rate must remain between 1 and 30 requests per minute.",
    );
  }
  const historyBudget = input.sources.requestBudget.snapshot();
  if (
    historyBudget.effectiveRequestsPerMinute >
    DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE
  ) {
    throw new Error(
      "DNA Open Lab private daily refresh history budget exceeds the conservative aggregate rate.",
    );
  }
  const currentPool = input.sources.currentStatePool.snapshot();
  if (
    currentPool.independentRateBucketsEnabled ||
    currentPool.aggregateBudget === null ||
    currentPool.aggregateBudget.effectiveRequestsPerMinute >
      DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE
  ) {
    throw new Error(
      "DNA Open Lab private daily refresh requires one conservative aggregate client-pool budget.",
    );
  }
}

async function advanceFinishedHistory(input: {
  ownerId: string;
  invocation: DnaOpenLabPrivateDailyRefreshInvocation;
  sources: DnaOpenLabPrivateDailyRefreshSources;
  repositories: DnaOpenLabPrivateDailyRefreshRepositories;
}): Promise<DnaFinishedRaceIncrementalStepResult> {
  const step = await runDnaFinishedRaceIncrementalStep({
    upperBoundAt: input.invocation.finishedHistoryUpperBoundAt,
    attemptedAt: input.invocation.attemptedAt,
    ...(input.invocation.minimumHistoryWindowMilliseconds === undefined
      ? {}
      : {
          minimumWindowMilliseconds:
            input.invocation.minimumHistoryWindowMilliseconds,
        }),
    repository: input.repositories.finishedHistoryCycle,
    client: input.sources.finishedHistoryClient,
    requestBudget: input.sources.requestBudget,
    publisher: input.sources.finishedHistoryPublisher,
    identityConflictQuarantine: input.sources.identityConflictQuarantine,
    pauseLastGood: async (pause) => {
      await input.repositories.currentStatePublication.pause({
        ownerId: input.ownerId,
        reason: syncPauseReason(pause.reason),
        attemptedAt: pause.attemptedAt,
        retryAfterSeconds: pause.retryAfterSeconds,
      });
    },
  });
  if (step.kind === "collection_complete") {
    const completedAt = step.stored.cycle.completion?.completedAt;
    if (completedAt === undefined) {
      throw new Error(
        "DNA Open Lab private daily refresh completed history has no completion authority.",
      );
    }
    const publication = await publishDnaFinishedRaceIncrementalCycle({
      cycle: step.stored.cycle,
      repository: input.repositories.finishedHistoryPublication,
      validatedAt: completedAt,
      publishedAt: completedAt,
    });
    if (publication.cycleId !== step.stored.cycle.cycleId) {
      throw new Error(
        "DNA Open Lab private daily refresh history publication drifted.",
      );
    }
  }
  return step;
}

async function advanceCurrentState(input: {
  ownerId: string;
  invocation: DnaOpenLabPrivateDailyRefreshInvocation;
  sources: DnaOpenLabPrivateDailyRefreshSources;
  repositories: DnaOpenLabPrivateDailyRefreshRepositories;
}): Promise<DnaCurrentStateOperatorStepResult> {
  return runDnaCurrentStateOperatorStep({
    ownerId: input.ownerId,
    cycleId: input.invocation.currentStateCycleId,
    evaluatedAt: input.invocation.evaluatedAt,
    attemptedAt: input.invocation.attemptedAt,
    recordedAt: input.invocation.recordedAt,
    acceptedAt: input.invocation.acceptedAt,
    vault: input.invocation.vault,
    ...(input.invocation.spliceModes === undefined
      ? {}
      : { spliceModes: input.invocation.spliceModes }),
    checkpointRepository: input.repositories.currentStateCycle,
    publicationRepository: input.repositories.currentStatePublication,
    pool: input.sources.currentStatePool,
    persistEvidence: input.sources.persistCurrentStateEvidence,
    readEvidence: input.sources.readCurrentStateEvidence,
    currentR2Usage: input.invocation.currentR2Usage,
    plannedRefreshR2Usage: input.invocation.plannedR2Usage,
    ...(input.invocation.maximumAggregateRequestsPerMinute === undefined
      ? {}
      : {
          maximumAggregateRequestsPerMinute:
            input.invocation.maximumAggregateRequestsPerMinute,
        }),
  });
}

export function createDnaOpenLabPrivateDailyRefreshOperator(input: {
  configuredOwnerId: string;
  sources: DnaOpenLabPrivateDailyRefreshSources;
  repositories: DnaOpenLabPrivateDailyRefreshRepositories;
}): Extract<DnaOpenLabPrivateDailyRefreshOperator, { status: "ready" }> {
  const configuredOwnerId = requiredIdentity(
    input.configuredOwnerId,
    "configured owner",
  );
  return Object.freeze({
    status: "ready" as const,
    async execute(invocation) {
      if (
        invocation.operatorVersion !==
          DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_OPERATOR_VERSION ||
        invocation.intent !== DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_INTENT ||
        invocation.allowPersistentWrite !== true
      ) {
        throw new Error(
          "DNA Open Lab private daily refresh invocation is not explicitly armed.",
        );
      }
      const authenticatedOwnerId = requiredIdentity(
        invocation.authenticatedOwnerId,
        "authenticated owner",
      );
      if (authenticatedOwnerId !== configuredOwnerId) {
        throw new Error(
          "DNA Open Lab private daily refresh owner scope denied.",
        );
      }
      assertConservativeRateSafety({ invocation, sources: input.sources });
      const providerCapacity =
        await input.sources.providerCapacityPreflight.inspect({
          preflightVersion: DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION,
          intent: DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT,
          authenticatedOwnerId,
          exactCodeHeadSha: invocation.exactCodeHeadSha,
          refreshCycleId: invocation.refreshCycleId,
          budgetWindowId: invocation.budgetWindowId,
          plannedR2UsagePerRefresh: invocation.plannedR2Usage,
          plannedNeonUsagePerRefresh: invocation.plannedNeonUsage,
        });
      if (providerCapacity.status === "held") {
        return Object.freeze({
          kind: "provider_capacity_held" as const,
          preflight: providerCapacity,
        });
      }
      return runDnaOpenLabDailyRefreshStep({
        ownerId: authenticatedOwnerId,
        refreshCycleId: invocation.refreshCycleId,
        budgetWindowId: invocation.budgetWindowId,
        plannedR2Usage: invocation.plannedR2Usage,
        budgetRepository: input.repositories.budget,
        generationRepository: input.repositories.generation,
        advanceFinishedHistory: () =>
          advanceFinishedHistory({
            ownerId: authenticatedOwnerId,
            invocation,
            sources: input.sources,
            repositories: input.repositories,
          }),
        advanceCurrentState: () =>
          advanceCurrentState({
            ownerId: authenticatedOwnerId,
            invocation,
            sources: input.sources,
            repositories: input.repositories,
          }),
        measureActualR2Usage: input.sources.measureActualR2Usage,
        publishedAt: invocation.publishedAt,
      });
    },
  });
}

function configured(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

/**
 * Server-only composition root for one bounded private refresh step. Creating
 * it opens no provider or database connection. It is deliberately not wired to
 * a route, page, Worker or schedule in this boundary.
 */
export function dnaOpenLabPrivateDailyRefreshOperatorFromEnvironment(
  environment: Readonly<{
    databaseUrl?: string;
    databaseOwnerId?: string;
    ownerId?: string;
    runtimeRole?: string;
  }>,
  sources: DnaOpenLabPrivateDailyRefreshSources,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): DnaOpenLabPrivateDailyRefreshOperator {
  const databaseUrl = configured(environment.databaseUrl);
  const databaseOwnerId = configured(environment.databaseOwnerId);
  const ownerId = configured(environment.ownerId);
  const runtimeRole = configured(environment.runtimeRole);
  if (
    databaseUrl === null ||
    databaseOwnerId === null ||
    ownerId === null ||
    runtimeRole === null
  ) {
    return Object.freeze({ status: "not_configured" });
  }
  const common = {
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    ...(sessionFactory === undefined ? {} : { sessionFactory }),
  };
  const budget = neonDnaOpenLabR2BudgetRepositoryFromEnvironment(
    { databaseUrl, databaseOwnerId, runtimeRole },
    sessionFactory,
  );
  const generation =
    neonDnaOpenLabDailyRefreshGenerationRepositoryFromEnvironment(
      { databaseUrl, databaseOwnerId, runtimeRole },
      sessionFactory,
    );
  if (budget.status !== "ready" || generation === null) {
    return Object.freeze({ status: "not_configured" });
  }
  return createDnaOpenLabPrivateDailyRefreshOperator({
    configuredOwnerId: ownerId,
    sources,
    repositories: {
      budget,
      finishedHistoryCycle: createNeonDnaFinishedRaceIncrementalCycleRepository(
        {
          ...common,
          ownerId,
        },
      ),
      finishedHistoryPublication:
        createNeonDnaFinishedRaceIncrementalPublicationRepository({
          ...common,
          ownerId,
        }),
      currentStateCycle:
        createNeonDnaCurrentStateAcquisitionCycleCheckpointRepository({
          ...common,
          ownerId,
        }),
      currentStatePublication:
        createNeonDnaOpenLabSyncPublicationRepository(common),
      generation,
    },
  });
}
