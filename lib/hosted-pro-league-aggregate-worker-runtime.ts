import {
  consumeAggregateRefreshQueueMessage,
  type ImportQueueConsumerDecision,
} from "./import-queue-consumer";
import type { NeonImportPersistenceSessionFactory } from "./neon-import-persistence-driver";
import {
  neonProLeagueAggregateRefreshCapabilitiesFromEnvironment,
  type ProLeagueAggregateRefreshEnvironment,
} from "./neon-pro-league-aggregate-refresh";

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export type HostedProLeagueAggregateWorkerEnvironment = Readonly<{
  workerId: string | undefined;
  database: ProLeagueAggregateRefreshEnvironment;
  leaseDurationMilliseconds: string | undefined;
}>;

export type HostedProLeagueAggregateWorkerDependencies = Readonly<{
  now?: () => Date;
  neonSessionFactory?: NeonImportPersistenceSessionFactory;
}>;

export type HostedProLeagueAggregateWorkerRuntime =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      consume: (input: {
        body: unknown;
        now?: Date;
      }) => Promise<ImportQueueConsumerDecision>;
    }>;

export const unavailableHostedProLeagueAggregateWorkerRuntime: HostedProLeagueAggregateWorkerRuntime =
  Object.freeze({ status: "not_configured" });

function identifier(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return SAFE_IDENTIFIER_PATTERN.test(normalized) ? normalized : null;
}

function leaseDuration(value: string | undefined): number | null {
  const normalized = value?.trim() ?? "";
  if (!/^[1-9][0-9]*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1_000 ||
    parsed > 60 * 60 * 1_000
  ) {
    return null;
  }
  return parsed;
}

export function hostedProLeagueAggregateWorkerRuntime(input: {
  environment: HostedProLeagueAggregateWorkerEnvironment;
  dependencies?: HostedProLeagueAggregateWorkerDependencies;
}): HostedProLeagueAggregateWorkerRuntime {
  const workerId = identifier(input.environment.workerId);
  const leaseDurationMilliseconds = leaseDuration(
    input.environment.leaseDurationMilliseconds,
  );
  if (workerId === null || leaseDurationMilliseconds === null) {
    return unavailableHostedProLeagueAggregateWorkerRuntime;
  }

  try {
    const capabilities =
      neonProLeagueAggregateRefreshCapabilitiesFromEnvironment(
        input.environment.database,
        input.dependencies?.neonSessionFactory,
      );
    if (capabilities.status !== "ready") {
      return unavailableHostedProLeagueAggregateWorkerRuntime;
    }
    const now = input.dependencies?.now ?? (() => new Date());
    return Object.freeze({
      status: "ready" as const,
      consume(consumeInput: { body: unknown; now?: Date }) {
        return consumeAggregateRefreshQueueMessage({
          body: consumeInput.body,
          workerId,
          now: consumeInput.now ?? now(),
          leaseDurationMilliseconds,
          capabilities,
        });
      },
    });
  } catch {
    return unavailableHostedProLeagueAggregateWorkerRuntime;
  }
}
