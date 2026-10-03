import type {
  RaceMergeCoreOutcomeR2GenerationAuthority,
  RaceMergeCoreOutcomeR2GenerationCheckpoint,
  RaceMergeCoreOutcomeR2GenerationRepository,
  RaceMergeCoreOutcomeR2Manifest,
} from "./race-merge-core-outcome-r2-generation";
import type { RaceMergeCoreOutcomeR2Receipt } from "./race-merge-core-outcome-r2-store";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA = /^[a-f0-9]{64}$/u;
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const ROLE = /^[a-z_][a-z0-9_]{0,62}$/u;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
type Row = Record<string, unknown>;
type Result = Readonly<{ rows: readonly unknown[] }>;

const VERIFY_SQL = `SELECT owner.id::text AS database_owner_id, owner.clerk_user_id AS authenticated_owner_id,
 bool_and(c.relrowsecurity) AS all_rls_enabled, bool_and(c.relforcerowsecurity) AS all_force_rls_enabled,
 bool_or(has_table_privilege(session_user,c.oid,'SELECT,INSERT,UPDATE,DELETE')) AS runtime_can_access_tables,
 has_function_privilege(session_user,'dna.begin_race_merge_core_outcome_r2_generation(uuid,jsonb,timestamp with time zone)','EXECUTE') AS runtime_can_begin,
 has_function_privilege(session_user,'dna.register_race_merge_core_outcome_r2_manifest(uuid,text,integer,jsonb,timestamp with time zone)','EXECUTE') AS runtime_can_register,
 has_function_privilege(session_user,'dna.finalize_race_merge_core_outcome_r2_generation(uuid,text,integer,text,timestamp with time zone)','EXECUTE') AS runtime_can_finalize,
 has_function_privilege(session_user,'dna.read_race_merge_core_outcome_r2_manifests(uuid,text,integer,bigint,integer)','EXECUTE') AS runtime_can_list,
 has_function_privilege(session_user,'dna.reject_race_merge_core_outcome_r2_manifest_mutation()','EXECUTE') AS runtime_can_mutate,
 session_user::text AS session_user_name,current_user::text AS current_user_name,r.rolsuper AS runtime_is_superuser,
 r.rolbypassrls AS runtime_bypasses_rls,r.rolcreaterole AS runtime_can_create_roles,r.rolcreatedb AS runtime_can_create_databases,
 has_database_privilege(session_user,current_database(),'CREATE') AS runtime_can_create_in_database,
 has_schema_privilege(session_user,'dna','CREATE') AS runtime_can_create_in_schema,
 COALESCE(pg_has_role(session_user,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='neon_superuser'),'MEMBER'),false) AS runtime_is_neon_superuser_member
 FROM dna.app_owner owner CROSS JOIN LATERAL unnest(ARRAY['dna.race_merge_core_outcome_r2_generation'::regclass,'dna.race_merge_core_outcome_r2_manifest'::regclass]) t(oid)
 JOIN pg_catalog.pg_class c ON c.oid=t.oid JOIN pg_catalog.pg_roles r ON r.rolname=session_user
 WHERE owner.id=$1::uuid AND owner.clerk_user_id=$2
 GROUP BY owner.id,owner.clerk_user_id,r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb`;

function row(value: unknown, field: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${field} is invalid`);
  return value as Row;
}
function one(result: Result, field: string): Row {
  if (result.rows.length !== 1)
    throw new Error(`${field} must return exactly one row`);
  return row(result.rows[0], field);
}
function text(value: unknown, field: string, max = 2048): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > max ||
    value.trim() !== value ||
    CONTROL.test(value)
  )
    throw new Error(`${field} is invalid`);
  return value;
}
function integer(
  value: unknown,
  field: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const parsed =
    typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (
    !Number.isSafeInteger(parsed) ||
    (parsed as number) < min ||
    (parsed as number) > max
  )
    throw new Error(`${field} is invalid`);
  return parsed as number;
}
function sha(value: unknown, field: string): string {
  const v = text(value, field, 64).toLowerCase();
  if (!SHA.test(v)) throw new Error(`${field} is invalid`);
  return v;
}
function identifier(value: unknown, field: string): string {
  const v = text(value, field, 128);
  if (!IDENTIFIER.test(v)) throw new Error(`${field} is invalid`);
  return v;
}
function instant(value: unknown, field: string): string {
  const d = value instanceof Date ? value : new Date(text(value, field));
  if (Number.isNaN(d.getTime())) throw new Error(`${field} is invalid`);
  return d.toISOString();
}
function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} is invalid`);
  return value;
}

function authority(
  value: RaceMergeCoreOutcomeR2GenerationAuthority,
): RaceMergeCoreOutcomeR2GenerationAuthority {
  const result = Object.freeze({
    version: 1 as const,
    generationId: identifier(value.generationId, "generationId"),
    cohortOrdinal: integer(value.cohortOrdinal, "cohortOrdinal", 1),
    firstSourceCoreId: integer(value.firstSourceCoreId, "firstSourceCoreId", 1),
    lastSourceCoreId: integer(value.lastSourceCoreId, "lastSourceCoreId", 1),
    coreCount: integer(value.coreCount, "coreCount", 1, 100),
    uniqueOutcomeCount: integer(
      value.uniqueOutcomeCount,
      "uniqueOutcomeCount",
      1,
    ),
    sourceObservationCount: integer(
      value.sourceObservationCount,
      "sourceObservationCount",
      1,
    ),
    retainedR2Bytes: integer(
      value.retainedR2Bytes,
      "retainedR2Bytes",
      1,
      64 * 1024 * 1024,
    ),
    receiptSetSha256: sha(value.receiptSetSha256, "receiptSetSha256"),
  });
  if (
    value.version !== 1 ||
    result.lastSourceCoreId < result.firstSourceCoreId ||
    result.sourceObservationCount < result.uniqueOutcomeCount
  )
    throw new Error(
      "Race Merge Core outcome R2 generation authority is invalid",
    );
  return result;
}
function receipt(
  value: RaceMergeCoreOutcomeR2Receipt,
): RaceMergeCoreOutcomeR2Receipt {
  const result = Object.freeze({
    version: 1 as const,
    generationId: identifier(value.generationId, "generationId"),
    sourceCoreId: integer(value.sourceCoreId, "sourceCoreId", 1),
    objectKey: text(value.objectKey, "objectKey"),
    bodySha256: sha(value.bodySha256, "bodySha256"),
    byteLength: integer(value.byteLength, "byteLength", 1, 8 * 1024 * 1024),
    uniqueOutcomeCount: integer(
      value.uniqueOutcomeCount,
      "uniqueOutcomeCount",
      1,
      50_000,
    ),
    sourceObservationCount: integer(
      value.sourceObservationCount,
      "sourceObservationCount",
      1,
      1_200_000,
    ),
    firstSourceRaceId: text(value.firstSourceRaceId, "firstSourceRaceId", 512),
    lastSourceRaceId: text(value.lastSourceRaceId, "lastSourceRaceId", 512),
  });
  if (
    value.version !== 1 ||
    result.sourceObservationCount < result.uniqueOutcomeCount ||
    result.lastSourceRaceId < result.firstSourceRaceId
  )
    throw new Error("Race Merge Core outcome R2 receipt is invalid");
  return result;
}
function checkpoint(
  value: unknown,
  owner: string,
  expected: Readonly<{ generationId: string; cohortOrdinal: number }>,
): RaceMergeCoreOutcomeR2GenerationCheckpoint {
  const r = row(value, "checkpoint");
  const status = text(r.state, "state", 16);
  if (status !== "writing" && status !== "complete")
    throw new Error("checkpoint status is invalid");
  const result = Object.freeze({
    version: 1 as const,
    generationId: identifier(r.generation_id, "generationId"),
    cohortOrdinal: integer(r.cohort_ordinal, "cohortOrdinal", 1),
    firstSourceCoreId: integer(r.first_source_core_id, "firstSourceCoreId", 1),
    lastSourceCoreId: integer(r.last_source_core_id, "lastSourceCoreId", 1),
    coreCount: integer(r.core_count, "coreCount", 1, 100),
    uniqueOutcomeCount: integer(
      r.unique_outcome_count,
      "uniqueOutcomeCount",
      1,
    ),
    sourceObservationCount: integer(
      r.source_observation_count,
      "sourceObservationCount",
      1,
    ),
    retainedR2Bytes: integer(
      r.retained_r2_bytes,
      "retainedR2Bytes",
      1,
      64 * 1024 * 1024,
    ),
    receiptSetSha256: sha(r.receipt_set_sha256, "receiptSetSha256"),
    status,
    registeredCoreCount: integer(
      r.registered_core_count,
      "registeredCoreCount",
    ),
    registeredUniqueOutcomeCount: integer(
      r.registered_unique_outcome_count,
      "registeredUniqueOutcomeCount",
    ),
    registeredSourceObservationCount: integer(
      r.registered_source_observation_count,
      "registeredSourceObservationCount",
    ),
    registeredR2Bytes: integer(r.registered_r2_bytes, "registeredR2Bytes"),
    lastRegisteredSourceCoreId:
      r.last_registered_source_core_id == null
        ? null
        : integer(
            r.last_registered_source_core_id,
            "lastRegisteredSourceCoreId",
            1,
          ),
    completedReceiptSetSha256:
      r.completed_receipt_set_sha256 == null
        ? null
        : sha(r.completed_receipt_set_sha256, "completedReceiptSetSha256"),
    startedAt: instant(r.started_at, "startedAt"),
    updatedAt: instant(r.updated_at, "updatedAt"),
  });
  if (
    text(r.owner_id, "owner_id", 64).toLowerCase() !== owner ||
    result.generationId !== expected.generationId ||
    result.cohortOrdinal !== expected.cohortOrdinal ||
    (r.version !== 1 && r.version !== "1") ||
    result.registeredCoreCount > result.coreCount ||
    result.registeredUniqueOutcomeCount > result.uniqueOutcomeCount ||
    result.registeredSourceObservationCount > result.sourceObservationCount ||
    result.registeredR2Bytes > result.retainedR2Bytes ||
    (status === "complete" &&
      result.completedReceiptSetSha256 !== result.receiptSetSha256)
  )
    throw new Error("Race Merge Core outcome R2 checkpoint drifted");
  return result;
}
function manifest(
  value: unknown,
  generationId: string,
): RaceMergeCoreOutcomeR2Manifest {
  const r = row(value, "manifest");
  return Object.freeze({
    ...receipt({
      version: 1,
      generationId,
      sourceCoreId: integer(r.source_core_id, "sourceCoreId", 1),
      objectKey: text(r.object_key, "objectKey"),
      bodySha256: sha(r.body_sha256, "bodySha256"),
      byteLength: integer(r.byte_length, "byteLength", 1),
      uniqueOutcomeCount: integer(
        r.unique_outcome_count,
        "uniqueOutcomeCount",
        1,
      ),
      sourceObservationCount: integer(
        r.source_observation_count,
        "sourceObservationCount",
        1,
      ),
      firstSourceRaceId: text(r.first_source_race_id, "firstSourceRaceId", 512),
      lastSourceRaceId: text(r.last_source_race_id, "lastSourceRaceId", 512),
    }),
    registeredAt: instant(r.registered_at, "registeredAt"),
  });
}

export function createNeonRaceMergeCoreOutcomeR2GenerationRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    ownerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): RaceMergeCoreOutcomeR2GenerationRepository {
  const databaseUrl = input.databaseUrl.trim();
  if (!databaseUrl) throw new Error("databaseUrl is required");
  const databaseOwnerId = input.databaseOwnerId.trim().toLowerCase();
  if (!UUID.test(databaseOwnerId))
    throw new Error("databaseOwnerId is invalid");
  const configuredOwner = text(input.ownerId, "ownerId", 512);
  if (!ROLE.test(input.runtimeRole)) throw new Error("runtimeRole is invalid");
  const runtimeRole = input.runtimeRole;
  const factory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;
  async function tx<T>(
    ownerId: string,
    readOnly: boolean,
    run: (client: Awaited<ReturnType<typeof factory>>["client"]) => Promise<T>,
  ): Promise<T> {
    if (ownerId !== configuredOwner)
      throw new Error("Race Merge Core outcome R2 owner access denied");
    const session = await factory(databaseUrl);
    let begun = false;
    try {
      await session.client.query(
        readOnly
          ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
          : "BEGIN ISOLATION LEVEL SERIALIZABLE",
      );
      begun = true;
      await session.client.query(
        "SELECT set_config('app.owner_id',$1,true) AS owner_scope",
        [databaseOwnerId],
      );
      const v = one(
        await session.client.query(VERIFY_SQL, [
          databaseOwnerId,
          configuredOwner,
        ]),
        "isolation",
      );
      if (
        text(v.database_owner_id, "database_owner_id", 64).toLowerCase() !==
          databaseOwnerId ||
        text(v.authenticated_owner_id, "authenticated_owner_id", 512) !==
          configuredOwner ||
        !bool(v.all_rls_enabled, "all_rls_enabled") ||
        !bool(v.all_force_rls_enabled, "all_force_rls_enabled") ||
        bool(v.runtime_can_access_tables, "runtime_can_access_tables") ||
        !bool(v.runtime_can_begin, "runtime_can_begin") ||
        !bool(v.runtime_can_register, "runtime_can_register") ||
        !bool(v.runtime_can_finalize, "runtime_can_finalize") ||
        !bool(v.runtime_can_list, "runtime_can_list") ||
        bool(v.runtime_can_mutate, "runtime_can_mutate") ||
        text(v.session_user_name, "session_user_name", 63) !== runtimeRole ||
        text(v.current_user_name, "current_user_name", 63) !== runtimeRole ||
        [
          "runtime_is_superuser",
          "runtime_bypasses_rls",
          "runtime_can_create_roles",
          "runtime_can_create_databases",
          "runtime_can_create_in_database",
          "runtime_can_create_in_schema",
          "runtime_is_neon_superuser_member",
        ].some((k) => bool(v[k], k))
      )
        throw new Error(
          "Race Merge Core outcome R2 requires least-privilege owner isolation",
        );
      const result = await run(session.client);
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
    async begin(ownerId, request) {
      const a = authority(request.authority);
      const at = instant(request.startedAt, "startedAt");
      return tx(ownerId, false, async (c) =>
        checkpoint(
          one(
            await c.query(
              "SELECT * FROM dna.begin_race_merge_core_outcome_r2_generation($1::uuid,$2::jsonb,$3::timestamptz)",
              [databaseOwnerId, JSON.stringify(a), at],
            ),
            "begin",
          ),
          databaseOwnerId,
          a,
        ),
      );
    },
    async registerCore(ownerId, request) {
      const generationId = identifier(request.generationId, "generationId");
      const cohortOrdinal = integer(request.cohortOrdinal, "cohortOrdinal", 1);
      const r = receipt(request.receipt);
      if (r.generationId !== generationId)
        throw new Error("receipt generation does not match");
      const at = instant(request.registeredAt, "registeredAt");
      return tx(ownerId, false, async (c) =>
        checkpoint(
          one(
            await c.query(
              "SELECT * FROM dna.register_race_merge_core_outcome_r2_manifest($1::uuid,$2::text,$3::integer,$4::jsonb,$5::timestamptz)",
              [
                databaseOwnerId,
                generationId,
                cohortOrdinal,
                JSON.stringify(r),
                at,
              ],
            ),
            "register",
          ),
          databaseOwnerId,
          { generationId, cohortOrdinal },
        ),
      );
    },
    async finalize(ownerId, request) {
      const generationId = identifier(request.generationId, "generationId");
      const cohortOrdinal = integer(request.cohortOrdinal, "cohortOrdinal", 1);
      const digest = sha(request.receiptSetSha256, "receiptSetSha256");
      const at = instant(request.completedAt, "completedAt");
      return tx(ownerId, false, async (c) =>
        checkpoint(
          one(
            await c.query(
              "SELECT * FROM dna.finalize_race_merge_core_outcome_r2_generation($1::uuid,$2::text,$3::integer,$4::text,$5::timestamptz)",
              [databaseOwnerId, generationId, cohortOrdinal, digest, at],
            ),
            "finalize",
          ),
          databaseOwnerId,
          { generationId, cohortOrdinal },
        ),
      );
    },
    async listManifests(ownerId, request) {
      const generationId = identifier(request.generationId, "generationId");
      const cohortOrdinal = integer(request.cohortOrdinal, "cohortOrdinal", 1);
      const after = integer(request.afterSourceCoreId, "afterSourceCoreId");
      const limit = integer(request.limit, "limit", 1, 100);
      return tx(ownerId, true, async (c) =>
        Object.freeze(
          (
            await c.query(
              "SELECT * FROM dna.read_race_merge_core_outcome_r2_manifests($1::uuid,$2::text,$3::integer,$4::bigint,$5::integer)",
              [databaseOwnerId, generationId, cohortOrdinal, after, limit],
            )
          ).rows.map((v) => manifest(v, generationId)),
        ),
      );
    },
  });
}
