import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceClient,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";
import type {
  RaceArchiveAggregateRefreshPlanRepository,
  RaceArchiveAggregateRefreshPlanVersion,
} from "./race-archive-aggregate-refresher";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const SHA_PATTERN = /^[a-f0-9]{64}$/;
const OWNER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,511}$/;

const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";

const VERIFY_ISOLATION_SQL = `
  SELECT owner.id::text AS database_owner_id,
    owner.clerk_user_id AS authenticated_owner_id,
    processing.relrowsecurity AS processing_rls,
    processing.relforcerowsecurity AS processing_force_rls,
    has_function_privilege(session_user,
      'dna.list_race_archive_aggregate_refresh_versions(uuid,uuid,uuid,character,integer)',
      'EXECUTE') AS runtime_can_list_versions,
    has_function_privilege(session_user,
      'dna.pro_league_aggregate_refresh_target_source_type(uuid,uuid,uuid,character)',
      'EXECUTE') AS runtime_can_read_target_source,
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
  SELECT dna.pro_league_aggregate_refresh_target_source_type(
    $1::uuid, $2::uuid, $3::uuid, $4::character(64)
  ) AS source_type
`;

const LIST_SQL = `
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
`;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;
export type ProLeagueAggregateRefreshTargetSource =
  | "race_merge"
  | "core_details"
  | "current_arena";

export type NeonRaceArchiveAggregateRefreshPlanRepository =
  RaceArchiveAggregateRefreshPlanRepository &
    Readonly<{
      targetSourceType: (input: {
        ownerId: string;
        refreshId: string;
        updateSessionId: string;
        sourceVersionSetSha256: string;
      }) => Promise<ProLeagueAggregateRefreshTargetSource>;
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

function positiveCount(value: unknown, field: string, maximum: number): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
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
  const row = oneRow(result, "Race archive aggregate plan isolation");
  if (
    text(row.database_owner_id, "database_owner_id") !== input.databaseOwnerId ||
    text(row.authenticated_owner_id, "authenticated_owner_id") !== input.ownerId ||
    !bool(row.processing_rls, "processing_rls") ||
    !bool(row.processing_force_rls, "processing_force_rls") ||
    !bool(row.runtime_can_list_versions, "runtime_can_list_versions") ||
    !bool(row.runtime_can_read_target_source, "runtime_can_read_target_source") ||
    text(row.session_user_name, "session_user_name") !== input.runtimeRole ||
    text(row.current_user_name, "current_user_name") !== input.runtimeRole ||
    bool(row.runtime_is_superuser, "runtime_is_superuser") ||
    bool(row.runtime_bypasses_rls, "runtime_bypasses_rls") ||
    bool(row.runtime_can_create_roles, "runtime_can_create_roles") ||
    bool(row.runtime_can_create_databases, "runtime_can_create_databases") ||
    bool(row.runtime_is_neon_superuser_member, "runtime_is_neon_superuser_member")
  ) {
    throw new Error(
      "Race archive aggregate plan runtime is not least privileged.",
    );
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

function planVersion(value: unknown): RaceArchiveAggregateRefreshPlanVersion {
  const row = record(value, "Race archive aggregate plan version");
  return Object.freeze({
    datasetVersionId: uuid(
      text(row.dataset_version_id, "dataset_version_id"),
      "dataset_version_id",
    ),
    importBatchId: uuid(
      text(row.import_batch_id, "import_batch_id"),
      "import_batch_id",
    ),
    versionNumber: positiveCount(
      row.version_number,
      "version_number",
      1_000_000,
    ),
    sourceRowCount: positiveCount(
      row.source_row_count,
      "source_row_count",
      5_000_000,
    ),
    acceptedRowCount: positiveCount(
      row.accepted_row_count,
      "accepted_row_count",
      5_000_000,
    ),
    evidencePartitionCount: positiveCount(
      row.evidence_partition_count,
      "evidence_partition_count",
      10_000,
    ),
    evidenceRowCount: positiveCount(
      row.evidence_row_count,
      "evidence_row_count",
      5_000_000,
    ),
  });
}

export function createNeonRaceArchiveAggregateRefreshPlanRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): NeonRaceArchiveAggregateRefreshPlanRepository {
  const config = configuration(input);
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;
  const run = <Result>(
    ownerId: string,
    operation: (client: NeonImportPersistenceClient) => Promise<Result>,
  ) => transaction({ config, ownerId, sessionFactory, operation });

  return Object.freeze({
    targetSourceType(request) {
      const ownerId = owner(request.ownerId);
      const refreshId = uuid(request.refreshId, "refreshId");
      const updateSessionId = uuid(request.updateSessionId, "updateSessionId");
      const sourceVersionSetSha256 = sha(request.sourceVersionSetSha256);
      return run(ownerId, async (client) => {
        const row = oneRow(
          await client.query(TARGET_SOURCE_SQL, [
            config.databaseOwnerId,
            refreshId,
            updateSessionId,
            sourceVersionSetSha256,
          ]),
          "aggregate target source",
        );
        const sourceType = text(row.source_type, "source_type");
        if (
          sourceType !== "race_merge" &&
          sourceType !== "core_details" &&
          sourceType !== "current_arena"
        ) {
          throw new Error("aggregate target source is unsupported");
        }
        return sourceType;
      });
    },
    list(request) {
      const ownerId = owner(request.ownerId);
      const refreshId = uuid(request.refreshId, "refreshId");
      const updateSessionId = uuid(request.updateSessionId, "updateSessionId");
      const sourceVersionSetSha256 = sha(request.sourceVersionSetSha256);
      const maximumVersions = positiveCount(
        request.maximumVersions,
        "maximumVersions",
        10_000,
      );
      return run(ownerId, async (client) => {
        const result = await client.query(LIST_SQL, [
          config.databaseOwnerId,
          refreshId,
          updateSessionId,
          sourceVersionSetSha256,
          maximumVersions,
        ]);
        return Object.freeze(result.rows.map(planVersion));
      });
    },
  });
}
