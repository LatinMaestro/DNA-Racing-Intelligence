import type {
  ImportPersistenceDriver,
  ImportPersistenceDriverFactory,
  ImportPersistenceTransaction,
} from "./import-persistence-operation-adapter";

type QueryResult = Readonly<{ rows: readonly unknown[] }>;

export type NeonImportPersistenceClient = Readonly<{
  query: (
    statement: string,
    values?: readonly unknown[],
  ) => Promise<QueryResult>;
}>;

export type NeonImportPersistenceSession = Readonly<{
  client: NeonImportPersistenceClient;
  close: () => Promise<void>;
}>;

export type NeonImportPersistenceSessionFactory = (
  databaseUrl: string,
) => Promise<NeonImportPersistenceSession>;

const SET_OWNER_SCOPE_SQL = `
  SELECT set_config('app.owner_id', $1, true) AS owner_scope
`;

const VERIFY_OWNER_ISOLATION_SQL = `
  SELECT
    owner.id::text AS database_owner_id,
    owner.clerk_user_id AS authenticated_owner_id,
    reservation.relrowsecurity AS row_security_enabled,
    reservation.relforcerowsecurity AS force_row_security_enabled,
    session_user::text AS session_user_name,
    current_user::text AS current_user_name,
    runtime_role.rolsuper AS runtime_is_superuser,
    runtime_role.rolbypassrls AS runtime_bypasses_rls,
    runtime_role.rolcreaterole AS runtime_can_create_roles,
    runtime_role.rolcreatedb AS runtime_can_create_databases,
    COALESCE(
      pg_has_role(
        session_user,
        (
          SELECT role.oid
          FROM pg_catalog.pg_roles role
          WHERE role.rolname = 'neon_superuser'
        ),
        'MEMBER'
      ),
      false
    ) AS runtime_is_neon_superuser_member
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_class reservation
    ON reservation.oid = 'dna.import_operation_reservation'::regclass
  JOIN pg_catalog.pg_roles runtime_role
    ON runtime_role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
`;

const RESERVE_OPERATION_SQL = `
  SELECT
    disposition,
    operation_id::text AS operation_id,
    request_fingerprint_sha256
  FROM dna.reserve_import_operation(
    $1::uuid,
    $2::text,
    $3::text,
    $4::character(64),
    $5::timestamptz
  )
`;

function databaseRecord(
  value: unknown,
  field: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be a database record`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

const SAFE_RUNTIME_ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

function requireRuntimeRole(value: string): string {
  const normalized = value.trim();
  if (!SAFE_RUNTIME_ROLE_PATTERN.test(normalized)) {
    throw new Error("runtimeRole is invalid");
  }
  return normalized;
}

function verifyLeastPrivilegeRuntimeRole(
  row: Readonly<Record<string, unknown>>,
  runtimeRole: string,
): void {
  if (
    requiredString(row.session_user_name, "session_user_name") !==
      runtimeRole ||
    requiredString(row.current_user_name, "current_user_name") !==
      runtimeRole ||
    requiredBoolean(row.runtime_is_superuser, "runtime_is_superuser") ||
    requiredBoolean(row.runtime_bypasses_rls, "runtime_bypasses_rls") ||
    requiredBoolean(row.runtime_can_create_roles, "runtime_can_create_roles") ||
    requiredBoolean(
      row.runtime_can_create_databases,
      "runtime_can_create_databases",
    ) ||
    requiredBoolean(
      row.runtime_is_neon_superuser_member,
      "runtime_is_neon_superuser_member",
    )
  ) {
    throw new Error("Import persistence runtime role is not least privileged.");
  }
}

function oneRow(
  result: QueryResult,
  field: string,
): Readonly<Record<string, unknown>> {
  if (result.rows.length !== 1) {
    throw new Error(`${field} must return exactly one row`);
  }
  return databaseRecord(result.rows[0], field);
}

async function defaultSessionFactory(
  databaseUrl: string,
): Promise<NeonImportPersistenceSession> {
  const { Pool } = await import("@neondatabase/serverless");
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

  try {
    const client = await pool.connect();
    return {
      client,
      async close() {
        client.release();
        await pool.end();
      },
    };
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
}

function createTransaction(
  client: NeonImportPersistenceClient,
  runtimeRole: string,
): ImportPersistenceTransaction {
  return {
    async setLocalOwnerScope({ databaseOwnerId }) {
      const row = oneRow(
        await client.query(SET_OWNER_SCOPE_SQL, [databaseOwnerId]),
        "owner scope",
      );
      return {
        ownerScope: requiredString(row.owner_scope, "owner_scope"),
      };
    },

    async verifyOwnerIsolation({ databaseOwnerId, authenticatedOwnerId }) {
      const result = await client.query(VERIFY_OWNER_ISOLATION_SQL, [
        databaseOwnerId,
        authenticatedOwnerId,
      ]);
      if (result.rows.length === 0) return null;
      const row = oneRow(result, "owner isolation");
      verifyLeastPrivilegeRuntimeRole(row, runtimeRole);
      return {
        databaseOwnerId: requiredString(
          row.database_owner_id,
          "database_owner_id",
        ),
        authenticatedOwnerId: requiredString(
          row.authenticated_owner_id,
          "authenticated_owner_id",
        ),
        rowSecurityEnabled: requiredBoolean(
          row.row_security_enabled,
          "row_security_enabled",
        ),
        forceRowSecurityEnabled: requiredBoolean(
          row.force_row_security_enabled,
          "force_row_security_enabled",
        ),
      };
    },

    async reserveOperation(input) {
      const row = oneRow(
        await client.query(RESERVE_OPERATION_SQL, [
          input.databaseOwnerId,
          input.operationKind,
          input.idempotencyKey,
          input.requestFingerprintSha256,
          input.requestedAt,
        ]),
        "operation reservation",
      );
      const disposition = requiredString(row.disposition, "disposition");
      if (disposition !== "created" && disposition !== "existing") {
        throw new Error("disposition is unsupported");
      }
      return {
        disposition,
        operationId: requiredString(row.operation_id, "operation_id"),
        requestFingerprintSha256: requiredString(
          row.request_fingerprint_sha256,
          "request_fingerprint_sha256",
        ),
      };
    },
  };
}

export function createNeonImportPersistenceDriverFactory(input: {
  databaseUrl: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): ImportPersistenceDriverFactory {
  const databaseUrl = input.databaseUrl.trim();
  if (databaseUrl === "") throw new Error("databaseUrl is required");
  const runtimeRole = requireRuntimeRole(input.runtimeRole);
  const sessionFactory = input.sessionFactory ?? defaultSessionFactory;

  return async (): Promise<ImportPersistenceDriver> => ({
    async transaction<Result>(
      operation: (transaction: ImportPersistenceTransaction) => Promise<Result>,
    ) {
      const session = await sessionFactory(databaseUrl);
      let transactionStarted = false;
      try {
        await session.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        transactionStarted = true;
        const result = await operation(
          createTransaction(session.client, runtimeRole),
        );
        await session.client.query("COMMIT");
        transactionStarted = false;
        return result;
      } catch (error) {
        if (transactionStarted) {
          await session.client.query("ROLLBACK").catch(() => undefined);
        }
        throw error;
      } finally {
        await session.close();
      }
    },
  });
}

export function neonImportPersistenceDriverFactoryFromEnvironment(
  environment: Readonly<{
    databaseUrl: string | undefined;
    runtimeRole: string | undefined;
  }>,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): ImportPersistenceDriverFactory | null {
  const databaseUrl = environment.databaseUrl?.trim() ?? "";
  const runtimeRole = environment.runtimeRole?.trim() ?? "";
  if (databaseUrl === "" || runtimeRole === "") return null;
  return createNeonImportPersistenceDriverFactory({
    databaseUrl,
    runtimeRole,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
