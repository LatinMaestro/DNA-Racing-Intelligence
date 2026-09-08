import {
  DNA_OPEN_LAB_DAILY_REFRESH_GENERATION_VERSION,
  type DnaOpenLabDailyRefreshGeneration,
  type DnaOpenLabDailyRefreshGenerationRepository,
} from "./dna-open-lab-daily-refresh-coordinator";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_ROLE = /^[a-z_][a-z0-9_]{0,62}$/u;

type Row = Record<string, unknown>;
type Environment = Readonly<{
  databaseUrl: string | undefined;
  databaseOwnerId: string | undefined;
  runtimeRole: string | undefined;
}>;

export type NeonDnaOpenLabDailyRefreshGenerationRepository =
  DnaOpenLabDailyRefreshGenerationRepository &
    Readonly<{
      loadLastGood(
        ownerId: string,
      ): Promise<DnaOpenLabDailyRefreshGeneration | null>;
    }>;

function normalized(value: string | undefined): string | null {
  const result = value?.trim() ?? "";
  return result === "" ? null : result;
}

function row(value: unknown): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("DNA Open Lab daily refresh generation row is invalid");
  }
  return value as Row;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is invalid`);
  }
  return value.trim();
}

function sha256(value: unknown, field: string): string {
  const result = text(value, field).toLowerCase();
  if (!SHA256_PATTERN.test(result)) throw new Error(`${field} is invalid`);
  return result;
}

function uuid(value: unknown, field: string): string {
  const result = text(value, field).toLowerCase();
  if (!UUID_PATTERN.test(result)) throw new Error(`${field} is invalid`);
  return result;
}

function count(value: unknown, field: string): number {
  const parsed =
    typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 0) {
    throw new Error(`${field} is invalid`);
  }
  return Number(parsed);
}

function timestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(text(value, field));
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} is invalid`);
  return parsed.toISOString();
}

function mapGeneration(value: unknown): DnaOpenLabDailyRefreshGeneration {
  const data = row(value);
  return Object.freeze({
    version: DNA_OPEN_LAB_DAILY_REFRESH_GENERATION_VERSION,
    refreshCycleId: sha256(data.refresh_cycle_id, "refresh_cycle_id"),
    budgetWindowId: sha256(data.budget_window_id, "budget_window_id"),
    budgetRequestSha256: sha256(
      data.budget_request_sha256,
      "budget_request_sha256",
    ),
    finishedHistoryCycleId: sha256(
      data.finished_history_cycle_id,
      "finished_history_cycle_id",
    ),
    currentStateGenerationId: uuid(
      data.current_state_generation_id,
      "current_state_generation_id",
    ),
    actualR2Usage: Object.freeze({
      storageBytes: count(data.actual_storage_bytes, "actual_storage_bytes"),
      classAOperations: count(
        data.actual_class_a_operations,
        "actual_class_a_operations",
      ),
      classBOperations: count(
        data.actual_class_b_operations,
        "actual_class_b_operations",
      ),
    }),
    publishedAt: timestamp(data.published_at, "published_at"),
  });
}

export function createNeonDnaOpenLabDailyRefreshGenerationRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): NeonDnaOpenLabDailyRefreshGenerationRepository {
  const databaseUrl = input.databaseUrl.trim();
  const databaseOwnerId = input.databaseOwnerId.trim();
  const runtimeRole = input.runtimeRole.trim();
  if (
    databaseUrl === "" ||
    !UUID_PATTERN.test(databaseOwnerId) ||
    !SAFE_ROLE.test(runtimeRole)
  ) {
    throw new Error("DNA Open Lab daily refresh configuration is invalid");
  }
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  async function transact<T>(
    ownerId: string,
    readOnly: boolean,
    work: (
      query: (
        sql: string,
        values?: readonly unknown[],
      ) => Promise<{ rows: readonly unknown[] }>,
    ) => Promise<T>,
  ): Promise<T> {
    const session = await sessionFactory(databaseUrl);
    let started = false;
    try {
      await session.client.query(
        `BEGIN ISOLATION LEVEL SERIALIZABLE${readOnly ? " READ ONLY" : ""}`,
      );
      started = true;
      await session.client.query(
        "SELECT set_config('app.owner_id', $1, true)",
        [databaseOwnerId],
      );
      const verified = await session.client.query(
        `SELECT owner.id::text AS owner_id, owner.clerk_user_id,
        generation.relrowsecurity AS generation_rls,
        generation.relforcerowsecurity AS generation_force_rls,
        active.relrowsecurity AS active_rls,
        active.relforcerowsecurity AS active_force_rls,
        session_user::text AS session_user_name,
        current_user::text AS current_user_name,
        role.rolsuper, role.rolbypassrls,
        has_function_privilege(
          session_user,
          'dna.read_dna_open_lab_daily_refresh_generation(uuid,text)',
          'EXECUTE'
        ) AS can_read_generation,
        has_function_privilege(
          session_user,
          'dna.read_dna_open_lab_daily_refresh_last_good(uuid)',
          'EXECUTE'
        ) AS can_read_last_good,
        has_function_privilege(
          session_user,
          'dna.publish_dna_open_lab_daily_refresh_generation(uuid,text,text,text,text,uuid,bigint,bigint,bigint,timestamptz)',
          'EXECUTE'
        ) AS can_publish_generation
        FROM dna.app_owner owner
        JOIN pg_catalog.pg_class generation
          ON generation.oid = 'dna.dna_open_lab_daily_refresh_generation'::regclass
        JOIN pg_catalog.pg_class active
          ON active.oid = 'dna.dna_open_lab_daily_refresh_active'::regclass
        JOIN pg_catalog.pg_roles role ON role.rolname = session_user
        WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2`,
        [databaseOwnerId, ownerId],
      );
      const evidence =
        verified.rows.length === 1 ? row(verified.rows[0]) : null;
      if (
        evidence === null ||
        evidence.owner_id !== databaseOwnerId ||
        evidence.clerk_user_id !== ownerId ||
        evidence.generation_rls !== true ||
        evidence.generation_force_rls !== true ||
        evidence.active_rls !== true ||
        evidence.active_force_rls !== true ||
        evidence.session_user_name !== runtimeRole ||
        evidence.current_user_name !== runtimeRole ||
        evidence.rolsuper !== false ||
        evidence.rolbypassrls !== false ||
        evidence.can_read_generation !== true ||
        evidence.can_read_last_good !== true ||
        evidence.can_publish_generation !== true
      ) {
        throw new Error("DNA Open Lab daily refresh owner isolation denied");
      }
      const result = await work((sql, values = []) =>
        session.client.query(sql, values),
      );
      await session.client.query("COMMIT");
      started = false;
      return result;
    } catch (error) {
      if (started)
        await session.client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await session.close();
    }
  }

  return {
    load: (ownerId, refreshCycleId) => {
      if (!SHA256_PATTERN.test(refreshCycleId)) {
        throw new Error("refreshCycleId is invalid");
      }
      return transact(ownerId, true, async (query) => {
        const result = await query(
          "SELECT * FROM dna.read_dna_open_lab_daily_refresh_generation($1::uuid,$2::text)",
          [databaseOwnerId, refreshCycleId],
        );
        if (result.rows.length > 1) {
          throw new Error("daily refresh generation is ambiguous");
        }
        return result.rows.length === 0 ? null : mapGeneration(result.rows[0]);
      });
    },
    loadLastGood: (ownerId) =>
      transact(ownerId, true, async (query) => {
        const result = await query(
          "SELECT * FROM dna.read_dna_open_lab_daily_refresh_last_good($1::uuid)",
          [databaseOwnerId],
        );
        if (result.rows.length > 1) {
          throw new Error("daily refresh last-good generation is ambiguous");
        }
        return result.rows.length === 0 ? null : mapGeneration(result.rows[0]);
      }),
    publish: (ownerId, generation) => {
      const refreshCycleId = sha256(
        generation.refreshCycleId,
        "refreshCycleId",
      );
      const budgetWindowId = sha256(
        generation.budgetWindowId,
        "budgetWindowId",
      );
      const budgetRequestSha256 = sha256(
        generation.budgetRequestSha256,
        "budgetRequestSha256",
      );
      const finishedHistoryCycleId = sha256(
        generation.finishedHistoryCycleId,
        "finishedHistoryCycleId",
      );
      const currentStateGenerationId = uuid(
        generation.currentStateGenerationId,
        "currentStateGenerationId",
      );
      return transact(ownerId, false, async (query) => {
        const result = await query(
          "SELECT * FROM dna.publish_dna_open_lab_daily_refresh_generation($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::uuid,$7::bigint,$8::bigint,$9::bigint,$10::timestamptz)",
          [
            databaseOwnerId,
            refreshCycleId,
            budgetWindowId,
            budgetRequestSha256,
            finishedHistoryCycleId,
            currentStateGenerationId,
            generation.actualR2Usage.storageBytes,
            generation.actualR2Usage.classAOperations,
            generation.actualR2Usage.classBOperations,
            generation.publishedAt,
          ],
        );
        if (result.rows.length !== 1) {
          throw new Error("daily refresh generation publication failed");
        }
        return mapGeneration(result.rows[0]);
      });
    },
  };
}

export function neonDnaOpenLabDailyRefreshGenerationRepositoryFromEnvironment(
  environment: Environment,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): NeonDnaOpenLabDailyRefreshGenerationRepository | null {
  const databaseUrl = normalized(environment.databaseUrl);
  const databaseOwnerId = normalized(environment.databaseOwnerId);
  const runtimeRole = normalized(environment.runtimeRole);
  if (
    databaseUrl === null ||
    databaseOwnerId === null ||
    runtimeRole === null
  ) {
    return null;
  }
  return createNeonDnaOpenLabDailyRefreshGenerationRepository({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
