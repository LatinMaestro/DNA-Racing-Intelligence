import {
  validateDnaFinishedRaceIncrementalCycle,
  type DnaFinishedRaceIncrementalCycle,
  type DnaFinishedRaceIncrementalCycleRepository,
  type StoredDnaFinishedRaceIncrementalCycle,
} from "./dna-open-lab-finished-race-incremental-cycle";
import { validateDnaFinishedRaceWindowPublicationReceipt } from "./dna-open-lab-finished-race-backfill";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;
const REVISION_PATTERN = /^[1-9][0-9]*$/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;
type DbRow = Record<string, unknown>;

const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";

const VERIFY_ISOLATION_SQL = [
  "SELECT",
  "  owner.id::text AS database_owner_id,",
  "  owner.clerk_user_id AS authenticated_owner_id,",
  "  cycle.relrowsecurity AS cycle_rls, cycle.relforcerowsecurity AS cycle_force_rls,",
  "  attempt.relrowsecurity AS attempt_rls, attempt.relforcerowsecurity AS attempt_force_rls,",
  "  receipt.relrowsecurity AS receipt_rls, receipt.relforcerowsecurity AS receipt_force_rls,",
  "  (has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_incremental_cycle', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_incremental_cycle', 'INSERT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_incremental_cycle', 'UPDATE')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_incremental_cycle', 'DELETE'))",
  "    AS runtime_can_access_cycle,",
  "  (has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_incremental_attempt', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_incremental_attempt', 'INSERT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_incremental_attempt', 'UPDATE')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_incremental_attempt', 'DELETE'))",
  "    AS runtime_can_access_attempt,",
  "  (has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_incremental_window_receipt', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_incremental_window_receipt', 'INSERT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_incremental_window_receipt', 'UPDATE')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_incremental_window_receipt', 'DELETE'))",
  "    AS runtime_can_access_receipt,",
  "  has_function_privilege(session_user,",
  "    'dna.save_dna_open_lab_finished_race_incremental_cycle(uuid,bigint,jsonb)', 'EXECUTE') AS runtime_can_save,",
  "  has_function_privilege(session_user,",
  "    'dna.save_dna_open_lab_finished_race_incremental_progress(uuid,bigint,jsonb,jsonb)', 'EXECUTE') AS runtime_can_save_progress,",
  "  has_function_privilege(session_user,",
  "    'dna.read_dna_open_lab_finished_race_incremental_cycle(uuid,text,integer)', 'EXECUTE') AS runtime_can_read,",
  "  has_function_privilege(session_user,",
  "    'dna.read_latest_complete_dna_finished_race_incremental_cycle(uuid)', 'EXECUTE') AS runtime_can_read_latest,",
  "  session_user::text AS session_user_name, current_user::text AS current_user_name,",
  "  role.rolsuper AS runtime_is_superuser, role.rolbypassrls AS runtime_bypasses_rls,",
  "  role.rolcreaterole AS runtime_can_create_roles, role.rolcreatedb AS runtime_can_create_databases,",
  "  COALESCE(pg_has_role(session_user, (SELECT oid FROM pg_catalog.pg_roles",
  "    WHERE rolname = 'neon_superuser'), 'MEMBER'), false) AS runtime_is_neon_superuser_member",
  "FROM dna.app_owner owner",
  "JOIN pg_catalog.pg_class cycle",
  "  ON cycle.oid = 'dna.dna_open_lab_finished_race_incremental_cycle'::regclass",
  "JOIN pg_catalog.pg_class attempt",
  "  ON attempt.oid = 'dna.dna_open_lab_finished_race_incremental_attempt'::regclass",
  "JOIN pg_catalog.pg_class receipt",
  "  ON receipt.oid = 'dna.dna_open_lab_finished_race_incremental_window_receipt'::regclass",
  "JOIN pg_catalog.pg_roles role ON role.rolname = session_user",
  "WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2",
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

function revision(value: unknown, field: string): string {
  const normalized =
    typeof value === "bigint" || typeof value === "number"
      ? String(value)
      : text(value, field);
  if (!REVISION_PATTERN.test(normalized))
    throw new Error(`${field} is invalid`);
  return normalized;
}

function cycleId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) throw new Error("cycleId is invalid");
  return normalized;
}

function attemptNumber(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 32) {
    throw new Error("attemptNumber is invalid");
  }
  return value;
}

function json(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("cycle must be valid JSON");
  }
}

function stored(row: DbRow): StoredDnaFinishedRaceIncrementalCycle {
  return Object.freeze({
    revision: revision(row.revision, "revision"),
    cycle: validateDnaFinishedRaceIncrementalCycle(
      json(row.cycle) as DnaFinishedRaceIncrementalCycle,
    ),
  });
}

function verifyIsolation(
  result: QueryResult,
  input: { databaseOwnerId: string; ownerId: string; runtimeRole: string },
): void {
  const row = oneRow(result, "DNA finished-race incremental isolation");
  if (
    text(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    text(row.authenticated_owner_id, "authenticated_owner_id") !== input.ownerId
  ) {
    throw new Error("DNA finished-race incremental owner scope denied.");
  }
  for (const field of [
    "cycle_rls",
    "cycle_force_rls",
    "attempt_rls",
    "attempt_force_rls",
    "receipt_rls",
    "receipt_force_rls",
  ]) {
    if (!bool(row[field], field)) {
      throw new Error(
        "DNA finished-race incremental requires forced owner RLS.",
      );
    }
  }
  if (
    bool(row.runtime_can_access_cycle, "runtime_can_access_cycle") ||
    bool(row.runtime_can_access_attempt, "runtime_can_access_attempt") ||
    bool(row.runtime_can_access_receipt, "runtime_can_access_receipt")
  ) {
    throw new Error(
      "DNA finished-race incremental table access is not bounded.",
    );
  }
  for (const field of [
    "runtime_can_save",
    "runtime_can_save_progress",
    "runtime_can_read",
    "runtime_can_read_latest",
  ]) {
    if (!bool(row[field], field)) {
      throw new Error(
        "DNA finished-race incremental function privilege is incomplete.",
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
      "DNA finished-race incremental runtime role is not least privileged.",
    );
  }
}

export function createNeonDnaFinishedRaceIncrementalCycleRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  ownerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): DnaFinishedRaceIncrementalCycleRepository {
  const databaseUrl = input.databaseUrl.trim();
  const databaseOwnerId = uuid(input.databaseOwnerId, "databaseOwnerId");
  const ownerId = owner(input.ownerId);
  const runtimeRole = input.runtimeRole.trim();
  if (databaseUrl === "") throw new Error("databaseUrl is required");
  if (!ROLE_PATTERN.test(runtimeRole))
    throw new Error("runtimeRole is invalid");
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  async function transaction<T>(request: {
    readOnly: boolean;
    run: (
      client: Awaited<ReturnType<typeof sessionFactory>>["client"],
    ) => Promise<T>;
  }): Promise<T> {
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
    async load(request) {
      const normalizedCycleId = cycleId(request.cycleId);
      const normalizedAttempt = attemptNumber(request.attemptNumber);
      return transaction({
        readOnly: true,
        async run(client) {
          const result = await client.query(
            "SELECT revision::text, cycle FROM dna.read_dna_open_lab_finished_race_incremental_cycle($1::uuid,$2::text,$3::integer)",
            [databaseOwnerId, normalizedCycleId, normalizedAttempt],
          );
          return result.rows.length === 0
            ? null
            : stored(oneRow(result, "DNA finished-race incremental cycle"));
        },
      });
    },

    async loadLatestComplete() {
      return transaction({
        readOnly: true,
        async run(client) {
          const result = await client.query(
            "SELECT revision::text, cycle FROM dna.read_latest_complete_dna_finished_race_incremental_cycle($1::uuid)",
            [databaseOwnerId],
          );
          return result.rows.length === 0
            ? null
            : stored(
                oneRow(
                  result,
                  "latest complete DNA finished-race incremental cycle",
                ),
              );
        },
      });
    },

    async save(request) {
      const normalizedCycle = validateDnaFinishedRaceIncrementalCycle(
        request.cycle,
      );
      const expectedRevision =
        request.expectedRevision === null
          ? null
          : revision(request.expectedRevision, "expectedRevision");
      return transaction({
        readOnly: false,
        async run(client) {
          const result = await client.query(
            "SELECT revision::text, cycle FROM dna.save_dna_open_lab_finished_race_incremental_cycle($1::uuid,$2::bigint,$3::jsonb)",
            [
              databaseOwnerId,
              expectedRevision,
              JSON.stringify(normalizedCycle),
            ],
          );
          const saved = stored(
            oneRow(result, "DNA finished-race incremental cycle save"),
          );
          if (
            dnaOpenLabRawEvidenceSha256(saved.cycle) !==
            dnaOpenLabRawEvidenceSha256(normalizedCycle)
          ) {
            throw new Error(
              "DNA finished-race incremental cycle response drifted.",
            );
          }
          return saved;
        },
      });
    },

    async saveProgress(request) {
      const normalizedCycle = validateDnaFinishedRaceIncrementalCycle(
        request.cycle,
      );
      const expectedRevision = revision(
        request.expectedRevision,
        "expectedRevision",
      );
      const publication =
        request.publication === undefined
          ? null
          : Object.freeze({
              window: request.publication.window,
              receipt: validateDnaFinishedRaceWindowPublicationReceipt(
                request.publication.receipt,
              ),
            });
      return transaction({
        readOnly: false,
        async run(client) {
          const result = await client.query(
            "SELECT revision::text, cycle FROM dna.save_dna_open_lab_finished_race_incremental_progress($1::uuid,$2::bigint,$3::jsonb,$4::jsonb)",
            [
              databaseOwnerId,
              expectedRevision,
              JSON.stringify(normalizedCycle),
              publication === null ? null : JSON.stringify(publication),
            ],
          );
          const saved = stored(
            oneRow(result, "DNA finished-race incremental progress save"),
          );
          if (
            dnaOpenLabRawEvidenceSha256(saved.cycle) !==
            dnaOpenLabRawEvidenceSha256(normalizedCycle)
          ) {
            throw new Error(
              "DNA finished-race incremental progress response drifted.",
            );
          }
          return saved;
        },
      });
    },
  });
}
