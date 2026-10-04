import type {
  ImportCapacityProjection,
  ImportProviderCapacityPort,
} from "./import-provider-capacity-adapter";
import { maxImportUploadFilesPerBatch } from "./import-upload-intake-service";

const CLOUDFLARE_API_ORIGIN = "https://api.cloudflare.com";
const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/;
const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const R2_ACTION_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,127}$/;
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
  cloudflareAnalyticsApiToken: string;
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

export const hostedImportCapacityFailureCodes = [
  "capacity_r2_analytics_transport_failed",
  "capacity_r2_analytics_http_rejected",
  "capacity_r2_analytics_response_invalid",
  "capacity_r2_operations_transport_failed",
  "capacity_r2_operations_http_rejected",
  "capacity_r2_operations_response_invalid",
  "capacity_r2_storage_transport_failed",
  "capacity_r2_storage_http_rejected",
  "capacity_r2_storage_response_invalid",
  "capacity_queue_metrics_transport_failed",
  "capacity_queue_metrics_http_rejected",
  "capacity_queue_metrics_response_invalid",
  "capacity_neon_storage_failed",
] as const;

export type HostedImportCapacityFailureCode =
  (typeof hostedImportCapacityFailureCodes)[number];

export class HostedImportCapacityMeasurementError extends Error {
  readonly code: HostedImportCapacityFailureCode;

  constructor(code: HostedImportCapacityFailureCode) {
    super(code);
    this.name = "HostedImportCapacityMeasurementError";
    this.code = code;
  }
}

function capacityFailure(code: HostedImportCapacityFailureCode): never {
  throw new HostedImportCapacityMeasurementError(code);
}

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

function addSafeInteger(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) {
    throw new Error("Hosted provider capacity response is invalid.");
  }
  return value;
}

function cloudflareAccount(value: unknown): Record<string, unknown> {
  const data = record(value);
  const viewer = record(data.viewer);
  const accounts = array(viewer.accounts);
  if (accounts.length !== 1) {
    throw new Error("Hosted provider capacity response is invalid.");
  }
  return record(accounts[0]);
}

function parseR2Operations(value: unknown): Readonly<{
  classAOperations: number;
  classBOperations: number;
}> {
  const account = cloudflareAccount(value);
  const groups = array(account.r2OperationsAdaptiveGroups);
  let classAOperations = 0;
  let classBOperations = 0;
  const observedActions = new Set<string>();

  for (const groupValue of groups) {
    const group = record(groupValue);
    const actionType = record(group.dimensions).actionType;
    if (
      typeof actionType !== "string" ||
      !R2_ACTION_TYPE_PATTERN.test(actionType) ||
      observedActions.has(actionType)
    ) {
      throw new Error("Hosted provider capacity response is invalid.");
    }
    observedActions.add(actionType);

    const requests = safeInteger(record(group.sum).requests);
    if (CLASS_A_ACTIONS.has(actionType)) {
      classAOperations = addSafeInteger(classAOperations, requests);
    } else if (CLASS_B_ACTIONS.has(actionType)) {
      classBOperations = addSafeInteger(classBOperations, requests);
    } else if (!FREE_ACTIONS.has(actionType)) {
      // Cloudflare may expose an analytics action before its pricing class is
      // represented here. Charge an unknown non-free action against both
      // guards so the zero-cost projection cannot be understated.
      classAOperations = addSafeInteger(classAOperations, requests);
      classBOperations = addSafeInteger(classBOperations, requests);
    }
  }

  return { classAOperations, classBOperations };
}

function parseR2Storage(value: unknown): number {
  const account = cloudflareAccount(value);
  const storageGroups = array(account.r2StorageAdaptiveGroups);
  if (storageGroups.length > 1) {
    throw new Error("Hosted provider capacity response is invalid.");
  }
  const storage =
    storageGroups.length === 0
      ? { payloadSize: 0, metadataSize: 0 }
      : record(record(storageGroups[0]).max);
  return addSafeInteger(
    safeInteger(storage.payloadSize),
    safeInteger(storage.metadataSize),
  );
}

function parseQueueBacklog(value: unknown): number {
  const result = record(value);
  return safeInteger(result.backlog_count);
}

const R2_OPERATIONS_QUERY = `query DnaImportCapacityOperations(
  $accountTag: string!
  $startDate: Time
  $endDate: Time
  $bucketName: string
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
    }
  }
}`;

const R2_STORAGE_QUERY = `query DnaImportCapacityStorage(
  $accountTag: string!
  $startDate: Time
  $endDate: Time
  $bucketName: string
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
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
        dimensions { datetime }
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
  const analyticsApiToken = secret(
    configuration.cloudflareAnalyticsApiToken,
    "cloudflareAnalyticsApiToken",
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
    const analyticsHeaders = {
      Accept: "application/json",
      Authorization: `Bearer ${analyticsApiToken}`,
    };
    const operationalHeaders = {
      Accept: "application/json",
      Authorization: `Bearer ${apiToken}`,
    };

    const readR2Dataset = async (
      query: string,
      failureCodes: Readonly<{
        transport: HostedImportCapacityFailureCode;
        http: HostedImportCapacityFailureCode;
        response: HostedImportCapacityFailureCode;
      }>,
    ): Promise<unknown> => {
      let response: Response;
      try {
        response = await fetcher(`${CLOUDFLARE_API_ORIGIN}/client/v4/graphql`, {
          method: "POST",
          headers: {
            ...analyticsHeaders,
            "Content-Type": "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({
            query,
            variables: {
              accountTag: accountId,
              startDate: startOfUtcMonth(measuredAt),
              endDate: measuredAt.toISOString(),
              bucketName,
            },
          }),
        });
      } catch {
        return capacityFailure(failureCodes.transport);
      }
      if (!response.ok) {
        return capacityFailure(failureCodes.http);
      }
      let envelope: CloudflareGraphqlEnvelope;
      try {
        envelope = (await response.json()) as CloudflareGraphqlEnvelope;
      } catch {
        return capacityFailure(failureCodes.response);
      }
      if (
        (envelope.errors !== undefined &&
          envelope.errors !== null &&
          (!Array.isArray(envelope.errors) || envelope.errors.length > 0)) ||
        envelope.data === undefined
      ) {
        return capacityFailure(failureCodes.response);
      }
      return envelope.data;
    };

    const readR2Usage = async () => {
      const [operationsData, storageData] = await Promise.all([
        readR2Dataset(R2_OPERATIONS_QUERY, {
          transport: "capacity_r2_operations_transport_failed",
          http: "capacity_r2_operations_http_rejected",
          response: "capacity_r2_operations_response_invalid",
        }),
        readR2Dataset(R2_STORAGE_QUERY, {
          transport: "capacity_r2_storage_transport_failed",
          http: "capacity_r2_storage_http_rejected",
          response: "capacity_r2_storage_response_invalid",
        }),
      ]);

      let operations: ReturnType<typeof parseR2Operations>;
      try {
        operations = parseR2Operations(operationsData);
      } catch {
        return capacityFailure("capacity_r2_operations_response_invalid");
      }
      let storageBytes: number;
      try {
        storageBytes = parseR2Storage(storageData);
      } catch {
        return capacityFailure("capacity_r2_storage_response_invalid");
      }
      return { storageBytes, ...operations };
    };

    const readQueueBacklog = async () => {
      let response: Response;
      try {
        response = await fetcher(
          `${CLOUDFLARE_API_ORIGIN}/client/v4/accounts/${accountId}/queues/${encodeURIComponent(queueId)}/metrics`,
          {
            method: "GET",
            headers: operationalHeaders,
            cache: "no-store",
          },
        );
      } catch {
        return capacityFailure("capacity_queue_metrics_transport_failed");
      }
      if (!response.ok) {
        return capacityFailure("capacity_queue_metrics_http_rejected");
      }
      let envelope: CloudflareRestEnvelope;
      try {
        envelope = (await response.json()) as CloudflareRestEnvelope;
      } catch {
        return capacityFailure("capacity_queue_metrics_response_invalid");
      }
      if (envelope.success !== true) {
        return capacityFailure("capacity_queue_metrics_response_invalid");
      }
      try {
        return parseQueueBacklog(envelope.result);
      } catch {
        return capacityFailure("capacity_queue_metrics_response_invalid");
      }
    };

    const readNeonStorage = async () => {
      try {
        return safeInteger(
          await configuration.readNeonStorageBytes({ ownerId }),
        );
      } catch {
        return capacityFailure("capacity_neon_storage_failed");
      }
    };

    const [r2, queueBacklogMessages, neonStorageBytes] = await Promise.all([
      readR2Usage(),
      readQueueBacklog(),
      readNeonStorage(),
    ]);
    return {
      measuredAt: measuredAt.toISOString(),
      r2,
      neonStorageBytes,
      queueBacklogMessages,
    };
  }

  return Object.freeze({
    async measureUploadProjection(input): Promise<ImportCapacityProjection> {
      assertOwner(input.ownerId);
      if (
        !Number.isSafeInteger(input.fileCount) ||
        input.fileCount < 1 ||
        input.fileCount > maxImportUploadFilesPerBatch ||
        !Number.isSafeInteger(input.totalByteLength) ||
        input.totalByteLength < 1 ||
        input.totalByteLength > maxImportUploadFilesPerBatch * MAX_FILE_BYTES
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
