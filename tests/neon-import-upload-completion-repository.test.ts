import { describe, expect, it, vi } from "vitest";

import {
  createNeonImportUploadCompletionRepository,
  neonImportUploadCompletionRepositoryFromEnvironment,
} from "../lib/neon-import-upload-completion-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "../lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const authenticatedOwnerId = "owner-1";
const runtimeRole = "dna_app_runtime";
const uploadBatchId = "22222222-2222-4222-8222-222222222222";
const completionId = "33333333-3333-4333-8333-333333333333";
const uploadFileId = "44444444-4444-4444-8444-444444444444";
const previewDispatchId = "55555555-5555-4555-8555-555555555555";
const requestFingerprint = "a".repeat(64);

function ownerEvidence(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: authenticatedOwnerId,
    batch_row_security_enabled: true,
    batch_force_row_security_enabled: true,
    file_row_security_enabled: true,
    file_force_row_security_enabled: true,
    completion_row_security_enabled: true,
    completion_force_row_security_enabled: true,
    dispatch_row_security_enabled: true,
    dispatch_force_row_security_enabled: true,
    verified_row_security_enabled: true,
    verified_force_row_security_enabled: true,
    session_user_name: runtimeRole,
    current_user_name: runtimeRole,
    runtime_is_superuser: false,
    runtime_bypasses_rls: false,
    runtime_can_create_roles: false,
    runtime_can_create_databases: false,
    runtime_is_neon_superuser_member: false,
    ...overrides,
  };
}

function claimedRow(overrides: Record<string, unknown> = {}) {
  return {
    status: "claimed",
    completion_id: completionId,
    upload_request_fingerprint_sha256: requestFingerprint,
    upload_target_expires_at: "2026-08-14T00:15:00.000Z",
    preview_dispatch_id: null,
    file_count: 1,
    reserved_files: [
      {
        uploadFileId,
        objectId: uploadFileId,
        sourceFamily: "race_merge",
        expectedByteLength: 1024,
        expectedSha256: "b".repeat(64),
        expectedContentType: "text/csv",
      },
    ],
    ...overrides,
  };
}

function queryHarness(rows: readonly (readonly unknown[])[]) {
  const events: string[] = [];
  let rowIndex = 0;
  const query = vi.fn(
    async (statement: string, values?: readonly unknown[]) => {
      const normalized = statement.replace(/\s+/g, " ").trim();
      events.push(
        values ? `${normalized}|${JSON.stringify(values)}` : normalized,
      );
      if (
        normalized === "BEGIN ISOLATION LEVEL SERIALIZABLE" ||
        normalized === "COMMIT" ||
        normalized === "ROLLBACK"
      ) {
        return { rows: [] };
      }
      return { rows: rows[rowIndex++] ?? [] };
    },
  );
  const client: NeonImportPersistenceClient = { query };
  const close = vi.fn(async () => {
    events.push("close");
  });
  const sessionFactory = vi.fn(async () => ({ client, close }));
  return {
    events,
    query,
    close,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
    sessionFactoryMock: sessionFactory,
  };
}

function repository(test: ReturnType<typeof queryHarness>) {
  return createNeonImportUploadCompletionRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    runtimeRole,
    sessionFactory: test.sessionFactory,
  });
}

function claimInput() {
  return {
    ownerId: authenticatedOwnerId,
    uploadBatchId,
    idempotencyKey: "complete-request-1",
    uploadRequestFingerprint: requestFingerprint,
    claimedAt: "2026-08-14T00:10:00.000Z",
  };
}

function verifiedFiles() {
  return [
    {
      uploadFileId,
      objectId: uploadFileId,
      objectVersion: "r2-version-1",
      advertisedByteLength: 1024,
      advertisedContentType: "text/csv",
      providerSha256: "b".repeat(64),
      scope: "private_owner" as const,
      ownerId: authenticatedOwnerId,
      uploadBatchId,
    },
  ];
}

describe("Neon private-upload completion repository", () => {
  it("stays unconfigured until every server-only database value is present", () => {
    expect(
      neonImportUploadCompletionRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole,
      }),
    ).toBeNull();
    expect(
      neonImportUploadCompletionRepositoryFromEnvironment({
        databaseUrl: "postgresql://private.example/dna",
        databaseOwnerId: undefined,
        runtimeRole,
      }),
    ).toBeNull();
    expect(
      neonImportUploadCompletionRepositoryFromEnvironment({
        databaseUrl: "postgresql://private.example/dna",
        databaseOwnerId,
        runtimeRole: undefined,
      }),
    ).toBeNull();
  });

  it("validates database identity before opening a provider session", () => {
    const test = queryHarness([]);
    expect(() =>
      createNeonImportUploadCompletionRepository({
        databaseUrl: "postgresql://private.example/dna",
        databaseOwnerId: "not-a-uuid",
        runtimeRole,
        sessionFactory: test.sessionFactory,
      }),
    ).toThrow("databaseOwnerId must be a UUID");
    expect(() =>
      createNeonImportUploadCompletionRepository({
        databaseUrl: "postgresql://private.example/dna",
        databaseOwnerId,
        runtimeRole: "neondb_owner; SET ROLE neon_superuser",
        sessionFactory: test.sessionFactory,
      }),
    ).toThrow("runtimeRole is invalid");
    expect(test.sessionFactoryMock).not.toHaveBeenCalled();
  });

  it("claims an upload through one guarded serializable owner transaction", async () => {
    const test = queryHarness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [claimedRow()],
    ]);

    await expect(
      repository(test).claimUploadCompletion(claimInput()),
    ).resolves.toEqual({
      status: "claimed",
      completionId,
      uploadRequestFingerprint: requestFingerprint,
      uploadTargetExpiresAt: "2026-08-14T00:15:00.000Z",
      files: [
        {
          uploadFileId,
          objectId: uploadFileId,
          sourceFamily: "race_merge",
          expectedByteLength: 1024,
          expectedSha256: "b".repeat(64),
          expectedContentType: "text/csv",
        },
      ],
    });

    expect(test.sessionFactoryMock).toHaveBeenCalledExactlyOnceWith(
      "postgresql://private.example/dna",
    );
    expect(test.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(test.events[1]).toContain(
      "SELECT set_config('app.owner_id', $1, true) AS owner_scope",
    );
    expect(test.events[2]).toContain(
      JSON.stringify([databaseOwnerId, authenticatedOwnerId]),
    );
    expect(test.events[3]).toContain(
      "FROM dna.claim_import_upload_completion(",
    );
    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      uploadBatchId,
      "complete-request-1",
      requestFingerprint,
      "2026-08-14T00:10:00.000Z",
    ]);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("maps not-found and already-queued replay evidence", async () => {
    const missing = queryHarness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [
        {
          status: "not_found",
          completion_id: null,
          upload_request_fingerprint_sha256: null,
          upload_target_expires_at: null,
          preview_dispatch_id: null,
          file_count: 0,
          reserved_files: [],
        },
      ],
    ]);
    await expect(
      repository(missing).claimUploadCompletion(claimInput()),
    ).resolves.toEqual({ status: "not_found" });

    const queued = queryHarness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [
        {
          status: "already_queued",
          completion_id: completionId,
          upload_request_fingerprint_sha256: requestFingerprint,
          upload_target_expires_at: "2026-08-14T00:15:00.000Z",
          preview_dispatch_id: previewDispatchId,
          file_count: "1",
          reserved_files: [],
        },
      ],
    ]);
    await expect(
      repository(queued).claimUploadCompletion(claimInput()),
    ).resolves.toEqual({
      status: "already_queued",
      uploadBatchId,
      uploadRequestFingerprint: requestFingerprint,
      previewDispatchId,
      fileCount: 1,
    });
  });

  it("persists verified private objects and maps the dispatch reservation", async () => {
    const test = queryHarness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [
        {
          preview_dispatch_id: previewDispatchId,
          disposition: "created",
          dispatch_state: "pending",
          upload_request_fingerprint_sha256: requestFingerprint,
        },
      ],
    ]);

    await expect(
      repository(test).reservePreviewDispatch({
        ownerId: authenticatedOwnerId,
        uploadBatchId,
        completionId,
        uploadRequestFingerprint: requestFingerprint,
        verifiedAt: "2026-08-14T00:13:00.000Z",
        files: verifiedFiles(),
      }),
    ).resolves.toEqual({
      previewDispatchId,
      disposition: "created",
      dispatchState: "pending",
      uploadRequestFingerprint: requestFingerprint,
    });

    expect(test.events[3]).toContain(
      "FROM dna.reserve_import_preview_dispatch(",
    );
    expect(test.query.mock.calls[3]?.[1]?.[5]).toBe(
      JSON.stringify([
        {
          upload_file_id: uploadFileId,
          object_id: uploadFileId,
          object_version: "r2-version-1",
          advertised_byte_length: 1024,
          advertised_content_type: "text/csv",
          provider_sha256: "b".repeat(64),
          scope: "private_owner",
          owner_id: authenticatedOwnerId,
          upload_batch_id: uploadBatchId,
        },
      ]),
    );
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("persists queued, queue-failed, and verification-failed transitions", async () => {
    const cases = [
      {
        invoke: (test: ReturnType<typeof queryHarness>) =>
          repository(test).markPreviewDispatchQueued({
            ownerId: authenticatedOwnerId,
            uploadBatchId,
            previewDispatchId,
            queuedAt: "2026-08-14T00:16:00.000Z",
          }),
        functionName: "mark_import_preview_dispatch_queued",
      },
      {
        invoke: (test: ReturnType<typeof queryHarness>) =>
          repository(test).markPreviewDispatchFailed({
            ownerId: authenticatedOwnerId,
            uploadBatchId,
            previewDispatchId,
            failedAt: "2026-08-14T00:14:00.000Z",
            reason: "preview_queue_unavailable",
          }),
        functionName: "mark_import_preview_dispatch_failed",
      },
      {
        invoke: (test: ReturnType<typeof queryHarness>) =>
          repository(test).recordUploadVerificationFailure({
            ownerId: authenticatedOwnerId,
            uploadBatchId,
            completionId,
            failedAt: "2026-08-14T00:11:00.000Z",
            reason: "object_metadata_mismatch",
          }),
        functionName: "record_import_upload_verification_failure",
      },
    ];

    for (const expected of cases) {
      const test = queryHarness([
        [{ owner_scope: databaseOwnerId }],
        [ownerEvidence()],
        [{}],
      ]);
      await expected.invoke(test);
      expect(test.events[3]).toContain(expected.functionName);
      expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
    }
  });

  it("rolls back before persistence when owner mapping or forced RLS is absent", async () => {
    for (const evidence of [
      [] as readonly unknown[],
      [ownerEvidence({ verified_force_row_security_enabled: false })],
    ]) {
      const test = queryHarness([[{ owner_scope: databaseOwnerId }], evidence]);
      await expect(
        repository(test).claimUploadCompletion(claimInput()),
      ).rejects.toThrow(/owner scope denied|forced owner RLS/);
      expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
      expect(
        test.events.some((event) =>
          event.includes("claim_import_upload_completion"),
        ),
      ).toBe(false);
    }
  });

  it.each([
    { session_user_name: "neondb_owner" },
    { current_user_name: "neondb_owner" },
    { runtime_is_superuser: true },
    { runtime_bypasses_rls: true },
    { runtime_can_create_roles: true },
    { runtime_can_create_databases: true },
    { runtime_is_neon_superuser_member: true },
  ])(
    "rejects privileged or substituted runtime identity: %o",
    async (drift) => {
      const test = queryHarness([
        [{ owner_scope: databaseOwnerId }],
        [ownerEvidence(drift)],
      ]);
      await expect(
        repository(test).claimUploadCompletion(claimInput()),
      ).rejects.toThrow("runtime role is not least privileged");
      expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
    },
  );

  it("rolls back malformed completion or dispatch evidence", async () => {
    const malformedClaim = queryHarness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [claimedRow({ reserved_files: "not-json" })],
    ]);
    await expect(
      repository(malformedClaim).claimUploadCompletion(claimInput()),
    ).rejects.toThrow();
    expect(malformedClaim.events.slice(-2)).toEqual(["ROLLBACK", "close"]);

    const malformedDispatch = queryHarness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [
        {
          preview_dispatch_id: previewDispatchId,
          disposition: "created",
          dispatch_state: "failed",
          upload_request_fingerprint_sha256: requestFingerprint,
        },
      ],
    ]);
    await expect(
      repository(malformedDispatch).reservePreviewDispatch({
        ownerId: authenticatedOwnerId,
        uploadBatchId,
        completionId,
        uploadRequestFingerprint: requestFingerprint,
        verifiedAt: "2026-08-14T00:13:00.000Z",
        files: verifiedFiles(),
      }),
    ).rejects.toThrow("preview dispatch state is unsupported");
    expect(malformedDispatch.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });
});
