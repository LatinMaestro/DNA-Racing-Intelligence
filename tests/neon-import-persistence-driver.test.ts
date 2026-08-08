import { describe, expect, it, vi } from "vitest";
import { createOwnerScopedImportPersistenceOperationAdapter } from "../lib/import-persistence-operation-adapter";
import {
  createNeonImportPersistenceDriverFactory,
  neonImportPersistenceDriverFactoryFromEnvironment,
  type NeonImportPersistenceClient,
  type NeonImportPersistenceSessionFactory,
} from "../lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const authenticatedOwnerId = "owner-1";
const requestFingerprintSha256 = "a".repeat(64);
const runtimeRole = "dna_app_runtime";

function queryHarness(
  rows: readonly (readonly unknown[])[] = [
    [{ owner_scope: databaseOwnerId }],
    [
      {
        database_owner_id: databaseOwnerId,
        authenticated_owner_id: authenticatedOwnerId,
        row_security_enabled: true,
        force_row_security_enabled: true,
        session_user_name: runtimeRole,
        current_user_name: runtimeRole,
        runtime_is_superuser: false,
        runtime_bypasses_rls: false,
        runtime_can_create_roles: false,
        runtime_can_create_databases: false,
        runtime_is_neon_superuser_member: false,
      },
    ],
    [
      {
        disposition: "created",
        operation_id: "22222222-2222-4222-8222-222222222222",
        request_fingerprint_sha256: requestFingerprintSha256,
      },
    ],
  ],
) {
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

function request() {
  return {
    operationKind: "upload_batch" as const,
    idempotencyKey: "request-1",
    requestFingerprintSha256,
    now: new Date("2026-07-26T00:00:00.000Z"),
  };
}

describe("Neon import persistence driver", () => {
  it("initializes no provider until the first owner-scoped operation", async () => {
    const test = queryHarness();
    const driverFactory = createNeonImportPersistenceDriverFactory({
      databaseUrl: "postgresql://private.example/dna",
      runtimeRole,
      sessionFactory: test.sessionFactory,
    });
    const adapter = createOwnerScopedImportPersistenceOperationAdapter({
      databaseOwnerId,
      authenticatedOwnerId,
      driverFactory,
    });

    expect(test.sessionFactoryMock).not.toHaveBeenCalled();
    await expect(adapter.reserveOperation(request())).resolves.toEqual({
      disposition: "created",
      operationId: "22222222-2222-4222-8222-222222222222",
    });
    expect(test.sessionFactoryMock).toHaveBeenCalledTimes(1);
    expect(test.close).toHaveBeenCalledTimes(1);
  });

  it("uses one serializable transaction with parameterized owner and operation evidence", async () => {
    const test = queryHarness();
    const adapter = createOwnerScopedImportPersistenceOperationAdapter({
      databaseOwnerId,
      authenticatedOwnerId,
      driverFactory: createNeonImportPersistenceDriverFactory({
        databaseUrl: "postgresql://private.example/dna",
        runtimeRole,
        sessionFactory: test.sessionFactory,
      }),
    });

    await adapter.reserveOperation(request());

    expect(test.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(test.events[1]).toContain(
      "SELECT set_config('app.owner_id', $1, true) AS owner_scope",
    );
    expect(test.events[1]).toContain(JSON.stringify([databaseOwnerId]));
    expect(test.events[2]).toContain(
      "reservation.relforcerowsecurity AS force_row_security_enabled",
    );
    expect(test.events[2]).toContain("session_user::text AS session_user_name");
    expect(test.events[2]).toContain(
      JSON.stringify([databaseOwnerId, authenticatedOwnerId]),
    );
    expect(test.events[3]).toContain("FROM dna.reserve_import_operation(");
    expect(test.events[3]).toContain(
      JSON.stringify([
        databaseOwnerId,
        "upload_batch",
        "request-1",
        requestFingerprintSha256,
        "2026-07-26T00:00:00.000Z",
      ]),
    );
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("rolls back and closes when forced RLS evidence is absent", async () => {
    const test = queryHarness([
      [{ owner_scope: databaseOwnerId }],
      [
        {
          database_owner_id: databaseOwnerId,
          authenticated_owner_id: authenticatedOwnerId,
          row_security_enabled: true,
          force_row_security_enabled: false,
          session_user_name: runtimeRole,
          current_user_name: runtimeRole,
          runtime_is_superuser: false,
          runtime_bypasses_rls: false,
          runtime_can_create_roles: false,
          runtime_can_create_databases: false,
          runtime_is_neon_superuser_member: false,
        },
      ],
    ]);
    const adapter = createOwnerScopedImportPersistenceOperationAdapter({
      databaseOwnerId,
      authenticatedOwnerId,
      driverFactory: createNeonImportPersistenceDriverFactory({
        databaseUrl: "postgresql://private.example/dna",
        runtimeRole,
        sessionFactory: test.sessionFactory,
      }),
    });

    await expect(adapter.reserveOperation(request())).rejects.toThrow(
      "forced owner RLS is required",
    );
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
    expect(
      test.events.some((event) => event.includes("reserve_import_operation")),
    ).toBe(false);
  });

  it("rolls back malformed reservation rows rather than committing uncertain evidence", async () => {
    const test = queryHarness([
      [{ owner_scope: databaseOwnerId }],
      [
        {
          database_owner_id: databaseOwnerId,
          authenticated_owner_id: authenticatedOwnerId,
          row_security_enabled: true,
          force_row_security_enabled: true,
          session_user_name: runtimeRole,
          current_user_name: runtimeRole,
          runtime_is_superuser: false,
          runtime_bypasses_rls: false,
          runtime_can_create_roles: false,
          runtime_can_create_databases: false,
          runtime_is_neon_superuser_member: false,
        },
      ],
      [{ disposition: "unexpected" }],
    ]);
    const adapter = createOwnerScopedImportPersistenceOperationAdapter({
      databaseOwnerId,
      authenticatedOwnerId,
      driverFactory: createNeonImportPersistenceDriverFactory({
        databaseUrl: "postgresql://private.example/dna",
        runtimeRole,
        sessionFactory: test.sessionFactory,
      }),
    });

    await expect(adapter.reserveOperation(request())).rejects.toThrow(
      "disposition is unsupported",
    );
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
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
        [
          {
            database_owner_id: databaseOwnerId,
            authenticated_owner_id: authenticatedOwnerId,
            row_security_enabled: true,
            force_row_security_enabled: true,
            session_user_name: runtimeRole,
            current_user_name: runtimeRole,
            runtime_is_superuser: false,
            runtime_bypasses_rls: false,
            runtime_can_create_roles: false,
            runtime_can_create_databases: false,
            runtime_is_neon_superuser_member: false,
            ...drift,
          },
        ],
      ]);
      const adapter = createOwnerScopedImportPersistenceOperationAdapter({
        databaseOwnerId,
        authenticatedOwnerId,
        driverFactory: createNeonImportPersistenceDriverFactory({
          databaseUrl: "postgresql://private.example/dna",
          runtimeRole,
          sessionFactory: test.sessionFactory,
        }),
      });

      await expect(adapter.reserveOperation(request())).rejects.toThrow(
        "runtime role is not least privileged",
      );
      expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
      expect(
        test.events.some((event) => event.includes("reserve_import_operation")),
      ).toBe(false);
    },
  );

  it("returns no factory for an unconfigured environment", () => {
    expect(
      neonImportPersistenceDriverFactoryFromEnvironment({
        databaseUrl: undefined,
        runtimeRole,
      }),
    ).toBeNull();
    expect(
      neonImportPersistenceDriverFactoryFromEnvironment({
        databaseUrl: "   ",
        runtimeRole,
      }),
    ).toBeNull();
    expect(
      neonImportPersistenceDriverFactoryFromEnvironment({
        databaseUrl: "postgresql://private.example/dna",
        runtimeRole: undefined,
      }),
    ).toBeNull();
  });

  it("rejects blank explicit configuration without initializing a provider", () => {
    const test = queryHarness();
    expect(() =>
      createNeonImportPersistenceDriverFactory({
        databaseUrl: " ",
        runtimeRole,
        sessionFactory: test.sessionFactory,
      }),
    ).toThrow("databaseUrl is required");
    expect(test.sessionFactoryMock).not.toHaveBeenCalled();
  });

  it("rejects an unsafe runtime-role identifier before provider access", () => {
    const test = queryHarness();
    expect(() =>
      createNeonImportPersistenceDriverFactory({
        databaseUrl: "postgresql://private.example/dna",
        runtimeRole: "neondb_owner; SET ROLE neon_superuser",
        sessionFactory: test.sessionFactory,
      }),
    ).toThrow("runtimeRole is invalid");
    expect(test.sessionFactoryMock).not.toHaveBeenCalled();
  });
});
