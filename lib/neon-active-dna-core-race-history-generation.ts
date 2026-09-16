import {
  DNA_CORE_RACE_HISTORY_GENERATION_MAXIMUM_OBSERVATIONS,
  type DnaCoreRaceHistoryPublishedGeneration,
} from "@/lib/dna-core-race-history-generation";
import type { DnaCoreRaceHistoryJoinedObservation } from "@/lib/dna-core-race-history-materialization";
import { dnaOpenLabRawEvidenceSha256 } from "@/lib/dna-open-lab-v1-adapters";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";
const READ_GENERATION_SQL =
  "SELECT * FROM dna.read_active_dna_core_race_history_generation($1::uuid)";
const READ_ROWS_SQL =
  "SELECT * FROM dna.read_active_dna_core_race_history_generation_rows($1::uuid,$2::integer,$3::integer)";
const VERIFY_ISOLATION_SQL = `
SELECT owner.id::text AS database_owner_id,
  owner.clerk_user_id AS authenticated_owner_id,
  bool_and(relation.relrowsecurity) AS all_rls_enabled,
  bool_and(relation.relforcerowsecurity) AS all_force_rls_enabled,
  bool_or(has_table_privilege(session_user, relation.oid,
    'SELECT,INSERT,UPDATE,DELETE')) AS runtime_can_access_tables,
  has_function_privilege(session_user,
    'dna.read_active_dna_core_race_history_generation(uuid)',
    'EXECUTE') AS runtime_can_read_generation,
  has_function_privilege(session_user,
    'dna.read_active_dna_core_race_history_generation_rows(uuid,integer,integer)',
    'EXECUTE') AS runtime_can_read_rows,
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
  'dna.dna_core_race_history_generation'::regclass,
  'dna.dna_core_race_history_generation_row'::regclass,
  'dna.dna_core_race_history_generation_active'::regclass
]) target(oid)
JOIN pg_catalog.pg_class relation ON relation.oid = target.oid
JOIN pg_catalog.pg_roles role ON role.rolname = session_user
WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
GROUP BY owner.id, owner.clerk_user_id, role.rolsuper, role.rolbypassrls,
  role.rolcreaterole, role.rolcreatedb`;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;
type DbRow = Readonly<Record<string, unknown>>;

export type ActiveDnaCoreRaceHistoryGenerationRow = Readonly<{
  generationId: string;
  ordinal: number;
  naturalKey: string;
  rowSha256: string;
  payload: DnaCoreRaceHistoryJoinedObservation;
}>;

export type ActiveDnaCoreRaceHistoryGenerationReadRepository = Readonly<{
  readActiveGeneration(
    ownerId: string,
  ): Promise<DnaCoreRaceHistoryPublishedGeneration | null>;
  readActiveRows(
    ownerId: string,
    afterOrdinal: number,
    limit: number,
  ): Promise<readonly ActiveDnaCoreRaceHistoryGenerationRow[]>;
}>;

function record(value: unknown, field: string): DbRow {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be a database record`);
  }
  return value as DbRow;
}

function text(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    CONTROL_PATTERN.test(value)
  ) {
    throw new Error(`${field} is invalid`);
  }
  return value;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean`);
  return value;
}

function count(value: unknown, field: string): number {
  const parsed =
    typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (
    !Number.isSafeInteger(parsed) ||
    (parsed as number) < 0 ||
    (parsed as number) > DNA_CORE_RACE_HISTORY_GENERATION_MAXIMUM_OBSERVATIONS
  ) {
    throw new Error(`${field} is invalid`);
  }
  return parsed as number;
}

function timestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(text(value, field));
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} is invalid`);
  return parsed.toISOString();
}

function sha256(value: unknown, field: string): string {
  const normalized = text(value, field);
  if (!SHA_256_PATTERN.test(normalized)) throw new Error(`${field} is invalid`);
  return normalized;
}

function uuid(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new Error(`${field} is invalid`);
  return normalized;
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

function payload(value: unknown): DnaCoreRaceHistoryJoinedObservation {
  const parsed =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  const row = record(parsed, "Core history active payload");
  if (
    row.sourceType !== "joined_core_race_history_result" ||
    row.distanceAuthority !== "result_and_race_document" ||
    (row.mode !== "bike" && row.mode !== "car" && row.mode !== "horse") ||
    (row.publishedCellStatus !== "accepted" &&
      row.publishedCellStatus !== "missing_format" &&
      row.publishedCellStatus !== "unsupported_format" &&
      row.publishedCellStatus !== "unpublished_cell")
  ) {
    throw new Error("Core history active payload authority is invalid");
  }
  return row as DnaCoreRaceHistoryJoinedObservation;
}

function parseGeneration(row: DbRow): DnaCoreRaceHistoryPublishedGeneration {
  const value = Object.freeze({
    version: count(row.version, "version") as 1,
    generationId: sha256(row.generation_id, "generationId"),
    materializedAt: timestamp(row.materialized_at, "materializedAt"),
    cycleSetSha256: sha256(row.cycle_set_sha256, "cycleSetSha256"),
    observationSetSha256: sha256(
      row.observation_set_sha256,
      "observationSetSha256",
    ),
    payloadSha256: sha256(row.payload_sha256, "payloadSha256"),
    inputCycleCount: count(row.input_cycle_count, "inputCycleCount"),
    inputPageCount: count(row.input_page_count, "inputPageCount"),
    inputResultCount: count(row.input_result_count, "inputResultCount"),
    replayDuplicateCount: count(
      row.replay_duplicate_count,
      "replayDuplicateCount",
    ),
    raceDocumentCount: count(row.race_document_count, "raceDocumentCount"),
    entrantAuthorityOmissionCount: count(
      row.entrant_authority_omission_count,
      "entrantAuthorityOmissionCount",
    ),
    entrantMismatchOmissionCount: count(
      row.entrant_mismatch_omission_count,
      "entrantMismatchOmissionCount",
    ),
    exactDistanceConfirmedCount: count(
      row.exact_distance_confirmed_count,
      "exactDistanceConfirmedCount",
    ),
    acceptedPublishedCellCount: count(
      row.accepted_published_cell_count,
      "acceptedPublishedCellCount",
    ),
    missingFormatCount: count(row.missing_format_count, "missingFormatCount"),
    unsupportedFormatCount: count(
      row.unsupported_format_count,
      "unsupportedFormatCount",
    ),
    unpublishedCellCount: count(
      row.unpublished_cell_count,
      "unpublishedCellCount",
    ),
    observationCount: count(row.observation_count, "observationCount"),
    state: text(row.state, "state") as "published",
    publishedAt: timestamp(row.published_at, "publishedAt"),
  });
  if (
    value.version !== 1 ||
    value.state !== "published" ||
    value.inputCycleCount < 1 ||
    value.inputPageCount < 1 ||
    Date.parse(value.publishedAt) < Date.parse(value.materializedAt) ||
    value.exactDistanceConfirmedCount !== value.observationCount ||
    value.acceptedPublishedCellCount +
      value.missingFormatCount +
      value.unsupportedFormatCount +
      value.unpublishedCellCount !==
      value.observationCount ||
    value.inputResultCount !==
      value.observationCount +
        value.replayDuplicateCount +
        value.entrantAuthorityOmissionCount +
        value.entrantMismatchOmissionCount
  ) {
    throw new Error("Core history active generation authority is invalid");
  }
  return value;
}

function verifyIsolation(
  result: QueryResult,
  input: { databaseOwnerId: string; ownerId: string; runtimeRole: string },
): void {
  if (result.rows.length !== 1) {
    throw new Error("Core history active read isolation is unavailable");
  }
  const row = record(result.rows[0], "Core history active read isolation");
  if (
    text(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    text(row.authenticated_owner_id, "authenticated_owner_id") !==
      input.ownerId ||
    !bool(row.all_rls_enabled, "all_rls_enabled") ||
    !bool(row.all_force_rls_enabled, "all_force_rls_enabled") ||
    bool(row.runtime_can_access_tables, "runtime_can_access_tables") ||
    !bool(row.runtime_can_read_generation, "runtime_can_read_generation") ||
    !bool(row.runtime_can_read_rows, "runtime_can_read_rows") ||
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
      "Core history active read requires least-privilege owner isolation",
    );
  }
}

export function createNeonActiveDnaCoreRaceHistoryGenerationReadRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  ownerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): ActiveDnaCoreRaceHistoryGenerationReadRepository {
  const databaseUrl = input.databaseUrl.trim();
  if (databaseUrl === "") throw new Error("databaseUrl is required");
  const databaseOwnerId = uuid(input.databaseOwnerId, "databaseOwnerId");
  const configuredOwnerId = ownerId(input.ownerId);
  if (!ROLE_PATTERN.test(input.runtimeRole))
    throw new Error("runtimeRole is invalid");
  const runtimeRole = input.runtimeRole;
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  async function transaction<T>(
    requestOwnerId: string,
    run: (
      client: Awaited<ReturnType<typeof sessionFactory>>["client"],
    ) => Promise<T>,
  ): Promise<T> {
    if (ownerId(requestOwnerId) !== configuredOwnerId) {
      throw new Error("Core history active read owner access denied");
    }
    const session = await sessionFactory(databaseUrl);
    let begun = false;
    try {
      await session.client.query(
        "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
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
      const value = await run(session.client);
      await session.client.query("COMMIT");
      begun = false;
      return value;
    } catch (error) {
      if (begun) await session.client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await session.close();
    }
  }

  return Object.freeze({
    readActiveGeneration(requestOwnerId) {
      return transaction(requestOwnerId, async (client) => {
        const result = await client.query(READ_GENERATION_SQL, [
          databaseOwnerId,
        ]);
        if (result.rows.length > 1) {
          throw new Error("Core history active generation is ambiguous");
        }
        return result.rows.length === 0
          ? null
          : parseGeneration(
              record(result.rows[0], "Core history active generation"),
            );
      });
    },
    readActiveRows(requestOwnerId, afterOrdinal, limit) {
      if (
        !Number.isSafeInteger(afterOrdinal) ||
        afterOrdinal < -1 ||
        afterOrdinal > 499_999 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 250
      ) {
        throw new Error("Core history active row read bound is invalid");
      }
      return transaction(requestOwnerId, async (client) => {
        const result = await client.query(READ_ROWS_SQL, [
          databaseOwnerId,
          afterOrdinal,
          limit,
        ]);
        return Object.freeze(
          result.rows.map((value) => {
            const row = record(value, "Core history active row");
            const parsedPayload = payload(row.payload);
            const naturalKey = text(row.natural_key, "naturalKey");
            const rowSha256 = sha256(row.row_sha256, "rowSha256");
            if (
              parsedPayload.naturalKey !== naturalKey ||
              dnaOpenLabRawEvidenceSha256(parsedPayload) !== rowSha256
            ) {
              throw new Error("Core history active row integrity is invalid");
            }
            return Object.freeze({
              generationId: sha256(row.generation_id, "generationId"),
              ordinal: count(row.ordinal, "ordinal"),
              naturalKey,
              rowSha256,
              payload: parsedPayload,
            });
          }),
        );
      });
    },
  });
}
