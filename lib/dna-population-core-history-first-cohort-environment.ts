import {
  cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment,
  type CloudflareNeonDnaOpenLabProviderCapacityEnvironment,
} from "./cloudflare-neon-dna-open-lab-provider-capacity-source";
import { createCloudflareR2DatasetEvidencePort } from "./cloudflare-r2-dataset-evidence-port";
import { createDnaCoreRaceHistoryClient } from "./dna-core-race-history-client";
import { runDnaCoreRaceHistoryPrivateCollectorStep } from "./dna-core-race-history-private-collector";
import { createDnaCoreRaceHistoryR2EvidenceStore } from "./dna-core-race-history-r2-evidence";
import type { DnaPopulationCoreHistoryFirstCohortAuthority } from "./dna-population-core-history-first-cohort-authority";
import {
  createDnaPopulationCoreHistoryFirstCohortCommand,
  type DnaPopulationCoreHistoryFirstCohortCollectionStep,
} from "./dna-population-core-history-first-cohort-command";
import {
  createDnaOpenLabProviderCapacityPreflight,
  type DnaOpenLabProviderCapacityMeasurement,
  type DnaOpenLabProviderCapacityMeasurementSource,
} from "./dna-open-lab-provider-capacity-preflight";
import type { DnaOpenLabR2BudgetRepository } from "./dna-open-lab-r2-budget-repository";
import {
  createDnaOpenLabRequestBudget,
  DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
} from "./dna-open-lab-request-budget";
import { createNeonDnaCoreRaceHistoryAcquisitionRepository } from "./neon-dna-core-race-history-acquisition";
import { neonDnaOpenLabR2BudgetRepositoryFromEnvironment } from "./neon-dna-open-lab-r2-budget-repository";
import type { NeonImportPersistenceSessionFactory } from "./neon-import-persistence-driver";

const RUNTIME_ROLE = "dna_app_runtime";

export type DnaPopulationCoreHistoryFirstCohortEnvironment =
  CloudflareNeonDnaOpenLabProviderCapacityEnvironment &
    Readonly<{
      databaseUrl?: string;
      databaseOwnerId?: string;
      ownerId?: string;
      runtimeRole?: string;
      cloudflareApiToken?: string;
      r2AccessKeyId?: string;
      r2SecretAccessKey?: string;
    }>;

type Dependencies = Readonly<{
  measurementSource?: DnaOpenLabProviderCapacityMeasurementSource;
  budgetRepository?: DnaOpenLabR2BudgetRepository;
  runCollectionStep?: DnaPopulationCoreHistoryFirstCohortCollectionStep;
  sessionFactory?: NeonImportPersistenceSessionFactory;
  now?: () => Date;
}>;

function configured(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function trackedMeasurementSource(input: {
  source: Extract<
    DnaOpenLabProviderCapacityMeasurementSource,
    { status: "ready" }
  >;
  setLatest: (measurement: DnaOpenLabProviderCapacityMeasurement) => void;
}): Extract<DnaOpenLabProviderCapacityMeasurementSource, { status: "ready" }> {
  return Object.freeze({
    status: "ready" as const,
    async measure(request) {
      const measurement = await input.source.measure(request);
      input.setLatest(measurement);
      return measurement;
    },
  });
}

/**
 * Connects the selection-only first population cohort authority to the private
 * Preview persistence ports. The selected Core can only come from the supplied
 * exact-main authority; environment configuration cannot replace or widen it.
 * Provider capacity is measured again by the command immediately before the
 * first durable step, and that exact measurement opens the fail-closed R2
 * budget window used by the collector.
 */
export function dnaPopulationCoreHistoryFirstCohortCommandFromEnvironment(
  environment: DnaPopulationCoreHistoryFirstCohortEnvironment,
  authority: DnaPopulationCoreHistoryFirstCohortAuthority,
  dependencies: Dependencies = {},
) {
  const ownerId = configured(
    environment.ownerId ?? environment.authorizedOwnerId,
  );
  const databaseUrl = configured(environment.databaseUrl);
  const databaseOwnerId = configured(environment.databaseOwnerId);
  const runtimeRole = configured(environment.runtimeRole) ?? RUNTIME_ROLE;
  const cloudflareAccountId = configured(environment.cloudflareAccountId);
  const cloudflareApiToken = configured(environment.cloudflareApiToken);
  const r2BucketName = configured(environment.r2BucketName);
  const r2AccessKeyId = configured(environment.r2AccessKeyId);
  const r2SecretAccessKey = configured(environment.r2SecretAccessKey);
  if (
    ownerId === null ||
    databaseUrl === null ||
    databaseOwnerId === null ||
    cloudflareAccountId === null ||
    cloudflareApiToken === null ||
    r2BucketName === null ||
    r2AccessKeyId === null ||
    r2SecretAccessKey === null
  ) {
    return Object.freeze({ status: "not_configured" as const });
  }

  const source =
    dependencies.measurementSource ??
    cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment(environment);
  const budgetRepository =
    dependencies.budgetRepository ??
    neonDnaOpenLabR2BudgetRepositoryFromEnvironment(
      { databaseUrl, databaseOwnerId, runtimeRole },
      dependencies.sessionFactory,
    );
  if (source.status !== "ready" || budgetRepository.status !== "ready") {
    return Object.freeze({ status: "not_configured" as const });
  }

  let latestCapacityMeasurement: DnaOpenLabProviderCapacityMeasurement | null =
    null;
  const measurementSource = trackedMeasurementSource({
    source,
    setLatest(measurement) {
      latestCapacityMeasurement = measurement;
    },
  });
  const capacityPreflight = createDnaOpenLabProviderCapacityPreflight({
    configuredOwnerId: ownerId,
    measurementSource,
    ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
  });

  const defaultRunCollectionStep =
    (): DnaPopulationCoreHistoryFirstCohortCollectionStep => {
      const storage = createCloudflareR2DatasetEvidencePort({
        accountId: cloudflareAccountId,
        apiToken: cloudflareApiToken,
        accessKeyId: r2AccessKeyId,
        secretAccessKey: r2SecretAccessKey,
      });
      const evidenceStore = createDnaCoreRaceHistoryR2EvidenceStore({
        ownerId,
        bucketName: r2BucketName,
        storage,
      });
      const acquisitionRepository =
        createNeonDnaCoreRaceHistoryAcquisitionRepository({
          databaseUrl,
          databaseOwnerId,
          ownerId,
          runtimeRole,
          ...(dependencies.sessionFactory === undefined
            ? {}
            : { sessionFactory: dependencies.sessionFactory }),
        });
      const requestBudget = createDnaOpenLabRequestBudget({
        initialRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
        maximumRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
      });
      const client = createDnaCoreRaceHistoryClient();

      return async (request) =>
        runDnaCoreRaceHistoryPrivateCollectorStep({
          ownerId,
          budgetWindowId: request.budgetWindowId,
          evaluatedAt: request.evaluatedAt,
          attemptedAt: request.attemptedAt,
          loadServingCores: async () =>
            Object.freeze(
              request.authority.coreIds.map((coreId) =>
                Object.freeze({
                  generationId: request.authority.measurementSliceSha256,
                  canonical: Object.freeze({ sourceCoreId: String(coreId) }),
                }),
              ),
            ),
          acquisitionRepository,
          budgetRepository,
          client,
          requestBudget,
          evidenceStore,
        });
    };
  const runStep = dependencies.runCollectionStep ?? defaultRunCollectionStep();

  return Object.freeze({
    status: "ready" as const,
    command: createDnaPopulationCoreHistoryFirstCohortCommand({
      configuredOwnerId: ownerId,
      authority,
      capacityPreflight,
      ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
      async runCollectionStep(request) {
        const measurement = latestCapacityMeasurement;
        if (measurement === null) {
          throw new Error(
            "Population Core history first cohort capacity measurement is unavailable.",
          );
        }
        const existingWindow = await budgetRepository.readWindow(ownerId);
        if (existingWindow?.windowId !== request.budgetWindowId) {
          await budgetRepository.openWindow({
            ownerId,
            windowId: request.budgetWindowId,
            windowStartAt: measurement.billingWindowStartAt,
            windowEndAt: measurement.billingWindowEndAt,
            measuredAt: measurement.measuredAt,
            baselineUsage: measurement.currentR2Usage,
          });
        }
        return runStep(request);
      },
    }),
  });
}
