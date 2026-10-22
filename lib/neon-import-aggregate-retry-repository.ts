import { createHash } from "node:crypto";
import type { AggregateRetryRepository } from "./import-aggregate-retry-action-service";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceClient,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

type QueryResult = Readonly<{ rows: readonly unknown[] }>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const PENDING_PREFIX = "retry_dispatch_pending:";
const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";
const VERIFY_ISOLATION_SQL = `
  SELECT owner.id::text AS database_owner_id,
    owner.clerk_user_id AS authenticated_owner_id,
    job.relrowsecurity AS job_rls,
    job.relforcerowsecurity AS job_force_rls,
    reservation.relrowsecurity AS reservation_rls,
    reservation.relforcerowsecurity AS reservation_force_rls,
    session_user::text AS session_user_name,
    current_user::text AS current_user_name,
    role.rolsuper AS runtime_is_superuser,
    role.rolbypassrls AS runtime_bypasses_rls
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_class job
    ON job.oid = 'dna.aggregate_refresh_job'::regclass
  JOIN pg_catalog.pg_class reservation
    ON reservation.oid = 'dna.import_operation_reservation'::regclass
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
`;
const FIND_REFRESH_SQL = `
  SELECT status, failure_code
  FROM dna.aggregate_refresh_job
  WHERE owner_id = $1::uuid AND id = $2::uuid
  LIMIT 1
`;
const LOCK_REFRESH_SQL = `
  SELECT status, failure_code
  FROM dna.aggregate_refresh_job
  WHERE owner_id = $1::uuid AND id = $2::uuid
  FOR UPDATE
`;
const RESERVE_OPERATION_SQL = `
  SELECT disposition, operation_id::text AS operation_id,
    request_fingerprint_sha256
  FROM dna.reserve_import_operation(
    $1::uuid, 'aggregate_refresh_retry', $2::text,
    $3::character(64), $4::timestamptz
  )
`;
const MARK_PENDING_SQL = `
  UPDATE dna.aggregate_refresh_job
  SET status = 'queued', started_at = NULL, completed_at = NULL,
    affected_record_count = NULL, failure_code = $3::text
  WHERE owner_id = $1::uuid AND id = $2::uuid AND status = 'failed'
`;
const MARK_QUEUED_SQL = `
  UPDATE dna.aggregate_refresh_job
  SET failure_code = NULL
  WHERE owner_id = $1::uuid AND id = $2::uuid
    AND status = 'queued' AND failure_code = $3::text
`;
const MARK_FAILED_SQL = `
  UPDATE dna.aggregate_refresh_job
  SET status = 'failed', started_at = coalesce(started_at, $4::timestamptz),
    completed_at = $4::timestamptz,
    failure_code = $5::text
  WHERE owner_id = $1::uuid AND id = $2::uuid
    AND failure_code = $3::text
`;

export type AggregateRetryDatabaseEnvironment = Readonly<{
  databaseUrl: string | undefined;
  databaseOwnerId: string | undefined;
  runtimeRole: string | undefined;
}>;

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be a database record`);
  }
  return value as Record<string, unknown>;
}

function oneRow(result: QueryResult, field: string): Record<string, unknown> {
  if (result.rows.length !== 1) {
    throw new Error(`${field} must return exactly one row`);
  }
  return record(result.rows[0], field);
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean`);
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
  if (databaseUrl === "") throw new Error("databaseUrl is required");
  if (!UUID_PATTERN.test(databaseOwnerId)) {
    throw new Error("databaseOwnerId must be a UUID");
  }
  if (!ROLE_PATTERN.test(runtimeRole))
    throw new Error("runtimeRole is invalid");
  return { databaseUrl, databaseOwnerId, runtimeRole };
}

function verifyIsolation(
  result: QueryResult,
  input: { databaseOwnerId: string; ownerId: string; runtimeRole: string },
): void {
  const row = oneRow(result, "aggregate retry owner isolation");
  if (
    string(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    string(row.authenticated_owner_id, "authenticated_owner_id") !==
      input.ownerId ||
    string(row.session_user_name, "session_user_name") !== input.runtimeRole ||
    string(row.current_user_name, "current_user_name") !== input.runtimeRole ||
    bool(row.runtime_is_superuser, "runtime_is_superuser") ||
    bool(row.runtime_bypasses_rls, "runtime_bypasses_rls") ||
    !bool(row.job_rls, "job_rls") ||
    !bool(row.job_force_rls, "job_force_rls") ||
    !bool(row.reservation_rls, "reservation_rls") ||
    !bool(row.reservation_force_rls, "reservation_force_rls")
  ) {
    throw new Error("Aggregate retry owner scope denied.");
  }
}

function fingerprint(input: {
  failedRefreshId: string;
  reason: string;
}): string {
  return createHash("sha256")
    .update(`${input.failedRefreshId}\n${input.reason}`, "utf8")
    .digest("hex");
}

function mappedStatus(
  status: string,
): "pending" | "running" | "completed" | "superseded" {
  if (status === "queued") return "pending";
  if (status === "running") return "running";
  if (status === "completed") return "completed";
  if (status === "rolled_back") return "superseded";
  throw new Error("aggregate refresh status is unsupported");
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

export function createNeonImportAggregateRetryRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): AggregateRetryRepository {
  const config = configuration(input);
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;
  const run = <Result>(
    ownerId: string,
    operation: (client: NeonImportPersistenceClient) => Promise<Result>,
  ) => transaction({ config, ownerId, sessionFactory, operation });

  return Object.freeze({
    reserveRetry(reservation) {
      return run(reservation.ownerId, async (client) => {
        const refreshResult = await client.query(FIND_REFRESH_SQL, [
          config.databaseOwnerId,
          reservation.failedRefreshId,
        ]);
        if (refreshResult.rows.length === 0) return { status: "not_found" };
        const refresh = oneRow(refreshResult, "aggregate refresh");
        const refreshStatus = string(refresh.status, "status");
        if (refreshStatus !== "failed") {
          return {
            status: "not_retryable" as const,
            refreshStatus: mappedStatus(refreshStatus),
          };
        }

        const lockedRefreshResult = await client.query(LOCK_REFRESH_SQL, [
          config.databaseOwnerId,
          reservation.failedRefreshId,
        ]);
        if (lockedRefreshResult.rows.length === 0) {
          return { status: "not_found" };
        }
        const lockedRefresh = oneRow(
          lockedRefreshResult,
          "locked aggregate refresh",
        );
        const lockedRefreshStatus = string(lockedRefresh.status, "status");
        if (lockedRefreshStatus !== "failed") {
          return {
            status: "not_retryable" as const,
            refreshStatus: mappedStatus(lockedRefreshStatus),
          };
        }

        const requestFingerprint = fingerprint(reservation);
        const operation = oneRow(
          await client.query(RESERVE_OPERATION_SQL, [
            config.databaseOwnerId,
            reservation.idempotencyKey,
            requestFingerprint,
            reservation.requestedAt,
          ]),
          "aggregate retry reservation",
        );
        if (
          string(
            operation.request_fingerprint_sha256,
            "request fingerprint",
          ) !== requestFingerprint
        ) {
          throw new Error("Aggregate retry idempotency conflict.");
        }
        const disposition = string(operation.disposition, "disposition");
        if (disposition !== "created" && disposition !== "existing") {
          throw new Error("Aggregate retry disposition is unsupported.");
        }
        const dispatchId = string(operation.operation_id, "operation_id");
        await client.query(MARK_PENDING_SQL, [
          config.databaseOwnerId,
          reservation.failedRefreshId,
          `${PENDING_PREFIX}${dispatchId}`,
        ]);
        return {
          status: "reserved" as const,
          refreshId: reservation.failedRefreshId,
          dispatchId,
          disposition,
          dispatchState: "pending" as const,
        };
      });
    },
    markDispatchQueued(mark) {
      return run(mark.ownerId, async (client) => {
        await client.query(MARK_QUEUED_SQL, [
          config.databaseOwnerId,
          mark.refreshId,
          `${PENDING_PREFIX}${mark.dispatchId}`,
        ]);
      });
    },
    markDispatchFailed(mark) {
      if (mark.reason !== "queue_unavailable") {
        throw new Error("Aggregate retry dispatch failure is unsupported.");
      }
      return run(mark.ownerId, async (client) => {
        await client.query(MARK_FAILED_SQL, [
          config.databaseOwnerId,
          mark.refreshId,
          `${PENDING_PREFIX}${mark.dispatchId}`,
          mark.failedAt,
          mark.reason,
        ]);
      });
    },
  });
}

export function neonImportAggregateRetryRepositoryFromEnvironment(
  environment: AggregateRetryDatabaseEnvironment,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): AggregateRetryRepository | null {
  const databaseUrl = environment.databaseUrl?.trim() ?? "";
  const databaseOwnerId = environment.databaseOwnerId?.trim() ?? "";
  const runtimeRole = environment.runtimeRole?.trim() ?? "";
  if (databaseUrl === "" || databaseOwnerId === "" || runtimeRole === "") {
    return null;
  }
  return createNeonImportAggregateRetryRepository({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
