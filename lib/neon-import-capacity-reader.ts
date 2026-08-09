import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const SAFE_RUNTIME_ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SET_OWNER_SCOPE_SQL = `
  SELECT set_config('app.owner_id', $1, true) AS owner_scope
`;

const VERIFY_OWNER_AND_RUNTIME_SQL = `
  SELECT
    owner.id::text AS database_owner_id,
    owner.clerk_user_id AS authenticated_owner_id,
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
  JOIN pg_catalog.pg_roles runtime_role
    ON runtime_role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
`;

const READ_DATABASE_STORAGE_SQL = `
  SELECT pg_database_size(current_database())::text AS storage_bytes
`;

export type NeonImportCapacityReaderConfiguration = Readonly<{
  authorizedOwnerId: string;
  databaseOwnerId: string;
  databaseUrl: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}>;

type DatabaseRow = Readonly<Record<string, unknown>>;

function boundedString(
  value: string,
  field: string,
  maxLength: number,
): string {
  const normalized = value.trim();
  if (
    normalized === "" ||
    normalized.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function databaseRow(value: unknown): DatabaseRow {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Neon capacity response is invalid.");
  }
  return value as DatabaseRow;
}

function exactlyOneRow(rows: readonly unknown[]): DatabaseRow {
  if (rows.length !== 1) {
    throw new Error("Neon capacity response is invalid.");
  }
  return databaseRow(rows[0]);
}

function stringField(row: DatabaseRow, field: string): string {
  const value = row[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Neon capacity response is invalid.");
  }
  return value;
}

function booleanField(row: DatabaseRow, field: string): boolean {
  const value = row[field];
  if (typeof value !== "boolean") {
    throw new Error("Neon capacity response is invalid.");
  }
  return value;
}

function verifyOwnerAndRuntime(
  row: DatabaseRow,
  input: {
    authorizedOwnerId: string;
    databaseOwnerId: string;
    runtimeRole: string;
  },
): void {
  if (
    stringField(row, "database_owner_id") !== input.databaseOwnerId ||
    stringField(row, "authenticated_owner_id") !== input.authorizedOwnerId ||
    stringField(row, "session_user_name") !== input.runtimeRole ||
    stringField(row, "current_user_name") !== input.runtimeRole ||
    booleanField(row, "runtime_is_superuser") ||
    booleanField(row, "runtime_bypasses_rls") ||
    booleanField(row, "runtime_can_create_roles") ||
    booleanField(row, "runtime_can_create_databases") ||
    booleanField(row, "runtime_is_neon_superuser_member")
  ) {
    throw new Error("Neon capacity access denied.");
  }
}

function storageBytes(row: DatabaseRow): number {
  const value = row.storage_bytes;
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error("Neon capacity response is invalid.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Neon capacity response is invalid.");
  }
  return parsed;
}

export function createNeonImportStorageBytesReader(
  configuration: NeonImportCapacityReaderConfiguration,
): (input: { ownerId: string }) => Promise<number> {
  const authorizedOwnerId = boundedString(
    configuration.authorizedOwnerId,
    "authorizedOwnerId",
    512,
  );
  const databaseOwnerId = configuration.databaseOwnerId.trim().toLowerCase();
  if (!UUID_PATTERN.test(databaseOwnerId)) {
    throw new Error("databaseOwnerId is invalid");
  }
  const databaseUrl = boundedString(
    configuration.databaseUrl,
    "databaseUrl",
    4096,
  );
  const runtimeRole = configuration.runtimeRole.trim();
  if (!SAFE_RUNTIME_ROLE_PATTERN.test(runtimeRole)) {
    throw new Error("runtimeRole is invalid");
  }
  const sessionFactory =
    configuration.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  return async function readNeonStorageBytes({ ownerId }): Promise<number> {
    if (ownerId.trim() !== authorizedOwnerId) {
      throw new Error("Neon capacity access denied.");
    }

    let session: Awaited<ReturnType<NeonImportPersistenceSessionFactory>>;
    try {
      session = await sessionFactory(databaseUrl);
    } catch {
      throw new Error("Neon capacity measurement failed.");
    }

    let transactionStarted = false;
    try {
      await session.client.query(
        "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY",
      );
      transactionStarted = true;

      const ownerScope = exactlyOneRow(
        (await session.client.query(SET_OWNER_SCOPE_SQL, [databaseOwnerId]))
          .rows,
      );
      if (stringField(ownerScope, "owner_scope") !== databaseOwnerId) {
        throw new Error("Neon capacity access denied.");
      }

      const ownerAndRuntime = exactlyOneRow(
        (
          await session.client.query(VERIFY_OWNER_AND_RUNTIME_SQL, [
            databaseOwnerId,
            authorizedOwnerId,
          ])
        ).rows,
      );
      verifyOwnerAndRuntime(ownerAndRuntime, {
        authorizedOwnerId,
        databaseOwnerId,
        runtimeRole,
      });

      const measured = storageBytes(
        exactlyOneRow(
          (await session.client.query(READ_DATABASE_STORAGE_SQL)).rows,
        ),
      );
      await session.client.query("COMMIT");
      return measured;
    } catch {
      if (transactionStarted) {
        await session.client.query("ROLLBACK").catch(() => undefined);
      }
      throw new Error("Neon capacity measurement failed.");
    } finally {
      await session.close().catch(() => undefined);
    }
  };
}
