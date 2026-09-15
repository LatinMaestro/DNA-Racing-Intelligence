import {
  cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment,
  type CloudflareNeonDnaOpenLabProviderCapacityEnvironment,
} from "./cloudflare-neon-dna-open-lab-provider-capacity-source";
import { createCloudflareR2DatasetEvidencePort } from "./cloudflare-r2-dataset-evidence-port";
import { createDnaCoreRaceHistoryClient } from "./dna-core-race-history-client";
import {
  createDnaCoreRaceHistoryPrivateGenerationOperator,
  DNA_CORE_RACE_HISTORY_COMMISSIONING_MATERIALIZATION_CLASS_B_OPERATION_CEILING,
  DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_INTENT,
  DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_OPERATOR_VERSION,
  type DnaCoreRaceHistoryPrivateGenerationResult,
} from "./dna-core-race-history-private-generation-operator";
import { createDnaCoreRaceHistoryR2EvidenceStore } from "./dna-core-race-history-r2-evidence";
import { createDnaOpenLabClientPool } from "./dna-open-lab-client-pool";
import {
  DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_PLANNED_NEON_USAGE,
  DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_PLANNED_R2_USAGE,
} from "./dna-open-lab-private-daily-refresh-command";
import type { DnaOpenLabPrivateDailyRefreshSourceEnvironment } from "./dna-open-lab-private-daily-refresh-sources";
import {
  createDnaOpenLabProviderCapacityPreflight,
  DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT,
  DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION,
  type DnaOpenLabProviderCapacityMeasurement,
  type DnaOpenLabProviderCapacityMeasurementSource,
} from "./dna-open-lab-provider-capacity-preflight";
import {
  createDnaOpenLabRequestBudget,
  DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
} from "./dna-open-lab-request-budget";
import type { DnaOpenLabR2BudgetRepository } from "./dna-open-lab-r2-budget-repository";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";
import { createDnaOpenLabV1Client } from "./dna-open-lab-v1-client";
import { createNeonDnaCoreRaceHistoryAcquisitionRepository } from "./neon-dna-core-race-history-acquisition";
import { createNeonDnaCoreRaceHistoryGenerationRepository } from "./neon-dna-core-race-history-generation";
import { neonDnaOpenLabR2BudgetRepositoryFromEnvironment } from "./neon-dna-open-lab-r2-budget-repository";
import {
  createDnaOpenLabCombinedServingReadRepository,
  createNeonDnaOpenLabSyncPublicationRepository,
} from "./neon-dna-open-lab-sync-publication";
import type { NeonImportPersistenceSessionFactory } from "./neon-import-persistence-driver";

export const DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_COMMAND_VERSION =
  "dna-core-race-history-private-generation-command/v1" as const;
export const DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_COMMAND_INTENT =
  "execute_bounded_private_preview_core_history" as const;

const RUNTIME_ROLE = "dna_app_runtime";
const MAXIMUM_STEPS = 100;
const GIT_OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

export type DnaCoreRaceHistoryPrivateGenerationCommandEnvironment =
  DnaOpenLabPrivateDailyRefreshSourceEnvironment &
    CloudflareNeonDnaOpenLabProviderCapacityEnvironment &
    Readonly<{
      databaseUrl?: string;
      databaseOwnerId?: string;
      ownerId?: string;
      runtimeRole?: string;
    }>;

export type DnaCoreRaceHistoryPrivateGenerationCommandInvocation = Readonly<{
  commandVersion: typeof DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_COMMAND_VERSION;
  intent: typeof DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_COMMAND_INTENT;
  allowPersistentWrite: true;
  exactCodeHeadSha: string;
  evaluatedAt: string;
  maximumSteps: number;
}>;

export type DnaCoreRaceHistoryPrivateGenerationCommandReceipt = Readonly<{
  status: "advanced" | "complete" | "held";
  stepCount: number;
  terminalKind: string;
  exactCodeHeadSha: string;
  evaluatedAt: string;
  budgetWindowId: string;
  preflightSha256: string;
  persistentWriteArmed: true;
  previewOnly: true;
  paidUsageAllowed: false;
  preserveLastGood: true;
}>;

export type DnaCoreRaceHistoryPrivateGenerationCommand =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      execute: (
        invocation: DnaCoreRaceHistoryPrivateGenerationCommandInvocation,
      ) => Promise<DnaCoreRaceHistoryPrivateGenerationCommandReceipt>;
    }>;

type ReadyOperator = ReturnType<
  typeof createDnaCoreRaceHistoryPrivateGenerationOperator
>;

type CommandDependencies = Readonly<{
  measurementSource?: DnaOpenLabProviderCapacityMeasurementSource;
  budgetRepository?: DnaOpenLabR2BudgetRepository;
  operatorForEvaluation?: (input: {
    evaluatedAt: string;
    budgetRepository: DnaOpenLabR2BudgetRepository;
  }) => ReadyOperator;
  sessionFactory?: NeonImportPersistenceSessionFactory;
  now?: () => Date;
}>;

function configured(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function timestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`DNA Core history command ${field} is invalid.`);
  }
  return parsed.toISOString();
}

function exactHead(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!GIT_OBJECT_ID_PATTERN.test(normalized)) {
    throw new Error("DNA Core history command head is invalid.");
  }
  return normalized;
}

function authorityId(domain: string, value: unknown): string {
  return dnaOpenLabRawEvidenceSha256({ domain, value });
}

function fixedMeasurementSource(
  measurement: DnaOpenLabProviderCapacityMeasurement,
): DnaOpenLabProviderCapacityMeasurementSource {
  return Object.freeze({
    status: "ready" as const,
    async measure() {
      return measurement;
    },
  });
}

function terminalKind(result: DnaCoreRaceHistoryPrivateGenerationResult): {
  kind: string;
  terminal: boolean;
  complete: boolean;
} {
  if (result.kind === "generation") {
    const kind = `generation:${result.result.kind}`;
    return {
      kind:
        result.result.kind === "authority_unavailable"
          ? `${kind}:${result.result.reason}`
          : kind,
      terminal: true,
      complete: result.result.kind === "published",
    };
  }
  if (result.kind === "collection") {
    const kind = `collection:${result.step.kind}`;
    if (result.step.kind === "paused") {
      return {
        kind: `${kind}:${result.step.reason}`,
        terminal: true,
        complete: false,
      };
    }
    return {
      kind,
      terminal:
        result.step.kind === "attempt_unavailable" ||
        result.step.kind === "authority_unavailable",
      complete: false,
    };
  }
  return { kind: result.kind, terminal: true, complete: false };
}

/**
 * Connected Preview command for the first complete Core-result generation.
 * It performs a fresh read-only provider preflight, opens only the measured
 * free-budget window, and then advances a bounded number of one-page steps.
 */
export function dnaCoreRaceHistoryPrivateGenerationCommandFromEnvironment(
  environment: DnaCoreRaceHistoryPrivateGenerationCommandEnvironment,
  dependencies: CommandDependencies = {},
): DnaCoreRaceHistoryPrivateGenerationCommand {
  const ownerId = configured(
    environment.ownerId ?? environment.authorizedOwnerId,
  );
  const databaseUrl = configured(environment.databaseUrl);
  const databaseOwnerId = configured(environment.databaseOwnerId);
  const runtimeRole = configured(environment.runtimeRole) ?? RUNTIME_ROLE;
  const r2BucketName = configured(environment.r2BucketName);
  const cloudflareAccountId = configured(environment.cloudflareAccountId);
  const cloudflareApiToken = configured(environment.cloudflareApiToken);
  const r2AccessKeyId = configured(environment.r2AccessKeyId);
  const r2SecretAccessKey = configured(environment.r2SecretAccessKey);
  const apiKeys = [
    configured(environment.dnaOpenLabApiKey1),
    configured(environment.dnaOpenLabApiKey2),
    configured(environment.dnaOpenLabApiKey3),
  ];
  if (
    ownerId === null ||
    databaseUrl === null ||
    databaseOwnerId === null ||
    r2BucketName === null ||
    cloudflareAccountId === null ||
    cloudflareApiToken === null ||
    r2AccessKeyId === null ||
    r2SecretAccessKey === null ||
    apiKeys.some((value) => value === null)
  ) {
    return Object.freeze({ status: "not_configured" });
  }
  const configuredApiKeys = apiKeys as [string, string, string];
  if (new Set(configuredApiKeys).size !== configuredApiKeys.length) {
    throw new Error("DNA Core history command requires three distinct keys.");
  }
  const measurementSource =
    dependencies.measurementSource ??
    cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment(environment);
  const budgetRepository =
    dependencies.budgetRepository ??
    neonDnaOpenLabR2BudgetRepositoryFromEnvironment(
      { databaseUrl, databaseOwnerId, runtimeRole },
      dependencies.sessionFactory,
    );
  if (
    measurementSource.status !== "ready" ||
    budgetRepository.status !== "ready"
  ) {
    return Object.freeze({ status: "not_configured" });
  }
  const now = dependencies.now ?? (() => new Date());

  const defaultOperatorForEvaluation = (input: {
    evaluatedAt: string;
    budgetRepository: DnaOpenLabR2BudgetRepository;
  }): ReadyOperator => {
    if (input.budgetRepository.status !== "ready") {
      throw new Error("DNA Core history command budget became unavailable.");
    }
    const sessionFactory = dependencies.sessionFactory;
    const serving = createDnaOpenLabCombinedServingReadRepository({
      repository: createNeonDnaOpenLabSyncPublicationRepository({
        databaseUrl,
        databaseOwnerId,
        runtimeRole,
        ...(sessionFactory === undefined ? {} : { sessionFactory }),
      }),
      validatedAt: input.evaluatedAt,
    });
    const storage = createCloudflareR2DatasetEvidencePort({
      accountId: cloudflareAccountId,
      accessKeyId: r2AccessKeyId,
      secretAccessKey: r2SecretAccessKey,
      apiToken: cloudflareApiToken,
    });
    const requestBudget = createDnaOpenLabRequestBudget({
      initialRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
      maximumRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
    });
    const clients = configuredApiKeys.map((apiKey) =>
      createDnaOpenLabV1Client({ apiKey }),
    );
    const pool = createDnaOpenLabClientPool({
      lanes: clients.map((client, index) => ({
        id: `key-${index + 1}`,
        client,
        scopes: ["races"] as const,
      })),
      aggregateRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
      maximumLaneRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
      allowIndependentRateBuckets: false,
    });
    const evidenceStore = createDnaCoreRaceHistoryR2EvidenceStore({
      ownerId,
      bucketName: r2BucketName,
      storage,
    });
    return createDnaCoreRaceHistoryPrivateGenerationOperator({
      configuredOwnerId: ownerId,
      sources: {
        loadServingOwnedCores: () => serving.readServingOwnedCores({ ownerId }),
        client: createDnaCoreRaceHistoryClient(),
        requestBudget,
        evidenceStore,
        raceDocumentClient: {
          raceDocs: (raceIds) =>
            pool.execute({
              scope: "races",
              request: (client) => client.raceDocs(raceIds),
            }),
        },
      },
      repositories: {
        acquisition: createNeonDnaCoreRaceHistoryAcquisitionRepository({
          databaseUrl,
          databaseOwnerId,
          ownerId,
          runtimeRole,
          ...(sessionFactory === undefined ? {} : { sessionFactory }),
        }),
        budget: input.budgetRepository,
        generation: createNeonDnaCoreRaceHistoryGenerationRepository({
          databaseUrl,
          databaseOwnerId,
          ownerId,
          runtimeRole,
          ...(sessionFactory === undefined ? {} : { sessionFactory }),
        }),
      },
    });
  };

  return Object.freeze({
    status: "ready" as const,
    async execute(invocation) {
      if (
        invocation.commandVersion !==
          DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_COMMAND_VERSION ||
        invocation.intent !==
          DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_COMMAND_INTENT ||
        invocation.allowPersistentWrite !== true
      ) {
        throw new Error("DNA Core history command is not explicitly armed.");
      }
      if (
        !Number.isSafeInteger(invocation.maximumSteps) ||
        invocation.maximumSteps < 1 ||
        invocation.maximumSteps > MAXIMUM_STEPS
      ) {
        throw new Error("DNA Core history command step bound is invalid.");
      }
      const exactCodeHeadSha = exactHead(invocation.exactCodeHeadSha);
      const evaluatedAt = timestamp(invocation.evaluatedAt, "evaluatedAt");
      const startedAt = now();
      if (
        Number.isNaN(startedAt.getTime()) ||
        Date.parse(evaluatedAt) > startedAt.getTime()
      ) {
        throw new Error(
          "DNA Core history command evaluation is in the future.",
        );
      }
      const measurement = await measurementSource.measure({ ownerId });
      const budgetWindowId = authorityId("dna-open-lab-r2-budget-window/v1", {
        ownerId,
        startAt: measurement.billingWindowStartAt,
        endAt: measurement.billingWindowEndAt,
      });
      const refreshCycleId = authorityId(
        "dna-core-race-history-private-generation-command-cycle/v1",
        { ownerId, evaluatedAt },
      );
      const preflight = createDnaOpenLabProviderCapacityPreflight({
        configuredOwnerId: ownerId,
        measurementSource: fixedMeasurementSource(measurement),
        now,
      });
      const capacity = await preflight.inspect({
        preflightVersion: DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION,
        intent: DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT,
        authenticatedOwnerId: ownerId,
        exactCodeHeadSha,
        refreshCycleId,
        budgetWindowId,
        plannedR2UsagePerRefresh:
          DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_PLANNED_R2_USAGE,
        plannedNeonUsagePerRefresh:
          DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_PLANNED_NEON_USAGE,
      });
      if (capacity.status !== "ready") {
        return Object.freeze({
          status: "held" as const,
          stepCount: 0,
          terminalKind: `provider_capacity_held:${capacity.reason}`,
          exactCodeHeadSha,
          evaluatedAt,
          budgetWindowId,
          preflightSha256: authorityId(
            "dna-core-race-history-private-generation-held/v1",
            capacity,
          ),
          persistentWriteArmed: true as const,
          previewOnly: true as const,
          paidUsageAllowed: false as const,
          preserveLastGood: true as const,
        });
      }
      const existingWindow = await budgetRepository.readWindow(ownerId);
      if (existingWindow?.windowId !== budgetWindowId) {
        await budgetRepository.openWindow({
          ownerId,
          windowId: budgetWindowId,
          windowStartAt: measurement.billingWindowStartAt,
          windowEndAt: measurement.billingWindowEndAt,
          measuredAt: measurement.measuredAt,
          baselineUsage: measurement.currentR2Usage,
        });
      }
      const operator = (
        dependencies.operatorForEvaluation ?? defaultOperatorForEvaluation
      )({ evaluatedAt, budgetRepository });
      let outcome = {
        kind: "step_bound_reached",
        terminal: false,
        complete: false,
      };
      let stepCount = 0;
      for (let index = 0; index < invocation.maximumSteps; index += 1) {
        const stepAt = now();
        if (Number.isNaN(stepAt.getTime())) {
          throw new Error("DNA Core history command clock is invalid.");
        }
        const at = stepAt.toISOString();
        const result = await operator.execute({
          operatorVersion:
            DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_OPERATOR_VERSION,
          intent: DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_INTENT,
          allowPersistentWrite: true,
          authenticatedOwnerId: ownerId,
          budgetWindowId,
          evaluatedAt,
          attemptedAt: at,
          workerId: "private-preview-core-history-worker",
          materializedAt: at,
          publishedAt: at,
          maximumRetainedEvidenceClassBOperations:
            DNA_CORE_RACE_HISTORY_COMMISSIONING_MATERIALIZATION_CLASS_B_OPERATION_CEILING,
          maximumAggregateRequestsPerMinute:
            DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
        });
        stepCount += 1;
        outcome = terminalKind(result);
        if (outcome.terminal) break;
      }
      return Object.freeze({
        status: outcome.complete
          ? ("complete" as const)
          : outcome.terminal
            ? ("held" as const)
            : ("advanced" as const),
        stepCount,
        terminalKind: outcome.kind,
        exactCodeHeadSha,
        evaluatedAt,
        budgetWindowId,
        preflightSha256: capacity.preflightSha256,
        persistentWriteArmed: true as const,
        previewOnly: true as const,
        paidUsageAllowed: false as const,
        preserveLastGood: true as const,
      });
    },
  });
}
