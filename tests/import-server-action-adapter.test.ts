import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  ownerId: vi.fn(async (): Promise<string | null> => null),
}));

vi.mock("../lib/clerk-owner-session", () => ({
  authenticatedClerkOwnerId: session.ownerId,
}));

import {
  beginImportUploadAction,
  confirmImportUpdateAction,
  completeImportUploadAction,
  retryAggregateRefreshAction,
  rollbackImportAction,
} from "../app/(private)/imports/actions";
import type { ImportUploadCandidate } from "../lib/import-upload-intake-service";

const UPLOAD_REQUEST_SHA = "b".repeat(64);

const candidate: ImportUploadCandidate = {
  clientFileId: "client-file-1",
  sourceFamily: "race_merge",
  originalFileName: "synthetic-race-export.csv",
  contentType: "text/csv",
  byteLength: 2048,
  sha256: "a".repeat(64),
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("import server action adapter", () => {
  it("resolves Clerk identity inside the action and fails closed when signed out", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce(null);

    await expect(
      beginImportUploadAction({
        idempotencyKey: "request-1",
        files: [candidate],
      }),
    ).resolves.toEqual({ status: "identity_not_connected" });

    expect(session.ownerId).toHaveBeenCalledWith({
      environment: {
        publishableKey: undefined,
        secretKey: undefined,
      },
    });
  });

  it("rejects a signed-in non-owner before any unavailable provider is used", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce("other-owner");

    await expect(
      beginImportUploadAction({
        idempotencyKey: "request-1",
        files: [candidate],
      }),
    ).rejects.toThrow("access denied");
  });

  it("preserves the explicit not-configured intake state for the verified owner", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce("owner-1");

    await expect(
      beginImportUploadAction({
        idempotencyKey: "request-1",
        files: [candidate],
      }),
    ).resolves.toEqual({ status: "not_configured" });
  });

  it("keeps partial hosted intake configuration fail-closed", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    vi.stubEnv("DATABASE_URL", "postgresql://preview.invalid/dna");
    vi.stubEnv("DNA_DATABASE_OWNER_ID", "11111111-1111-4111-8111-111111111111");
    vi.stubEnv("DNA_DATABASE_RUNTIME_ROLE", "dna_app_runtime");
    session.ownerId.mockResolvedValueOnce("owner-1");

    await expect(
      beginImportUploadAction({
        idempotencyKey: "request-1",
        files: [candidate],
      }),
    ).resolves.toEqual({ status: "not_configured" });
  });

  it("re-verifies the owner and preserves not-configured upload completion", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce("owner-1");

    await expect(
      completeImportUploadAction({
        uploadBatchId: "upload-batch-1",
        idempotencyKey: "complete-request-1",
        uploadRequestFingerprint: UPLOAD_REQUEST_SHA,
      }),
    ).resolves.toEqual({ status: "not_configured" });

    expect(session.ownerId).toHaveBeenCalledOnce();
  });

  it("re-verifies the owner and keeps import confirmation fail-closed", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce("owner-1");

    await expect(
      confirmImportUpdateAction({
        previewId: "preview-1",
        previewFingerprintSha256: "b".repeat(64),
        idempotencyKey: "confirm-request-1",
        explicitlyConfirmed: true,
      }),
    ).resolves.toEqual({
      status: "not_configured",
      missingCapabilities: [
        "repository",
        "raw_upload_store",
        "capacity_gate",
        "background_queue",
      ],
    });

    expect(session.ownerId).toHaveBeenCalledOnce();
  });

  it("re-verifies the owner and keeps rollback persistence fail-closed", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce("owner-1");

    await expect(
      rollbackImportAction({
        batchId: "batch-active",
        rollbackReason: "Restore the prior accepted source snapshot.",
        idempotencyKey: "rollback-request-1",
        explicitlyConfirmed: true,
      }),
    ).resolves.toEqual({ status: "persistence_not_configured" });

    expect(session.ownerId).toHaveBeenCalledOnce();
  });

  it("re-verifies the owner and keeps aggregate retry fail-closed", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce("owner-1");

    await expect(
      retryAggregateRefreshAction({
        failedRefreshId: "refresh-failed-1",
        retryReason: "Retry the failed aggregate publication.",
        idempotencyKey: "retry-request-1",
        explicitlyConfirmed: true,
      }),
    ).resolves.toEqual({
      status: "not_configured",
      missingCapabilities: ["repository", "background_queue"],
    });

    expect(session.ownerId).toHaveBeenCalledOnce();
  });
});
