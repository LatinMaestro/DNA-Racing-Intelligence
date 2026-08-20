import { createBoundedAcceptedDatasetProcessor } from "./bounded-accepted-dataset-processor";
import {
  consumeImportActivationQueueMessage,
  type ImportQueueConsumerDecision,
} from "./import-queue-consumer";
import {
  neonImportActivationRepositoriesFromEnvironment,
  type ImportActivationDatabaseEnvironment,
} from "./neon-import-activation";
import type { NeonImportPersistenceSessionFactory } from "./neon-import-persistence-driver";

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export type HostedImportActivationWorkerEnvironment = Readonly<{
  workerId: string | undefined;
  database: ImportActivationDatabaseEnvironment;
  leaseDurationMilliseconds: string | undefined;
  maximumSourceVersions: string | undefined;
  maximumQuarantinedRecords: string | undefined;
}>;

export type HostedImportActivationWorkerDependencies = Readonly<{
  now?: () => Date;
  neonSessionFactory?: NeonImportPersistenceSessionFactory;
}>;

export type HostedImportActivationWorkerRuntime =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      consume: (input: {
        body: unknown;
        now?: Date;
      }) => Promise<ImportQueueConsumerDecision>;
    }>;

export const unavailableHostedImportActivationWorkerRuntime: HostedImportActivationWorkerRuntime =
  Object.freeze({ status: "not_configured" });

function identifier(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return SAFE_IDENTIFIER_PATTERN.test(normalized) ? normalized : null;
}

function boundedInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
): number | null {
  const normalized = value?.trim() ?? "";
  if (!/^[1-9][0-9]*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    return null;
  }
  return parsed;
}

export function hostedImportActivationWorkerRuntime(input: {
  environment: HostedImportActivationWorkerEnvironment;
  dependencies?: HostedImportActivationWorkerDependencies;
}): HostedImportActivationWorkerRuntime {
  const workerId = identifier(input.environment.workerId);
  const leaseDurationMilliseconds = boundedInteger(
    input.environment.leaseDurationMilliseconds,
    1_000,
    60 * 60 * 1_000,
  );
  const maximumSourceVersions = boundedInteger(
    input.environment.maximumSourceVersions,
    1,
    24,
  );
  const maximumQuarantinedRecords = boundedInteger(
    input.environment.maximumQuarantinedRecords,
    1,
    10_000_000,
  );
  if (
    workerId === null ||
    leaseDurationMilliseconds === null ||
    maximumSourceVersions === null ||
    maximumQuarantinedRecords === null
  ) {
    return unavailableHostedImportActivationWorkerRuntime;
  }

  try {
    const repositories = neonImportActivationRepositoriesFromEnvironment(
      input.environment.database,
      input.dependencies?.neonSessionFactory,
    );
    if (repositories === null) {
      return unavailableHostedImportActivationWorkerRuntime;
    }
    const processor = createBoundedAcceptedDatasetProcessor({
      repository: repositories.preparationRepository,
      maximumSourceVersions,
      maximumQuarantinedRecords,
    });
    const capabilities = Object.freeze({
      status: "ready" as const,
      repository: repositories.processingRepository,
      processor,
    });
    const now = input.dependencies?.now ?? (() => new Date());
    return Object.freeze({
      status: "ready" as const,
      consume(consumeInput: { body: unknown; now?: Date }) {
        return consumeImportActivationQueueMessage({
          body: consumeInput.body,
          workerId,
          now: consumeInput.now ?? now(),
          leaseDurationMilliseconds,
          capabilities,
        });
      },
    });
  } catch {
    return unavailableHostedImportActivationWorkerRuntime;
  }
}
