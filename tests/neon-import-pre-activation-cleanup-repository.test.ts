import { describe, expect, it, vi } from "vitest";

import {
  createNeonImportPreActivationCleanupRepository,
  neonImportPreActivationCleanupRepositoryFromEnvironment,
} from "@/lib/neon-import-pre-activation-cleanup-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "user_owner";
const uploadBatchId = "22222222-2222-4222-8222-222222222222";
const cleanupId = "33333333-3333-3333-3333-333333333333";
const fingerprint = "a".repeat(64);
const runtimeRole = "dna_app_runtime";
const cleanedAt = "2026-08-22T00:00:00.000Z";

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    cleanup_rls: true,
    cleanup_force_rls: true,
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
  return createNeonImportPreActivationCleanupRepository({
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
    requestFingerprintSha256: fingerprint,
    reason: "synthetic acceptance cleanup",
    cleanedAt,
  };
}

describe("Neon pre-activation cleanup repository", () => {
  it("stays unconfigured until every server-only setting exists", () => {
    expect(
      neonImportPreActivationCleanupRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole,
      }),
    ).toBeNull();
  });

  it("cleans through forced owner RLS and maps the durable receipt", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          status: "cleaned",
          cleanup_id: cleanupId,
          file_count: 9,
          verified_object_count: 9,
          staged_batch_count: 9,
        },
      ],
    ]);

    await expect(
      repository(test).cleanupBeforeActivation(cleanupInput()),
    ).resolves.toEqual({
      status: "cleaned",
      cleanupId,
      fileCount: 9,
      verifiedObjectCount: 9,
      stagedBatchCount: 9,
    });
    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      uploadBatchId,
      fingerprint,
      "synthetic acceptance cleanup",
      cleanedAt,
    ]);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("maps idempotent replay and absent batches without inventing evidence", async () => {
    const existing = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          status: "existing",
          cleanup_id: cleanupId,
          file_count: "1",
          verified_object_count: "1",
          staged_batch_count: "0",
        },
      ],
    ]);
    await expect(
      repository(existing).cleanupBeforeActivation(cleanupInput()),
    ).resolves.toEqual({
      status: "existing",
      cleanupId,
      fileCount: 1,
      verifiedObjectCount: 1,
      stagedBatchCount: 0,
    });

    const absent = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          status: "not_found",
          cleanup_id: null,
          file_count: 0,
          verified_object_count: 0,
          staged_batch_count: 0,
        },
      ],
    ]);
    await expect(
      repository(absent).cleanupBeforeActivation(cleanupInput()),
    ).resolves.toEqual({
      status: "not_found",
      cleanupId: null,
      fileCount: 0,
      verifiedObjectCount: 0,
      stagedBatchCount: 0,
    });
  });

  it("rejects invalid cleanup authority before opening a connection", () => {
    const test = harness([]);
    const configured = repository(test);
    expect(() =>
      configured.cleanupBeforeActivation({
        ...cleanupInput(),
        requestFingerprintSha256: "A".repeat(64),
      }),
    ).toThrow("requestFingerprintSha256 is invalid");
    expect(() =>
      configured.cleanupBeforeActivation({
        ...cleanupInput(),
        reason: "short",
      }),
    ).toThrow("reason must contain");
    expect(test.query).not.toHaveBeenCalled();
  });

  it("rolls back before cleanup when the runtime can bypass RLS", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation({ runtime_bypasses_rls: true })],
    ]);
    await expect(
      repository(test).cleanupBeforeActivation(cleanupInput()),
    ).rejects.toThrow("runtime role is not least privileged");
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
    expect(
      test.events.some((event) =>
        event.includes("cleanup_import_before_activation"),
      ),
    ).toBe(false);
  });

  it("rejects inconsistent database evidence and rolls back", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          status: "cleaned",
          cleanup_id: cleanupId,
          file_count: 1,
          verified_object_count: 2,
          staged_batch_count: 0,
        },
      ],
    ]);
    await expect(
      repository(test).cleanupBeforeActivation(cleanupInput()),
    ).rejects.toThrow("counts are inconsistent");
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });
});
