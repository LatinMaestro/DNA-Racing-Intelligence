import { describe, expect, it, vi } from "vitest";

import {
  createNeonImportUploadIntakeRepository,
  neonImportUploadIntakeRepositoryFromEnvironment,
} from "../lib/neon-import-upload-intake-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "../lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const authenticatedOwnerId = "owner-1";
const runtimeRole = "dna_app_runtime";
const requestFingerprint = "a".repeat(64);
const uploadBatchId = "22222222-2222-4222-8222-222222222222";
const uploadFileId = "33333333-3333-4333-8333-333333333333";

function ownerEvidence(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: authenticatedOwnerId,
    batch_row_security_enabled: true,
    batch_force_row_security_enabled: true,
    file_row_security_enabled: true,
    file_force_row_security_enabled: true,
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

function reservationRow(overrides: Record<string, unknown> = {}) {
  return {
    disposition: "created",
    upload_batch_id: uploadBatchId,
    request_fingerprint_sha256: requestFingerprint,
    reserved_files: [{ clientFileId: "race-1", uploadFileId }],
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
  return createNeonImportUploadIntakeRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    runtimeRole,
    sessionFactory: test.sessionFactory,
  });
}

function reserveInput() {
  return {
    ownerId: authenticatedOwnerId,
    idempotencyKey: "request-1",
    requestedAt: "2026-08-10T00:00:00.000Z",
    requestFingerprint,
    files: [
      {
        clientFileId: "race-1",
        sourceFamily: "race_merge" as const,
        originalFileName: "synthetic-race.csv",
        contentType: "text/csv",
        byteLength: 1024,
        sha256: "b".repeat(64),
      },
    ],
  };
}

describe("Neon private-upload intake repository", () => {
  it("stays unconfigured until all server-only values are present", () => {
    expect(
      neonImportUploadIntakeRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole,
      }),
    ).toBeNull();
    expect(
      neonImportUploadIntakeRepositoryFromEnvironment({
        databaseUrl: "postgresql://private.example/dna",
        databaseOwnerId: undefined,
        runtimeRole,
      }),
    ).toBeNull();
    expect(
      neonImportUploadIntakeRepositoryFromEnvironment({
        databaseUrl: "postgresql://private.example/dna",
        databaseOwnerId,
        runtimeRole: undefined,
      }),
    ).toBeNull();
  });

  it("validates configuration before opening a provider session", () => {
    const test = queryHarness([]);
    expect(() =>
      createNeonImportUploadIntakeRepository({
        databaseUrl: "postgresql://private.example/dna",
        databaseOwnerId: "not-a-uuid",
        runtimeRole,
        sessionFactory: test.sessionFactory,
      }),
    ).toThrow("databaseOwnerId must be a UUID");
    expect(() =>
      createNeonImportUploadIntakeRepository({
        databaseUrl: "postgresql://private.example/dna",
        databaseOwnerId,
        runtimeRole: "neondb_owner; SET ROLE neon_superuser",
        sessionFactory: test.sessionFactory,
      }),
    ).toThrow("runtimeRole is invalid");
    expect(test.sessionFactoryMock).not.toHaveBeenCalled();
  });

  it("maps authenticated intake metadata into one guarded serializable reservation", async () => {
    const test = queryHarness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [reservationRow()],
    ]);

    await expect(
      repository(test).reserveUploadBatch(reserveInput()),
    ).resolves.toEqual({
      disposition: "created",
      uploadBatchId,
      requestFingerprint,
      files: [{ clientFileId: "race-1", uploadFileId }],
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
    expect(test.events[3]).toContain("FROM dna.reserve_import_upload_batch(");
    expect(test.query.mock.calls[3]?.[1]?.[4]).toBe(
      JSON.stringify([
        {
          client_file_id: "race-1",
          source_family: "race_merge",
          original_file_name: "synthetic-race.csv",
          content_type: "text/csv",
          byte_length: 1024,
          sha256: "b".repeat(64),
        },
      ]),
    );
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("persists ready and failed target states through guarded functions", async () => {
    const ready = queryHarness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [{}],
    ]);
    await repository(ready).markUploadTargetsReady({
      ownerId: authenticatedOwnerId,
      uploadBatchId,
      uploadFileIds: [uploadFileId],
      requestFingerprint,
      expiresAt: "2026-08-10T00:15:00.000Z",
    });
    expect(ready.events[3]).toContain(
      "SELECT dna.mark_import_upload_targets_ready(",
    );
    expect(ready.events[3]).toContain(
      JSON.stringify([
        databaseOwnerId,
        uploadBatchId,
        [uploadFileId],
        requestFingerprint,
        "2026-08-10T00:15:00.000Z",
      ]),
    );
    expect(ready.events.slice(-2)).toEqual(["COMMIT", "close"]);

    const failed = queryHarness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [{}],
    ]);
    await repository(failed).markUploadReservationFailed({
      ownerId: authenticatedOwnerId,
      uploadBatchId,
      requestFingerprint,
      failedAt: "2026-08-10T00:01:00.000Z",
      reason: "private_object_target_unavailable",
    });
    expect(failed.events[3]).toContain(
      "SELECT dna.mark_import_upload_reservation_failed(",
    );
    expect(failed.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("rolls back before writes when owner mapping or forced RLS is absent", async () => {
    for (const evidence of [
      [] as readonly unknown[],
      [ownerEvidence({ file_force_row_security_enabled: false })],
    ]) {
      const test = queryHarness([[{ owner_scope: databaseOwnerId }], evidence]);
      await expect(
        repository(test).reserveUploadBatch(reserveInput()),
      ).rejects.toThrow(/owner scope denied|forced owner RLS/);
      expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
      expect(
        test.events.some((event) =>
          event.includes("reserve_import_upload_batch"),
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
        repository(test).reserveUploadBatch(reserveInput()),
      ).rejects.toThrow("runtime role is not least privileged");
      expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
    },
  );

  it("rolls back malformed reservation evidence", async () => {
    const test = queryHarness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [reservationRow({ reserved_files: "not-json" })],
    ]);
    await expect(
      repository(test).reserveUploadBatch(reserveInput()),
    ).rejects.toThrow();
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });
});
