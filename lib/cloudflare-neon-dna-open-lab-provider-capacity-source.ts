import type {
  DnaOpenLabProviderCapacityMeasurement,
  DnaOpenLabProviderCapacityMeasurementSource,
} from "./dna-open-lab-provider-capacity-preflight";
import { DnaOpenLabProviderCapacityMeasurementError } from "./dna-open-lab-provider-capacity-preflight";

const CLOUDFLARE_GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";
const NEON_API_ORIGIN = "https://console.neon.tech/api/v2";
const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/u;
const SAFE_PROVIDER_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;

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

const R2_CAPACITY_QUERY = `query DnaOpenLabDailyRefreshCapacity(
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

export type CloudflareNeonDnaOpenLabProviderCapacityConfiguration = Readonly<{
  authorizedOwnerId: string;
  cloudflareAccountId: string;
  cloudflareApiToken: string;
  r2BucketName: string;
  r2StorageClass: string;
  neonApiKey: string;
  neonProjectId: string;
  now?: () => Date;
  fetch?: typeof globalThis.fetch;
}>;

export type CloudflareNeonDnaOpenLabProviderCapacityEnvironment = Readonly<{
  authorizedOwnerId?: string;
  cloudflareAccountId?: string;
  cloudflareApiToken?: string;
  r2BucketName?: string;
  r2StorageClass?: string;
  neonApiKey?: string;
  neonProjectId?: string;
}>;

type ProviderRecord = Record<string, unknown>;

function boundedText(value: string, field: string, maximum: number): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)
  ) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function providerIdentifier(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SAFE_PROVIDER_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function providerRecord(value: unknown): ProviderRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Provider capacity response is invalid.");
  }
  return value as ProviderRecord;
}

function providerArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error("Provider capacity response is invalid.");
  }
  return value;
}

function safeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("Provider capacity response is invalid.");
  }
  return value as number;
}

function addSafeInteger(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) {
    throw new Error("Provider capacity response is invalid.");
  }
  return value;
}

function canonicalInstant(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Provider capacity response is invalid.");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Provider capacity response is invalid.");
  }
  const canonical = parsed.toISOString();
  if (canonical !== value) {
    throw new Error("Provider capacity response is invalid.");
  }
  return canonical;
}

function startOfUtcMonth(date: Date): string {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
  ).toISOString();
}

function startOfNextUtcMonth(date: Date): string {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
  ).toISOString();
}

function measurementFailure(
  failureId: ConstructorParameters<
    typeof DnaOpenLabProviderCapacityMeasurementError
  >[0],
): DnaOpenLabProviderCapacityMeasurementError {
  return new DnaOpenLabProviderCapacityMeasurementError(failureId);
}

function parseR2Usage(value: unknown): Readonly<{
  storageBytes: number;
  classAOperations: number;
  classBOperations: number;
}> {
  const data = providerRecord(value);
  const viewer = providerRecord(data.viewer);
  const accounts = providerArray(viewer.accounts);
  if (accounts.length !== 1) {
    throw new Error("Provider capacity response is invalid.");
  }
  const account = providerRecord(accounts[0]);
  const storageGroups = providerArray(account.r2StorageAdaptiveGroups);
  if (storageGroups.length > 1) {
    throw new Error("Provider capacity response is invalid.");
  }
  const storage =
    storageGroups.length === 0
      ? { payloadSize: 0, metadataSize: 0 }
      : providerRecord(providerRecord(storageGroups[0]).max);
  const storageBytes = addSafeInteger(
    safeInteger(storage.payloadSize),
    safeInteger(storage.metadataSize),
  );

  let classAOperations = 0;
  let classBOperations = 0;
  const observedActions = new Set<string>();
  for (const groupValue of providerArray(account.r2OperationsAdaptiveGroups)) {
    const group = providerRecord(groupValue);
    const actionType = providerRecord(group.dimensions).actionType;
    if (typeof actionType !== "string" || observedActions.has(actionType)) {
      throw new Error("Provider capacity response is invalid.");
    }
    observedActions.add(actionType);
    const requests = safeInteger(providerRecord(group.sum).requests);
    if (CLASS_A_ACTIONS.has(actionType)) {
      classAOperations = addSafeInteger(classAOperations, requests);
    } else if (CLASS_B_ACTIONS.has(actionType)) {
      classBOperations = addSafeInteger(classBOperations, requests);
    } else if (!FREE_ACTIONS.has(actionType)) {
      throw new Error("Provider capacity response is invalid.");
    }
  }

  return Object.freeze({
    storageBytes,
    classAOperations,
    classBOperations,
  });
}

function parseNeonUsage(
  value: unknown,
  expectedProjectId: string,
): Readonly<{
  billingWindowStartAt: string;
  billingWindowEndAt: string;
  storageBytes: number;
  computeMilliCuHours: number;
}> {
  const envelope = providerRecord(value);
  const project = providerRecord(envelope.project);
  if (project.id !== expectedProjectId) {
    throw new Error("Provider capacity response is invalid.");
  }
  const billingWindowStartAt = canonicalInstant(
    project.consumption_period_start,
  );
  const billingWindowEndAt = canonicalInstant(project.consumption_period_end);
  if (Date.parse(billingWindowStartAt) >= Date.parse(billingWindowEndAt)) {
    throw new Error("Provider capacity response is invalid.");
  }
  const storageBytes = safeInteger(project.synthetic_storage_size);
  const computeSeconds = safeInteger(project.compute_time_seconds);
  const computeMilliCuHours = Math.ceil((computeSeconds * 1_000) / 3_600);
  if (!Number.isSafeInteger(computeMilliCuHours)) {
    throw new Error("Provider capacity response is invalid.");
  }
  return Object.freeze({
    billingWindowStartAt,
    billingWindowEndAt,
    storageBytes,
    computeMilliCuHours,
  });
}

/**
 * Read-only, server-only provider measurement source for the recurring refresh.
 * Cloudflare supplies the bucket storage/operation counters and Neon supplies
 * project-wide storage, CU-weighted compute and its exact consumption window.
 * Only normalized totals and timestamps cross this boundary.
 */
export function createCloudflareNeonDnaOpenLabProviderCapacitySource(
  configuration: CloudflareNeonDnaOpenLabProviderCapacityConfiguration,
): DnaOpenLabProviderCapacityMeasurementSource {
  const authorizedOwnerId = boundedText(
    configuration.authorizedOwnerId,
    "authorizedOwnerId",
    512,
  );
  const cloudflareAccountId = configuration.cloudflareAccountId
    .trim()
    .toLowerCase();
  if (!ACCOUNT_ID_PATTERN.test(cloudflareAccountId)) {
    throw new Error("cloudflareAccountId is invalid");
  }
  const cloudflareApiToken = boundedText(
    configuration.cloudflareApiToken,
    "cloudflareApiToken",
    4096,
  );
  const r2BucketName = providerIdentifier(
    configuration.r2BucketName,
    "r2BucketName",
  );
  const r2StorageClass = boundedText(
    configuration.r2StorageClass,
    "r2StorageClass",
    64,
  );
  const neonApiKey = boundedText(configuration.neonApiKey, "neonApiKey", 4096);
  const neonProjectId = providerIdentifier(
    configuration.neonProjectId,
    "neonProjectId",
  );
  const now = configuration.now ?? (() => new Date());
  const fetcher = configuration.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    throw new Error("Provider capacity transport is unavailable.");
  }

  return Object.freeze({
    status: "ready" as const,
    async measure({ ownerId }): Promise<DnaOpenLabProviderCapacityMeasurement> {
      if (ownerId.trim() !== authorizedOwnerId) {
        throw new Error("Provider capacity owner scope denied.");
      }
      const measured = now();
      if (Number.isNaN(measured.getTime())) {
        throw measurementFailure("measurement_clock_invalid");
      }
      const measuredAt = measured.toISOString();
      const r2BillingWindowStartAt = startOfUtcMonth(measured);
      const r2BillingWindowEndAt = startOfNextUtcMonth(measured);

      const cloudflareMeasurement = async () => {
        let cloudflareResponse: Response;
        try {
          cloudflareResponse = await fetcher(CLOUDFLARE_GRAPHQL_URL, {
            method: "POST",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${cloudflareApiToken}`,
              "Content-Type": "application/json",
            },
            cache: "no-store",
            body: JSON.stringify({
              query: R2_CAPACITY_QUERY,
              variables: {
                accountTag: cloudflareAccountId,
                startDate: r2BillingWindowStartAt,
                endDate: measuredAt,
                bucketName: r2BucketName,
              },
            }),
          });
        } catch {
          throw measurementFailure("cloudflare_transport_failed");
        }
        if (!cloudflareResponse.ok) {
          throw measurementFailure("cloudflare_http_rejected");
        }
        let cloudflareEnvelope: ProviderRecord;
        try {
          cloudflareEnvelope = providerRecord(await cloudflareResponse.json());
        } catch {
          throw measurementFailure("cloudflare_graphql_rejected");
        }
        if (
          cloudflareEnvelope.errors !== undefined ||
          cloudflareEnvelope.data === undefined
        ) {
          throw measurementFailure("cloudflare_graphql_rejected");
        }
        try {
          return parseR2Usage(cloudflareEnvelope.data);
        } catch {
          throw measurementFailure("cloudflare_usage_invalid");
        }
      };

      const neonMeasurement = async () => {
        let neonResponse: Response;
        try {
          neonResponse = await fetcher(
            `${NEON_API_ORIGIN}/projects/${encodeURIComponent(neonProjectId)}`,
            {
              method: "GET",
              headers: {
                Accept: "application/json",
                Authorization: `Bearer ${neonApiKey}`,
              },
              cache: "no-store",
            },
          );
        } catch {
          throw measurementFailure("neon_transport_failed");
        }
        if (!neonResponse.ok) {
          throw measurementFailure("neon_http_rejected");
        }
        try {
          return parseNeonUsage(await neonResponse.json(), neonProjectId);
        } catch {
          throw measurementFailure("neon_usage_invalid");
        }
      };

      try {
        const [cloudflareResult, neonResult] = await Promise.allSettled([
          cloudflareMeasurement(),
          neonMeasurement(),
        ]);
        if (cloudflareResult.status === "rejected") {
          throw cloudflareResult.reason;
        }
        if (neonResult.status === "rejected") {
          throw neonResult.reason;
        }
        const r2 = cloudflareResult.value;
        const neon = neonResult.value;

        return Object.freeze({
          evidenceSource: "provider_api" as const,
          r2StorageClass,
          measuredAt,
          billingWindowStartAt: r2BillingWindowStartAt,
          billingWindowEndAt: r2BillingWindowEndAt,
          currentR2Usage: r2,
          neonMeasuredAt: measuredAt,
          neonBillingWindowStartAt: neon.billingWindowStartAt,
          neonBillingWindowEndAt: neon.billingWindowEndAt,
          currentNeonUsage: Object.freeze({
            storageBytes: neon.storageBytes,
            computeMilliCuHours: neon.computeMilliCuHours,
          }),
        });
      } catch (error) {
        if (error instanceof DnaOpenLabProviderCapacityMeasurementError) {
          throw error;
        }
        throw measurementFailure("unexpected_measurement_failure");
      }
    },
  });
}

function configured(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

/**
 * Fail-closed server composition for Preview and the eventual daily operator.
 * Missing credentials make capacity unavailable without opening a provider
 * request. Present but malformed configuration is rejected by the strict
 * constructor rather than silently changing provider identity.
 */
export function cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment(
  environment: CloudflareNeonDnaOpenLabProviderCapacityEnvironment,
  options: Readonly<{
    now?: () => Date;
    fetch?: typeof globalThis.fetch;
  }> = {},
): DnaOpenLabProviderCapacityMeasurementSource {
  const authorizedOwnerId = configured(environment.authorizedOwnerId);
  const cloudflareAccountId = configured(environment.cloudflareAccountId);
  const cloudflareApiToken = configured(environment.cloudflareApiToken);
  const r2BucketName = configured(environment.r2BucketName);
  const r2StorageClass = configured(environment.r2StorageClass);
  const neonApiKey = configured(environment.neonApiKey);
  const neonProjectId = configured(environment.neonProjectId);
  if (
    authorizedOwnerId === null ||
    cloudflareAccountId === null ||
    cloudflareApiToken === null ||
    r2BucketName === null ||
    r2StorageClass === null ||
    neonApiKey === null ||
    neonProjectId === null
  ) {
    return Object.freeze({ status: "not_configured" });
  }
  return createCloudflareNeonDnaOpenLabProviderCapacitySource({
    authorizedOwnerId,
    cloudflareAccountId,
    cloudflareApiToken,
    r2BucketName,
    r2StorageClass,
    neonApiKey,
    neonProjectId,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}
