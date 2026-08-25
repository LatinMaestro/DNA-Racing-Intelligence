import type {
  RaceArchiveAggregateRefreshPlanRepository,
  RaceArchiveAggregateRefreshPlanVersion,
} from "./race-archive-aggregate-refresher";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceClient,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const SHA_PATTERN = /^[a-f0-9]{64}$/;
const OWNER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";
const VERIFY_ISOLATION_SQL = `
  SELECT owner.id::text AS database_owner_id,
    owner.clerk_user_id AS authenticated_owner_id,
    processing.relrowsecurity AS processing_rls,
    processing.relforcerowsecurity AS processing_force_rls,
    has_function_privilege(session_user,
      'dna.pro_league_aggregate_refresh_target_source(uuid,uuid,uuid,character)',
      'EXECUTE') AS runtime_can_read_target_source,
    has_function_privilege(session_user,
      'dna.list_race_archive_aggregate_refresh_versions(uuid,uuid,uuid,character,integer)',
      'EXECUTE') AS runtime_can_list_archive_versions,
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
  JOIN pg_catalog.pg_class processing
    ON processing.oid = 'dna.aggregate_refresh_processing'::regclass
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid
    AND owner.clerk_user_id = $2::text
`;
const TARGET_SOURCE_SQL = `
  SELECT dna.pro_league_aggregate_refresh_target_source(
    $1::uuid, $2::uuid, $3::uuid, $4::character(64)
  ) AS source_type
`;
const LIST_VERSIONS_SQL = `
  SELECT dataset_version_id::text AS dataset_version_id,
    import_batch_id::text AS import_batch_id,
    version_number::text AS version_number,
    source_row_count::text AS source_row_count,
    accepted_row_count::text AS accepted_row_count,
    evidence_partition_count::text AS evidence_partition_count,
    evidence_row_count::text AS evidence_row_count
  FROM dna.list_race_archive_aggregate_refresh_versions(
    $1::uuid, $2::uuid, $3::uuid, $4::character(64), $5::integer
  )
  ORDER BY version_number, dataset_version_id
`;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;
export type AggregateRefreshTargetSource =
  | "race_merge"
  | "core_details"
  | "current_arena";

export type RaceArchiveAggregateRefreshControl = Readonly<{
  targetSource: (input: {
    ownerId: string;
    refreshId: string;
    updateSessionId: string;
    sourceVersionSetSha256: string;
  }) => Promise<AggregateRefreshTargetSource>;
  planRepository: RaceArchiveAggregateRefreshPlanRepository;
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

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean`);
  return value;
}

function uuid(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new Error(`${field} must be a UUID`);
  return normalized;
}

function owner(value: string): string {
  const normalized = value.trim();
  if (!OWNER_PATTERN.test(normalized)) throw new Error("ownerId is invalid");
  return normalized;
}

function sha(value: string): string {
  const normalized = value.trim();
  if (!SHA_PATTERN.test(normalized)) {
    throw new Error("sourceVersionSetSha256 is invalid");
  }
  return normalized;
}

function count(value: unknown, field: string, maximum: number): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new Error(`${field} is invalid`);
  }
  return parsed;
}

function configuration(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
}) {
  const databaseUrl = input.databaseUrl.trim();
  const databaseOwnerId = uuid(input.databaseOwnerId, "databaseOwnerId");
  const runtimeRole = input.runtimeRole.trim();
  if (!databaseUrl) throw new Error("databaseUrl is required");
  if (!ROLE_PATTERN.test(runtimeRole)) throw new Error("runtimeRole is invalid");
  return { databaseUrl, databaseOwnerId, runtimeRole };
}

function verifyIsolation(
  result: QueryResult,
  input: { databaseOwnerId: string; ownerId: string; runtimeRole: string },
): void {
  const row = oneRow(result, "Race archive aggregate refresh control isolation");
  if (
    text(row.database_owner_id, "database_owner_id") !== input.databaseOwnerId ||
    text(row.authenticated_owner_id, "authenticated_owner_id") !== input.ownerId
  ) {
    throw new Error("Race archive aggregate refresh control owner scope denied.");
  }
  if (!bool(row.processing_rls, "processing_rls") || !bool(row.processing_force_rls, "processing_force_rls")) {
    throw new Error("Race archive aggregate refresh control requires forced owner RLS.");
  }
  if (!bool(row.runtime_can_read_target_source, "runtime_can_read_target_source") || !bool(row.runtime_can_list_archive_versions, "runtime_can_list_archive_versions")) {
    throw new Error("Race archive aggregate refresh control function access is incomplete.");
  }
  if (
    text(row.session_user_name, "session_user_name") !== input.runtimeRole ||
    text(row.current_user_name, "current_user_name") !== input.runtimeRole ||
    bool(row.runtime_is_superuser, "runtime_is_superuser") ||
    bool(row.runtime_bypasses_rls, "runtime_bypasses_rls") ||
    bool(row.runtime_can_create_roles, "runtime_can_create_roles") ||
    bool(row.runtime_can_create_databases, "runtime_can_create_databases") ||
    bool(row.runtime_is_neon_superuser_member, "runtime_is_neon_superuser_member")
  ) {
    throw new Error("Race archive aggregate refresh control runtime is not least privileged.");
  }
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
    await session.client.query(SET_OWNER_SCOPE_SQL, [input.config.databaseOwnerId]);
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

function source(value: unknown): AggregateRefreshTargetSource {
  const result = text(value, "source_type");
  if (result !== "race_merge" && result !== "core_details" && result !== "current_arena") {
    throw new Error("aggregate refresh target source is unsupported");
  }
  return result;
}

function planRow(value: unknown): RaceArchiveAggregateRefreshPlanVersion {
  const row = record(value, "Race archive aggregate refresh plan row");
  return Object.freeze({
    datasetVersionId: uuid(text(row.dataset_version_id, "dataset_version_id"), "dataset_version_id"),
    importBatchId: uuid(text(row.import_batch_id, "import_batch_id"), "import_batch_id"),
    versionNumber: count(row.version_number, "version_number", 1_000_000),
    sourceRowCount: count(row.source_row_count, "source_row_count", 5_000_000),
    acceptedRowCount: count(row.accepted_row_count, "accepted_row_count", 5_000_000),
    evidencePartitionCount: count(row.evidence_partition_count, "evidence_partition_count", 10_000),
    evidenceRowCount: count(row.evidence_row_count, "evidence_row_count", 5_000_000),
  });
}

export function createNeonRaceArchiveAggregateRefreshControl(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): RaceArchiveAggregateRefreshControl {
  const config = configuration(input);
  const sessionFactory = input.sessionFactory ?? createDefaultNeonImportPersistenceSession;
  const run = <Result>(ownerId: string, operation: (client: NeonImportPersistenceClient) => Promise<Result>) =>
    transaction({ config, ownerId, sessionFactory, operation });

  const targetSource: RaceArchiveAggregateRefreshControl["targetSource"] = (input) => {
    const ownerId = owner(input.ownerId);
    const refreshId = uuid(input.refreshId, "refreshId");
    const updateSessionId = uuid(input.updateSessionId, "updateSessionId");
    const sourceVersionSetSha256 = sha(input.sourceVersionSetSha256);
    return run(ownerId, async (client) =>
      source(
        oneRow(
          await client.query(TARGET_SOURCE_SQL, [
            config.databaseOwnerId,
            refreshId,
            updateSessionId,
            sourceVersionSetSha256,
          ]),
          "aggregate refresh target source",
        ).source_type,
      ),
    );
  };

  const planRepository: RaceArchiveAggregateRefreshPlanRepository = Object.freeze({
    list(input) {
      const ownerId = owner(input.ownerId);
      const refreshId = uuid(input.refreshId, "refreshId");
      const updateSessionId = uuid(input.updateSessionId, "updateSessionId");
      const sourceVersionSetSha256 = sha(input.sourceVersionSetSha256);
      if (!Number.isSafeInteger(input.maximumVersions) || input.maximumVersions < 1 || input.maximumVersions > 10_000) {
        throw new Error("maximumVersions is invalid");
      }
      return run(ownerId, async (client) => {
        const result = await client.query(LIST_VERSIONS_SQL, [
          config.databaseOwnerId,
          refreshId,
          updateSessionId,
          sourceVersionSetSha256,
          input.maximumVersions,
        ]);
        if (result.rows.length < 1 || result.rows.length > input.maximumVersions) {
          throw new Error("Race archive aggregate refresh plan row count is invalid");
        }
        return Object.freeze(result.rows.map(planRow));
      });
    },
  });

  return Object.freeze({ targetSource, planRepository });
}
