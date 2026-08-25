import {
  consumeAggregateRefreshQueueMessage,
  type ImportQueueConsumerDecision,
} from "./import-queue-consumer";
import type { NeonImportPersistenceSessionFactory } from "./neon-import-persistence-driver";
import {
  neonProLeagueAggregateRefreshCapabilitiesFromEnvironment,
  type ProLeagueAggregateRefreshEnvironment,
} from "./neon-pro-league-aggregate-refresh";
import {
  hostedRaceArchiveAggregateRefresherRuntime,
  type HostedRaceArchiveAggregateRefresherDependencies,
} from "./hosted-race-archive-aggregate-refresher-runtime";

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export type HostedProLeagueAggregateWorkerArchiveEnvironment = Readonly<{
  authorizedOwnerId: string | undefined;
  cloudflareAccountId: string | undefined;
  cloudflareApiToken: string | undefined;
  bucketName: string | undefined;
  r2AccessKeyId: string | undefined;
  r2SecretAccessKey: string | undefined;
}>;

export type HostedProLeagueAggregateWorkerEnvironment = Readonly<{
  workerId: string | undefined;
  database: ProLeagueAggregateRefreshEnvironment;
  leaseDurationMilliseconds: string | undefined;
  archive?: HostedProLeagueAggregateWorkerArchiveEnvironment;
}>;

export type HostedProLeagueAggregateWorkerDependencies = Readonly<{
  now?: () => Date;
  neonSessionFactory?: NeonImportPersistenceSessionFactory;
  archive?: HostedRaceArchiveAggregateRefresherDependencies;
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
    const baseCapabilities =
      neonProLeagueAggregateRefreshCapabilitiesFromEnvironment(
        input.environment.database,
        input.dependencies?.neonSessionFactory,
      );
    if (baseCapabilities.status !== "ready") {
      return unavailableHostedProLeagueAggregateWorkerRuntime;
    }

    let capabilities = baseCapabilities;
    if (input.environment.archive !== undefined) {
      const archiveRuntime = hostedRaceArchiveAggregateRefresherRuntime({
        environment: {
          authorizedOwnerId: input.environment.archive.authorizedOwnerId,
          databaseUrl: input.environment.database.databaseUrl,
          databaseOwnerId: input.environment.database.databaseOwnerId,
          runtimeRole: input.environment.database.runtimeRole,
          workerId,
          cloudflareAccountId:
            input.environment.archive.cloudflareAccountId,
          cloudflareApiToken: input.environment.archive.cloudflareApiToken,
          bucketName: input.environment.archive.bucketName,
          r2AccessKeyId: input.environment.archive.r2AccessKeyId,
          r2SecretAccessKey: input.environment.archive.r2SecretAccessKey,
        },
        currentStateRefresher: baseCapabilities.refresher,
        dependencies: {
          ...input.dependencies?.archive,
          ...(input.dependencies?.neonSessionFactory &&
          input.dependencies?.archive?.neonSessionFactory === undefined
            ? { neonSessionFactory: input.dependencies.neonSessionFactory }
            : {}),
          ...(input.dependencies?.now &&
          input.dependencies?.archive?.now === undefined
            ? { now: input.dependencies.now }
            : {}),
        },
      });
      if (archiveRuntime.status !== "ready") {
        return unavailableHostedProLeagueAggregateWorkerRuntime;
      }
      capabilities = Object.freeze({
        status: "ready" as const,
        repository: baseCapabilities.repository,
        refresher: archiveRuntime.refresher,
      });
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
