import type { AdaptedRaceMergeRow } from "@/domain/source-adapters";
import type {
  RaceBoundedMaterializationCommit,
  RaceBoundedMaterializationSession,
  RaceBoundedMaterializationSink,
  RaceBoundedMaterializationSummary,
} from "./race-bounded-materializer";
import type {
  RacePreactivationMaterializationRecord,
} from "./race-preactivation-materialization-spool";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_RUNTIME_ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const MAXIMUM_BATCH_RECORDS = 5_000;

const SET_OWNER_SCOPE_SQL = `
  SELECT set_config('app.owner_id', $1, true) AS owner_scope
`;

const VERIFY_TARGET_SQL = `
  SELECT
    batch.owner_id::text AS database_owner_id,
    batch.source_type,
    batch.status AS import_batch_status,
    batch.source_rows,
    batch.accepted_rows,
    batch.rejected_rows,
    batch.warning_rows,
    (
      SELECT version.import_batch_id::text
      FROM dna.dataset_version version
      WHERE version.owner_id = batch.owner_id
        AND version.id = $2::uuid
    ) AS requested_version_import_batch_id,
    race_event.relrowsecurity AS race_event_rls,
    race_event.relforcerowsecurity AS race_event_force_rls,
    race_entry.relrowsecurity AS race_entry_rls,
    race_entry.relforcerowsecurity AS race_entry_force_rls,
    race_source.relrowsecurity AS race_source_rls,
    race_source.relforcerowsecurity AS race_source_force_rls,
    session_user::text AS session_user_name,
    current_user::text AS current_user_name,
    runtime_role.rolsuper AS runtime_is_superuser,
    runtime_role.rolbypassrls AS runtime_bypasses_rls,
    runtime_role.rolcreaterole AS runtime_can_create_roles,
    runtime_role.rolcreatedb AS runtime_can_create_databases,
    COALESCE(
      pg_has_role(
        session_user,
        (
          SELECT role.oid
          FROM pg_catalog.pg_roles role
          WHERE role.rolname = 'neon_superuser'
        ),
        'MEMBER'
      ),
      false
    ) AS runtime_is_neon_superuser_member
  FROM dna.import_batch batch
  JOIN pg_catalog.pg_roles runtime_role
    ON runtime_role.rolname = session_user
  JOIN pg_catalog.pg_class race_event
    ON race_event.oid = 'dna.race_event'::regclass
  JOIN pg_catalog.pg_class race_entry
    ON race_entry.oid = 'dna.race_entry'::regclass
  JOIN pg_catalog.pg_class race_source
    ON race_source.oid = 'dna.race_entry_source'::regclass
  WHERE batch.owner_id = dna.current_owner_id()
    AND batch.id = $1::uuid
`;

const MATERIALIZE_BATCH_SQL = `
  SELECT materialized_row_count
  FROM dna.materialize_bounded_race_batch(
    $1::uuid,
    $2::uuid,
    $3::jsonb,
    $4::timestamptz
  )
`;

const COMPLETE_MATERIALIZATION_SQL = `
  SELECT result_status, materialized_entry_count
  FROM dna.complete_bounded_race_materialization(
    $1::uuid,
    $2::uuid,
    $3::bigint,
    $4::bigint,
    $5::timestamptz
  )
`;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;

export type NeonRaceBoundedMaterializationClient = Readonly<{
  query: (
    statement: string,
    values?: readonly unknown[],
  ) => Promise<QueryResult>;
}>;

export type NeonRaceBoundedMaterializationDatabaseSession = Readonly<{
  client: NeonRaceBoundedMaterializationClient;
  close: () => Promise<void>;
}>;

export type NeonRaceBoundedMaterializationSessionFactory = (
  databaseUrl: string,
) => Promise<NeonRaceBoundedMaterializationDatabaseSession>;

type MaterializationPayloadRow = Readonly<{
  sourceRowNumber: number;
  naturalKey: string;
  fingerprintSha256: string;
  record: AdaptedRaceMergeRow;
}>;

function databaseRecord(
  value: unknown,
  field: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be a database record`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function oneRow(
  result: QueryResult,
  field: string,
): Readonly<Record<string, unknown>> {
  if (result.rows.length !== 1) {
    throw new Error(`${field} must return exactly one row`);
  }
  return databaseRecord(result.rows[0], field);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean`);
  return value;
}

function requiredCount(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return parsed;
}

function requireUuid(value: string, field: string): string {
  const normalized = value.trim();
  if (!UUID_PATTERN.test(normalized)) throw new Error(`${field} is invalid`);
  return normalized;
}

function requireTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("activatedAt must be a canonical ISO timestamp");
  }
  return value;
}

function requireRuntimeRole(value: string): string {
  const normalized = value.trim();
  if (!SAFE_RUNTIME_ROLE_PATTERN.test(normalized)) {
    throw new Error("runtimeRole is invalid");
  }
  return normalized;
}

function verifyTarget(input: {
  row: Readonly<Record<string, unknown>>;
  ownerId: string;
  importBatchId: string;
  runtimeRole: string;
  summary: RaceBoundedMaterializationSummary;
}): void {
  const { row, summary } = input;
  if (
    requiredString(row.database_owner_id, "database_owner_id") !==
      input.ownerId ||
    requiredString(row.source_type, "source_type") !== "race_merge" ||
    requiredString(row.import_batch_status, "import_batch_status") !==
      "validating" ||
    row.requested_version_import_batch_id !== null
  ) {
    throw new Error("Bounded Race materialization target is not eligible.");
  }
  if (
    requiredCount(row.source_rows, "source_rows") !== summary.sourceRowCount ||
    requiredCount(row.accepted_rows, "accepted_rows") !== summary.readyRowCount ||
    requiredCount(row.rejected_rows, "rejected_rows") !==
      summary.quarantinedRowCount ||
    summary.readyRowCount + summary.quarantinedRowCount !==
      summary.sourceRowCount ||
    summary.acceptedNaturalKeyCount + summary.duplicateReadyRowCount !==
      summary.readyRowCount
  ) {
    throw new Error("Bounded Race materialization manifest coverage changed.");
  }
  if (
    !requiredBoolean(row.race_event_rls, "race_event_rls") ||
    !requiredBoolean(row.race_event_force_rls, "race_event_force_rls") ||
    !requiredBoolean(row.race_entry_rls, "race_entry_rls") ||
    !requiredBoolean(row.race_entry_force_rls, "race_entry_force_rls") ||
    !requiredBoolean(row.race_source_rls, "race_source_rls") ||
    !requiredBoolean(row.race_source_force_rls, "race_source_force_rls") ||
    requiredString(row.session_user_name, "session_user_name") !==
      input.runtimeRole ||
    requiredString(row.current_user_name, "current_user_name") !==
      input.runtimeRole ||
    requiredBoolean(row.runtime_is_superuser, "runtime_is_superuser") ||
    requiredBoolean(row.runtime_bypasses_rls, "runtime_bypasses_rls") ||
    requiredBoolean(row.runtime_can_create_roles, "runtime_can_create_roles") ||
    requiredBoolean(
      row.runtime_can_create_databases,
      "runtime_can_create_databases",
    ) ||
    requiredBoolean(
      row.runtime_is_neon_superuser_member,
      "runtime_is_neon_superuser_member",
    )
  ) {
    throw new Error(
      "Bounded Race materialization runtime is not least privileged.",
    );
  }
}

function payloadRow(
  value: RacePreactivationMaterializationRecord,
): MaterializationPayloadRow {
  const row = value.canonicalRow;
  if (
    row.row.status !== "ready" ||
    row.row.record?.sourceType !== "race_merge" ||
    row.naturalKey !== value.naturalKey ||
    row.fingerprintSha256 !== value.fingerprintSha256 ||
    !SHA_256_PATTERN.test(value.fingerprintSha256) ||
    !Number.isSafeInteger(row.sourceRowNumber) ||
    row.sourceRowNumber < 1
  ) {
    throw new Error("Bounded Race materialization record is invalid.");
  }
  return Object.freeze({
    sourceRowNumber: row.sourceRowNumber,
    naturalKey: value.naturalKey,
    fingerprintSha256: value.fingerprintSha256,
    record: row.row.record,
  });
}

export async function createDefaultNeonRaceBoundedMaterializationSession(
  databaseUrl: string,
): Promise<NeonRaceBoundedMaterializationDatabaseSession> {
  const { Pool } = await import("@neondatabase/serverless");
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  try {
    const client = await pool.connect();
    return {
      client,
      async close() {
        client.release();
        await pool.end();
      },
    };
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
}

export function createNeonRaceBoundedMaterializationSink(input: {
  databaseUrl: string;
  runtimeRole: string;
  ownerId: string;
  importBatchId: string;
  datasetVersionId: string;
  activatedAt: string;
  sessionFactory?: NeonRaceBoundedMaterializationSessionFactory;
}): RaceBoundedMaterializationSink {
  const databaseUrl = input.databaseUrl.trim();
  if (databaseUrl === "") throw new Error("databaseUrl is required");
  const runtimeRole = requireRuntimeRole(input.runtimeRole);
  const ownerId = requireUuid(input.ownerId, "ownerId");
  const importBatchId = requireUuid(input.importBatchId, "importBatchId");
  const datasetVersionId = requireUuid(input.datasetVersionId, "datasetVersionId");
  const activatedAt = requireTimestamp(input.activatedAt);
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonRaceBoundedMaterializationSession;

  return Object.freeze({
    async begin(
      summary: RaceBoundedMaterializationSummary,
    ): Promise<RaceBoundedMaterializationSession> {
      if (summary.acceptedNaturalKeyCount < 1) {
        throw new Error("Bounded Race materialization summary is empty.");
      }
      const databaseSession = await sessionFactory(databaseUrl);
      let transactionOpen = false;
      let closed = false;
      const close = async () => {
        if (closed) return;
        closed = true;
        await databaseSession.close();
      };
      try {
        await databaseSession.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        transactionOpen = true;
        const ownerScope = oneRow(
          await databaseSession.client.query(SET_OWNER_SCOPE_SQL, [ownerId]),
          "owner scope",
        );
        if (requiredString(ownerScope.owner_scope, "owner_scope") !== ownerId) {
          throw new Error("Bounded Race materialization owner scope changed.");
        }
        verifyTarget({
          row: oneRow(
            await databaseSession.client.query(VERIFY_TARGET_SQL, [
              importBatchId,
              datasetVersionId,
            ]),
            "bounded Race target",
          ),
          ownerId,
          importBatchId,
          runtimeRole,
          summary,
        });
      } catch (error) {
        if (transactionOpen) {
          await databaseSession.client.query("ROLLBACK").catch(() => undefined);
        }
        await close().catch(() => undefined);
        throw error;
      }

      return Object.freeze({
        async writeBatch({ records }) {
          if (records.length < 1 || records.length > MAXIMUM_BATCH_RECORDS) {
            throw new Error("Bounded Race Neon batch is outside its safe bound.");
          }
          const payload = records.map(payloadRow);
          const row = oneRow(
            await databaseSession.client.query(MATERIALIZE_BATCH_SQL, [
              importBatchId,
              datasetVersionId,
              JSON.stringify(payload),
              activatedAt,
            ]),
            "bounded Race batch",
          );
          if (
            requiredCount(row.materialized_row_count, "materialized_row_count") !==
            records.length
          ) {
            throw new Error("Bounded Race Neon batch coverage changed.");
          }
        },
        async commit(commit: RaceBoundedMaterializationCommit) {
          if (!transactionOpen) {
            throw new Error("Bounded Race materialization transaction is closed.");
          }
          const row = oneRow(
            await databaseSession.client.query(COMPLETE_MATERIALIZATION_SQL, [
              importBatchId,
              datasetVersionId,
              commit.materializedNaturalKeyCount,
              commit.materializationBatchCount,
              activatedAt,
            ]),
            "bounded Race completion",
          );
          if (
            requiredString(row.result_status, "result_status") !== "materialized" ||
            requiredCount(
              row.materialized_entry_count,
              "materialized_entry_count",
            ) !== commit.materializedNaturalKeyCount
          ) {
            throw new Error("Bounded Race materialization completion changed.");
          }
          await databaseSession.client.query("COMMIT");
          transactionOpen = false;
          await close();
        },
        async rollback() {
          if (transactionOpen) {
            await databaseSession.client.query("ROLLBACK");
            transactionOpen = false;
          }
          await close();
        },
      });
    },
  });
}
