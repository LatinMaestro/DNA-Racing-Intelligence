import {
  dnaCoreRaceHistoryCoreSetSha256,
  validateDnaCoreRaceHistoryAcquisitionCycle,
  validateDnaCoreRaceHistoryCoreCheckpoint,
  validateDnaCoreRaceHistoryPageReceipt,
  type DnaCoreRaceHistoryAcquisitionRepository,
  type StoredDnaCoreRaceHistoryAcquisitionCycle,
  type StoredDnaCoreRaceHistoryCoreCheckpoint,
} from "./dna-core-race-history-acquisition-cycle";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;
const REVISION_PATTERN = /^[1-9][0-9]*$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

const SERIALIZATION_FAILURE_CODE = "40001";
const MAXIMUM_SERIALIZATION_ATTEMPTS = 3;

function isSerializationFailure(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const code = "code" in error ? (error as { code?: unknown }).code : null;
  if (code === SERIALIZATION_FAILURE_CODE) return true;
  return (
    error instanceof Error &&
    /could not serialize access due to concurrent update/iu.test(error.message)
  );
}

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
  "  checkpoint.relrowsecurity AS checkpoint_rls, checkpoint.relforcerowsecurity AS checkpoint_force_rls,",
  "  receipt.relrowsecurity AS receipt_rls, receipt.relforcerowsecurity AS receipt_force_rls,",
  "  population.relrowsecurity AS population_rls, population.relforcerowsecurity AS population_force_rls,",
  "  (has_table_privilege(session_user, 'dna.dna_core_race_history_acquisition_cycle', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_core_race_history_acquisition_attempt', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_core_race_history_core_checkpoint', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_core_race_history_page_receipt', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_population_core_history_authority', 'SELECT')) AS runtime_can_read_tables,",
  "  (has_table_privilege(session_user, 'dna.dna_core_race_history_acquisition_cycle', 'INSERT,UPDATE,DELETE')",
  "    OR has_table_privilege(session_user, 'dna.dna_core_race_history_acquisition_attempt', 'INSERT,UPDATE,DELETE')",
  "    OR has_table_privilege(session_user, 'dna.dna_core_race_history_core_checkpoint', 'INSERT,UPDATE,DELETE')",
  "    OR has_table_privilege(session_user, 'dna.dna_core_race_history_page_receipt', 'INSERT,UPDATE,DELETE')",
  "    OR has_table_privilege(session_user, 'dna.dna_population_core_history_authority', 'INSERT,UPDATE,DELETE')) AS runtime_can_write_tables,",
  "  has_function_privilege(session_user,",
  "    'dna.begin_dna_population_core_history_acquisition_attempt(uuid,jsonb,jsonb)', 'EXECUTE') AS runtime_can_begin_population,",
  "  has_function_privilege(session_user,",
  "    'dna.save_dna_core_race_history_acquisition_attempt(uuid,bigint,jsonb)', 'EXECUTE') AS runtime_can_save_attempt,",
  "  has_function_privilege(session_user,",
  "    'dna.save_dna_core_race_history_page_progress(uuid,bigint,jsonb,jsonb)', 'EXECUTE') AS runtime_can_save_page,",
  "  has_function_privilege(session_user,",
  "    'dna.read_dna_core_race_history_acquisition_attempt(uuid,text,integer)', 'EXECUTE') AS runtime_can_read_attempt,",
  "  has_function_privilege(session_user,",
  "    'dna.read_latest_complete_dna_core_race_history_acquisition(uuid)', 'EXECUTE') AS runtime_can_read_latest,",
  "  has_function_privilege(session_user,",
  "    'dna.read_next_dna_core_race_history_checkpoint(uuid,text,integer)', 'EXECUTE') AS runtime_can_read_next,",
  "  has_function_privilege(session_user,",
  "    'dna.read_dna_core_race_history_checkpoints(uuid,text,integer)', 'EXECUTE') AS runtime_can_read_cores,",
  "  session_user::text AS session_user_name, current_user::text AS current_user_name,",
  "  role.rolsuper AS runtime_is_superuser, role.rolbypassrls AS runtime_bypasses_rls,",
  "  role.rolcreaterole AS runtime_can_create_roles, role.rolcreatedb AS runtime_can_create_databases,",
  "  has_database_privilege(session_user, current_database(), 'CREATE') AS runtime_can_create_in_database,",
  "  has_schema_privilege(session_user, 'dna', 'CREATE') AS runtime_can_create_in_schema,",
  "  COALESCE(pg_has_role(session_user, (SELECT oid FROM pg_catalog.pg_roles",
  "    WHERE rolname = 'neon_superuser'), 'MEMBER'), false) AS runtime_is_neon_superuser_member",
  "FROM dna.app_owner owner",
  "JOIN pg_catalog.pg_class cycle",
  "  ON cycle.oid = 'dna.dna_core_race_history_acquisition_cycle'::regclass",
  "JOIN pg_catalog.pg_class attempt",
  "  ON attempt.oid = 'dna.dna_core_race_history_acquisition_attempt'::regclass",
  "JOIN pg_catalog.pg_class checkpoint",
  "  ON checkpoint.oid = 'dna.dna_core_race_history_core_checkpoint'::regclass",
  "JOIN pg_catalog.pg_class receipt",
  "  ON receipt.oid = 'dna.dna_core_race_history_page_receipt'::regclass",
  "JOIN pg_catalog.pg_class population",
  "  ON population.oid = 'dna.dna_population_core_history_authority'::regclass",
  "JOIN pg_catalog.pg_roles role ON role.rolname = session_user",
  "WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2",
].join("\n");

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
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean`);
  return value;
}

function json(value: unknown, field: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${field} must be valid JSON`);
  }
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

function role(value: string): string {
  const normalized = value.trim();
  if (!ROLE_PATTERN.test(normalized)) throw new Error("runtimeRole is invalid");
  return normalized;
}

function revision(value: unknown, field: string): string {
  const normalized =
    typeof value === "bigint" || typeof value === "number"
      ? String(value)
      : text(value, field);
  if (!REVISION_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
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

function storedCycle(row: DbRow): StoredDnaCoreRaceHistoryAcquisitionCycle {
  return Object.freeze({
    revision: revision(row.revision, "revision"),
    cycle: validateDnaCoreRaceHistoryAcquisitionCycle(
      json(
        row.cycle,
        "cycle",
      ) as StoredDnaCoreRaceHistoryAcquisitionCycle["cycle"],
    ),
  });
}

function storedCheckpoint(row: DbRow): StoredDnaCoreRaceHistoryCoreCheckpoint {
  return Object.freeze({
    revision: revision(row.revision, "revision"),
    checkpoint: validateDnaCoreRaceHistoryCoreCheckpoint(
      json(
        row.checkpoint,
        "checkpoint",
      ) as StoredDnaCoreRaceHistoryCoreCheckpoint["checkpoint"],
    ),
  });
}

function verifyIsolation(
  result: QueryResult,
  input: { databaseOwnerId: string; ownerId: string; runtimeRole: string },
): void {
  const row = oneRow(result, "DNA Core history acquisition isolation");
  if (
    text(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    text(row.authenticated_owner_id, "authenticated_owner_id") !== input.ownerId
  ) {
    throw new Error("DNA Core history acquisition owner scope denied.");
  }
  for (const field of [
    "cycle_rls",
    "cycle_force_rls",
    "attempt_rls",
    "attempt_force_rls",
    "checkpoint_rls",
    "checkpoint_force_rls",
    "receipt_rls",
    "receipt_force_rls",
    "population_rls",
    "population_force_rls",
  ]) {
    if (!bool(row[field], field)) {
      throw new Error(
        "DNA Core history acquisition requires forced owner RLS.",
      );
    }
  }
  if (
    bool(row.runtime_can_read_tables, "runtime_can_read_tables") ||
    bool(row.runtime_can_write_tables, "runtime_can_write_tables")
  ) {
    throw new Error(
      "DNA Core history acquisition table access is not bounded.",
    );
  }
  for (const field of [
    "runtime_can_save_attempt",
    "runtime_can_begin_population",
    "runtime_can_save_page",
    "runtime_can_read_attempt",
    "runtime_can_read_latest",
    "runtime_can_read_next",
    "runtime_can_read_cores",
  ]) {
    if (!bool(row[field], field)) {
      throw new Error(
        "DNA Core history acquisition function access is incomplete.",
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
      row.runtime_can_create_in_database,
      "runtime_can_create_in_database",
    ) ||
    bool(row.runtime_can_create_in_schema, "runtime_can_create_in_schema") ||
    bool(
      row.runtime_is_neon_superuser_member,
      "runtime_is_neon_superuser_member",
    )
  ) {
    throw new Error("DNA Core history acquisition runtime role is unsafe.");
  }
}

export function createNeonDnaCoreRaceHistoryAcquisitionRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  ownerId: string;
  runtimeRole: string;
  populationAuthority?: Readonly<{
    generationId: string;
    coreIds: readonly number[];
  }>;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): DnaCoreRaceHistoryAcquisitionRepository {
  const databaseUrl = input.databaseUrl.trim();
  if (databaseUrl === "") throw new Error("databaseUrl is required");
  const databaseOwnerId = uuid(input.databaseOwnerId, "databaseOwnerId");
  const ownerId = owner(input.ownerId);
  const runtimeRole = role(input.runtimeRole);
  const populationAuthority =
    input.populationAuthority === undefined
      ? null
      : Object.freeze({
          generationId: uuid(
            input.populationAuthority.generationId,
            "populationAuthority.generationId",
          ),
          coreIds: Object.freeze([...input.populationAuthority.coreIds]),
          coreSetSha256: dnaCoreRaceHistoryCoreSetSha256(
            input.populationAuthority.coreIds,
          ),
        });
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  async function transaction<T>(request: {
    readOnly: boolean;
    run: (
      client: Awaited<ReturnType<typeof sessionFactory>>["client"],
    ) => Promise<T>;
  }): Promise<T> {
    for (
      let attempt = 1;
      attempt <= MAXIMUM_SERIALIZATION_ATTEMPTS;
      attempt += 1
    ) {
      const session = await sessionFactory(databaseUrl);
      let begun = false;
      try {
        await session.client.query(
          request.readOnly
            ? "BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY"
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
        if (begun)
          await session.client.query("ROLLBACK").catch(() => undefined);
        if (
          isSerializationFailure(error) &&
          attempt < MAXIMUM_SERIALIZATION_ATTEMPTS
        ) {
          // Write transactions retain serializable isolation. Read-only
          // acquisition-state transactions use statement-consistent
          // read-committed snapshots so concurrent writers cannot force
          // serialization failures during safe observation reads.
          await new Promise<void>((resolve) =>
            setTimeout(resolve, attempt * 1_000),
          );
          continue;
        }
        throw error;
      } finally {
        await session.close();
      }
    }
    throw new Error(
      "DNA Core history acquisition serialization retry exhausted.",
    );
  }

  return Object.freeze({
    async loadAttempt(request) {
      const id = cycleId(request.cycleId);
      const attempt = attemptNumber(request.attemptNumber);
      return transaction({
        readOnly: true,
        async run(client) {
          const result = await client.query(
            "SELECT revision::text, cycle FROM dna.read_dna_core_race_history_acquisition_attempt($1::uuid,$2::text,$3::integer)",
            [databaseOwnerId, id, attempt],
          );
          return result.rows.length === 0
            ? null
            : storedCycle(
                oneRow(result, "DNA Core history acquisition attempt"),
              );
        },
      });
    },

    async loadLatestComplete() {
      return transaction({
        readOnly: true,
        async run(client) {
          const result = await client.query(
            "SELECT revision::text, cycle FROM dna.read_latest_complete_dna_core_race_history_acquisition($1::uuid)",
            [databaseOwnerId],
          );
          return result.rows.length === 0
            ? null
            : storedCycle(
                oneRow(result, "latest complete DNA Core history acquisition"),
              );
        },
      });
    },

    async loadNextCore(request) {
      const id = cycleId(request.cycleId);
      const attempt = attemptNumber(request.attemptNumber);
      return transaction({
        readOnly: true,
        async run(client) {
          const result = await client.query(
            "SELECT revision::text, checkpoint FROM dna.read_next_dna_core_race_history_checkpoint($1::uuid,$2::text,$3::integer)",
            [databaseOwnerId, id, attempt],
          );
          return result.rows.length === 0
            ? null
            : storedCheckpoint(
                oneRow(result, "next DNA Core history checkpoint"),
              );
        },
      });
    },

    async loadCores(request) {
      const id = cycleId(request.cycleId);
      const attempt = attemptNumber(request.attemptNumber);
      return transaction({
        readOnly: true,
        async run(client) {
          const result = await client.query(
            "SELECT revision::text, checkpoint FROM dna.read_dna_core_race_history_checkpoints($1::uuid,$2::text,$3::integer)",
            [databaseOwnerId, id, attempt],
          );
          return Object.freeze(
            result.rows.map((row) =>
              storedCheckpoint(record(row, "Core checkpoint")),
            ),
          );
        },
      });
    },

    async saveAttempt(request) {
      const cycle = validateDnaCoreRaceHistoryAcquisitionCycle(request.cycle);
      const expectedRevision =
        request.expectedRevision === null
          ? null
          : revision(request.expectedRevision, "expectedRevision");
      return transaction({
        readOnly: false,
        async run(client) {
          const usePopulationBootstrap =
            expectedRevision === null &&
            populationAuthority !== null &&
            cycle.attemptNumber === 1 &&
            cycle.currentStateGenerationId ===
              populationAuthority.generationId &&
            cycle.coreSetSha256 === populationAuthority.coreSetSha256 &&
            cycle.coreIds.length === populationAuthority.coreIds.length &&
            cycle.coreIds.every(
              (coreId, index) => coreId === populationAuthority.coreIds[index],
            );
          const result = usePopulationBootstrap
            ? await client.query(
                "SELECT revision::text, cycle FROM dna.begin_dna_population_core_history_acquisition_attempt($1::uuid,$2::jsonb,$3::jsonb)",
                [
                  databaseOwnerId,
                  JSON.stringify({
                    version: 1,
                    generationId: populationAuthority.generationId,
                    coreSetSha256: populationAuthority.coreSetSha256,
                    coreIds: populationAuthority.coreIds,
                  }),
                  JSON.stringify(cycle),
                ],
              )
            : await client.query(
                "SELECT revision::text, cycle FROM dna.save_dna_core_race_history_acquisition_attempt($1::uuid,$2::bigint,$3::jsonb)",
                [databaseOwnerId, expectedRevision, JSON.stringify(cycle)],
              );
          const stored = storedCycle(
            oneRow(result, "DNA Core history acquisition attempt save"),
          );
          if (
            dnaOpenLabRawEvidenceSha256(stored.cycle) !==
            dnaOpenLabRawEvidenceSha256(cycle)
          ) {
            throw new Error("DNA Core history acquisition response drifted.");
          }
          return stored;
        },
      });
    },

    async savePage(request) {
      const checkpoint = validateDnaCoreRaceHistoryCoreCheckpoint(
        request.checkpoint,
      );
      const receipt = validateDnaCoreRaceHistoryPageReceipt(request.receipt);
      const expectedCoreRevision = revision(
        request.expectedCoreRevision,
        "expectedCoreRevision",
      );
      return transaction({
        readOnly: false,
        async run(client) {
          const result = await client.query(
            "SELECT revision::text, checkpoint FROM dna.save_dna_core_race_history_page_progress($1::uuid,$2::bigint,$3::jsonb,$4::jsonb)",
            [
              databaseOwnerId,
              expectedCoreRevision,
              JSON.stringify(checkpoint),
              JSON.stringify(receipt),
            ],
          );
          const stored = storedCheckpoint(
            oneRow(result, "DNA Core history page progress save"),
          );
          if (
            dnaOpenLabRawEvidenceSha256(stored.checkpoint) !==
            dnaOpenLabRawEvidenceSha256(checkpoint)
          ) {
            throw new Error("DNA Core history checkpoint response drifted.");
          }
          return stored;
        },
      });
    },
  });
}
