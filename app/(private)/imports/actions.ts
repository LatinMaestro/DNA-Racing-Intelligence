"use server";

import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import {
  retryOwnerAggregateRefresh,
  type AggregateRetryActionDependencies,
  unavailableAggregateRetryCapabilities,
} from "@/lib/import-aggregate-retry-action-service";
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
