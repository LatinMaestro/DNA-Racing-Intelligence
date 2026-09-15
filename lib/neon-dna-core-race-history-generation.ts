import { createHash } from "node:crypto";

import {
  DNA_CORE_RACE_HISTORY_GENERATION_MAXIMUM_OBSERVATIONS,
  type DnaCoreRaceHistoryGenerationMetadata,
  type DnaCoreRaceHistoryGenerationRepository,
  type DnaCoreRaceHistoryPublishedGeneration,
} from "./dna-core-race-history-generation";
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
    'dna.begin_dna_core_race_history_generation(uuid,text,jsonb)',
    'EXECUTE') AS runtime_can_begin,
  has_function_privilege(session_user,
    'dna.stage_dna_core_race_history_generation_rows(uuid,text,text,integer,jsonb)',
    'EXECUTE') AS runtime_can_stage,
  has_function_privilege(session_user,
    'dna.publish_dna_core_race_history_generation(uuid,text,text,integer,text,timestamp with time zone)',
    'EXECUTE') AS runtime_can_publish,
  has_function_privilege(session_user,
    'dna.read_dna_core_race_history_generation(uuid,text)',
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
  'dna.dna_core_race_history_generation'::regclass,
  'dna.dna_core_race_history_generation_row'::regclass,
  'dna.dna_core_race_history_generation_active'::regclass
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

function canonicalPayload(value: unknown, rowSha256: string): string {
  const canonical = text(value, "canonicalPayload");
  const byteLength = Buffer.byteLength(canonical, "utf8");
  if (
    byteLength < 2 ||
    byteLength > 16_384 ||
    createHash("sha256").update(canonical, "utf8").digest("hex") !== rowSha256
  ) {
    throw new Error("canonicalPayload integrity is invalid");
  }
  return canonical;
}

function timestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(text(value, field));
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} is invalid`);
  return parsed.toISOString();
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

function parsePublished(row: DbRow): DnaCoreRaceHistoryPublishedGeneration {
  if (text(row.state, "state") !== "published") {
    throw new Error("Core history generation is not published");
  }
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
    state: "published" as const,
    publishedAt: timestamp(row.published_at, "publishedAt"),
  });
  if (value.version !== 1) throw new Error("generation version is invalid");
  return value;
}

function verifyIsolation(
  result: QueryResult,
  input: { databaseOwnerId: string; ownerId: string; runtimeRole: string },
): void {
  const row = oneRow(result, "Core history generation isolation");
  if (
    text(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    text(row.authenticated_owner_id, "authenticated_owner_id") !==
      input.ownerId ||
    !bool(row.all_rls_enabled, "all_rls_enabled") ||
    !bool(row.all_force_rls_enabled, "all_force_rls_enabled") ||
    bool(row.runtime_can_access_tables, "runtime_can_access_tables") ||
    !bool(row.runtime_can_begin, "runtime_can_begin") ||
    !bool(row.runtime_can_stage, "runtime_can_stage") ||
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
      "Core history generation requires least-privilege owner isolation",
    );
  }
}

export function createNeonDnaCoreRaceHistoryGenerationRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  ownerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): DnaCoreRaceHistoryGenerationRepository {
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
      throw new Error("Core history generation owner access denied");
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
      const generation: DnaCoreRaceHistoryGenerationMetadata =
        request.generation;
      return transaction({
        ownerId: requestOwnerId,
        readOnly: false,
        async run(client) {
          const result = oneRow(
            await client.query(
              "SELECT dna.begin_dna_core_race_history_generation($1::uuid,$2::text,$3::jsonb) AS disposition",
              [
                databaseOwnerId,
                workerId(request.workerId),
                JSON.stringify(generation),
              ],
            ),
            "Core history generation begin",
          );
          const disposition = text(result.disposition, "disposition");
          if (disposition !== "staging" && disposition !== "published") {
            throw new Error(
              "Core history generation begin disposition is invalid",
            );
          }
          return disposition;
        },
      });
    },

    async stageRows(requestOwnerId, request) {
      if (request.rows.length < 1 || request.rows.length > 250) {
        throw new Error("Core history generation stage batch is invalid");
      }
      const startOrdinal = count(request.startOrdinal, "startOrdinal");
      const rows = request.rows.map((entry, index) => {
        if (entry.ordinal !== startOrdinal + index) {
          throw new Error("Core history generation stage ordinal is invalid");
        }
        const rowSha256 = sha256(entry.rowSha256, "rowSha256");
        return {
          ordinal: entry.ordinal,
          naturalKey: text(entry.naturalKey, "naturalKey"),
          rowSha256,
          canonicalPayload: canonicalPayload(entry.canonicalPayload, rowSha256),
          payload: entry.payload,
        };
      });
      return transaction({
        ownerId: requestOwnerId,
        readOnly: false,
        async run(client) {
          const result = oneRow(
            await client.query(
              "SELECT dna.stage_dna_core_race_history_generation_rows($1::uuid,$2::text,$3::text,$4::integer,$5::jsonb) AS accepted",
              [
                databaseOwnerId,
                workerId(request.workerId),
                sha256(request.generationId, "generationId"),
                startOrdinal,
                JSON.stringify(rows),
              ],
            ),
            "Core history generation stage",
          );
          const accepted =
            typeof result.accepted === "string"
              ? (JSON.parse(result.accepted) as unknown)
              : result.accepted;
          if (!Array.isArray(accepted) || accepted.length !== rows.length) {
            throw new Error(
              "Core history generation staged coverage is incomplete",
            );
          }
          return Object.freeze(
            accepted.map((value, index) => {
              const entry = record(value, "accepted row");
              const ordinal = count(entry.ordinal, "accepted ordinal");
              const rowSha256 = sha256(entry.rowSha256, "accepted rowSha256");
              if (ordinal !== startOrdinal + index) {
                throw new Error("Core history generation staged order drifted");
              }
              return Object.freeze({ ordinal, rowSha256 });
            }),
          );
        },
      });
    },

    async publish(requestOwnerId, request) {
      return transaction({
        ownerId: requestOwnerId,
        readOnly: false,
        async run(client) {
          return parsePublished(
            oneRow(
              await client.query(
                "SELECT * FROM dna.publish_dna_core_race_history_generation($1::uuid,$2::text,$3::text,$4::integer,$5::text,$6::timestamptz)",
                [
                  databaseOwnerId,
                  workerId(request.workerId),
                  sha256(request.generationId, "generationId"),
                  count(
                    request.expectedObservationCount,
                    "expectedObservationCount",
                  ),
                  sha256(request.payloadSha256, "payloadSha256"),
                  timestamp(request.publishedAt, "publishedAt"),
                ],
              ),
              "Core history generation publication",
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
            "SELECT * FROM dna.read_dna_core_race_history_generation($1::uuid,$2::text)",
            [databaseOwnerId, sha256(generationId, "generationId")],
          );
          return result.rows.length === 0
            ? null
            : parsePublished(oneRow(result, "Core history generation read"));
        },
      });
    },
  });
}
