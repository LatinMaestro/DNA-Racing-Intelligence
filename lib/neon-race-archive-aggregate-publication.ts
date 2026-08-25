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
const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const FAMILY_NAMES = new Set([
  "core_performance",
  "discovery_benchmark",
  "payout_format",
  "core_star_profile",
]);

const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";

const VERIFY_ISOLATION_SQL = `
  SELECT owner.id::text AS database_owner_id,
    owner.clerk_user_id AS authenticated_owner_id,
    stage.relrowsecurity AS stage_rls,
    stage.relforcerowsecurity AS stage_force_rls,
    stage_row.relrowsecurity AS stage_row_rls,
    stage_row.relforcerowsecurity AS stage_row_force_rls,
    receipt.relrowsecurity AS receipt_rls,
    receipt.relforcerowsecurity AS receipt_force_rls,
    has_table_privilege(session_user,
      'dna.race_archive_aggregate_publication_stage', 'SELECT,INSERT,UPDATE,DELETE')
      AS runtime_can_access_stage_table,
    has_table_privilege(session_user,
      'dna.race_archive_aggregate_publication_stage_row', 'SELECT,INSERT,UPDATE,DELETE')
      AS runtime_can_access_stage_row_table,
    has_table_privilege(session_user,
      'dna.race_archive_aggregate_publication_receipt', 'SELECT,INSERT,UPDATE,DELETE')
      AS runtime_can_access_receipt_table,
    has_function_privilege(session_user,
      'dna.begin_race_archive_aggregate_publication(uuid,uuid,uuid,text,character,timestamp with time zone)',
      'EXECUTE') AS runtime_can_begin,
    has_function_privilege(session_user,
      'dna.stage_race_archive_aggregate_rows(uuid,uuid,text,text,integer,jsonb)',
      'EXECUTE') AS runtime_can_stage,
    has_function_privilege(session_user,
      'dna.publish_race_archive_aggregates(uuid,uuid,text,character,bigint,bigint,bigint,bigint,bigint,bigint,timestamp with time zone)',
      'EXECUTE') AS runtime_can_publish,
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
  JOIN pg_catalog.pg_class stage
    ON stage.oid = 'dna.race_archive_aggregate_publication_stage'::regclass
  JOIN pg_catalog.pg_class stage_row
    ON stage_row.oid = 'dna.race_archive_aggregate_publication_stage_row'::regclass
  JOIN pg_catalog.pg_class receipt
    ON receipt.oid = 'dna.race_archive_aggregate_publication_receipt'::regclass
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid
    AND owner.clerk_user_id = $2::text
`;

const BEGIN_SQL = `
  SELECT dna.begin_race_archive_aggregate_publication(
    $1::uuid, $2::uuid, $3::uuid, $4::text,
    $5::character(64), $6::timestamptz
  ) AS status
`;

const STAGE_SQL = `
  SELECT dna.stage_race_archive_aggregate_rows(
    $1::uuid, $2::uuid, $3::text, $4::text, $5::integer, $6::jsonb
  ) AS staged_row_count
`;

const PUBLISH_SQL = `
  SELECT status, materialized_row_count::text AS materialized_row_count
  FROM dna.publish_race_archive_aggregates(
    $1::uuid, $2::uuid, $3::text, $4::character(64),
    $5::bigint, $6::bigint, $7::bigint, $8::bigint,
    $9::bigint, $10::bigint, $11::timestamptz
  )
`;

export type RaceArchiveAggregateFamily =
  | "core_performance"
  | "discovery_benchmark"
  | "payout_format"
  | "core_star_profile";

export type NeonRaceArchiveAggregatePublicationRepository = Readonly<{
  begin: (input: {
    ownerId: string;
    refreshId: string;
    raceDatasetVersionId: string;
    workerId: string;
    sourceVersionSetSha256: string;
    refreshedAt: string;
  }) => Promise<"staging" | "published">;
  stageRows: (input: {
    ownerId: string;
    refreshId: string;
    workerId: string;
    family: RaceArchiveAggregateFamily;
    startOrdinal: number;
    rows: readonly Readonly<Record<string, unknown>>[];
  }) => Promise<number>;
  publish: (input: {
    ownerId: string;
    refreshId: string;
    workerId: string;
    payloadSha256: string;
    validatedEventCount: number;
    acceptedFormatEntryCount: number;
    corePerformanceProfileCount: number;
    discoveryBenchmarkCount: number;
    payoutFormatProfileCount: number;
    coreStarProfileCount: number;
    completedAt: string;
  }) => Promise<
    Readonly<{
      status: "published" | "existing";
      materializedRowCount: number;
    }>
  >;
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
  if (!UUID_PATTERN.test(normalized))
    throw new Error(`${field} must be a UUID`);
  return normalized;
}

function sha(value: string, field: string): string {
  const normalized = value.trim();
  if (!SHA_PATTERN.test(normalized)) throw new Error(`${field} is invalid`);
  return normalized;
}

function identifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function timestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} is invalid`);
  return parsed.toISOString();
}

function count(
  value: unknown,
  field: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
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

function owner(value: string): string {
  const normalized = value.trim();
  if (normalized === "" || normalized.length > 512) {
    throw new Error("ownerId is invalid");
  }
  return normalized;
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
  if (!ROLE_PATTERN.test(runtimeRole))
    throw new Error("runtimeRole is invalid");
  return { databaseUrl, databaseOwnerId, runtimeRole };
}

function verifyIsolation(
  result: QueryResult,
  input: { databaseOwnerId: string; ownerId: string; runtimeRole: string },
): void {
  const row = oneRow(result, "Race archive aggregate publication isolation");
  if (
    text(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    text(row.authenticated_owner_id, "authenticated_owner_id") !== input.ownerId
  ) {
    throw new Error("Race archive aggregate publication owner scope denied.");
  }
  for (const field of [
    "stage_rls",
    "stage_force_rls",
    "stage_row_rls",
    "stage_row_force_rls",
    "receipt_rls",
    "receipt_force_rls",
  ]) {
    if (!bool(row[field], field)) {
      throw new Error(
        "Race archive aggregate publication requires forced owner RLS.",
      );
    }
  }
  for (const field of [
    "runtime_can_access_stage_table",
    "runtime_can_access_stage_row_table",
    "runtime_can_access_receipt_table",
  ]) {
    if (bool(row[field], field)) {
      throw new Error(
        "Race archive aggregate publication table access is not bounded.",
      );
    }
  }
  for (const field of [
    "runtime_can_begin",
    "runtime_can_stage",
    "runtime_can_publish",
  ]) {
    if (!bool(row[field], field)) {
      throw new Error(
        "Race archive aggregate publication function access is incomplete.",
      );
    }
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
    throw new Error(
      "Race archive aggregate publication runtime is not least privileged.",
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

export function createNeonRaceArchiveAggregatePublicationRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): NeonRaceArchiveAggregatePublicationRepository {
  const config = configuration(input);
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;
  const run = <Result>(
    ownerId: string,
    operation: (client: NeonImportPersistenceClient) => Promise<Result>,
  ) => transaction({ config, ownerId, sessionFactory, operation });

  return Object.freeze({
    begin(input) {
      const ownerId = owner(input.ownerId);
      const refreshId = uuid(input.refreshId, "refreshId");
      const raceDatasetVersionId = uuid(
        input.raceDatasetVersionId,
        "raceDatasetVersionId",
      );
      const workerId = identifier(input.workerId, "workerId");
      const sourceVersionSetSha256 = sha(
        input.sourceVersionSetSha256,
        "sourceVersionSetSha256",
      );
      const refreshedAt = timestamp(input.refreshedAt, "refreshedAt");
      return run(ownerId, async (client) => {
        const row = oneRow(
          await client.query(BEGIN_SQL, [
            config.databaseOwnerId,
            refreshId,
            raceDatasetVersionId,
            workerId,
            sourceVersionSetSha256,
            refreshedAt,
          ]),
          "Race archive aggregate publication begin",
        );
        const status = text(row.status, "status");
        if (status !== "staging" && status !== "published") {
          throw new Error(
            "Race archive aggregate publication begin status is invalid",
          );
        }
        return status;
      });
    },
    async stageRows(input) {
      const ownerId = owner(input.ownerId);
      const refreshId = uuid(input.refreshId, "refreshId");
      const workerId = identifier(input.workerId, "workerId");
      if (!FAMILY_NAMES.has(input.family)) {
        throw new Error("family is invalid");
      }
      if (
        !Number.isSafeInteger(input.startOrdinal) ||
        input.startOrdinal < 0 ||
        input.rows.length < 1 ||
        input.rows.length > 2_000 ||
        input.startOrdinal + input.rows.length - 1 > 4_999_999
      ) {
        throw new Error(
          "Race archive aggregate staged row chunk is outside its bound",
        );
      }
      const rows = input.rows.map((rowValue) => {
        if (
          typeof rowValue !== "object" ||
          rowValue === null ||
          Array.isArray(rowValue)
        ) {
          throw new Error("Race archive aggregate staged rows must be objects");
        }
        return rowValue;
      });
      return run(ownerId, async (client) => {
        const row = oneRow(
          await client.query(STAGE_SQL, [
            config.databaseOwnerId,
            refreshId,
            workerId,
            input.family,
            input.startOrdinal,
            JSON.stringify(rows),
          ]),
          "Race archive aggregate row staging",
        );
        const stagedRowCount = count(
          row.staged_row_count,
          "staged_row_count",
          2_000,
        );
        if (stagedRowCount !== rows.length) {
          throw new Error("Race archive aggregate staged row count changed");
        }
        return stagedRowCount;
      });
    },
    publish(input) {
      const ownerId = owner(input.ownerId);
      const refreshId = uuid(input.refreshId, "refreshId");
      const workerId = identifier(input.workerId, "workerId");
      const payloadSha256 = sha(input.payloadSha256, "payloadSha256");
      const counts = {
        validatedEventCount: count(
          input.validatedEventCount,
          "validatedEventCount",
          1_000_000,
        ),
        acceptedFormatEntryCount: count(
          input.acceptedFormatEntryCount,
          "acceptedFormatEntryCount",
          5_000_000,
        ),
        corePerformanceProfileCount: count(
          input.corePerformanceProfileCount,
          "corePerformanceProfileCount",
          500_000,
        ),
        discoveryBenchmarkCount: count(
          input.discoveryBenchmarkCount,
          "discoveryBenchmarkCount",
          100_000,
        ),
        payoutFormatProfileCount: count(
          input.payoutFormatProfileCount,
          "payoutFormatProfileCount",
          500_000,
        ),
        coreStarProfileCount: count(
          input.coreStarProfileCount,
          "coreStarProfileCount",
          500_000,
        ),
      };
      if (counts.acceptedFormatEntryCount < counts.payoutFormatProfileCount) {
        throw new Error("acceptedFormatEntryCount is inconsistent");
      }
      const completedAt = timestamp(input.completedAt, "completedAt");
      return run(ownerId, async (client) => {
        const row = oneRow(
          await client.query(PUBLISH_SQL, [
            config.databaseOwnerId,
            refreshId,
            workerId,
            payloadSha256,
            counts.validatedEventCount,
            counts.acceptedFormatEntryCount,
            counts.corePerformanceProfileCount,
            counts.discoveryBenchmarkCount,
            counts.payoutFormatProfileCount,
            counts.coreStarProfileCount,
            completedAt,
          ]),
          "Race archive aggregate publication",
        );
        const status = text(row.status, "status");
        if (status !== "published" && status !== "existing") {
          throw new Error(
            "Race archive aggregate publication status is invalid",
          );
        }
        return Object.freeze({
          status,
          materializedRowCount: count(
            row.materialized_row_count,
            "materialized_row_count",
          ),
        });
      });
    },
  });
}
