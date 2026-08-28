import type { DnaOpenLabP5PostgresCapacityPort } from "./dna-open-lab-p5-capacity-measurement-runner";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceClient,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const SAFE_RUNTIME_ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;
const SAFE_RELATION_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAXIMUM_RELATIONS = 512;

/** Complete API-only DNA Open Lab relation inventory through migration 0076. */
export const DNA_OPEN_LAB_P5_OWNER_RELATION_NAMES = Object.freeze([
  "dna_open_lab_active_race_snapshot",
  "dna_open_lab_core_supplemental_snapshot",
  "dna_open_lab_current_state_acquisition_cycle",
  "dna_open_lab_current_state_evidence_index",
  "dna_open_lab_finished_race_backfill_checkpoint",
  "dna_open_lab_finished_race_window_receipt",
  "dna_open_lab_owned_core_snapshot",
  "dna_open_lab_race_fill_snapshot",
  "dna_open_lab_splice_arena_listing_snapshot",
  "dna_open_lab_splice_arena_mode_snapshot",
  "dna_open_lab_splice_arena_page_snapshot",
  "dna_open_lab_sync_family",
  "dna_open_lab_sync_generation",
  "dna_open_lab_sync_state",
  "dna_open_lab_token_prices_snapshot",
] as const);

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
    has_database_privilege(session_user, current_database(), 'CREATE')
      AS runtime_can_create_in_database,
    has_schema_privilege(session_user, 'dna', 'CREATE')
      AS runtime_can_create_in_schema,
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

const READ_POSTGRES_MAJOR_VERSION_SQL = `
  SELECT current_setting('server_version_num') AS server_version_num
`;

const READ_DATABASE_STORAGE_SQL = `
  SELECT pg_database_size(current_database())::text AS storage_bytes
`;

const READ_OWNER_RELATION_STORAGE_SQL = `
  SELECT
    COUNT(*)::text AS relation_count,
    COALESCE(SUM(pg_relation_size(relation.oid)), 0)::text AS heap_bytes,
    COALESCE(SUM(pg_indexes_size(relation.oid)), 0)::text AS index_bytes,
    COALESCE(
      SUM(
        CASE
          WHEN relation.reltoastrelid = 0 THEN 0
          ELSE pg_total_relation_size(relation.reltoastrelid)
        END
      ),
      0
    )::text AS toast_bytes
  FROM pg_catalog.pg_class relation
  JOIN pg_catalog.pg_namespace namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'dna'
    AND relation.relkind = 'r'
    AND relation.relname = ANY($1::text[])
`;

type DatabaseRow = Readonly<Record<string, unknown>>;

export type NeonDnaOpenLabP5CapacityPortConfiguration = Readonly<{
  authorizedOwnerId: string;
  databaseOwnerId: string;
  databaseUrl: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}>;

function capacityError(message: string): never {
  throw new Error(`DNA Open Lab P5 Neon capacity port: ${message}`);
}

function safeText(value: string, field: string, maximum: number): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)
  ) {
    capacityError(`${field} is invalid`);
  }
  return normalized;
}

function exactlyOneRow(rows: readonly unknown[]): DatabaseRow {
  const row = rows[0];
  if (
    rows.length !== 1 ||
    row === null ||
    typeof row !== "object" ||
    Array.isArray(row)
  ) {
    capacityError("provider response is invalid");
  }
  return row as DatabaseRow;
}

function stringField(row: DatabaseRow, field: string): string {
  const value = row[field];
  if (typeof value !== "string" || value.trim().length < 1) {
    capacityError("provider response is invalid");
  }
  return value;
}

function booleanField(row: DatabaseRow, field: string): boolean {
  const value = row[field];
  if (typeof value !== "boolean") {
    capacityError("provider response is invalid");
  }
  return value;
}

function byteCount(row: DatabaseRow, field: string): number {
  const value = row[field];
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    capacityError("provider response is invalid");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    capacityError("provider response is invalid");
  }
  return parsed;
}

function ownerRelations(values: readonly string[]): readonly string[] {
  if (values.length < 1 || values.length > MAXIMUM_RELATIONS) {
    capacityError("ownerRelationNames is invalid");
  }
  const normalized = values.map((value) => value.trim());
  if (
    normalized.some((value) => !SAFE_RELATION_PATTERN.test(value)) ||
    new Set(normalized).size !== normalized.length
  ) {
    capacityError("ownerRelationNames is invalid");
  }
  return Object.freeze([...normalized].sort());
}

function verifyRuntime(
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
    booleanField(row, "runtime_can_create_in_database") ||
    booleanField(row, "runtime_can_create_in_schema") ||
    booleanField(row, "runtime_is_neon_superuser_member")
  ) {
    capacityError("access denied");
  }
}

/**
 * Creates the read-only PostgreSQL side of the P5 capacity runner. Every
 * observation uses a fresh owner-bound transaction and verifies that the
 * configured credential is not privileged before reading catalog sizes.
 */
export function createNeonDnaOpenLabP5PostgresCapacityPort(
  configuration: NeonDnaOpenLabP5CapacityPortConfiguration,
): DnaOpenLabP5PostgresCapacityPort {
  const authorizedOwnerId = safeText(
    configuration.authorizedOwnerId,
    "authorizedOwnerId",
    512,
  );
  const databaseOwnerId = configuration.databaseOwnerId.trim().toLowerCase();
  if (!UUID_PATTERN.test(databaseOwnerId)) {
    capacityError("databaseOwnerId is invalid");
  }
  const databaseUrl = safeText(configuration.databaseUrl, "databaseUrl", 4096);
  const runtimeRole = configuration.runtimeRole.trim();
  if (!SAFE_RUNTIME_ROLE_PATTERN.test(runtimeRole)) {
    capacityError("runtimeRole is invalid");
  }
  const relationNames = ownerRelations(DNA_OPEN_LAB_P5_OWNER_RELATION_NAMES);
  const sessionFactory =
    configuration.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  async function read<T>(
    measure: (client: NeonImportPersistenceClient) => Promise<T>,
  ): Promise<T> {
    let session: Awaited<ReturnType<NeonImportPersistenceSessionFactory>>;
    try {
      session = await sessionFactory(databaseUrl);
    } catch {
      return capacityError("measurement failed");
    }
    let transactionStarted = false;
    try {
      await session.client.query(
        "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY",
      );
      transactionStarted = true;
      const scope = exactlyOneRow(
        (await session.client.query(SET_OWNER_SCOPE_SQL, [databaseOwnerId]))
          .rows,
      );
      if (stringField(scope, "owner_scope") !== databaseOwnerId) {
        capacityError("access denied");
      }
      verifyRuntime(
        exactlyOneRow(
          (
            await session.client.query(VERIFY_OWNER_AND_RUNTIME_SQL, [
              databaseOwnerId,
              authorizedOwnerId,
            ])
          ).rows,
        ),
        { authorizedOwnerId, databaseOwnerId, runtimeRole },
      );
      const result = await measure(session.client);
      await session.client.query("COMMIT");
      return result;
    } catch {
      if (transactionStarted) {
        await session.client.query("ROLLBACK").catch(() => undefined);
      }
      return capacityError("measurement failed");
    } finally {
      await session.close().catch(() => undefined);
    }
  }

  return Object.freeze({
    readMajorVersion: () =>
      read(async (client) => {
        const value = stringField(
          exactlyOneRow(
            (await client.query(READ_POSTGRES_MAJOR_VERSION_SQL)).rows,
          ),
          "server_version_num",
        );
        if (!/^[1-9][0-9]{4,5}$/u.test(value)) {
          capacityError("provider response is invalid");
        }
        return Math.floor(Number(value) / 10_000);
      }),
    readDatabaseBytes: () =>
      read(async (client) =>
        byteCount(
          exactlyOneRow((await client.query(READ_DATABASE_STORAGE_SQL)).rows),
          "storage_bytes",
        ),
      ),
    readOwnerRelationBytes: () =>
      read(async (client) => {
        const row = exactlyOneRow(
          (await client.query(READ_OWNER_RELATION_STORAGE_SQL, [relationNames]))
            .rows,
        );
        if (byteCount(row, "relation_count") !== relationNames.length) {
          capacityError("owner relation coverage is incomplete");
        }
        return Object.freeze({
          heapBytes: byteCount(row, "heap_bytes"),
          indexBytes: byteCount(row, "index_bytes"),
          toastBytes: byteCount(row, "toast_bytes"),
        });
      }),
  });
}
