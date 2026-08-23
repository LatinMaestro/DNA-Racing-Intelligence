import { historicalImportSources } from "@/domain/import-workflow";
import type { ImportRollbackRepository } from "@/lib/import-rollback-service";

import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceClient,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

type QueryResult = Readonly<{ rows: readonly unknown[] }>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATABASE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";

const VERIFY_ISOLATION_SQL = [
  "SELECT",
  "  owner.id::text AS database_owner_id,",
  "  owner.clerk_user_id AS authenticated_owner_id,",
  "  rollback.relrowsecurity AS rollback_rls,",
  "  rollback.relforcerowsecurity AS rollback_force_rls,",
  "  has_table_privilege(session_user, 'dna.import_dataset_rollback', 'SELECT')",
  "    AS runtime_can_read_rollback_receipts,",
  "  has_function_privilege(",
  "    session_user,",
  "    'dna.rollback_active_source_version(uuid,uuid,text,text,timestamp with time zone)',",
  "    'EXECUTE'",
  "  ) AS runtime_can_rollback,",
  "  session_user::text AS session_user_name,",
  "  current_user::text AS current_user_name,",
  "  role.rolsuper AS runtime_is_superuser,",
  "  role.rolbypassrls AS runtime_bypasses_rls,",
  "  role.rolcreaterole AS runtime_can_create_roles,",
  "  role.rolcreatedb AS runtime_can_create_databases,",
  "  COALESCE(pg_has_role(session_user, (",
  "    SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'neon_superuser'",
  "  ), 'MEMBER'), false) AS runtime_is_neon_superuser_member",
  "FROM dna.app_owner owner",
  "JOIN pg_catalog.pg_class rollback",
  "  ON rollback.oid = 'dna.import_dataset_rollback'::regclass",
  "JOIN pg_catalog.pg_roles role ON role.rolname = session_user",
  "WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2",
].join("\n");

const ROLLBACK_SQL = [
  "SELECT",
  "  status, disposition, rollback_id::text AS rollback_id, source_type,",
  "  restored_batch_id::text AS restored_batch_id,",
  "  aggregate_refresh_id::text AS aggregate_refresh_id",
  "FROM dna.rollback_active_source_version(",
  "  $1::uuid, $2::uuid, $3::text, $4::text, $5::timestamptz",
  ")",
].join("\n");

type ReadyImportRollbackRepository = Extract<
  ImportRollbackRepository,
  Readonly<{ status: "ready" }>
>;

export type NeonImportRollbackEnvironment = Readonly<{
  databaseUrl: string | undefined;
  databaseOwnerId: string | undefined;
  runtimeRole: string | undefined;
}>;

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(field + " must be a database record");
  }
  return value as Record<string, unknown>;
}

function oneRow(result: QueryResult, field: string): Record<string, unknown> {
  if (result.rows.length !== 1) {
    throw new Error(field + " must return exactly one row");
  }
  return record(result.rows[0], field);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(field + " must be a non-empty string");
  }
  return value;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(field + " must be boolean");
  return value;
}

function configuration(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
}) {
  const databaseUrl = input.databaseUrl.trim();
  const databaseOwnerId = input.databaseOwnerId.trim();
  const runtimeRole = input.runtimeRole.trim();
  if (!databaseUrl) throw new Error("databaseUrl is required");
  if (!UUID_PATTERN.test(databaseOwnerId)) {
    throw new Error("databaseOwnerId must be a UUID");
  }
  if (!ROLE_PATTERN.test(runtimeRole)) {
    throw new Error("runtimeRole is invalid");
  }
  return { databaseUrl, databaseOwnerId, runtimeRole };
}

function validateRollback(input: {
  ownerId: string;
  batchId: string;
  reason: string;
  idempotencyKey: string;
  requestedAt: string;
}) {
  const ownerId = input.ownerId.trim();
  const batchId = input.batchId.trim();
  const reason = input.reason.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (!ownerId) throw new Error("ownerId is required");
  if (!DATABASE_UUID_PATTERN.test(batchId)) {
    throw new Error("batchId must be a UUID");
  }
  if (
    reason.length < 10 ||
    reason.length > 500 ||
    CONTROL_CHARACTER_PATTERN.test(reason)
  ) {
    throw new Error(
      "reason must contain between 10 and 500 printable characters",
    );
  }
  if (
    idempotencyKey !== input.idempotencyKey ||
    !SAFE_IDENTIFIER_PATTERN.test(idempotencyKey)
  ) {
    throw new Error("idempotencyKey is invalid");
  }
  if (
    input.requestedAt.trim() === "" ||
    Number.isNaN(Date.parse(input.requestedAt))
  ) {
    throw new Error("requestedAt must be a timestamp");
  }
  return {
    ownerId,
    batchId,
    reason,
    idempotencyKey,
    requestedAt: input.requestedAt,
  };
}

function verifyIsolation(
  result: QueryResult,
  input: {
    databaseOwnerId: string;
    ownerId: string;
    runtimeRole: string;
  },
) {
  const row = oneRow(result, "dataset rollback isolation");
  if (
    text(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    text(row.authenticated_owner_id, "authenticated_owner_id") !== input.ownerId
  ) {
    throw new Error("Private Preview dataset rollback owner scope denied.");
  }
  if (
    !bool(row.rollback_rls, "rollback_rls") ||
    !bool(row.rollback_force_rls, "rollback_force_rls")
  ) {
    throw new Error(
      "Private Preview dataset rollback requires forced owner RLS.",
    );
  }
  if (
    !bool(
      row.runtime_can_read_rollback_receipts,
      "runtime_can_read_rollback_receipts",
    ) ||
    !bool(row.runtime_can_rollback, "runtime_can_rollback")
  ) {
    throw new Error(
      "Private Preview dataset rollback runtime privileges are incomplete.",
    );
  }
  if (
    text(row.session_user_name, "session_user_name") !== input.runtimeRole ||
    text(row.current_user_name, "current_user_name") !== input.runtimeRole ||
    bool(row.runtime_is_superuser, "runtime_is_superuser") ||
    bool(row.runtime_bypasses_rls, "runtime_bypasses_rls") ||
    bool(row.runtime_can_create_roles, "runtime_can_create_roles") ||
    bool(row.runtime_can_create_databases, "runtime_can_create_databases") ||
    bool(
      row.runtime_is_neon_superuser_member,
      "runtime_is_neon_superuser_member",
    )
  ) {
    throw new Error("Private Preview runtime role is not least privileged.");
  }
}

function normalizeRollback(row: Record<string, unknown>) {
  const status = text(row.status, "status");
  if (
    status === "not_found" ||
    status === "not_active" ||
    status === "no_prior_version"
  ) {
    return { status } as const;
  }
  if (status !== "restored") {
    throw new Error("dataset rollback status is unsupported");
  }
  const disposition = text(row.disposition, "disposition");
  if (disposition !== "created" && disposition !== "existing") {
    throw new Error("dataset rollback disposition is unsupported");
  }
  const rollbackId = text(row.rollback_id, "rollback_id");
  const sourceType = text(row.source_type, "source_type");
  const restoredBatchId = text(row.restored_batch_id, "restored_batch_id");
  const aggregateRefreshId = text(
    row.aggregate_refresh_id,
    "aggregate_refresh_id",
  );
  if (
    !DATABASE_UUID_PATTERN.test(rollbackId) ||
    !DATABASE_UUID_PATTERN.test(restoredBatchId) ||
    !DATABASE_UUID_PATTERN.test(aggregateRefreshId)
  ) {
    throw new Error("dataset rollback identifiers must be UUIDs");
  }
  if (!historicalImportSources.some((candidate) => candidate === sourceType)) {
    throw new Error("dataset rollback source type is unsupported");
  }
  return {
    status: "restored" as const,
    disposition,
    rollbackId,
    sourceType,
    restoredBatchId,
    aggregateRefreshId,
  };
}

async function transaction<Result>(input: {
  config: ReturnType<typeof configuration>;
  ownerId: string;
  sessionFactory: NeonImportPersistenceSessionFactory;
  operation: (client: NeonImportPersistenceClient) => Promise<Result>;
}): Promise<Result> {
  const session = await input.sessionFactory(input.config.databaseUrl);
  let begun = false;
  try {
    await session.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    begun = true;
    await session.client.query(SET_OWNER_SCOPE_SQL, [
      input.config.databaseOwnerId,
    ]);
    verifyIsolation(
      await session.client.query(VERIFY_ISOLATION_SQL, [
        input.config.databaseOwnerId,
        input.ownerId,
      ]),
      { ...input.config, ownerId: input.ownerId },
    );
    const result = await input.operation(session.client);
    await session.client.query("COMMIT");
    begun = false;
    return result;
  } catch (error) {
    if (begun) await session.client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await session.close();
  }
}

export function createNeonImportRollbackRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): ReadyImportRollbackRepository {
  const config = configuration(input);
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  return {
    status: "ready",
    rollbackActiveSourceVersion(rollbackInput) {
      const rollback = validateRollback(rollbackInput);
      return transaction({
        config,
        ownerId: rollback.ownerId,
        sessionFactory,
        operation: async (client) =>
          normalizeRollback(
            oneRow(
              await client.query(ROLLBACK_SQL, [
                config.databaseOwnerId,
                rollback.batchId,
                rollback.reason,
                rollback.idempotencyKey,
                rollback.requestedAt,
              ]),
              "dataset rollback",
            ),
          ),
      });
    },
  };
}

export function neonImportRollbackRepositoryFromEnvironment(
  environment: NeonImportRollbackEnvironment,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): ImportRollbackRepository {
  const databaseUrl = environment.databaseUrl?.trim();
  const databaseOwnerId = environment.databaseOwnerId?.trim();
  const runtimeRole = environment.runtimeRole?.trim();
  if (!databaseUrl || !databaseOwnerId || !runtimeRole) {
    return { status: "not_configured" };
  }
  return createNeonImportRollbackRepository({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
