import { createCloudflareNeonDnaOpenLabProviderCapacitySource } from "./cloudflare-neon-dna-open-lab-provider-capacity-source";
import { createCloudflareR2DatasetEvidencePort } from "./cloudflare-r2-dataset-evidence-port";
import { createDnaOpenLabClientPool } from "./dna-open-lab-client-pool";
import type { DnaOpenLabPrivateDailyRefreshSources } from "./dna-open-lab-private-daily-refresh-operator";
import {
  createDnaOpenLabProviderCapacityPreflight,
  type DnaOpenLabProviderCapacityMeasurementSource,
} from "./dna-open-lab-provider-capacity-preflight";
import {
  createDnaOpenLabR2CurrentStateEvidenceReader,
  createDnaOpenLabR2CurrentStateEvidenceSink,
} from "./dna-open-lab-r2-current-state-evidence";
import { createDnaOpenLabR2RaceEvidencePorts } from "./dna-open-lab-r2-race-evidence";
import {
  createDnaOpenLabRequestBudget,
  DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
} from "./dna-open-lab-request-budget";
import {
  createDnaOpenLabV1Client,
  type DnaOpenLabClient,
  type DnaOpenLabTransport,
} from "./dna-open-lab-v1-client";
import type { DnaOpenLabR2Usage } from "./dna-open-lab-zero-cost-refresh-policy";

type EvidenceStorage = ReturnType<typeof createCloudflareR2DatasetEvidencePort>;

export type DnaOpenLabPrivateDailyRefreshSourceEnvironment = Readonly<{
  authorizedOwnerId?: string;
  cloudflareAccountId?: string;
  cloudflareApiToken?: string;
  cloudflareAnalyticsApiToken?: string;
  dnaOpenLabApiKey1?: string;
  dnaOpenLabApiKey2?: string;
  dnaOpenLabApiKey3?: string;
  neonApiKey?: string;
  neonProjectId?: string;
  r2AccessKeyId?: string;
  r2BucketName?: string;
  r2SecretAccessKey?: string;
  r2StorageClass?: string;
}>;

export type DnaOpenLabPrivateDailyRefreshSourceRuntime =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      sources: DnaOpenLabPrivateDailyRefreshSources;
    }>;

function configured(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function addCount(value: number, increment: number, field: string): number {
  const result = value + increment;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`DNA Open Lab private daily refresh ${field} overflowed.`);
  }
  return result;
}

/**
 * Counts the exact S3 operations issued by this process. Counts advance before
 * each request because an unsuccessful provider request may still be billable.
 * Retained storage advances only after R2 confirms that an immutable object was
 * newly created. Delete operations are free in R2 Standard and are not part of
 * a normal refresh.
 */
export function createMeteredDnaOpenLabR2EvidenceStorage(
  storage: EvidenceStorage,
): Readonly<{
  storage: EvidenceStorage;
  measure: () => DnaOpenLabR2Usage;
}> {
  let storageBytes = 0;
  let classAOperations = 0;
  let classBOperations = 0;
  const metered: EvidenceStorage = Object.freeze({
    readBucketPrivacy: (input) => storage.readBucketPrivacy(input),
    async putObjectIfAbsent(input) {
      classAOperations = addCount(
        classAOperations,
        1,
        "Class A operation count",
      );
      const result = await storage.putObjectIfAbsent(input);
      if (result.status === "created") {
        storageBytes = addCount(
          storageBytes,
          input.byteLength,
          "retained byte count",
        );
      }
      return result;
    },
    async headObject(input) {
      classBOperations = addCount(
        classBOperations,
        1,
        "Class B operation count",
      );
      return storage.headObject(input);
    },
    async getObject(input) {
      classBOperations = addCount(
        classBOperations,
        1,
        "Class B operation count",
      );
      return storage.getObject(input);
    },
    deleteObject: (input) => storage.deleteObject(input),
  });
  return Object.freeze({
    storage: metered,
    measure: () =>
      Object.freeze({ storageBytes, classAOperations, classBOperations }),
  });
}

function pooledRaceClient(
  pool: ReturnType<typeof createDnaOpenLabClientPool>,
): Pick<DnaOpenLabClient, "racesFinished" | "raceDocs"> {
  return Object.freeze({
    racesFinished: (request) =>
      pool.execute({
        scope: "races",
        request: (client) => client.racesFinished(request),
      }),
    raceDocs: (request) =>
      pool.execute({
        scope: "races",
        request: (client) => client.raceDocs(request),
      }),
  });
}

/**
 * Server-only hosted source composition. Creating it performs no network,
 * database or provider write. Every DNA request, including finished-history
 * hydration, passes through the same fixed aggregate 30-rpm client pool.
 */
export function dnaOpenLabPrivateDailyRefreshSourcesFromEnvironment(
  environment: DnaOpenLabPrivateDailyRefreshSourceEnvironment,
  options: Readonly<{
    fetch?: typeof globalThis.fetch;
    now?: () => Date;
    nowMilliseconds?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
    storage?: EvidenceStorage;
    transport?: DnaOpenLabTransport;
    providerCapacityMeasurementSource?: DnaOpenLabProviderCapacityMeasurementSource;
  }> = {},
): DnaOpenLabPrivateDailyRefreshSourceRuntime {
  const authorizedOwnerId = configured(environment.authorizedOwnerId);
  const cloudflareAccountId = configured(environment.cloudflareAccountId);
  const cloudflareApiToken = configured(environment.cloudflareApiToken);
  const cloudflareAnalyticsApiToken = configured(
    environment.cloudflareAnalyticsApiToken,
  );
  const dnaOpenLabApiKeys = [
    configured(environment.dnaOpenLabApiKey1),
    configured(environment.dnaOpenLabApiKey2),
    configured(environment.dnaOpenLabApiKey3),
  ];
  const neonApiKey = configured(environment.neonApiKey);
  const neonProjectId = configured(environment.neonProjectId);
  const r2AccessKeyId = configured(environment.r2AccessKeyId);
  const r2BucketName = configured(environment.r2BucketName);
  const r2SecretAccessKey = configured(environment.r2SecretAccessKey);
  const r2StorageClass = configured(environment.r2StorageClass);
  if (
    authorizedOwnerId === null ||
    cloudflareAccountId === null ||
    cloudflareApiToken === null ||
    cloudflareAnalyticsApiToken === null ||
    dnaOpenLabApiKeys.some((value) => value === null) ||
    neonApiKey === null ||
    neonProjectId === null ||
    r2AccessKeyId === null ||
    r2BucketName === null ||
    r2SecretAccessKey === null ||
    r2StorageClass === null
  ) {
    return Object.freeze({ status: "not_configured" });
  }
  const apiKeys = dnaOpenLabApiKeys as [string, string, string];
  if (new Set(apiKeys).size !== apiKeys.length) {
    throw new Error(
      "DNA Open Lab private daily refresh requires three distinct API keys.",
    );
  }
  const measurementSource =
    options.providerCapacityMeasurementSource ??
    createCloudflareNeonDnaOpenLabProviderCapacitySource({
      authorizedOwnerId,
      cloudflareAccountId,
      cloudflareAnalyticsApiToken,
      r2BucketName,
      r2StorageClass,
      neonApiKey,
      neonProjectId,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  if (measurementSource.status !== "ready") {
    return Object.freeze({ status: "not_configured" });
  }
  const baseStorage =
    options.storage ??
    createCloudflareR2DatasetEvidencePort({
      accountId: cloudflareAccountId,
      accessKeyId: r2AccessKeyId,
      secretAccessKey: r2SecretAccessKey,
      apiToken: cloudflareApiToken,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  const meteredStorage = createMeteredDnaOpenLabR2EvidenceStorage(baseStorage);
  const clients = apiKeys.map((apiKey) =>
    createDnaOpenLabV1Client({
      apiKey,
      ...(options.transport === undefined
        ? {}
        : { transport: options.transport }),
    }),
  );
  const allScopes = ["vault", "races", "cores", "tokens", "splice"] as const;
  const currentStatePool = createDnaOpenLabClientPool({
    lanes: clients.map((client, index) => ({
      id: `key-${index + 1}`,
      client,
      scopes: allScopes,
    })),
    aggregateRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
    maximumLaneRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
    allowIndependentRateBuckets: false,
    ...(options.nowMilliseconds === undefined
      ? {}
      : { nowMilliseconds: options.nowMilliseconds }),
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
  });
  const finishedHistoryClient = pooledRaceClient(currentStatePool);
  const raceEvidence = createDnaOpenLabR2RaceEvidencePorts({
    client: finishedHistoryClient,
    configuration: {
      ownerId: authorizedOwnerId,
      bucketName: r2BucketName,
      storage: meteredStorage.storage,
    },
  });
  const currentStateEvidenceConfiguration = {
    ownerId: authorizedOwnerId,
    bucketName: r2BucketName,
    storage: meteredStorage.storage,
  };
  const sources: DnaOpenLabPrivateDailyRefreshSources = Object.freeze({
    providerCapacityPreflight: createDnaOpenLabProviderCapacityPreflight({
      configuredOwnerId: authorizedOwnerId,
      measurementSource,
      ...(options.now === undefined ? {} : { now: options.now }),
    }),
    finishedHistoryClient: {
      racesFinished: finishedHistoryClient.racesFinished,
      raceDocs: raceEvidence.raceDocumentClient.raceDocs,
    },
    requestBudget: createDnaOpenLabRequestBudget({
      initialRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
      maximumRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
      ...(options.nowMilliseconds === undefined
        ? {}
        : { nowMilliseconds: options.nowMilliseconds }),
      ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    }),
    finishedHistoryPublisher: raceEvidence.publisher,
    identityConflictQuarantine: raceEvidence.identityConflictQuarantine,
    currentStatePool,
    persistCurrentStateEvidence: createDnaOpenLabR2CurrentStateEvidenceSink(
      currentStateEvidenceConfiguration,
    ),
    readCurrentStateEvidence: createDnaOpenLabR2CurrentStateEvidenceReader(
      currentStateEvidenceConfiguration,
    ),
    measureActualR2Usage: async () => meteredStorage.measure(),
  });
  return Object.freeze({ status: "ready", sources });
}
