import {
  cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment,
  type CloudflareNeonDnaOpenLabProviderCapacityEnvironment,
} from "./cloudflare-neon-dna-open-lab-provider-capacity-source";
import {
  createCloudflareR2ImportObjectStorageForOwner,
  type CloudflareR2ImportObjectStoragePort,
} from "./cloudflare-r2-import-object-storage";
import { createCloudflareR2S3Port } from "./cloudflare-r2-s3-port";
import { createDnaOpenLabProviderCapacityPreflight } from "./dna-open-lab-provider-capacity-preflight";
import type { DnaOpenLabProviderCapacityMeasurementSource } from "./dna-open-lab-provider-capacity-preflight";
import { createNeonRaceMergeOutcomeIngestionRepository } from "./neon-race-merge-outcome-ingestion-repository";
import type { NeonImportPersistenceSessionFactory } from "./neon-import-persistence-driver";
import type { PrivateRawImportObjectStore } from "./private-raw-import-object-stream";
import {
  ingestRaceMergeOutcomeEvidence,
  type RaceMergeOutcomeImportReference,
  type RaceMergeOutcomeIngestionBounds,
  type RaceMergeOutcomeIngestionRepository,
  type RaceMergeOutcomeIngestionResult,
} from "./race-merge-outcome-ingestion-service";
import { createRaceMergeOutcomeZeroCostCapacityGate } from "./race-merge-outcome-zero-cost-capacity-gate";

const RUNTIME_ROLE = "dna_app_runtime";

export type RaceMergeOutcomeConnectedEnvironment =
  CloudflareNeonDnaOpenLabProviderCapacityEnvironment &
    Readonly<{
      exactCodeHeadSha?: string;
      databaseUrl?: string;
      databaseOwnerId?: string;
      runtimeRole?: string;
      cloudflareApiToken?: string;
      r2AccessKeyId?: string;
      r2SecretAccessKey?: string;
    }>;

export type RaceMergeOutcomeConnectedCommand = Readonly<{
  status: "ready";
  execute: (input: {
    generationId: string;
    references: readonly RaceMergeOutcomeImportReference[];
    bounds: RaceMergeOutcomeIngestionBounds;
  }) => Promise<RaceMergeOutcomeIngestionResult>;
}>;

export type RaceMergeOutcomeConnectedRuntime =
  Readonly<{ status: "not_configured" }> | RaceMergeOutcomeConnectedCommand;

type Dependencies = Readonly<{
  measurementSource?: DnaOpenLabProviderCapacityMeasurementSource;
  repository?: RaceMergeOutcomeIngestionRepository;
  objectStore?: PrivateRawImportObjectStore;
  createR2Port?: () => CloudflareR2ImportObjectStoragePort;
  sessionFactory?: NeonImportPersistenceSessionFactory;
  runIngestion?: typeof ingestRaceMergeOutcomeEvidence;
  now?: () => Date;
  fetch?: typeof globalThis.fetch;
}>;

function configured(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function privateObjectStore(input: {
  ownerId: string;
  accountId: string;
  bucketName: string;
  apiToken: string;
  accessKeyId: string;
  secretAccessKey: string;
  createR2Port?: () => CloudflareR2ImportObjectStoragePort;
  now: () => Date;
  fetch?: typeof globalThis.fetch;
}): PrivateRawImportObjectStore {
  const storage = createCloudflareR2ImportObjectStorageForOwner({
    ownerId: input.ownerId,
    configuration: {
      accountId: input.accountId,
      bucketName: input.bucketName,
      createPort:
        input.createR2Port ??
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

/**
 * Composes the guarded Race Merge stream, private owner-scoped R2 source,
 * least-privilege Neon repository and fresh provider capacity preflight. A
 * missing dependency returns a closed runtime before any provider request.
 */
export function raceMergeOutcomeConnectedRuntimeFromEnvironment(
  environment: RaceMergeOutcomeConnectedEnvironment,
  dependencies: Dependencies = {},
): RaceMergeOutcomeConnectedRuntime {
  const ownerId = configured(environment.authorizedOwnerId);
  const exactCodeHeadSha = configured(environment.exactCodeHeadSha);
  if (ownerId === null || exactCodeHeadSha === null) {
    return Object.freeze({ status: "not_configured" as const });
  }

  const now = dependencies.now ?? (() => new Date());
  const measurementSource =
    dependencies.measurementSource ??
    cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment(environment, {
      now,
      ...(dependencies.fetch === undefined
        ? {}
        : { fetch: dependencies.fetch }),
    });
  if (measurementSource.status !== "ready") {
    return Object.freeze({ status: "not_configured" as const });
  }

  try {
    const repository =
      dependencies.repository ??
      createNeonRaceMergeOutcomeIngestionRepository({
        databaseUrl: configured(environment.databaseUrl) ?? "",
        databaseOwnerId: configured(environment.databaseOwnerId) ?? "",
        ownerId,
        runtimeRole: configured(environment.runtimeRole) ?? RUNTIME_ROLE,
        ...(dependencies.sessionFactory === undefined
          ? {}
          : { sessionFactory: dependencies.sessionFactory }),
      });
    const objectStore =
      dependencies.objectStore ??
      privateObjectStore({
        ownerId,
        accountId: configured(environment.cloudflareAccountId) ?? "",
        bucketName: configured(environment.r2BucketName) ?? "",
        apiToken: configured(environment.cloudflareApiToken) ?? "",
        accessKeyId: configured(environment.r2AccessKeyId) ?? "",
        secretAccessKey: configured(environment.r2SecretAccessKey) ?? "",
        now,
        ...(dependencies.createR2Port === undefined
          ? {}
          : { createR2Port: dependencies.createR2Port }),
        ...(dependencies.fetch === undefined
          ? {}
          : { fetch: dependencies.fetch }),
      });
    const preflight = createDnaOpenLabProviderCapacityPreflight({
      configuredOwnerId: ownerId,
      measurementSource,
      now,
    });
    const zeroCostCapacityGate = createRaceMergeOutcomeZeroCostCapacityGate({
      configuredOwnerId: ownerId,
      exactCodeHeadSha,
      preflight,
    });
    const runIngestion =
      dependencies.runIngestion ?? ingestRaceMergeOutcomeEvidence;

    return Object.freeze({
      status: "ready" as const,
      execute(input) {
        return runIngestion({
          ownerId,
          generationId: input.generationId,
          references: input.references,
          objectStore,
          repository,
          zeroCostCapacityGate,
          bounds: input.bounds,
          now: now(),
        });
      },
    });
  } catch {
    return Object.freeze({ status: "not_configured" as const });
  }
}
