import type {
  DnaPopulationRaceIndexAuthority,
  DnaPopulationRaceIndexCheckpoint,
  DnaPopulationRaceIndexGenerationRepository,
  DnaPopulationRaceIndexWriteBatch,
} from "./dna-population-race-index-generation";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;
const WORKER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;
type DbRow = Record<string, unknown>;

const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";
const VERIFY_ISOLATION_SQL = `
SELECT owner.id::text AS database_owner_id,
  owner.clerk_user_id AS authenticated_owner_id,
  bool_and(relation.relrowsecurity) AS all_rls_enabled,
  bool_and(relation.relforcerowsecurity) AS all_force_rls_enabled,
  bool_or(has_table_privilege(session_user, relation.oid,
    'SELECT,INSERT,UPDATE,DELETE')) AS runtime_can_access_tables,
  has_function_privilege(session_user,
    'dna.begin_dna_population_race_index_generation(uuid,text,jsonb,timestamp with time zone)',
    'EXECUTE') AS runtime_can_begin,
  has_function_privilege(session_user,
    'dna.append_dna_population_race_index_batch(uuid,text,jsonb,timestamp with time zone)',
    'EXECUTE') AS runtime_can_append,
  has_function_privilege(session_user,
    'dna.publish_dna_population_race_index_generation(uuid,text,text,timestamp with time zone)',
    'EXECUTE') AS runtime_can_publish,
  has_function_privilege(session_user,
    'dna.read_dna_population_race_index_generation(uuid,text)',
    'EXECUTE') AS runtime_can_read,
  session_user::text AS session_user_name,
  current_user::text AS current_user_name,
  role.rolsuper AS runtime_is_superuser,
  role.rolbypassrls AS runtime_bypasses_rls,
  role.rolcreaterole AS runtime_can_create_roles,
  role.rolcreatedb AS runtime_can_create_databases,
  has_database_privilege(session_user, current_database(), 'CREATE')
    AS runtime_can_create_in_database,
  has_schema_privilege(session_user, 'dna', 'CREATE')
    AS runtime_can_create_in_schema,
  COALESCE(pg_has_role(session_user, (
    SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'neon_superuser'
  ), 'MEMBER'), false) AS runtime_is_neon_superuser_member
FROM dna.app_owner owner
CROSS JOIN LATERAL unnest(ARRAY[
  'dna.dna_population_race_index_generation'::regclass,
  'dna.dna_population_race_index_batch_receipt'::regclass,
  'dna.dna_population_race_index_race'::regclass,
  'dna.dna_population_race_index_entrant'::regclass,
  'dna.dna_population_race_index_active'::regclass
]) target(oid)
JOIN pg_catalog.pg_class relation ON relation.oid = target.oid
JOIN pg_catalog.pg_roles role ON role.rolname = session_user
WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
GROUP BY owner.id, owner.clerk_user_id, role.rolsuper, role.rolbypassrls,
  role.rolcreaterole, role.rolcreatedb`;

function record(value: unknown, field: string): DbRow {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be a database record`);
  }
  return value as DbRow;
}

function oneRow(result: QueryResult, field: string): DbRow {
  if (result.rows.length !== 1) {
    throw new Error(`${field} must return exactly one row`);
  }
  return record(result.rows[0], field);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() !== value || value === "") {
    throw new Error(`${field} is invalid`);
  }
  return value;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean`);
  return value;
}

function uuid(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new Error(`${field} is invalid`);
  return normalized;
}

function sha256(value: unknown, field: string): string {
  const normalized = text(value, field);
  if (!SHA_256_PATTERN.test(normalized)) throw new Error(`${field} is invalid`);
  return normalized;
}

function timestamp(value: unknown, field: string): string {
  if (value === null) throw new Error(`${field} is invalid`);
  const parsed = value instanceof Date ? value : new Date(text(value, field));
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} is invalid`);
  return parsed.toISOString();
}

function optionalTimestamp(value: unknown, field: string): string | null {
  return value === null || value === undefined ? null : timestamp(value, field);
}

function count(value: unknown, field: string): number {
  const parsed =
    typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) < 0) {
    throw new Error(`${field} is invalid`);
  }
  return parsed as number;
}

function ownerId(value: string): string {
  if (
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 512 ||
    CONTROL_PATTERN.test(value)
  ) {
    throw new Error("ownerId is invalid");
  }
  return value;
}

function workerId(value: string): string {
  if (!WORKER_PATTERN.test(value)) throw new Error("workerId is invalid");
  return value;
}

function validateAuthority(
  authority: DnaPopulationRaceIndexAuthority,
): DnaPopulationRaceIndexAuthority {
  if (
    authority.version !== 1 ||
    sha256(authority.generationId, "generationId") !==
      sha256(authority.baselineCompletionSha256, "baselineCompletionSha256") ||
    count(
      authority.baselineLogicalRequestCount,
      "baselineLogicalRequestCount",
    ) < 1 ||
    count(authority.baselineRetainedR2Bytes, "baselineRetainedR2Bytes") < 1
  ) {
    throw new Error("population race index authority is invalid");
  }
  count(
    authority.baselineOmittedIdentityObservationCount,
    "baselineOmittedIdentityObservationCount",
  );
  return authority;
}

function validateBatch(batch: DnaPopulationRaceIndexWriteBatch): void {
  if (
    batch.version !== 1 ||
    batch.generationId !== sha256(batch.generationId, "generationId") ||
    batch.batchSha256 !== sha256(batch.batchSha256, "batchSha256") ||
    !Number.isSafeInteger(batch.afterRequestOrdinal) ||
    batch.afterRequestOrdinal < 0 ||
    !Number.isSafeInteger(batch.processedReceiptCount) ||
    batch.processedReceiptCount < 1 ||
    batch.processedReceiptCount > 100 ||
    batch.nextRequestOrdinal !==
      batch.afterRequestOrdinal + batch.processedReceiptCount + 1 ||
    batch.canonicalDocumentObservationCount !== batch.documents.length ||
    batch.documents.length > 5_000
  ) {
    throw new Error("population race index batch is invalid");
  }
}

function parseCheckpoint(row: DbRow): DnaPopulationRaceIndexCheckpoint {
  const state = text(row.state, "state");
  if (state !== "staging" && state !== "complete" && state !== "published") {
    throw new Error("population race index state is invalid");
  }
  const checkpoint: DnaPopulationRaceIndexCheckpoint = Object.freeze({
    version: count(row.version, "version") as 1,
    generationId: sha256(row.generation_id, "generationId"),
    baselineCompletionSha256: sha256(
      row.baseline_completion_sha256,
      "baselineCompletionSha256",
    ),
    baselineLogicalRequestCount: count(
      row.baseline_logical_request_count,
      "baselineLogicalRequestCount",
    ),
    baselineRetainedR2Bytes: count(
      row.baseline_retained_r2_bytes,
      "baselineRetainedR2Bytes",
    ),
    baselineOmittedIdentityObservationCount: count(
      row.baseline_omitted_identity_observation_count,
      "baselineOmittedIdentityObservationCount",
    ),
    state,
    lastRequestOrdinal: count(row.last_request_ordinal, "lastRequestOrdinal"),
    processedReceiptCount: count(
      row.processed_receipt_count,
      "processedReceiptCount",
    ),
    processedReceiptBytes: count(
      row.processed_receipt_bytes,
      "processedReceiptBytes",
    ),
    processedIdentityOmissionCount: count(
      row.processed_identity_omission_count,
      "processedIdentityOmissionCount",
    ),
    finishedRaceReceiptCount: count(
      row.finished_race_receipt_count,
      "finishedRaceReceiptCount",
    ),
    canonicalDocumentObservationCount: count(
      row.canonical_document_observation_count,
      "canonicalDocumentObservationCount",
    ),
    uniqueRaceCount: count(row.unique_race_count, "uniqueRaceCount"),
    uniqueEntrantCoreCount: count(
      row.unique_entrant_core_count,
      "uniqueEntrantCoreCount",
    ),
    updatedAt: timestamp(row.updated_at, "updatedAt"),
    completedAt: optionalTimestamp(row.completed_at, "completedAt"),
    publishedAt: optionalTimestamp(row.published_at, "publishedAt"),
  });
  if (
    checkpoint.version !== 1 ||
    checkpoint.generationId !== checkpoint.baselineCompletionSha256
  ) {
    throw new Error("population race index checkpoint authority drifted");
  }
  return checkpoint;
}

function verifyIsolation(
  result: QueryResult,
  input: { databaseOwnerId: string; ownerId: string; runtimeRole: string },
): void {
  const row = oneRow(result, "population race index isolation");
  if (
    text(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    text(row.authenticated_owner_id, "authenticated_owner_id") !==
      input.ownerId ||
    !bool(row.all_rls_enabled, "all_rls_enabled") ||
    !bool(row.all_force_rls_enabled, "all_force_rls_enabled") ||
    bool(row.runtime_can_access_tables, "runtime_can_access_tables") ||
    !bool(row.runtime_can_begin, "runtime_can_begin") ||
    !bool(row.runtime_can_append, "runtime_can_append") ||
    !bool(row.runtime_can_publish, "runtime_can_publish") ||
    !bool(row.runtime_can_read, "runtime_can_read") ||
    text(row.session_user_name, "session_user_name") !== input.runtimeRole ||
    text(row.current_user_name, "current_user_name") !== input.runtimeRole ||
    bool(row.runtime_is_superuser, "runtime_is_superuser") ||
    bool(row.runtime_bypasses_rls, "runtime_bypasses_rls") ||
    bool(row.runtime_can_create_roles, "runtime_can_create_roles") ||
    bool(row.runtime_can_create_databases, "runtime_can_create_databases") ||
    bool(
      row.runtime_can_create_in_database,
      "runtime_can_create_in_database",
    ) ||
    bool(row.runtime_can_create_in_schema, "runtime_can_create_in_schema") ||
    bool(
      row.runtime_is_neon_superuser_member,
      "runtime_is_neon_superuser_member",
    )
  ) {
    throw new Error(
      "population race index requires least-privilege owner isolation",
    );
  }
}

export function createNeonDnaPopulationRaceIndexGenerationRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  ownerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): DnaPopulationRaceIndexGenerationRepository {
  const databaseUrl = input.databaseUrl.trim();
  if (databaseUrl === "") throw new Error("databaseUrl is required");
  const databaseOwnerId = uuid(input.databaseOwnerId, "databaseOwnerId");
  const configuredOwnerId = ownerId(input.ownerId);
  if (!ROLE_PATTERN.test(input.runtimeRole))
    throw new Error("runtimeRole is invalid");
  const runtimeRole = input.runtimeRole;
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  async function transaction<T>(request: {
    ownerId: string;
    readOnly: boolean;
    run: (
      client: Awaited<ReturnType<typeof sessionFactory>>["client"],
    ) => Promise<T>;
  }): Promise<T> {
    if (ownerId(request.ownerId) !== configuredOwnerId) {
      throw new Error("population race index owner access denied");
    }
    const session = await sessionFactory(databaseUrl);
    let begun = false;
    try {
      await session.client.query(
        request.readOnly
          ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
          : "BEGIN ISOLATION LEVEL SERIALIZABLE",
      );
      begun = true;
      await session.client.query(SET_OWNER_SCOPE_SQL, [databaseOwnerId]);
      verifyIsolation(
        await session.client.query(VERIFY_ISOLATION_SQL, [
          databaseOwnerId,
          configuredOwnerId,
        ]),
        { databaseOwnerId, ownerId: configuredOwnerId, runtimeRole },
      );
      const result = await request.run(session.client);
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

  return Object.freeze({
    async begin(requestOwnerId, request) {
      const authority = validateAuthority(request.authority);
      return transaction({
        ownerId: requestOwnerId,
        readOnly: false,
        async run(client) {
          return parseCheckpoint(
            oneRow(
              await client.query(
                "SELECT * FROM dna.begin_dna_population_race_index_generation($1::uuid,$2::text,$3::jsonb,$4::timestamptz)",
                [
                  databaseOwnerId,
                  workerId(request.workerId),
                  JSON.stringify(authority),
                  timestamp(request.startedAt, "startedAt"),
                ],
              ),
              "population race index begin",
            ),
          );
        },
      });
    },

    async appendBatch(requestOwnerId, request) {
      validateBatch(request.batch);
      return transaction({
        ownerId: requestOwnerId,
        readOnly: false,
        async run(client) {
          return parseCheckpoint(
            oneRow(
              await client.query(
                "SELECT * FROM dna.append_dna_population_race_index_batch($1::uuid,$2::text,$3::jsonb,$4::timestamptz)",
                [
                  databaseOwnerId,
                  workerId(request.workerId),
                  JSON.stringify(request.batch),
                  timestamp(request.writtenAt, "writtenAt"),
                ],
              ),
              "population race index append",
            ),
          );
        },
      });
    },

    async publish(requestOwnerId, request) {
      return transaction({
        ownerId: requestOwnerId,
        readOnly: false,
        async run(client) {
          return parseCheckpoint(
            oneRow(
              await client.query(
                "SELECT * FROM dna.publish_dna_population_race_index_generation($1::uuid,$2::text,$3::text,$4::timestamptz)",
                [
                  databaseOwnerId,
                  workerId(request.workerId),
                  sha256(request.generationId, "generationId"),
                  timestamp(request.publishedAt, "publishedAt"),
                ],
              ),
              "population race index publication",
            ),
          );
        },
      });
    },

    async load(requestOwnerId, generationId) {
      return transaction({
        ownerId: requestOwnerId,
        readOnly: true,
        async run(client) {
          const result = await client.query(
            "SELECT * FROM dna.read_dna_population_race_index_generation($1::uuid,$2::text)",
            [databaseOwnerId, sha256(generationId, "generationId")],
          );
          return result.rows.length === 0
            ? null
            : parseCheckpoint(oneRow(result, "population race index read"));
        },
      });
    },
  });
}
