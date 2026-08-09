import type {
  ImportCapacityProjection,
  ImportProviderCapacityPort,
} from "./import-provider-capacity-adapter";

const CLOUDFLARE_API_ORIGIN = "https://api.cloudflare.com";
const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/;
const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const MAX_FILES_PER_BATCH = 24;
const MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024;
const NEON_STAGING_MULTIPLIER = 2;

const CLASS_A_ACTIONS = new Set([
  "ListBuckets",
  "PutBucket",
  "ListObjects",
  "PutObject",
  "CopyObject",
  "CompleteMultipartUpload",
  "CreateMultipartUpload",
  "LifecycleStorageTierTransition",
  "ListMultipartUploads",
  "UploadPart",
  "UploadPartCopy",
  "ListParts",
  "PutBucketEncryption",
  "PutBucketCors",
  "PutBucketLifecycleConfiguration",
]);

const CLASS_B_ACTIONS = new Set([
  "HeadBucket",
  "HeadObject",
  "GetObject",
  "UsageSummary",
  "GetBucketEncryption",
  "GetBucketLocation",
  "GetBucketCors",
  "GetBucketLifecycleConfiguration",
]);

const FREE_ACTIONS = new Set([
  "DeleteObject",
  "DeleteBucket",
  "AbortMultipartUpload",
]);

export type CloudflareNeonImportCapacityConfiguration = Readonly<{
  authorizedOwnerId: string;
  cloudflareAccountId: string;
  cloudflareApiToken: string;
  r2BucketName: string;
  queueId: string;
  now?: () => Date;
  fetch?: typeof globalThis.fetch;
  readNeonStorageBytes: (input: { ownerId: string }) => Promise<number>;
}>;

type CloudflareGraphqlEnvelope = Readonly<{
  data?: unknown;
  errors?: unknown;
}>;

type CloudflareRestEnvelope = Readonly<{
  success?: unknown;
  result?: unknown;
}>;

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Hosted provider capacity response is invalid.");
  }
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error("Hosted provider capacity response is invalid.");
  }
  return value;
}

function safeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("Hosted provider capacity response is invalid.");
  }
  return value as number;
}

function secret(value: string, field: string): string {
  const normalized = value.trim();
  if (
    normalized === "" ||
    normalized.length > 4096 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function identifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function owner(value: string): string {
  const normalized = value.trim();
  if (
    normalized === "" ||
    normalized.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error("authorizedOwnerId is invalid");
  }
  return normalized;
}

function startOfUtcMonth(date: Date): string {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
  ).toISOString();
}

function parseR2Usage(value: unknown): Readonly<{
  storageBytes: number;
  classAOperations: number;
  classBOperations: number;
}> {
  const data = record(value);
  const viewer = record(data.viewer);
  const account = record(array(viewer.accounts)[0]);
  const storageGroups = array(account.r2StorageAdaptiveGroups);
  const storage =
    storageGroups.length === 0
      ? { payloadSize: 0, metadataSize: 0 }
      : record(record(storageGroups[0]).max);
  const storageBytes =
    safeInteger(storage.payloadSize) + safeInteger(storage.metadataSize);
  if (!Number.isSafeInteger(storageBytes)) {
    throw new Error("Hosted provider capacity response is invalid.");
  }

  let classAOperations = 0;
  let classBOperations = 0;
  for (const groupValue of array(account.r2OperationsAdaptiveGroups)) {
    const group = record(groupValue);
    const actionType = record(group.dimensions).actionType;
    if (typeof actionType !== "string") {
      throw new Error("Hosted provider capacity response is invalid.");
    }
    const requests = safeInteger(record(group.sum).requests);
    if (CLASS_A_ACTIONS.has(actionType)) classAOperations += requests;
    else if (CLASS_B_ACTIONS.has(actionType)) classBOperations += requests;
    else if (!FREE_ACTIONS.has(actionType)) {
      throw new Error("Hosted provider capacity response is invalid.");
    }
    if (
      !Number.isSafeInteger(classAOperations) ||
      !Number.isSafeInteger(classBOperations)
    ) {
      throw new Error("Hosted provider capacity response is invalid.");
    }
  }
  return { storageBytes, classAOperations, classBOperations };
}

function parseQueueBacklog(value: unknown): number {
  const result = record(value);
  return safeInteger(result.backlog_count);
}

const R2_CAPACITY_QUERY = `query DnaImportCapacity(
  $accountTag: string!
  $startDate: Time!
  $endDate: Time!
  $bucketName: string!
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      r2OperationsAdaptiveGroups(
        limit: 10000
        filter: {
          datetime_geq: $startDate
          datetime_leq: $endDate
          bucketName: $bucketName
        }
      ) {
        sum { requests }
        dimensions { actionType }
      }
      r2StorageAdaptiveGroups(
        limit: 1
        filter: {
          datetime_geq: $startDate
          datetime_leq: $endDate
          bucketName: $bucketName
        }
        orderBy: [datetime_DESC]
      ) {
        max { payloadSize metadataSize }
      }
    }
  }
}`;

export function createCloudflareNeonImportCapacityPort(
  configuration: CloudflareNeonImportCapacityConfiguration,
): ImportProviderCapacityPort {
  const authorizedOwnerId = owner(configuration.authorizedOwnerId);
  const accountId = configuration.cloudflareAccountId.trim().toLowerCase();
  if (!ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new Error("cloudflareAccountId is invalid");
  }
  const apiToken = secret(
    configuration.cloudflareApiToken,
    "cloudflareApiToken",
  );
  const bucketName = identifier(configuration.r2BucketName, "r2BucketName");
  const queueId = identifier(configuration.queueId, "queueId");
  const now = configuration.now ?? (() => new Date());
  const fetcher = configuration.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    throw new Error("Hosted provider capacity transport is unavailable.");
  }

  function assertOwner(candidate: string): void {
    if (candidate.trim() !== authorizedOwnerId) {
      throw new Error("Import provider capacity access denied.");
    }
  }

  async function providerUsage(ownerId: string) {
    const measuredAt = now();
    if (Number.isNaN(measuredAt.getTime())) {
      throw new Error("Hosted provider capacity time is invalid.");
    }
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${apiToken}`,
    };
    try {
      const [r2Response, queueResponse, neonStorageValue] = await Promise.all([
        fetcher(`${CLOUDFLARE_API_ORIGIN}/client/v4/graphql`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            query: R2_CAPACITY_QUERY,
            variables: {
              accountTag: accountId,
              startDate: startOfUtcMonth(measuredAt),
              endDate: measuredAt.toISOString(),
              bucketName,
            },
          }),
        }),
        fetcher(
          `${CLOUDFLARE_API_ORIGIN}/client/v4/accounts/${accountId}/queues/${encodeURIComponent(queueId)}/metrics`,
          { method: "GET", headers, cache: "no-store" },
        ),
        configuration.readNeonStorageBytes({ ownerId }),
      ]);
      if (!r2Response.ok || !queueResponse.ok) {
        throw new Error("provider rejected capacity measurement");
      }
      const r2Envelope = (await r2Response.json()) as CloudflareGraphqlEnvelope;
      if (r2Envelope.errors !== undefined || r2Envelope.data === undefined) {
        throw new Error("provider returned invalid capacity measurement");
      }
      const queueEnvelope =
        (await queueResponse.json()) as CloudflareRestEnvelope;
      if (queueEnvelope.success !== true) {
        throw new Error("provider returned invalid capacity measurement");
      }
      const r2 = parseR2Usage(r2Envelope.data);
      return {
        measuredAt: measuredAt.toISOString(),
        r2,
        neonStorageBytes: safeInteger(neonStorageValue),
        queueBacklogMessages: parseQueueBacklog(queueEnvelope.result),
      };
    } catch {
      throw new Error("Hosted provider capacity measurement failed.");
    }
  }

  return Object.freeze({
    async measureUploadProjection(input): Promise<ImportCapacityProjection> {
      assertOwner(input.ownerId);
      if (
        !Number.isSafeInteger(input.fileCount) ||
        input.fileCount < 1 ||
        input.fileCount > MAX_FILES_PER_BATCH ||
        !Number.isSafeInteger(input.totalByteLength) ||
        input.totalByteLength < 1 ||
        input.totalByteLength > MAX_FILES_PER_BATCH * MAX_FILE_BYTES
      ) {
        throw new Error("Import provider capacity request is invalid.");
      }
      const usage = await providerUsage(authorizedOwnerId);
      const projectedNeonBytes =
        input.totalByteLength * NEON_STAGING_MULTIPLIER;
      if (!Number.isSafeInteger(projectedNeonBytes)) {
        throw new Error("Import provider capacity request is invalid.");
      }
      return {
        evidenceSource: "provider_api",
        measuredAt: usage.measuredAt,
        resources: [
          {
            resource: "r2_storage_bytes",
            currentUsage: usage.r2.storageBytes,
            projectedIncrement: input.totalByteLength,
          },
          {
            resource: "r2_class_a_operations",
            currentUsage: usage.r2.classAOperations,
            projectedIncrement: input.fileCount,
          },
          {
            resource: "r2_class_b_operations",
            currentUsage: usage.r2.classBOperations,
            projectedIncrement: input.fileCount * 2,
          },
          {
            resource: "neon_storage_bytes",
            currentUsage: usage.neonStorageBytes,
            projectedIncrement: projectedNeonBytes,
          },
          {
            resource: "queue_backlog_messages",
            currentUsage: usage.queueBacklogMessages,
            projectedIncrement: 1,
          },
        ],
      };
    },

    async measureActivationProjection(
      input,
    ): Promise<ImportCapacityProjection> {
      assertOwner(input.ownerId);
      throw new Error(
        "Hosted activation capacity measurement is not configured.",
      );
    },
  });
}
