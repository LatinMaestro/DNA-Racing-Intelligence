import { describe, expect, it, vi } from "vitest";

import {
  createNeonImportPreviewProcessingRepository,
  neonImportPreviewProcessingRepositoryFromEnvironment,
} from "../lib/neon-import-preview-processing-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "../lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "owner-1";
const runtimeRole = "dna_app_runtime";
const uploadBatchId = "22222222-2222-4222-8222-222222222222";
const dispatchId = "33333333-3333-4333-8333-333333333333";
const requestFingerprint = "a".repeat(64);
const manifestFingerprint = "b".repeat(64);

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    processing_rls: true,
    processing_force_rls: true,
    prepared_rls: true,
    prepared_force_rls: true,
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

function harness(rows: readonly (readonly unknown[])[]) {
  const events: string[] = [];
  let index = 0;
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
      return { rows: rows[index++] ?? [] };
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
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  };
}

function repository(test: ReturnType<typeof harness>) {
  return createNeonImportPreviewProcessingRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    runtimeRole,
    sessionFactory: test.sessionFactory,
  });
}

describe("Neon import Preview processing repository", () => {
  it("stays unconfigured until all server-only database settings exist", () => {
    expect(
      neonImportPreviewProcessingRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole,
      }),
    ).toBeNull();
  });

  it("claims verified objects through one least-privilege transaction", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [evidence()],
      [
        {
          status: "claimed",
          authenticated_owner_id: ownerId,
          upload_batch_id: uploadBatchId,
          upload_request_fingerprint_sha256: requestFingerprint,
          upload_manifest_fingerprint_sha256: manifestFingerprint,
          retry_after: null,
          preview_id: null,
          preview_fingerprint_sha256: null,
          confirmable: null,
          files: [
            {
              uploadFileId: "44444444-4444-4444-8444-444444444444",
              objectId: "44444444-4444-4444-8444-444444444444",
              sourceFamily: "race_merge",
              expectedByteLength: 1024,
              expectedSha256: "c".repeat(64),
            },
          ],
        },
      ],
    ]);

    await expect(
      repository(test).claimPreviewDispatch({
        previewDispatchId: dispatchId,
        workerId: "worker-1",
        uploadRequestFingerprint: requestFingerprint,
        claimedAt: "2026-08-14T01:20:00.000Z",
        leaseExpiresAt: "2026-08-14T01:25:00.000Z",
      }),
    ).resolves.toEqual({
      status: "claimed",
      ownerId,
      uploadBatchId,
      uploadRequestFingerprint: requestFingerprint,
      uploadManifestFingerprintSha256: manifestFingerprint,
      files: [
        {
          uploadFileId: "44444444-4444-4444-8444-444444444444",
          objectId: "44444444-4444-4444-8444-444444444444",
          sourceFamily: "race_merge",
          expectedByteLength: 1024,
          expectedSha256: "c".repeat(64),
        },
      ],
    });
    expect(test.query.mock.calls[2]?.[1]).toEqual([databaseOwnerId, null]);
    expect(test.events[3]).toContain("dna.claim_import_preview_dispatch");
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("publishes exact prepared evidence and records retryable failures", async () => {
    const publication = harness([
      [{ owner_scope: databaseOwnerId }],
      [evidence()],
      [
        {
          disposition: "created",
          upload_request_fingerprint_sha256: requestFingerprint,
          upload_manifest_fingerprint_sha256: manifestFingerprint,
          preview_id: "preview-1",
          preview_fingerprint_sha256: "d".repeat(64),
          confirmable: true,
        },
      ],
    ]);
    await expect(
      repository(publication).publishPreparedPreview({
        ownerId,
        uploadBatchId,
        previewDispatchId: dispatchId,
        uploadRequestFingerprint: requestFingerprint,
        uploadManifestFingerprintSha256: manifestFingerprint,
        previewId: "preview-1",
        previewFingerprintSha256: "d".repeat(64),
        fileCount: 1,
        sourceFamilyCount: 1,
        blockingIssueCount: 0,
        confirmable: true,
        completedAt: "2026-08-14T01:23:00.000Z",
      }),
    ).resolves.toMatchObject({ disposition: "created", confirmable: true });

    const failure = harness([
      [{ owner_scope: databaseOwnerId }],
      [evidence()],
      [{}],
    ]);
    await repository(failure).recordPreviewFailure({
      ownerId,
      uploadBatchId,
      previewDispatchId: dispatchId,
      workerId: "worker-1",
      uploadRequestFingerprint: requestFingerprint,
      failedAt: "2026-08-14T01:22:00.000Z",
      reason: "preview_processor_failed",
    });
    expect(failure.events[3]).toContain(
      "dna.record_import_preview_processing_failure",
    );
  });

  it("rolls back before operations when runtime identity is privileged", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [evidence({ runtime_is_superuser: true })],
    ]);
    await expect(
      repository(test).claimPreviewDispatch({
        previewDispatchId: dispatchId,
        workerId: "worker-1",
        uploadRequestFingerprint: requestFingerprint,
        claimedAt: "2026-08-14T01:20:00.000Z",
        leaseExpiresAt: "2026-08-14T01:25:00.000Z",
      }),
    ).rejects.toThrow("not least privileged");
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });
});
