import type {
  AggregateRefreshCapabilities,
  AggregateRefreshClaim,
  AggregateRefreshRepository,
  BoundedAggregateRefresher,
} from "./import-aggregate-refresh-service";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceClient,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

type QueryResult = Readonly<{ rows: readonly unknown[] }>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const SHA_PATTERN = /^[a-f0-9]{64}$/;
const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";

const VERIFY_ISOLATION_SQL = `
  SELECT owner.id::text AS database_owner_id,
    owner.clerk_user_id AS authenticated_owner_id,
    job.relrowsecurity AS job_rls,
    job.relforcerowsecurity AS job_force_rls,
    processing.relrowsecurity AS processing_rls,
    processing.relforcerowsecurity AS processing_force_rls,
    session_user::text AS session_user_name,
    current_user::text AS current_user_name,
    role.rolsuper AS runtime_is_superuser,
    role.rolbypassrls AS runtime_bypasses_rls,
    role.rolcreaterole AS runtime_can_create_roles,
    role.rolcreatedb AS runtime_can_create_databases,
    COALESCE(pg_has_role(session_user, (
      SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'neon_superuser'
    ), 'MEMBER'), false) AS runtime_is_neon_superuser_member
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_class job
    ON job.oid = 'dna.aggregate_refresh_job'::regclass
  JOIN pg_catalog.pg_class processing
    ON processing.oid = 'dna.aggregate_refresh_processing'::regclass
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid
    AND ($2::text IS NULL OR owner.clerk_user_id = $2)
`;

const CLAIM_SQL = `
  SELECT status, authenticated_owner_id,
    dataset_version_id::text AS dataset_version_id,
    source_version_set_sha256,
    CASE WHEN retry_after IS NULL THEN NULL ELSE to_char(
      retry_after AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ) END AS retry_after,
    aggregate_set_id::text AS aggregate_set_id
  FROM dna.claim_pro_league_aggregate_refresh(
    $1::uuid, $2::uuid, $3::text, $4::timestamptz, $5::timestamptz
  )
`;

const PREPARE_SQL = `
  SELECT prepared_aggregate_set_id::text AS prepared_aggregate_set_id,
    source_version_set_sha256, aggregate_family_count,
    materialized_row_count
  FROM dna.prepare_pro_league_aggregate_refresh(
    $1::uuid, $2::uuid, $3::uuid, $4::character(64)
  )
`;

const PUBLISH_SQL = `
  SELECT status, aggregate_set_id::text AS aggregate_set_id
  FROM dna.publish_pro_league_aggregate_refresh(
    $1::uuid, $2::uuid, $3::uuid, $4::text, $5::uuid,
    $6::character(64), $7::integer, $8::bigint, $9::timestamptz
  )
`;

const FAILURE_SQL = `
  SELECT dna.record_pro_league_aggregate_refresh_failure(
    $1::uuid, $2::uuid, $3::uuid, $4::text, $5::timestamptz, $6::text
  )
`;

export type ProLeagueAggregateRefreshEnvironment = Readonly<{
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

function sha(value: unknown, field: string): string {
  const result = string(value, field);
  if (!SHA_PATTERN.test(result)) throw new Error(`${field} is invalid`);
  return result;
}

function count(value: unknown, field: string): number {
  const result = typeof value === "string" ? Number(value) : value;
  if (
    typeof result !== "number" ||
    !Number.isSafeInteger(result) ||
    result < 0
  ) {
    throw new Error(`${field} is invalid`);
  }
  return result;
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
  if (!ROLE_PATTERN.test(runtimeRole))
    throw new Error("runtimeRole is invalid");
  return { databaseUrl, databaseOwnerId, runtimeRole };
}

function verifyIsolation(
  result: QueryResult,
  input: {
    databaseOwnerId: string;
    ownerId: string | null;
    runtimeRole: string;
  },
) {
  const row = oneRow(result, "owner isolation");
  if (
    string(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    (input.ownerId !== null &&
      string(row.authenticated_owner_id, "authenticated_owner_id") !==
        input.ownerId)
  ) {
    throw new Error("Private Preview aggregate owner scope denied.");
  }
  for (const field of [
    "job_rls",
    "job_force_rls",
    "processing_rls",
    "processing_force_rls",
  ]) {
    if (!bool(row[field], field)) {
      throw new Error("Private Preview aggregates require forced owner RLS.");
    }
  }
  if (
    string(row.session_user_name, "session_user_name") !== input.runtimeRole ||
    string(row.current_user_name, "current_user_name") !== input.runtimeRole ||
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

async function transaction<Result>(input: {
  config: ReturnType<typeof configuration>;
  ownerId: string | null;
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

function normalizeClaim(row: Record<string, unknown>): AggregateRefreshClaim {
  const status = string(row.status, "status");
  if (status === "not_found") return { status };
  if (status === "leased_elsewhere") {
    return { status, retryAfter: string(row.retry_after, "retry_after") };
  }
  if (status === "already_complete") {
    return {
      status,
      updateSessionId: string(row.dataset_version_id, "dataset_version_id"),
      aggregateSetId: string(row.aggregate_set_id, "aggregate_set_id"),
    };
  }
  if (status !== "claimed")
    throw new Error("aggregate claim status is unsupported");
  return {
    status,
    ownerId: string(row.authenticated_owner_id, "authenticated_owner_id"),
    updateSessionId: string(row.dataset_version_id, "dataset_version_id"),
    sourceVersionSetSha256: sha(
      row.source_version_set_sha256,
      "source_version_set_sha256",
    ),
  };
}

export function createNeonProLeagueAggregateRefreshCapabilities(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): AggregateRefreshCapabilities {
  const config = configuration(input);
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;
  const run = <Result>(
    ownerId: string | null,
    operation: (client: NeonImportPersistenceClient) => Promise<Result>,
  ) => transaction({ config, ownerId, sessionFactory, operation });

  const repository: AggregateRefreshRepository = {
    claimRefresh(input) {
      return run(null, async (client) =>
        normalizeClaim(
          oneRow(
            await client.query(CLAIM_SQL, [
              config.databaseOwnerId,
              input.refreshId,
              input.workerId,
              input.claimedAt,
              input.leaseExpiresAt,
            ]),
            "aggregate claim",
          ),
        ),
      );
    },
    publishPreparedAggregateSet(input) {
      return run(input.ownerId, async (client) => {
        const row = oneRow(
          await client.query(PUBLISH_SQL, [
            config.databaseOwnerId,
            input.refreshId,
            input.updateSessionId,
            input.workerId,
            input.preparedAggregateSetId,
            input.sourceVersionSetSha256,
            input.aggregateFamilyCount,
            input.materializedRowCount,
            input.completedAt,
          ]),
          "aggregate publication",
        );
        const status = string(row.status, "status");
        if (status === "superseded") return { status };
        if (status !== "published") {
          throw new Error("aggregate publication status is unsupported");
        }
        return {
          status,
          aggregateSetId: string(row.aggregate_set_id, "aggregate_set_id"),
        };
      });
    },
    recordRefreshFailure(input) {
      return run(input.ownerId, async (client) => {
        await client.query(FAILURE_SQL, [
          config.databaseOwnerId,
          input.refreshId,
          input.updateSessionId,
          input.workerId,
          input.failedAt,
          input.reason,
        ]);
      });
    },
  };

  const refresher: BoundedAggregateRefresher = {
    prepare(input) {
      return run(input.ownerId, async (client) => {
        const row = oneRow(
          await client.query(PREPARE_SQL, [
            config.databaseOwnerId,
            input.refreshId,
            input.updateSessionId,
            input.sourceVersionSetSha256,
          ]),
          "aggregate preparation",
        );
        return {
          preparedAggregateSetId: string(
            row.prepared_aggregate_set_id,
            "prepared_aggregate_set_id",
          ),
          sourceVersionSetSha256: sha(
            row.source_version_set_sha256,
            "source_version_set_sha256",
          ),
          aggregateFamilyCount: count(
            row.aggregate_family_count,
            "aggregate_family_count",
          ),
          materializedRowCount: count(
            row.materialized_row_count,
            "materialized_row_count",
          ),
        };
      });
    },
  };

  return { status: "ready", repository, refresher };
}

export function neonProLeagueAggregateRefreshCapabilitiesFromEnvironment(
  environment: ProLeagueAggregateRefreshEnvironment,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): AggregateRefreshCapabilities {
  const databaseUrl = environment.databaseUrl?.trim();
  const databaseOwnerId = environment.databaseOwnerId?.trim();
  const runtimeRole = environment.runtimeRole?.trim();
  if (!databaseUrl || !databaseOwnerId || !runtimeRole) {
    return { status: "not_configured" };
  }
  return createNeonProLeagueAggregateRefreshCapabilities({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
