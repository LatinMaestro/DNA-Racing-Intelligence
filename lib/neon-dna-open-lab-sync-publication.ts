import {
  createInitialDnaLastGoodSyncState,
  inspectDnaCurrentStateCandidate,
  type DnaCurrentStateCandidate,
  type DnaLastGoodSyncState,
  type DnaSyncInterruptionReason,
} from "./dna-open-lab-last-good-publication";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;
type DbRow = Record<string, unknown>;

export type NeonDnaOpenLabSyncPublicationRepository = Readonly<{
  publishCandidate: (input: {
    ownerId: string;
    candidate: DnaCurrentStateCandidate;
    recordedAt: string;
    acceptedAt: string;
  }) => Promise<DnaLastGoodSyncState>;
  pause: (input: {
    ownerId: string;
    reason: DnaSyncInterruptionReason;
    attemptedAt: string;
    retryAfterSeconds?: number | null;
  }) => Promise<DnaLastGoodSyncState>;
  read: (input: { ownerId: string }) => Promise<DnaLastGoodSyncState>;
}>;

const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";

const VERIFY_ISOLATION_SQL = [
  "SELECT",
  "  owner.id::text AS database_owner_id,",
  "  owner.clerk_user_id AS authenticated_owner_id,",
  "  generation.relrowsecurity AS generation_rls,",
  "  generation.relforcerowsecurity AS generation_force_rls,",
  "  family.relrowsecurity AS family_rls,",
  "  family.relforcerowsecurity AS family_force_rls,",
  "  state.relrowsecurity AS state_rls,",
  "  state.relforcerowsecurity AS state_force_rls,",
  "  (has_table_privilege(session_user, 'dna.dna_open_lab_sync_generation', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_sync_generation', 'INSERT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_sync_generation', 'UPDATE')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_sync_generation', 'DELETE'))",
  "    AS runtime_can_access_generation,",
  "  (has_table_privilege(session_user, 'dna.dna_open_lab_sync_family', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_sync_family', 'INSERT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_sync_family', 'UPDATE')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_sync_family', 'DELETE'))",
  "    AS runtime_can_access_family,",
  "  (has_table_privilege(session_user, 'dna.dna_open_lab_sync_state', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_sync_state', 'INSERT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_sync_state', 'UPDATE')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_sync_state', 'DELETE'))",
  "    AS runtime_can_access_state,",
  "  has_function_privilege(session_user,",
  "    'dna.stage_dna_open_lab_sync_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb)', 'EXECUTE')",
  "    AS runtime_can_stage,",
  "  has_function_privilege(session_user,",
  "    'dna.publish_dna_open_lab_sync_candidate(uuid,uuid,timestamp with time zone)', 'EXECUTE')",
  "    AS runtime_can_publish,",
  "  has_function_privilege(session_user,",
  "    'dna.pause_dna_open_lab_sync(uuid,text,timestamp with time zone,integer)', 'EXECUTE')",
  "    AS runtime_can_pause,",
  "  has_function_privilege(session_user,",
  "    'dna.read_dna_open_lab_sync_state(uuid)', 'EXECUTE') AS runtime_can_read,",
  "  session_user::text AS session_user_name, current_user::text AS current_user_name,",
  "  role.rolsuper AS runtime_is_superuser, role.rolbypassrls AS runtime_bypasses_rls,",
  "  role.rolcreaterole AS runtime_can_create_roles, role.rolcreatedb AS runtime_can_create_databases,",
  "  COALESCE(pg_has_role(session_user, (SELECT oid FROM pg_catalog.pg_roles",
  "    WHERE rolname = 'neon_superuser'), 'MEMBER'), false) AS runtime_is_neon_superuser_member",
  "FROM dna.app_owner owner",
  "JOIN pg_catalog.pg_class generation",
  "  ON generation.oid = 'dna.dna_open_lab_sync_generation'::regclass",
  "JOIN pg_catalog.pg_class family",
  "  ON family.oid = 'dna.dna_open_lab_sync_family'::regclass",
  "JOIN pg_catalog.pg_class state",
  "  ON state.oid = 'dna.dna_open_lab_sync_state'::regclass",
  "JOIN pg_catalog.pg_roles role ON role.rolname = session_user",
  "WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2",
].join("\n");

const READ_STATE_SQL = [
  "SELECT accepted_generation_id::text, accepted_observed_at, accepted_at,",
  "  serving_generation_id::text, sync_status, catch_up_required, last_attempt_at,",
  "  last_interruption_reason, last_interruption_at, retry_after_seconds,",
  "  last_catch_up_completed_at",
  "FROM dna.read_dna_open_lab_sync_state($1::uuid)",
].join("\n");

function record(value: unknown, field: string): DbRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
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
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean`);
  return value;
}

function optionalText(value: unknown, field: string): string | null {
  return value === null ? null : text(value, field);
}

function uuid(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized))
    throw new Error(`${field} must be a UUID`);
  return normalized;
}

function owner(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 512 ||
    CONTROL_PATTERN.test(normalized)
  ) {
    throw new Error("ownerId is invalid");
  }
  return normalized;
}

function timestamp(value: unknown, field: string): string {
  const raw = value instanceof Date ? value.toISOString() : text(value, field);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} is invalid`);
  return parsed.toISOString();
}

function optionalTimestamp(value: unknown, field: string): string | null {
  return value === null ? null : timestamp(value, field);
}

function retryAfter(value: unknown): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 86_400) {
    throw new Error("retry_after_seconds is invalid");
  }
  return parsed;
}

function state(result: QueryResult): DnaLastGoodSyncState {
  if (result.rows.length === 0) return createInitialDnaLastGoodSyncState();
  const row = oneRow(result, "DNA Open Lab sync state");
  const syncStatus = text(row.sync_status, "sync_status");
  if (
    syncStatus !== "never_synced" &&
    syncStatus !== "current" &&
    syncStatus !== "paused" &&
    syncStatus !== "catching_up"
  ) {
    throw new Error("DNA Open Lab sync status is invalid");
  }
  const interruptionReason = optionalText(
    row.last_interruption_reason,
    "last_interruption_reason",
  );
  if (
    interruptionReason !== null &&
    interruptionReason !== "rate_limited" &&
    interruptionReason !== "api_ineligible" &&
    interruptionReason !== "api_unavailable" &&
    interruptionReason !== "partial_refresh" &&
    interruptionReason !== "invalid_payload"
  ) {
    throw new Error("DNA Open Lab interruption reason is invalid");
  }
  const interruptionAt = optionalTimestamp(
    row.last_interruption_at,
    "last_interruption_at",
  );
  if ((interruptionReason === null) !== (interruptionAt === null)) {
    throw new Error("DNA Open Lab interruption state is incomplete");
  }
  return Object.freeze({
    acceptedGenerationId: optionalText(
      row.accepted_generation_id,
      "accepted_generation_id",
    ),
    acceptedObservedAt: optionalTimestamp(
      row.accepted_observed_at,
      "accepted_observed_at",
    ),
    acceptedAt: optionalTimestamp(row.accepted_at, "accepted_at"),
    servingGenerationId: optionalText(
      row.serving_generation_id,
      "serving_generation_id",
    ),
    syncStatus,
    catchUpRequired: bool(row.catch_up_required, "catch_up_required"),
    lastAttemptAt: optionalTimestamp(row.last_attempt_at, "last_attempt_at"),
    lastInterruption:
      interruptionReason === null
        ? null
        : Object.freeze({
            reason: interruptionReason,
            at: interruptionAt!,
            retryAfterSeconds: retryAfter(row.retry_after_seconds),
          }),
    lastCatchUpCompletedAt: optionalTimestamp(
      row.last_catch_up_completed_at,
      "last_catch_up_completed_at",
    ),
  });
}

function verifyIsolation(
  result: QueryResult,
  input: { databaseOwnerId: string; ownerId: string; runtimeRole: string },
): void {
  const row = oneRow(result, "DNA Open Lab sync isolation");
  if (
    text(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    text(row.authenticated_owner_id, "authenticated_owner_id") !== input.ownerId
  ) {
    throw new Error("DNA Open Lab sync owner scope denied.");
  }
  for (const field of [
    "generation_rls",
    "generation_force_rls",
    "family_rls",
    "family_force_rls",
    "state_rls",
    "state_force_rls",
  ]) {
    if (!bool(row[field], field)) {
      throw new Error(
        "DNA Open Lab sync publication requires forced owner RLS.",
      );
    }
  }
  if (
    bool(row.runtime_can_access_generation, "runtime_can_access_generation") ||
    bool(row.runtime_can_access_family, "runtime_can_access_family") ||
    bool(row.runtime_can_access_state, "runtime_can_access_state")
  ) {
    throw new Error("DNA Open Lab sync table access is not bounded.");
  }
  for (const field of [
    "runtime_can_stage",
    "runtime_can_publish",
    "runtime_can_pause",
    "runtime_can_read",
  ]) {
    if (!bool(row[field], field)) {
      throw new Error("DNA Open Lab sync function privilege is incomplete.");
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
    throw new Error("DNA Open Lab sync runtime role is not least privileged.");
  }
}

export function createNeonDnaOpenLabSyncPublicationRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): NeonDnaOpenLabSyncPublicationRepository {
  const databaseUrl = input.databaseUrl.trim();
  const databaseOwnerId = uuid(input.databaseOwnerId, "databaseOwnerId");
  const runtimeRole = input.runtimeRole.trim();
  if (!databaseUrl) throw new Error("databaseUrl is required");
  if (!ROLE_PATTERN.test(runtimeRole))
    throw new Error("runtimeRole is invalid");
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  async function transaction<T>(request: {
    ownerId: string;
    readOnly: boolean;
    run: (
      client: Awaited<ReturnType<typeof sessionFactory>>["client"],
    ) => Promise<T>;
  }): Promise<T> {
    const ownerId = owner(request.ownerId);
    const session = await sessionFactory(databaseUrl);
    let begun = false;
    try {
      await session.client.query(
        request.readOnly
          ? "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY"
          : "BEGIN ISOLATION LEVEL SERIALIZABLE",
      );
      begun = true;
      await session.client.query(SET_OWNER_SCOPE_SQL, [databaseOwnerId]);
      verifyIsolation(
        await session.client.query(VERIFY_ISOLATION_SQL, [
          databaseOwnerId,
          ownerId,
        ]),
        { databaseOwnerId, ownerId, runtimeRole },
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
    async publishCandidate(request) {
      const readiness = inspectDnaCurrentStateCandidate(request.candidate);
      if (!readiness.ready) {
        throw new Error(
          `DNA Open Lab candidate is incomplete: ${readiness.incompleteFamilies.join(", ")}`,
        );
      }
      const generationId = uuid(request.candidate.generationId, "generationId");
      const recordedAt = timestamp(request.recordedAt, "recordedAt");
      const acceptedAt = timestamp(request.acceptedAt, "acceptedAt");
      return transaction({
        ownerId: request.ownerId,
        readOnly: false,
        async run(client) {
          const staged = oneRow(
            await client.query(
              "SELECT dna.stage_dna_open_lab_sync_candidate($1::uuid,$2::uuid,$3::timestamptz,$4::timestamptz,$5::jsonb) AS status",
              [
                databaseOwnerId,
                generationId,
                request.candidate.observedAt,
                recordedAt,
                JSON.stringify(request.candidate.families),
              ],
            ),
            "DNA Open Lab candidate staging",
          );
          const stageStatus = text(staged.status, "status");
          if (stageStatus !== "staged" && stageStatus !== "published") {
            throw new Error("DNA Open Lab candidate staging status is invalid");
          }
          const published = oneRow(
            await client.query(
              "SELECT dna.publish_dna_open_lab_sync_candidate($1::uuid,$2::uuid,$3::timestamptz) AS status",
              [databaseOwnerId, generationId, acceptedAt],
            ),
            "DNA Open Lab candidate publication",
          );
          if (text(published.status, "status") !== "published") {
            throw new Error("DNA Open Lab publication status is invalid");
          }
          return state(await client.query(READ_STATE_SQL, [databaseOwnerId]));
        },
      });
    },

    async pause(request) {
      const attemptedAt = timestamp(request.attemptedAt, "attemptedAt");
      const retry = request.retryAfterSeconds ?? null;
      if (
        retry !== null &&
        (!Number.isSafeInteger(retry) || retry < 0 || retry > 86_400)
      ) {
        throw new Error("retryAfterSeconds is invalid");
      }
      return transaction({
        ownerId: request.ownerId,
        readOnly: false,
        async run(client) {
          const paused = oneRow(
            await client.query(
              "SELECT dna.pause_dna_open_lab_sync($1::uuid,$2::text,$3::timestamptz,$4::integer) AS status",
              [databaseOwnerId, request.reason, attemptedAt, retry],
            ),
            "DNA Open Lab sync pause",
          );
          if (text(paused.status, "status") !== "paused") {
            throw new Error("DNA Open Lab pause status is invalid");
          }
          return state(await client.query(READ_STATE_SQL, [databaseOwnerId]));
        },
      });
    },

    async read(request) {
      return transaction({
        ownerId: request.ownerId,
        readOnly: true,
        run: async (client) =>
          state(await client.query(READ_STATE_SQL, [databaseOwnerId])),
      });
    },
  });
}
