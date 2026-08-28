import {
  validateDnaCurrentStateAcquisitionCycleCheckpointDocument,
  type DnaCurrentStateAcquisitionCycleCheckpointRepository,
  type StoredDnaCurrentStateAcquisitionCycleCheckpoint,
} from "./dna-open-lab-current-state-acquisition-runner";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;
const REVISION_PATTERN = /^[1-9][0-9]*$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;
type DbRow = Record<string, unknown>;

const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";

const VERIFY_ISOLATION_SQL = [
  "SELECT",
  "  owner.id::text AS database_owner_id,",
  "  owner.clerk_user_id AS authenticated_owner_id,",
  "  cycle.relrowsecurity AS cycle_rls,",
  "  cycle.relforcerowsecurity AS cycle_force_rls,",
  "  (has_table_privilege(session_user, 'dna.dna_open_lab_current_state_acquisition_cycle', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_current_state_acquisition_cycle', 'INSERT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_current_state_acquisition_cycle', 'UPDATE')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_current_state_acquisition_cycle', 'DELETE'))",
  "    AS runtime_can_access_cycle,",
  "  has_function_privilege(session_user,",
  "    'dna.save_dna_open_lab_current_state_acquisition_cycle(uuid,uuid,bigint,jsonb)', 'EXECUTE')",
  "    AS runtime_can_save,",
  "  has_function_privilege(session_user,",
  "    'dna.read_dna_open_lab_current_state_acquisition_cycle(uuid,uuid)', 'EXECUTE')",
  "    AS runtime_can_read,",
  "  session_user::text AS session_user_name, current_user::text AS current_user_name,",
  "  role.rolsuper AS runtime_is_superuser, role.rolbypassrls AS runtime_bypasses_rls,",
  "  role.rolcreaterole AS runtime_can_create_roles, role.rolcreatedb AS runtime_can_create_databases,",
  "  COALESCE(pg_has_role(session_user, (SELECT oid FROM pg_catalog.pg_roles",
  "    WHERE rolname = 'neon_superuser'), 'MEMBER'), false) AS runtime_is_neon_superuser_member",
  "FROM dna.app_owner owner",
  "JOIN pg_catalog.pg_class cycle",
  "  ON cycle.oid = 'dna.dna_open_lab_current_state_acquisition_cycle'::regclass",
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

function json(value: unknown, field: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${field} must be valid JSON`);
  }
}

function verifyIsolation(
  result: QueryResult,
  input: { databaseOwnerId: string; ownerId: string; runtimeRole: string },
): void {
  const row = oneRow(result, "DNA current-state acquisition isolation");
  if (
    text(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    text(row.authenticated_owner_id, "authenticated_owner_id") !== input.ownerId
  ) {
    throw new Error("DNA current-state acquisition owner scope denied.");
  }
  if (
    !bool(row.cycle_rls, "cycle_rls") ||
    !bool(row.cycle_force_rls, "cycle_force_rls")
  ) {
    throw new Error("DNA current-state acquisition requires forced owner RLS.");
  }
  if (bool(row.runtime_can_access_cycle, "runtime_can_access_cycle")) {
    throw new Error(
      "DNA current-state acquisition table access is not bounded.",
    );
  }
  if (
    !bool(row.runtime_can_save, "runtime_can_save") ||
    !bool(row.runtime_can_read, "runtime_can_read")
  ) {
    throw new Error(
      "DNA current-state acquisition function privilege is incomplete.",
    );
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
      "DNA current-state acquisition runtime role is not least privileged.",
    );
  }
}

export function createNeonDnaCurrentStateAcquisitionCycleCheckpointRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  ownerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
  clock?: () => Date;
}): DnaCurrentStateAcquisitionCycleCheckpointRepository {
  const databaseUrl = input.databaseUrl.trim();
  const databaseOwnerId = uuid(input.databaseOwnerId, "databaseOwnerId");
  const ownerId = owner(input.ownerId);
  const runtimeRole = input.runtimeRole.trim();
  if (databaseUrl === "") throw new Error("databaseUrl is required");
  if (!ROLE_PATTERN.test(runtimeRole))
    throw new Error("runtimeRole is invalid");
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;
  const clock = input.clock ?? (() => new Date());

  function stored(row: DbRow): StoredDnaCurrentStateAcquisitionCycleCheckpoint {
    return Object.freeze({
      revision: revision(row.revision, "revision"),
      checkpoint: validateDnaCurrentStateAcquisitionCycleCheckpointDocument({
        checkpoint: json(
          row.checkpoint,
          "checkpoint",
        ) as StoredDnaCurrentStateAcquisitionCycleCheckpoint["checkpoint"],
        validatedAt: clock().toISOString(),
      }),
    });
  }

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
    async load(cycleId) {
      const normalizedCycleId = uuid(cycleId, "cycleId");
      return transaction({
        readOnly: true,
        async run(client) {
          const result = await client.query(
            "SELECT revision::text, checkpoint FROM dna.read_dna_open_lab_current_state_acquisition_cycle($1::uuid,$2::uuid)",
            [databaseOwnerId, normalizedCycleId],
          );
          if (result.rows.length === 0) return null;
          return stored(oneRow(result, "DNA current-state acquisition cycle"));
        },
      });
    },

    async save(request) {
      const normalizedCheckpoint =
        validateDnaCurrentStateAcquisitionCycleCheckpointDocument({
          checkpoint: request.checkpoint,
          validatedAt: clock().toISOString(),
        });
      const expectedRevision =
        request.expectedRevision === null
          ? null
          : revision(request.expectedRevision, "expectedRevision");
      return transaction({
        readOnly: false,
        async run(client) {
          const result = await client.query(
            "SELECT revision::text, checkpoint FROM dna.save_dna_open_lab_current_state_acquisition_cycle($1::uuid,$2::uuid,$3::bigint,$4::jsonb)",
            [
              databaseOwnerId,
              normalizedCheckpoint.cycleId,
              expectedRevision,
              JSON.stringify(normalizedCheckpoint),
            ],
          );
          const resultCheckpoint = stored(
            oneRow(result, "DNA current-state acquisition cycle save"),
          );
          if (
            dnaOpenLabRawEvidenceSha256(resultCheckpoint.checkpoint) !==
            dnaOpenLabRawEvidenceSha256(normalizedCheckpoint)
          ) {
            throw new Error(
              "DNA current-state acquisition cycle response drifted.",
            );
          }
          return resultCheckpoint;
        },
      });
    },
  });
}
