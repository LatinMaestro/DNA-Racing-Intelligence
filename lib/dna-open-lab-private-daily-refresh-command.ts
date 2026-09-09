import {
  dnaOpenLabPrivateDailyRefreshOperatorFromEnvironment,
  type DnaOpenLabPrivateDailyRefreshOperator,
  type DnaOpenLabPrivateDailyRefreshSources,
} from "./dna-open-lab-private-daily-refresh-operator";
import {
  dnaOpenLabPrivateDailyRefreshSourcesFromEnvironment,
  type DnaOpenLabPrivateDailyRefreshSourceEnvironment,
  type DnaOpenLabPrivateDailyRefreshSourceRuntime,
} from "./dna-open-lab-private-daily-refresh-sources";
import {
  cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment,
  type CloudflareNeonDnaOpenLabProviderCapacityEnvironment,
} from "./cloudflare-neon-dna-open-lab-provider-capacity-source";
import {
  DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT,
  DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION,
  type DnaOpenLabProviderCapacityMeasurement,
  type DnaOpenLabProviderCapacityMeasurementSource,
} from "./dna-open-lab-provider-capacity-preflight";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";
import type { DnaOpenLabR2BudgetRepository } from "./dna-open-lab-r2-budget-repository";
import { neonDnaOpenLabR2BudgetRepositoryFromEnvironment } from "./neon-dna-open-lab-r2-budget-repository";
import type { NeonImportPersistenceSessionFactory } from "./neon-import-persistence-driver";

export const DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_COMMAND_VERSION =
  "dna-open-lab-private-daily-refresh-command/v1" as const;
export const DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_COMMAND_INTENT =
  "execute_bounded_private_preview_refresh" as const;

export const DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_PLANNED_R2_USAGE =
  Object.freeze({
    storageBytes: 100_000_000,
    classAOperations: 1_000,
    classBOperations: 2_000,
  });
export const DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_PLANNED_NEON_USAGE =
  Object.freeze({
    storageBytes: 5_000_000,
    computeMilliCuHours: 1_000,
  });

const GIT_OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const RUNTIME_ROLE = "dna_app_runtime";
const MAXIMUM_STEPS = 100;

export type DnaOpenLabPrivateDailyRefreshCommandEnvironment =
  DnaOpenLabPrivateDailyRefreshSourceEnvironment &
    CloudflareNeonDnaOpenLabProviderCapacityEnvironment &
    Readonly<{
      databaseUrl?: string;
      databaseOwnerId?: string;
      ownerId?: string;
      runtimeRole?: string;
      vault?: string;
    }>;

export type DnaOpenLabPrivateDailyRefreshCommandInvocation = Readonly<{
  commandVersion: typeof DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_COMMAND_VERSION;
  intent: typeof DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_COMMAND_INTENT;
  allowPersistentWrite: true;
  exactCodeHeadSha: string;
  finishedHistoryUpperBoundAt: string;
  maximumSteps: number;
}>;

export type DnaOpenLabPrivateDailyRefreshCommandReceipt = Readonly<{
  status: "advanced" | "complete" | "held";
  stepCount: number;
  terminalKind: string;
  exactCodeHeadSha: string;
  finishedHistoryUpperBoundAt: string;
  refreshCycleId: string;
  budgetWindowId: string;
  preflightSha256: string;
  r2AccountingBasis: "reserved_upper_bound";
  persistentWriteArmed: true;
  previewOnly: true;
  paidUsageAllowed: false;
  preserveLastGood: true;
}>;

export type DnaOpenLabPrivateDailyRefreshCommand =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      execute: (
        invocation: DnaOpenLabPrivateDailyRefreshCommandInvocation,
      ) => Promise<DnaOpenLabPrivateDailyRefreshCommandReceipt>;
    }>;

type CommandDependencies = Readonly<{
  measurementSource?: DnaOpenLabProviderCapacityMeasurementSource;
  budgetRepository?: DnaOpenLabR2BudgetRepository;
  sourcesFromMeasurement?: (
    measurementSource: DnaOpenLabProviderCapacityMeasurementSource,
  ) => DnaOpenLabPrivateDailyRefreshSourceRuntime;
  operatorFromSources?: (
    sources: DnaOpenLabPrivateDailyRefreshSources,
  ) => DnaOpenLabPrivateDailyRefreshOperator;
  sessionFactory?: NeonImportPersistenceSessionFactory;
  now?: () => Date;
}>;

function configured(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function exactHead(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!GIT_OBJECT_ID_PATTERN.test(normalized)) {
    throw new Error(
      "DNA Open Lab private daily refresh command head is invalid.",
    );
  }
  return normalized;
}

function timestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(
      `DNA Open Lab private daily refresh command ${field} is invalid.`,
    );
  }
  return parsed.toISOString();
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

function resultKind(value: unknown): string {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    throw new Error(
      "DNA Open Lab private daily refresh command result is invalid.",
    );
  }
  const kind = (value as { kind?: unknown }).kind;
  if (typeof kind !== "string" || kind.length < 1 || kind.length > 64) {
    throw new Error(
      "DNA Open Lab private daily refresh command result kind is invalid.",
    );
  }
  if (kind === "finished_history") {
    const step = (
      value as {
        step?: {
          kind?: unknown;
          reason?: unknown;
          unavailableDiagnostic?: unknown;
        };
      }
    ).step;
    if (typeof step?.kind !== "string") return kind;
    if (step.kind !== "paused" || typeof step.reason !== "string") {
      return `finished_history:${step.kind}`;
    }
    return typeof step.unavailableDiagnostic === "string"
      ? `finished_history:paused:${step.reason}:${step.unavailableDiagnostic}`
      : `finished_history:paused:${step.reason}`;
  }
  if (kind === "current_state") {
    const step = (value as { step?: { kind?: unknown } }).step;
    if (step?.kind === "discovering") return "current_state:discovering";
    if (step?.kind === "scheduled") {
      const scheduled = (step as { scheduled?: { kind?: unknown } }).scheduled;
      return typeof scheduled?.kind === "string"
        ? `current_state:${scheduled.kind}`
        : "current_state:scheduled";
    }
  }
  return kind;
}

function heldResult(kind: string): boolean {
  return (
    kind === "provider_capacity_held" ||
    kind === "budget_unavailable" ||
    kind === "budget_blocked" ||
    kind.startsWith("finished_history:paused") ||
    kind === "current_state:budget_blocked" ||
    kind === "current_state:paused"
  );
}

/**
 * Exact-main Preview command. It obtains one fresh provider measurement before
 * the first write, opens or reuses the matching durable R2 billing window and
 * advances a bounded number of one-request operator steps. The immutable
 * upper bound makes a later workflow run resume the same cycle.
 */
export function dnaOpenLabPrivateDailyRefreshCommandFromEnvironment(
  environment: DnaOpenLabPrivateDailyRefreshCommandEnvironment,
  dependencies: CommandDependencies = {},
): DnaOpenLabPrivateDailyRefreshCommand {
  const ownerId = configured(
    environment.ownerId ?? environment.authorizedOwnerId,
  );
  const databaseUrl = configured(environment.databaseUrl);
  const databaseOwnerId = configured(environment.databaseOwnerId);
  const runtimeRole = configured(environment.runtimeRole) ?? RUNTIME_ROLE;
  const vault = configured(environment.vault);
  if (
    ownerId === null ||
    databaseUrl === null ||
    databaseOwnerId === null ||
    vault === null
  ) {
    return Object.freeze({ status: "not_configured" });
  }
  const measurementSource =
    dependencies.measurementSource ??
    cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment(environment);
  if (measurementSource.status !== "ready") {
    return Object.freeze({ status: "not_configured" });
  }
  const budgetRepository =
    dependencies.budgetRepository ??
    neonDnaOpenLabR2BudgetRepositoryFromEnvironment(
      { databaseUrl, databaseOwnerId, runtimeRole },
      dependencies.sessionFactory,
    );
  if (budgetRepository.status !== "ready") {
    return Object.freeze({ status: "not_configured" });
  }
  const now = dependencies.now ?? (() => new Date());

  return Object.freeze({
    status: "ready" as const,
    async execute(invocation) {
      if (
        invocation.commandVersion !==
          DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_COMMAND_VERSION ||
        invocation.intent !==
          DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_COMMAND_INTENT ||
        invocation.allowPersistentWrite !== true
      ) {
        throw new Error(
          "DNA Open Lab private daily refresh command is not explicitly armed.",
        );
      }
      if (
        !Number.isSafeInteger(invocation.maximumSteps) ||
        invocation.maximumSteps < 1 ||
        invocation.maximumSteps > MAXIMUM_STEPS
      ) {
        throw new Error(
          "DNA Open Lab private daily refresh command step bound is invalid.",
        );
      }
      const exactCodeHeadSha = exactHead(invocation.exactCodeHeadSha);
      const finishedHistoryUpperBoundAt = timestamp(
        invocation.finishedHistoryUpperBoundAt,
        "history upper bound",
      );
      const commandStartedAt = now();
      if (
        Number.isNaN(commandStartedAt.getTime()) ||
        Date.parse(finishedHistoryUpperBoundAt) > commandStartedAt.getTime()
      ) {
        throw new Error(
          "DNA Open Lab private daily refresh command upper bound is in the future.",
        );
      }

      const measurement = await measurementSource.measure({ ownerId });
      const budgetWindowId = authorityId("dna-open-lab-r2-budget-window/v1", {
        ownerId,
        startAt: measurement.billingWindowStartAt,
        endAt: measurement.billingWindowEndAt,
      });
      const refreshCycleId = authorityId(
        "dna-open-lab-private-daily-refresh-cycle/v1",
        { ownerId, finishedHistoryUpperBoundAt },
      );
      const currentStateCycleId = authorityId(
        "dna-open-lab-private-current-state-cycle/v1",
        { ownerId, finishedHistoryUpperBoundAt },
      );
      const cachedMeasurementSource = fixedMeasurementSource(measurement);
      const sourcesRuntime =
        dependencies.sourcesFromMeasurement?.(cachedMeasurementSource) ??
        dnaOpenLabPrivateDailyRefreshSourcesFromEnvironment(environment, {
          providerCapacityMeasurementSource: cachedMeasurementSource,
          ...(dependencies.now === undefined ? {} : { now }),
        });
      if (sourcesRuntime.status !== "ready") {
        throw new Error(
          "DNA Open Lab private daily refresh command sources are unavailable.",
        );
      }
      const preflight =
        await sourcesRuntime.sources.providerCapacityPreflight.inspect({
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
      if (preflight.status !== "ready") {
        return Object.freeze({
          status: "held" as const,
          stepCount: 0,
          terminalKind: `provider_capacity_held:${preflight.reason}`,
          exactCodeHeadSha,
          finishedHistoryUpperBoundAt,
          refreshCycleId,
          budgetWindowId,
          preflightSha256: authorityId(
            "dna-open-lab-private-daily-refresh-held/v1",
            preflight,
          ),
          r2AccountingBasis: "reserved_upper_bound" as const,
          persistentWriteArmed: true as const,
          previewOnly: true as const,
          paidUsageAllowed: false as const,
          preserveLastGood: true as const,
        });
      }

      // A refresh can span multiple short-lived GitHub runners. The concrete
      // source meter only observes the current process, so using it at final
      // publication would under-count R2 operations performed by earlier
      // resumptions. Account the entire preflight-approved reservation instead.
      // This is deliberately conservative, restart-safe, and can never create
      // more free-tier headroom than the provider has actually supplied.
      const restartSafeSources = Object.freeze({
        ...sourcesRuntime.sources,
        async measureActualR2Usage() {
          return DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_PLANNED_R2_USAGE;
        },
      });

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
      const operator =
        dependencies.operatorFromSources?.(restartSafeSources) ??
        dnaOpenLabPrivateDailyRefreshOperatorFromEnvironment(
          {
            databaseUrl,
            databaseOwnerId,
            ownerId,
            runtimeRole,
          },
          restartSafeSources,
          dependencies.sessionFactory,
        );
      if (operator.status !== "ready") {
        throw new Error(
          "DNA Open Lab private daily refresh command operator is unavailable.",
        );
      }

      let terminalKind = "step_bound_reached";
      let stepCount = 0;
      for (let index = 0; index < invocation.maximumSteps; index += 1) {
        const stepAt = now();
        if (Number.isNaN(stepAt.getTime())) {
          throw new Error(
            "DNA Open Lab private daily refresh command clock is invalid.",
          );
        }
        const at = stepAt.toISOString();
        const result = await operator.execute({
          operatorVersion: "dna-open-lab-private-daily-refresh/v1",
          intent: "advance_private_daily_refresh",
          allowPersistentWrite: true,
          authenticatedOwnerId: ownerId,
          exactCodeHeadSha,
          refreshCycleId,
          budgetWindowId,
          plannedR2Usage: DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_PLANNED_R2_USAGE,
          plannedNeonUsage:
            DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_PLANNED_NEON_USAGE,
          currentR2Usage: measurement.currentR2Usage,
          finishedHistoryUpperBoundAt,
          currentStateCycleId,
          evaluatedAt: at,
          attemptedAt: at,
          recordedAt: at,
          acceptedAt: at,
          publishedAt: at,
          vault,
          maximumAggregateRequestsPerMinute: 30,
        });
        stepCount += 1;
        terminalKind = resultKind(result);
        if (terminalKind === "complete" || heldResult(terminalKind)) break;
      }
      return Object.freeze({
        status:
          terminalKind === "complete"
            ? ("complete" as const)
            : heldResult(terminalKind)
              ? ("held" as const)
              : ("advanced" as const),
        stepCount,
        terminalKind,
        exactCodeHeadSha,
        finishedHistoryUpperBoundAt,
        refreshCycleId,
        budgetWindowId,
        preflightSha256: preflight.preflightSha256,
        r2AccountingBasis: "reserved_upper_bound" as const,
        persistentWriteArmed: true as const,
        previewOnly: true as const,
        paidUsageAllowed: false as const,
        preserveLastGood: true as const,
      });
    },
  });
}
