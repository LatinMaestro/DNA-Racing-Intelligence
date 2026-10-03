import { createHash } from "node:crypto";

import {
  type RaceMergeOutcomeEvidenceRow,
  type RaceMergeOutcomeGenerationReader,
  type RaceMergeOutcomeIngestionRepository,
  type RaceMergeOutcomeIngestionResult,
  type RaceMergeOutcomeObjectReceipt,
} from "./race-merge-outcome-ingestion-service";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceClient,
  type NeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const PAGE_SIZE = 10_000;

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
    'dna.begin_race_merge_outcome_object(uuid,text,text,text,bigint,text)',
    'EXECUTE') AS runtime_can_begin,
  has_function_privilege(session_user,
    'dna.append_race_merge_outcomes(uuid,text,text,jsonb)',
    'EXECUTE') AS runtime_can_append,
  has_function_privilege(session_user,
    'dna.commit_race_merge_outcome_object(uuid,text,text,jsonb)',
    'EXECUTE') AS runtime_can_commit,
  has_function_privilege(session_user,
    'dna.read_race_merge_outcome_object_receipt(uuid,text,text)',
    'EXECUTE') AS runtime_can_resume,
  has_function_privilege(session_user,
    'dna.inspect_race_merge_outcome_generation(uuid,text,text,jsonb)',
    'EXECUTE') AS runtime_can_inspect,
  has_function_privilege(session_user,
    'dna.read_race_merge_outcome_digest_page(uuid,text,bigint,text,integer)',
    'EXECUTE') AS runtime_can_digest,
  has_function_privilege(session_user,
    'dna.complete_race_merge_outcome_generation(uuid,text,text,integer,bigint,text)',
    'EXECUTE') AS runtime_can_complete,
  has_function_privilege(session_user,
    'dna.abort_race_merge_outcome_generation(uuid,text,text)',
    'EXECUTE') AS runtime_can_abort,
  has_function_privilege(session_user,
    'dna.read_race_merge_core_outcomes(uuid,text,bigint)',
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
  'dna.race_merge_outcome_generation'::regclass,
  'dna.race_merge_outcome_object'::regclass,
  'dna.race_merge_outcome'::regclass
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

function count(value: unknown, field: string): number {
  const parsed =
    typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) < 0) {
    throw new Error(`${field} is invalid`);
  }
  return parsed as number;
}

function identifier(value: string, field: string): string {
  if (!SAFE_IDENTIFIER_PATTERN.test(value))
    throw new Error(`${field} is invalid`);
  return value;
}

function sha256(value: unknown, field: string): string {
  const normalized = text(value, field);
  if (!SHA_256_PATTERN.test(normalized)) throw new Error(`${field} is invalid`);
  return normalized;
}

function databaseOwnerId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized))
    throw new Error("databaseOwnerId is invalid");
  return normalized;
}

function authenticatedOwnerId(value: string): string {
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

function verifyIsolation(
  result: QueryResult,
  input: { databaseOwnerId: string; ownerId: string; runtimeRole: string },
): void {
  const row = oneRow(result, "Race Merge outcome isolation");
  const required = [
    "runtime_can_begin",
    "runtime_can_append",
    "runtime_can_commit",
    "runtime_can_resume",
    "runtime_can_inspect",
    "runtime_can_digest",
    "runtime_can_complete",
    "runtime_can_abort",
    "runtime_can_read",
  ] as const;
  if (
    text(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    text(row.authenticated_owner_id, "authenticated_owner_id") !==
      input.ownerId ||
    !bool(row.all_rls_enabled, "all_rls_enabled") ||
    !bool(row.all_force_rls_enabled, "all_force_rls_enabled") ||
    bool(row.runtime_can_access_tables, "runtime_can_access_tables") ||
    required.some((field) => !bool(row[field], field)) ||
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
      "Race Merge outcome repository requires least-privilege owner isolation",
    );
  }
}

function receipt(row: DbRow): RaceMergeOutcomeObjectReceipt {
  return Object.freeze({
    objectId: identifier(text(row.object_id, "objectId"), "objectId"),
    byteLength: count(row.byte_length, "byteLength"),
    sha256: sha256(row.sha256, "sha256"),
    rowCount: count(row.row_count, "rowCount"),
    orderedOutcomeDigestSha256: sha256(
      row.ordered_outcome_digest_sha256,
      "orderedOutcomeDigestSha256",
    ),
  });
}

export type NeonRaceMergeOutcomeIngestionRepository =
  RaceMergeOutcomeIngestionRepository & RaceMergeOutcomeGenerationReader;

export function createNeonRaceMergeOutcomeIngestionRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  ownerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): NeonRaceMergeOutcomeIngestionRepository {
  const databaseUrl = input.databaseUrl.trim();
  if (databaseUrl === "") throw new Error("databaseUrl is required");
  const scopedDatabaseOwnerId = databaseOwnerId(input.databaseOwnerId);
  const scopedOwnerId = authenticatedOwnerId(input.ownerId);
  if (!ROLE_PATTERN.test(input.runtimeRole))
    throw new Error("runtimeRole is invalid");
  const runtimeRole = input.runtimeRole;
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  function assertOwner(value: string): void {
    if (authenticatedOwnerId(value) !== scopedOwnerId) {
      throw new Error("Race Merge outcome owner access denied");
    }
  }

  async function beginSession(
    readOnly: boolean,
  ): Promise<NeonImportPersistenceSession> {
    const session = await sessionFactory(databaseUrl);
    try {
      await session.client.query(
        readOnly
          ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
          : "BEGIN ISOLATION LEVEL SERIALIZABLE",
      );
      await session.client.query(SET_OWNER_SCOPE_SQL, [scopedDatabaseOwnerId]);
      verifyIsolation(
        await session.client.query(VERIFY_ISOLATION_SQL, [
          scopedDatabaseOwnerId,
          scopedOwnerId,
        ]),
        {
          databaseOwnerId: scopedDatabaseOwnerId,
          ownerId: scopedOwnerId,
          runtimeRole,
        },
      );
      return session;
    } catch (error) {
      await session.client.query("ROLLBACK").catch(() => undefined);
      await session.close();
      throw error;
    }
  }

  async function transaction<T>(input: {
    readOnly: boolean;
    run: (client: NeonImportPersistenceClient) => Promise<T>;
  }): Promise<T> {
    const session = await beginSession(input.readOnly);
    try {
      const result = await input.run(session.client);
      await session.client.query("COMMIT");
      return result;
    } catch (error) {
      await session.client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await session.close();
    }
  }

  return Object.freeze({
    async resumeObject(request) {
      assertOwner(request.ownerId);
      const result = await transaction({
        readOnly: true,
        run: (client) =>
          client.query(
            "SELECT * FROM dna.read_race_merge_outcome_object_receipt($1::uuid,$2::text,$3::text)",
            [
              scopedDatabaseOwnerId,
              identifier(request.generationId, "generationId"),
              identifier(request.objectId, "objectId"),
            ],
          ),
      });
      if (result.rows.length === 0) return null;
      const value = receipt(
        oneRow(result, "Race Merge outcome object receipt"),
      );
      if (
        value.byteLength !== request.expectedByteLength ||
        value.sha256 !== request.expectedSha256
      ) {
        throw new Error("Race Merge outcome object resume conflicts");
      }
      return value;
    },

    async beginObject(request) {
      assertOwner(request.ownerId);
      const generationId = identifier(request.generationId, "generationId");
      const objectId = identifier(request.objectId, "objectId");
      const session = await beginSession(false);
      let closed = false;
      const close = async (commit: boolean) => {
        if (closed) return;
        closed = true;
        try {
          await session.client.query(commit ? "COMMIT" : "ROLLBACK");
        } finally {
          await session.close();
        }
      };
      try {
        const state = text(
          oneRow(
            await session.client.query(
              "SELECT dna.begin_race_merge_outcome_object($1::uuid,$2::text,$3::text,$4::text,$5::bigint,$6::text) AS state",
              [
                scopedDatabaseOwnerId,
                generationId,
                sha256(request.manifestDigestSha256, "manifestDigestSha256"),
                objectId,
                request.expectedByteLength,
                sha256(request.expectedSha256, "expectedSha256"),
              ],
            ),
            "Race Merge outcome object begin",
          ).state,
          "state",
        );
        if (state !== "staging") {
          throw new Error("Race Merge outcome object is not staging");
        }
      } catch (error) {
        await close(false).catch(() => undefined);
        throw error;
      }
      return Object.freeze({
        async appendOutcomes(rows: readonly RaceMergeOutcomeEvidenceRow[]) {
          if (closed || rows.length < 1 || rows.length > 10_000) {
            throw new Error("Race Merge outcome append batch is invalid");
          }
          const result = oneRow(
            await session.client.query(
              "SELECT * FROM dna.append_race_merge_outcomes($1::uuid,$2::text,$3::text,$4::jsonb)",
              [
                scopedDatabaseOwnerId,
                generationId,
                objectId,
                JSON.stringify(rows),
              ],
            ),
            "Race Merge outcome append",
          );
          const accepted = count(result.accepted_count, "acceptedCount");
          const replays = count(result.exact_replay_count, "exactReplayCount");
          if (accepted + replays !== rows.length) {
            throw new Error("Race Merge outcome append coverage is incomplete");
          }
        },
        async commitVerified(verified) {
          if (closed)
            throw new Error("Race Merge outcome object transaction is closed");
          try {
            const value = receipt(
              oneRow(
                await session.client.query(
                  "SELECT * FROM dna.commit_race_merge_outcome_object($1::uuid,$2::text,$3::text,$4::jsonb)",
                  [
                    scopedDatabaseOwnerId,
                    generationId,
                    objectId,
                    JSON.stringify(verified),
                  ],
                ),
                "Race Merge outcome object commit",
              ),
            );
            await close(true);
            return value;
          } catch (error) {
            await close(false).catch(() => undefined);
            throw error;
          }
        },
        async rollback() {
          await close(false);
        },
      });
    },

    async finalizeGeneration(request) {
      assertOwner(request.ownerId);
      const generationId = identifier(request.generationId, "generationId");
      const manifestDigestSha256 = sha256(
        request.manifestDigestSha256,
        "manifestDigestSha256",
      );
      return transaction({
        readOnly: false,
        async run(client): Promise<RaceMergeOutcomeIngestionResult> {
          const inspected = oneRow(
            await client.query(
              "SELECT * FROM dna.inspect_race_merge_outcome_generation($1::uuid,$2::text,$3::text,$4::jsonb)",
              [
                scopedDatabaseOwnerId,
                generationId,
                manifestDigestSha256,
                JSON.stringify(request.objects),
              ],
            ),
            "Race Merge outcome generation inspection",
          );
          const sourceRowCount = count(
            inspected.source_row_count,
            "sourceRowCount",
          );
          const uniqueOutcomeCount = count(
            inspected.unique_outcome_count,
            "uniqueOutcomeCount",
          );
          const exactReplayCount = count(
            inspected.exact_replay_count,
            "exactReplayCount",
          );
          if (
            count(inspected.object_count, "objectCount") !==
              request.objects.length ||
            sourceRowCount !== uniqueOutcomeCount + exactReplayCount
          ) {
            throw new Error(
              "Race Merge outcome generation coverage is inconsistent",
            );
          }
          let outcomeSetDigestSha256: string;
          if (text(inspected.state, "state") === "complete") {
            outcomeSetDigestSha256 = sha256(
              inspected.outcome_set_digest_sha256,
              "outcomeSetDigestSha256",
            );
          } else {
            const digest = createHash("sha256");
            let afterCoreId = 0;
            let afterRaceId: string | null = null;
            let observed = 0;
            for (;;) {
              const page = await client.query(
                "SELECT * FROM dna.read_race_merge_outcome_digest_page($1::uuid,$2::text,$3::bigint,$4::text,$5::integer)",
                [
                  scopedDatabaseOwnerId,
                  generationId,
                  afterCoreId,
                  afterRaceId,
                  PAGE_SIZE,
                ],
              );
              for (const raw of page.rows) {
                const row = record(raw, "Race Merge outcome digest row");
                const sourceCoreId = count(row.source_core_id, "sourceCoreId");
                const sourceRaceId = text(row.source_race_id, "sourceRaceId");
                const finishPosition = count(
                  row.finish_position,
                  "finishPosition",
                );
                const elapsedMilliseconds = count(
                  row.elapsed_milliseconds,
                  "elapsedMilliseconds",
                );
                digest.update(
                  `${sourceCoreId}\u0000${sourceRaceId}\u0000${finishPosition}\u0000${elapsedMilliseconds}\n`,
                );
                afterCoreId = sourceCoreId;
                afterRaceId = sourceRaceId;
                observed += 1;
              }
              if (page.rows.length < PAGE_SIZE) break;
            }
            if (observed !== uniqueOutcomeCount) {
              throw new Error(
                "Race Merge outcome digest coverage is incomplete",
              );
            }
            outcomeSetDigestSha256 = digest.digest("hex");
            const completed = oneRow(
              await client.query(
                "SELECT * FROM dna.complete_race_merge_outcome_generation($1::uuid,$2::text,$3::text,$4::integer,$5::bigint,$6::text)",
                [
                  scopedDatabaseOwnerId,
                  generationId,
                  manifestDigestSha256,
                  request.objects.length,
                  uniqueOutcomeCount,
                  outcomeSetDigestSha256,
                ],
              ),
              "Race Merge outcome generation completion",
            );
            if (
              text(completed.state, "state") !== "complete" ||
              count(completed.object_count, "objectCount") !==
                request.objects.length ||
              count(completed.unique_outcome_count, "uniqueOutcomeCount") !==
                uniqueOutcomeCount ||
              sha256(
                completed.outcome_set_digest_sha256,
                "outcomeSetDigestSha256",
              ) !== outcomeSetDigestSha256
            ) {
              throw new Error(
                "Race Merge outcome generation completion is inconsistent",
              );
            }
          }
          return Object.freeze({
            status: "complete" as const,
            generationId,
            objectCount: request.objects.length,
            sourceRowCount,
            uniqueOutcomeCount,
            exactReplayCount,
            manifestDigestSha256,
            outcomeSetDigestSha256,
            dnaProviderRequestCount: 0 as const,
          });
        },
      });
    },

    async abortGeneration(request) {
      assertOwner(request.ownerId);
      await transaction({
        readOnly: false,
        async run(client) {
          await client.query(
            "SELECT dna.abort_race_merge_outcome_generation($1::uuid,$2::text,$3::text)",
            [
              scopedDatabaseOwnerId,
              identifier(request.generationId, "generationId"),
              request.reason,
            ],
          );
        },
      });
    },

    async loadCoreOutcomes(request) {
      assertOwner(request.ownerId);
      if (
        !Number.isSafeInteger(request.sourceCoreId) ||
        request.sourceCoreId < 1
      ) {
        throw new Error("sourceCoreId is invalid");
      }
      const result = await transaction({
        readOnly: true,
        run: (client) =>
          client.query(
            "SELECT * FROM dna.read_race_merge_core_outcomes($1::uuid,$2::text,$3::bigint)",
            [
              scopedDatabaseOwnerId,
              identifier(request.generationId, "generationId"),
              request.sourceCoreId,
            ],
          ),
      });
      return Object.freeze(
        result.rows.map((raw) => {
          const row = record(raw, "Race Merge Core outcome");
          return Object.freeze({
            sourceRaceId: text(row.source_race_id, "sourceRaceId"),
            sourceCoreId: count(row.source_core_id, "sourceCoreId"),
            finishPosition: count(row.finish_position, "finishPosition"),
            elapsedMilliseconds: count(
              row.elapsed_milliseconds,
              "elapsedMilliseconds",
            ),
            source: "race_merge" as const,
            sourceObjectSha256: sha256(
              row.source_object_sha256,
              "sourceObjectSha256",
            ),
            sourceRowNumber: count(row.source_row_number, "sourceRowNumber"),
          });
        }),
      );
    },
  });
}
