"use server";

import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import {
  retryOwnerAggregateRefresh,
  type AggregateRetryActionDependencies,
  unavailableAggregateRetryCapabilities,
} from "@/lib/import-aggregate-retry-action-service";
import { unavailableImportActivationCapabilities } from "@/lib/import-activation-service";
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
import { unavailableImportUploadCompletionCapabilities } from "@/lib/import-upload-completion-service";
import {
  type ImportUploadCandidate,
  unavailableImportUploadIntakeCapabilities,
} from "@/lib/import-upload-intake-service";

const UPLOAD_TARGET_LIFETIME_MILLISECONDS = 15 * 60 * 1000;

function ownerActionDependencies(): ImportOwnerActionDependencies {
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
    uploadTargetLifetimeMilliseconds: UPLOAD_TARGET_LIFETIME_MILLISECONDS,
    uploadIntakeCapabilities: unavailableImportUploadIntakeCapabilities,
    uploadCompletionCapabilities: unavailableImportUploadCompletionCapabilities,
  };
}

function confirmationActionDependencies(): ImportConfirmationActionDependencies {
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
    activationCapabilities: unavailableImportActivationCapabilities,
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
