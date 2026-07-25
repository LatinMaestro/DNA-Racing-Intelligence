"use server";

import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
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
  }>,
) {
  return completeOwnerImportUpload(input, ownerActionDependencies());
}
