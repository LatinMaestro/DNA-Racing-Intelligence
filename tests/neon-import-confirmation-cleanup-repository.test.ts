import { describe, expect, it, vi } from "vitest";

import {
  createNeonImportConfirmationCleanupRepository,
  neonImportConfirmationCleanupRepositoryFromEnvironment,
} from "@/lib/neon-import-confirmation-cleanup-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "user_owner";
const uploadBatchId = "22222222-2222-4222-8222-222222222222";
const updateSessionId = "33333333-3333-4333-8333-333333333333";
const activationDispatchId = "44444444-4444-4444-8444-444444444444";
const confirmationCleanupId = "55555555-5555-5555-5555-555555555555";
const preActivationCleanupId = "66666666-6666-6666-6666-666666666666";
const requestFingerprint = "a".repeat(64);
const previewFingerprint = "b".repeat(64);
const runtimeRole = "dna_app_runtime";
const cleanedAt = "2026-08-23T00:00:00.000Z";

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    cleanup_rls: true,
    cleanup_force_rls: true,
    runtime_can_read_cleanup_receipts: true,
    runtime_can_cleanup_confirmation: true,
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
        ["BEGIN ISOLATION LEVEL SERIALIZABLE", "COMMIT", "ROLLBACK"].includes(
          normalized,
        )
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
  return createNeonImportConfirmationCleanupRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    runtimeRole,
    sessionFactory: test.sessionFactory,
  });
}

function cleanupInput() {
  return {
    ownerId,
    uploadBatchId,
    requestFingerprintSha256: requestFingerprint,
    previewId: "preview-confirmed-cleanup",
    previewFingerprintSha256: previewFingerprint,
    updateSessionId,
    activationDispatchId,
    reason: "synthetic confirmed Preview cleanup",
    cleanedAt,
  };
}

describe("Neon confirmed import cleanup repository", () => {
  it("stays unconfigured until every server-only setting exists", () => {
    expect(
      neonImportConfirmationCleanupRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole,
      }),
    ).toBeNull();
  });

  it(
    "cleans an exact pending confirmation through forced owner RLS",
    async () => {
      const test = harness([
        [{ owner_scope: databaseOwnerId }],
        [isolation()],
        [
          {
            status: "cleaned",
            confirmation_cleanup_id: confirmationCleanupId,
            pre_activation_cleanup_id: preActivationCleanupId,
            file_count: 9,
            verified_object_count: 9,
            staged_batch_count: 9,
          },
        ],
      ]);

      await expect(
        repository(test).cleanupBeforeDispatch(cleanupInput()),
      ).resolves.toEqual({
        status: "cleaned",
        confirmationCleanupId,
        preActivationCleanupId,
        fileCount: 9,
        verifiedObjectCount: 9,
        stagedBatchCount: 9,
      });
      expect(test.query.mock.calls[3]?.[1]).toEqual([
        databaseOwnerId,
        uploadBatchId,
        requestFingerprint,
        "preview-confirmed-cleanup",
        previewFingerprint,
        updateSessionId,
        activationDispatchId,
        "synthetic confirmed Preview cleanup",
        cleanedAt,
      ]);
      expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
    },
  );

  it("maps exact idempotent replay without inventing identifiers", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          status: "existing",
          confirmation_cleanup_id: confirmationCleanupId,
          pre_activation_cleanup_id: preActivationCleanupId,
          file_count: "1",
          verified_object_count: "1",
          staged_batch_count: "0",
        },
      ],
    ]);

    await expect(
      repository(test).cleanupBeforeDispatch(cleanupInput()),
    ).resolves.toEqual({
      status: "existing",
      confirmationCleanupId,
      preActivationCleanupId,
      fileCount: 1,
      verifiedObjectCount: 1,
      stagedBatchCount: 0,
    });
  });

  it(
    "rejects malformed confirmation authority before opening a connection",
    () => {
      const test = harness([]);
      const configured = repository(test);
      expect(() =>
        configured.cleanupBeforeDispatch({
          ...cleanupInput(),
          previewFingerprintSha256: "B".repeat(64),
        }),
      ).toThrow("previewFingerprintSha256 is invalid");
      expect(() =>
        configured.cleanupBeforeDispatch({
          ...cleanupInput(),
          activationDispatchId: "not-a-uuid",
        }),
      ).toThrow("activationDispatchId must be a UUID");
      expect(test.query).not.toHaveBeenCalled();
    },
  );

  it(
    "rolls back when runtime privilege or RLS evidence is unsafe",
    async () => {
      const test = harness([
        [{ owner_scope: databaseOwnerId }],
        [isolation({ runtime_can_cleanup_confirmation: false })],
      ]);
      await expect(
        repository(test).cleanupBeforeDispatch(cleanupInput()),
      ).rejects.toThrow("runtime privileges are incomplete");
      expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
      expect(
        test.events.some((event) =>
          event.includes("cleanup_confirmed_import_before_dispatch(") &&
          event.includes("SELECT status"),
        ),
      ).toBe(false);
    },
  );

  it(
    "rejects inconsistent durable cleanup evidence and rolls back",
    async () => {
      const test = harness([
        [{ owner_scope: databaseOwnerId }],
        [isolation()],
        [
          {
            status: "cleaned",
            confirmation_cleanup_id: confirmationCleanupId,
            pre_activation_cleanup_id: preActivationCleanupId,
            file_count: 1,
            verified_object_count: 2,
            staged_batch_count: 0,
          },
        ],
      ]);
      await expect(
        repository(test).cleanupBeforeDispatch(cleanupInput()),
      ).rejects.toThrow("counts are inconsistent");
      expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
    },
  );
});
