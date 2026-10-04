import {
  createCloudflareR2ImportObjectStorageForOwner,
  type CloudflareR2ImportObjectStoragePort,
} from "./cloudflare-r2-import-object-storage";
import { createCloudflareR2DatasetEvidencePort } from "./cloudflare-r2-dataset-evidence-port";
import { createCloudflareR2S3Port } from "./cloudflare-r2-s3-port";
import type { DnaOpenLabProviderCapacityMeasurementSource } from "./dna-open-lab-provider-capacity-preflight";
import { createNeonRaceMergeCoreOutcomeR2GenerationRepository } from "./neon-race-merge-core-outcome-r2-generation";
import type { NeonImportPersistenceSessionFactory } from "./neon-import-persistence-driver";
import type { PrivateRawImportObjectStore } from "./private-raw-import-object-stream";
import {
  materializeRaceMergeCoreOutcomeSourceCohort,
  type RaceMergeCoreOutcomeCohortSourceBounds,
  type RaceMergeCoreOutcomeSourceCohort,
} from "./race-merge-core-outcome-cohort-source";
import {
  raceMergeCoreOutcomeR2CapacityGateFromEnvironment,
  type RaceMergeCoreOutcomeR2CapacityGateEnvironment,
} from "./race-merge-core-outcome-r2-capacity-gate";
import {
  commitRaceMergeCoreOutcomeR2Generation,
  RACE_MERGE_CORE_OUTCOME_R2_COHORT_MAXIMUM_CORES,
  readCompleteRaceMergeCoreOutcomeR2Generation,
  type RaceMergeCoreOutcomeR2CapacityGate,
  type RaceMergeCoreOutcomeR2CompletedBoundary,
  type RaceMergeCoreOutcomeR2GenerationRepository,
  type RaceMergeCoreOutcomeR2GenerationResult,
} from "./race-merge-core-outcome-r2-generation";
import {
  createRaceMergeCoreOutcomeR2Store,
  type RaceMergeCoreOutcomeR2StoragePort,
  type RaceMergeCoreOutcomeR2Store,
} from "./race-merge-core-outcome-r2-store";
import type { RaceMergeOutcomeImportReference } from "./race-merge-outcome-ingestion-service";

const RUNTIME_ROLE = "dna_app_runtime";

export type RaceMergeCoreOutcomeConnectedEnvironment =
  RaceMergeCoreOutcomeR2CapacityGateEnvironment &
    Readonly<{
      databaseUrl?: string;
      databaseOwnerId?: string;
      runtimeRole?: string;
      cloudflareApiToken?: string;
      r2AccessKeyId?: string;
      r2SecretAccessKey?: string;
    }>;

export type RaceMergeCoreOutcomeConnectedResult = Readonly<{
  source: RaceMergeCoreOutcomeSourceCohort;
  generation: RaceMergeCoreOutcomeR2GenerationResult;
  sourceManifestSha256: string;
  selectedExactReplayCount: number;
  dnaProviderRequestCount: 0;
  persistentWritePerformed: true;
  paidUsageAllowed: false;
}>;

export type RaceMergeCoreOutcomeConnectedContinuationResult = Readonly<{
  previousGeneration: RaceMergeCoreOutcomeR2CompletedBoundary;
  next: RaceMergeCoreOutcomeConnectedResult;
}>;

type ExecuteInput = Readonly<{
  generationId: string;
  cohortOrdinal: number;
  afterSourceCoreId: number;
  maximumCores: number;
  references: readonly RaceMergeOutcomeImportReference[];
  bounds: RaceMergeCoreOutcomeCohortSourceBounds;
}>;

export type RaceMergeCoreOutcomeConnectedRuntime =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      exactCodeHeadSha: string;
      execute: (
        input: ExecuteInput,
      ) => Promise<RaceMergeCoreOutcomeConnectedResult>;
      executeNext: (input: {
        generationId: string;
        previousCohortOrdinal: number;
        references: readonly RaceMergeOutcomeImportReference[];
        bounds: RaceMergeCoreOutcomeCohortSourceBounds;
      }) => Promise<RaceMergeCoreOutcomeConnectedContinuationResult>;
    }>;

type Dependencies = Readonly<{
  capacityGate?: RaceMergeCoreOutcomeR2CapacityGate;
  measurementSource?: DnaOpenLabProviderCapacityMeasurementSource;
  sourceObjectStore?: PrivateRawImportObjectStore;
  outcomeStorage?: RaceMergeCoreOutcomeR2StoragePort;
  outcomeStore?: RaceMergeCoreOutcomeR2Store;
  repository?: RaceMergeCoreOutcomeR2GenerationRepository;
  createSourceR2Port?: () => CloudflareR2ImportObjectStoragePort;
  sessionFactory?: NeonImportPersistenceSessionFactory;
  materializeSource?: typeof materializeRaceMergeCoreOutcomeSourceCohort;
  commitGeneration?: typeof commitRaceMergeCoreOutcomeR2Generation;
  readCompleteGeneration?: typeof readCompleteRaceMergeCoreOutcomeR2Generation;
  now?: () => Date;
  fetch?: typeof globalThis.fetch;
}>;

function configured(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function privateSourceObjectStore(input: {
  ownerId: string;
  accountId: string;
  bucketName: string;
  apiToken: string;
  accessKeyId: string;
  secretAccessKey: string;
  createPort?: () => CloudflareR2ImportObjectStoragePort;
  now: () => Date;
  fetch?: typeof globalThis.fetch;
}): PrivateRawImportObjectStore {
  const storage = createCloudflareR2ImportObjectStorageForOwner({
    ownerId: input.ownerId,
    configuration: {
      accountId: input.accountId,
      bucketName: input.bucketName,
      createPort:
        input.createPort ??
        (() =>
          createCloudflareR2S3Port({
            accountId: input.accountId,
            accessKeyId: input.accessKeyId,
            secretAccessKey: input.secretAccessKey,
            apiToken: input.apiToken,
            now: input.now,
            ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
          })),
    },
  });
  return Object.freeze({
    async openObject(request) {
      const opened = await storage.openObject(request);
      if (opened.status !== "ready") {
        throw new Error("Race Merge private source object is missing.");
      }
      return Object.freeze({
        advertisedByteLength: opened.advertisedByteLength,
        body: opened.body,
      });
    },
  });
}

function assertSameCohort(
  source: RaceMergeCoreOutcomeSourceCohort,
  generation: RaceMergeCoreOutcomeR2GenerationResult,
): void {
  const authority = generation.authority;
  if (
    source.generationId !== authority.generationId ||
    source.selectedCoreCount !== authority.coreCount ||
    source.selectedUniqueOutcomeCount !== authority.uniqueOutcomeCount ||
    source.selectedObservationCount !== authority.sourceObservationCount ||
    source.firstSourceCoreId !== authority.firstSourceCoreId ||
    source.lastSourceCoreId !== authority.lastSourceCoreId ||
    source.dnaProviderRequestCount !== 0 ||
    source.persistentWritePerformed !== false ||
    source.paidUsageAllowed !== false ||
    generation.dnaApiRequestPerformed !== false ||
    generation.persistentWritePerformed !== true ||
    generation.paidUsageAllowed !== false
  ) {
    throw new Error(
      "Race Merge Core outcome connected runtime: source and generation disagree",
    );
  }
}

/**
 * Composes the checksum-bound private source with exact-byte preparation, a
 * fresh exact-main A$0 capacity proof, R2-first persistence and compact Neon
 * receipt checkpoints. Construction performs no provider request or write.
 */
export function raceMergeCoreOutcomeConnectedRuntimeFromEnvironment(
  environment: RaceMergeCoreOutcomeConnectedEnvironment,
  dependencies: Dependencies = {},
): RaceMergeCoreOutcomeConnectedRuntime {
  const ownerId = configured(environment.authorizedOwnerId);
  const exactCodeHeadSha = configured(environment.exactCodeHeadSha);
  const bucketName = configured(environment.r2BucketName);
  if (ownerId === null || exactCodeHeadSha === null || bucketName === null) {
    return Object.freeze({ status: "not_configured" as const });
  }
  const now = dependencies.now ?? (() => new Date());

  try {
    const connectedCapacity =
      dependencies.capacityGate === undefined
        ? raceMergeCoreOutcomeR2CapacityGateFromEnvironment(environment, {
            ...(dependencies.measurementSource === undefined
              ? {}
              : { measurementSource: dependencies.measurementSource }),
            now,
            ...(dependencies.fetch === undefined
              ? {}
              : { fetch: dependencies.fetch }),
          })
        : null;
    const capacityGate =
      dependencies.capacityGate ??
      (connectedCapacity?.status === "ready"
        ? connectedCapacity.gate
        : undefined);
    if (capacityGate === undefined) {
      return Object.freeze({ status: "not_configured" as const });
    }

    const sourceObjectStore =
      dependencies.sourceObjectStore ??
      privateSourceObjectStore({
        ownerId,
        accountId: configured(environment.cloudflareAccountId) ?? "",
        bucketName,
        apiToken: configured(environment.cloudflareApiToken) ?? "",
        accessKeyId: configured(environment.r2AccessKeyId) ?? "",
        secretAccessKey: configured(environment.r2SecretAccessKey) ?? "",
        now,
        ...(dependencies.createSourceR2Port === undefined
          ? {}
          : { createPort: dependencies.createSourceR2Port }),
        ...(dependencies.fetch === undefined
          ? {}
          : { fetch: dependencies.fetch }),
      });
    const outcomeStore =
      dependencies.outcomeStore ??
      createRaceMergeCoreOutcomeR2Store({
        ownerId,
        bucketName,
        storage:
          dependencies.outcomeStorage ??
          createCloudflareR2DatasetEvidencePort({
            accountId: configured(environment.cloudflareAccountId) ?? "",
            accessKeyId: configured(environment.r2AccessKeyId) ?? "",
            secretAccessKey: configured(environment.r2SecretAccessKey) ?? "",
            apiToken: configured(environment.cloudflareApiToken) ?? "",
            ...(dependencies.fetch === undefined
              ? {}
              : { fetch: dependencies.fetch }),
          }),
      });
    const repository =
      dependencies.repository ??
      createNeonRaceMergeCoreOutcomeR2GenerationRepository({
        databaseUrl: configured(environment.databaseUrl) ?? "",
        databaseOwnerId: configured(environment.databaseOwnerId) ?? "",
        ownerId,
        runtimeRole: configured(environment.runtimeRole) ?? RUNTIME_ROLE,
        ...(dependencies.sessionFactory === undefined
          ? {}
          : { sessionFactory: dependencies.sessionFactory }),
      });
    const materializeSource =
      dependencies.materializeSource ??
      materializeRaceMergeCoreOutcomeSourceCohort;
    const commitGeneration =
      dependencies.commitGeneration ?? commitRaceMergeCoreOutcomeR2Generation;
    const readCompleteGeneration =
      dependencies.readCompleteGeneration ??
      readCompleteRaceMergeCoreOutcomeR2Generation;

    const execute = async (
      input: ExecuteInput,
    ): Promise<RaceMergeCoreOutcomeConnectedResult> => {
      const startedAt = now().toISOString();
      const source = await materializeSource({
        ownerId,
        generationId: input.generationId,
        references: input.references,
        objectStore: sourceObjectStore,
        afterSourceCoreId: input.afterSourceCoreId,
        maximumCores: input.maximumCores,
        bounds: input.bounds,
      });
      const generation = await commitGeneration({
        ownerId,
        generationId: input.generationId,
        cohortOrdinal: input.cohortOrdinal,
        cores: source.cores,
        capacityGate,
        store: outcomeStore,
        repository,
        startedAt,
        registrationClock: now,
      });
      assertSameCohort(source, generation);
      return Object.freeze({
        source,
        generation,
        sourceManifestSha256: source.sourceManifestSha256,
        selectedExactReplayCount: source.selectedExactReplayCount,
        dnaProviderRequestCount: 0 as const,
        persistentWritePerformed: true as const,
        paidUsageAllowed: false as const,
      });
    };

    return Object.freeze({
      status: "ready" as const,
      exactCodeHeadSha,
      execute,
      async executeNext(input) {
        const previousGeneration = await readCompleteGeneration({
          ownerId,
          generationId: input.generationId,
          cohortOrdinal: input.previousCohortOrdinal,
          repository,
        });
        const next = await execute({
          generationId: input.generationId,
          cohortOrdinal: input.previousCohortOrdinal + 1,
          afterSourceCoreId: previousGeneration.authority.lastSourceCoreId,
          maximumCores: RACE_MERGE_CORE_OUTCOME_R2_COHORT_MAXIMUM_CORES,
          references: input.references,
          bounds: input.bounds,
        });
        return Object.freeze({ previousGeneration, next });
      },
    });
  } catch {
    return Object.freeze({ status: "not_configured" as const });
  }
}
