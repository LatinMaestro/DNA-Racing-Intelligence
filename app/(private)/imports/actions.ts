"use server";

import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import {
  retryOwnerAggregateRefresh,
  type AggregateRetryActionDependencies,
  unavailableAggregateRetryCapabilities,
} from "@/lib/import-aggregate-retry-action-service";
import {
  HostedImportCapacityMeasurementError,
  type HostedImportCapacityFailureCode,
} from "@/lib/cloudflare-neon-import-capacity-port";
import { hostedImportConfirmationRuntime } from "@/lib/hosted-import-confirmation-runtime";
import { hostedImportUploadCompletionRuntime } from "@/lib/hosted-import-upload-completion-runtime";
import { hostedImportUploadIntakeRuntime } from "@/lib/hosted-import-upload-intake-runtime";
import {
  confirmOwnerDataUpdate,
  type ImportConfirmationActionDependencies,
} from "@/lib/import-confirmation-action-service";
import {
  rollbackOwnerImport,
  type ImportRecoveryActionDependencies,
} from "@/lib/import-recovery-action-service";
import {
  beginOwnerImportUpload,
  completeOwnerImportUpload,
  type ImportOwnerActionDependencies,
} from "@/lib/import-owner-action-service";
import { type ImportUploadCandidate } from "@/lib/import-upload-intake-service";

const UPLOAD_TARGET_LIFETIME_MILLISECONDS = 15 * 60 * 1000;
const RACE_MERGE_SOURCE_EVIDENCE_PREFIX = "race-merge-outcome-source-v1";
const RACE_MERGE_SOURCE_EVIDENCE_FILE_COUNT = 8;
const RACE_MERGE_SOURCE_EVIDENCE_MAXIMUM_FILE_BYTES = 100_000_000;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;

export type RaceMergeSourceUploadFailureCode =
  | HostedImportCapacityFailureCode
  | "capacity_evidence_invalid"
  | "capacity_limit_r2_storage_bytes"
  | "capacity_limit_r2_class_a_operations"
  | "capacity_limit_r2_class_b_operations"
  | "capacity_limit_neon_storage_bytes"
  | "capacity_limit_queue_backlog_messages"
  | "owner_authentication_unavailable"
  | "owner_access_denied"
  | "reservation_inconsistent"
  | "target_creation_failed"
  | "unexpected_server_failure";

function raceMergeSourceUploadFailureCode(
  error: unknown,
): RaceMergeSourceUploadFailureCode {
  if (error instanceof HostedImportCapacityMeasurementError) {
    return error.code;
  }
  if (!(error instanceof Error)) return "unexpected_server_failure";

  const capacityResource =
    /^Provider capacity unavailable for (r2_storage_bytes|r2_class_a_operations|r2_class_b_operations|neon_storage_bytes|queue_backlog_messages)\.$/u.exec(
      error.message,
    )?.[1];
  if (capacityResource !== undefined) {
    return `capacity_limit_${capacityResource}` as RaceMergeSourceUploadFailureCode;
  }

  if (
    error.message === "Provider capacity evidence is stale or invalid." ||
    error.message === "Provider capacity evidence source is invalid." ||
    error.message === "Provider capacity resource set is invalid." ||
    error.message === "Provider capacity evidence is incomplete."
  ) {
    return "capacity_evidence_invalid";
  }
  if (error.message === "Owner authentication is unavailable.") {
    return "owner_authentication_unavailable";
  }
  if (error.message === "Private import upload access denied.") {
    return "owner_access_denied";
  }
  if (
    error.message === "Reserved private upload identity set is inconsistent."
  ) {
    return "reservation_inconsistent";
  }
  if (error.message === "Private import upload target creation failed.") {
    return "target_creation_failed";
  }
  return "unexpected_server_failure";
}

function ownerActionDependencies(): ImportOwnerActionDependencies {
  const configuredOwnerId = process.env.AUTHORIZED_CLERK_USER_ID;
  return {
    resolveAuthenticatedOwnerId: () =>
      authenticatedClerkOwnerId({
        environment: {
          publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
          secretKey: process.env.CLERK_SECRET_KEY,
        },
      }),
    configuredOwnerId: configuredOwnerId ?? null,
    now: () => new Date(),
    uploadTargetLifetimeMilliseconds: UPLOAD_TARGET_LIFETIME_MILLISECONDS,
    uploadIntakeCapabilities: hostedImportUploadIntakeRuntime({
      environment: {
        authorizedOwnerId: configuredOwnerId,
        database: {
          databaseUrl: process.env.DATABASE_URL,
          databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
          runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
        },
        r2: {
          accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
          bucketName: process.env.DNA_R2_BUCKET_NAME,
          accessKeyId: process.env.DNA_R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.DNA_R2_SECRET_ACCESS_KEY,
        },
        cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN,
        cloudflareAnalyticsApiToken: process.env.CLOUDFLARE_ANALYTICS_API_TOKEN,
        queueId: process.env.DNA_IMPORT_QUEUE_ID,
        capacity: {
          approvedLimits: {
            r2_storage_bytes: process.env.DNA_IMPORT_LIMIT_R2_STORAGE_BYTES,
            r2_class_a_operations:
              process.env.DNA_IMPORT_LIMIT_R2_CLASS_A_OPERATIONS,
            r2_class_b_operations:
              process.env.DNA_IMPORT_LIMIT_R2_CLASS_B_OPERATIONS,
            neon_storage_bytes: process.env.DNA_IMPORT_LIMIT_NEON_STORAGE_BYTES,
            queue_backlog_messages:
              process.env.DNA_IMPORT_LIMIT_QUEUE_BACKLOG_MESSAGES,
          },
          minimumHeadroomBasisPoints:
            process.env.DNA_IMPORT_MINIMUM_HEADROOM_BASIS_POINTS,
          maximumMeasurementAgeMilliseconds:
            process.env.DNA_IMPORT_MAXIMUM_MEASUREMENT_AGE_MILLISECONDS,
        },
      },
    }),
    uploadCompletionCapabilities: hostedImportUploadCompletionRuntime({
      environment: {
        authorizedOwnerId: configuredOwnerId,
        database: {
          databaseUrl: process.env.DATABASE_URL,
          databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
          runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
        },
        r2: {
          accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
          bucketName: process.env.DNA_R2_BUCKET_NAME,
          accessKeyId: process.env.DNA_R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.DNA_R2_SECRET_ACCESS_KEY,
        },
        cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN,
        queueId: process.env.DNA_IMPORT_QUEUE_ID,
        queueName: process.env.DNA_IMPORT_QUEUE_NAME,
        deadLetterQueueName: process.env.DNA_IMPORT_DEAD_LETTER_QUEUE_NAME,
      },
    }),
  };
}

function confirmationActionDependencies(): ImportConfirmationActionDependencies {
  const configuredOwnerId = process.env.AUTHORIZED_CLERK_USER_ID;
  return {
    resolveAuthenticatedOwnerId: () =>
      authenticatedClerkOwnerId({
        environment: {
          publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
          secretKey: process.env.CLERK_SECRET_KEY,
        },
      }),
    configuredOwnerId: configuredOwnerId ?? null,
    now: () => new Date(),
    activationCapabilities: hostedImportConfirmationRuntime({
      environment: {
        authorizedOwnerId: configuredOwnerId,
        database: {
          databaseUrl: process.env.DATABASE_URL,
          databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
          runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
        },
        cloudflare: {
          accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
          apiToken: process.env.CLOUDFLARE_API_TOKEN,
          analyticsApiToken: process.env.CLOUDFLARE_ANALYTICS_API_TOKEN,
          r2BucketName: process.env.DNA_R2_BUCKET_NAME,
          queueId: process.env.DNA_IMPORT_QUEUE_ID,
          queueName: process.env.DNA_IMPORT_QUEUE_NAME,
          deadLetterQueueName: process.env.DNA_IMPORT_DEAD_LETTER_QUEUE_NAME,
        },
        capacity: {
          approvedLimits: {
            r2_storage_bytes: process.env.DNA_IMPORT_LIMIT_R2_STORAGE_BYTES,
            r2_class_a_operations:
              process.env.DNA_IMPORT_LIMIT_R2_CLASS_A_OPERATIONS,
            r2_class_b_operations:
              process.env.DNA_IMPORT_LIMIT_R2_CLASS_B_OPERATIONS,
            neon_storage_bytes: process.env.DNA_IMPORT_LIMIT_NEON_STORAGE_BYTES,
            queue_backlog_messages:
              process.env.DNA_IMPORT_LIMIT_QUEUE_BACKLOG_MESSAGES,
          },
          minimumHeadroomBasisPoints:
            process.env.DNA_IMPORT_MINIMUM_HEADROOM_BASIS_POINTS,
          maximumMeasurementAgeMilliseconds:
            process.env.DNA_IMPORT_MAXIMUM_MEASUREMENT_AGE_MILLISECONDS,
        },
      },
    }),
  };
}

function aggregateRetryActionDependencies(): AggregateRetryActionDependencies {
  return {
    resolveAuthenticatedOwnerId: () =>
      authenticatedClerkOwnerId({
        environment: {
          publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
          secretKey: process.env.CLERK_SECRET_KEY,
        },
      }),
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    now: () => new Date(),
    capabilities: unavailableAggregateRetryCapabilities,
  };
}

function recoveryActionDependencies(): ImportRecoveryActionDependencies {
  return {
    resolveAuthenticatedOwnerId: () =>
      authenticatedClerkOwnerId({
        environment: {
          publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
          secretKey: process.env.CLERK_SECRET_KEY,
        },
      }),
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    now: () => new Date(),
    rollbackRepository: { status: "not_configured" },
  };
}

export async function beginImportUploadAction(
  input: Readonly<{
    idempotencyKey: string;
    files: readonly ImportUploadCandidate[];
  }>,
) {
  return beginOwnerImportUpload(input, ownerActionDependencies());
}

export async function beginRaceMergeOutcomeSourceUploadAction(
  input: Readonly<{
    ordinal: number;
    originalFileName: string;
    byteLength: number;
    sha256: string;
  }>,
) {
  if (
    !Number.isSafeInteger(input.ordinal) ||
    input.ordinal < 1 ||
    input.ordinal > RACE_MERGE_SOURCE_EVIDENCE_FILE_COUNT ||
    !Number.isSafeInteger(input.byteLength) ||
    input.byteLength < 1 ||
    input.byteLength > RACE_MERGE_SOURCE_EVIDENCE_MAXIMUM_FILE_BYTES ||
    !SHA_256_PATTERN.test(input.sha256)
  ) {
    throw new Error("Race Merge source evidence metadata is invalid.");
  }
  const ordinal = String(input.ordinal).padStart(2, "0");
  const identity = `${RACE_MERGE_SOURCE_EVIDENCE_PREFIX}-${ordinal}-${input.sha256.slice(0, 16)}`;
  try {
    return await beginOwnerImportUpload(
      {
        idempotencyKey: `${RACE_MERGE_SOURCE_EVIDENCE_PREFIX}-${ordinal}-${input.sha256.slice(0, 32)}`,
        files: [
          {
            clientFileId: identity,
            sourceFamily: "race_merge",
            originalFileName: input.originalFileName,
            contentType: "text/csv",
            byteLength: input.byteLength,
            sha256: input.sha256,
          },
        ],
      },
      ownerActionDependencies(),
    );
  } catch (error) {
    return {
      status: "failed" as const,
      errorCode: raceMergeSourceUploadFailureCode(error),
    };
  }
}

export async function completeImportUploadAction(
  input: Readonly<{
    uploadBatchId: string;
    idempotencyKey: string;
    uploadRequestFingerprint: string;
  }>,
) {
  return completeOwnerImportUpload(input, ownerActionDependencies());
}

export async function confirmImportUpdateAction(
  input: Readonly<{
    previewId: string;
    previewFingerprintSha256: string;
    idempotencyKey: string;
    explicitlyConfirmed: boolean;
  }>,
) {
  return confirmOwnerDataUpdate(input, confirmationActionDependencies());
}

export async function rollbackImportAction(
  input: Readonly<{
    batchId: string;
    rollbackReason: string;
    idempotencyKey: string;
    explicitlyConfirmed: boolean;
  }>,
) {
  return rollbackOwnerImport(input, recoveryActionDependencies());
}

export async function retryAggregateRefreshAction(
  input: Readonly<{
    failedRefreshId: string;
    retryReason: string;
    idempotencyKey: string;
    explicitlyConfirmed: boolean;
  }>,
) {
  return retryOwnerAggregateRefresh(input, aggregateRetryActionDependencies());
}
