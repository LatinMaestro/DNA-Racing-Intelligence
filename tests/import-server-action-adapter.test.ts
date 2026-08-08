import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  ownerId: vi.fn(async (): Promise<string | null> => null),
}));

vi.mock("../lib/clerk-owner-session", () => ({
  authenticatedClerkOwnerId: session.ownerId,
}));

import {
  beginImportUploadAction,
  completeImportUploadAction,
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
});
