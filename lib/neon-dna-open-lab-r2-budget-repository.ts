import type {
  DnaOpenLabR2BudgetRepository,
  DnaOpenLabR2BudgetReservation,
  DnaOpenLabR2BudgetReservationDecision,
  DnaOpenLabR2BudgetWindow,
} from "./dna-open-lab-r2-budget-repository";
import type {
  DnaOpenLabR2Usage,
  DnaOpenLabZeroCostBlockerId,
} from "./dna-open-lab-zero-cost-refresh-policy";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_ROLE = /^[a-z_][a-z0-9_]{0,62}$/u;
const BLOCKERS = new Set<DnaOpenLabZeroCostBlockerId>([
  "class_a_refresh_limit_exceeded",
  "class_b_refresh_limit_exceeded",
  "storage_budget_exhausted",
  "class_a_budget_exhausted",
  "class_b_budget_exhausted",
]);

type Row = Record<string, unknown>;
type Environment = Readonly<{
  databaseUrl: string | undefined;
  databaseOwnerId: string | undefined;
  runtimeRole: string | undefined;
}>;

function normalized(value: string | undefined): string | null {
  const result = value?.trim() ?? "";
  return result === "" ? null : result;
}

function row(value: unknown): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("DNA Open Lab R2 budget row is invalid");
  }
  return value as Row;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is invalid`);
  }
  return value;
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

function optionalTimestamp(value: unknown, field: string): string | null {
  return value === null ? null : timestamp(value, field);
}

function usage(data: Row, prefix: string): DnaOpenLabR2Usage {
  return Object.freeze({
    storageBytes: count(data[`${prefix}_storage_bytes`], `${prefix} storage`),
    classAOperations: count(
      data[`${prefix}_class_a_operations`],
      `${prefix} Class A`,
    ),
    classBOperations: count(
      data[`${prefix}_class_b_operations`],
      `${prefix} Class B`,
    ),
  });
}

function blockerIds(value: unknown): readonly DnaOpenLabZeroCostBlockerId[] {
  if (!Array.isArray(value))
    throw new Error("R2 budget blocker IDs are invalid");
  return Object.freeze(
    value.map((entry) => {
      if (typeof entry !== "string" || !BLOCKERS.has(entry as never)) {
        throw new Error("R2 budget blocker ID is invalid");
      }
      return entry as DnaOpenLabZeroCostBlockerId;
    }),
  );
}

function mapWindow(value: unknown): DnaOpenLabR2BudgetWindow {
  const data = row(value);
  const windowId = text(data.window_id, "window_id");
  if (!SHA256_PATTERN.test(windowId)) throw new Error("window_id is invalid");
  return Object.freeze({
    windowId,
    windowStartAt: timestamp(data.window_start_at, "window_start_at"),
    windowEndAt: timestamp(data.window_end_at, "window_end_at"),
    measuredAt: timestamp(data.measured_at, "measured_at"),
    baselineUsage: usage(data, "baseline"),
    accountedUsage: usage(data, "accounted"),
    reservedUsage: usage(data, "reserved"),
    lastBlockedAt: optionalTimestamp(data.last_blocked_at, "last_blocked_at"),
    lastBlockerIds: blockerIds(data.last_blocker_ids),
    revision: count(data.revision, "revision"),
    updatedAt: timestamp(data.updated_at, "updated_at"),
  });
}

function mapDecision(value: unknown): DnaOpenLabR2BudgetReservationDecision {
  const data = row(value);
  if (typeof data.allowed !== "boolean") throw new Error("allowed is invalid");
  const reservationStatus = data.reservation_status;
  if (
    reservationStatus !== null &&
    reservationStatus !== "reserved" &&
    reservationStatus !== "accounted"
  ) {
    throw new Error("reservation_status is invalid");
  }
  return Object.freeze({
    allowed: data.allowed,
    blockerIds: blockerIds(data.blocker_ids),
    projectedUsage: usage(data, "projected"),
    reservationStatus,
    paidUsageAllowed: false,
    preserveLastGood: true,
  });
}

function mapReservation(value: unknown): DnaOpenLabR2BudgetReservation {
  const data = row(value);
  const status = data.status;
  if (status !== "reserved" && status !== "accounted") {
    throw new Error("reservation status is invalid");
  }
  const windowId = text(data.window_id, "window_id");
  const refreshCycleId = text(data.refresh_cycle_id, "refresh_cycle_id");
  const requestSha256 = text(data.request_sha256, "request_sha256");
  if (
    !SHA256_PATTERN.test(windowId) ||
    !SHA256_PATTERN.test(refreshCycleId) ||
    !SHA256_PATTERN.test(requestSha256)
  ) {
    throw new Error("reservation identity is invalid");
  }
  return Object.freeze({
    windowId,
    refreshCycleId,
    requestSha256,
    status,
    plannedUsage: usage(data, "planned"),
    actualUsage: status === "accounted" ? usage(data, "actual") : null,
    reservedAt: timestamp(data.reserved_at, "reserved_at"),
    accountedAt: optionalTimestamp(data.accounted_at, "accounted_at"),
  });
}

function assertHash(value: string, field: string): void {
  if (!SHA256_PATTERN.test(value)) throw new Error(`${field} is invalid`);
}

export function createNeonDnaOpenLabR2BudgetRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): DnaOpenLabR2BudgetRepository {
  const databaseUrl = input.databaseUrl.trim();
  const databaseOwnerId = input.databaseOwnerId.trim();
  const runtimeRole = input.runtimeRole.trim();
  if (
    databaseUrl === "" ||
    !UUID_PATTERN.test(databaseOwnerId) ||
    !SAFE_ROLE.test(runtimeRole)
  ) {
    throw new Error("DNA Open Lab R2 budget configuration is invalid");
  }
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  async function transact<T>(
    ownerId: string,
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
      await session.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      started = true;
      await session.client.query(
        "SELECT set_config('app.owner_id', $1, true)",
        [databaseOwnerId],
      );
      const verified = await session.client.query(
        `SELECT owner.id::text AS owner_id, owner.clerk_user_id,
        budget.relrowsecurity AS budget_rls,
        budget.relforcerowsecurity AS budget_force_rls,
        reservation.relrowsecurity AS reservation_rls,
        reservation.relforcerowsecurity AS reservation_force_rls,
        session_user::text AS session_user_name,
        current_user::text AS current_user_name, role.rolsuper, role.rolbypassrls
        FROM dna.app_owner owner
        JOIN pg_catalog.pg_class budget
          ON budget.oid = 'dna.dna_open_lab_r2_budget_window'::regclass
        JOIN pg_catalog.pg_class reservation
          ON reservation.oid = 'dna.dna_open_lab_r2_budget_reservation'::regclass
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
        evidence.budget_rls !== true ||
        evidence.budget_force_rls !== true ||
        evidence.reservation_rls !== true ||
        evidence.reservation_force_rls !== true ||
        evidence.session_user_name !== runtimeRole ||
        evidence.current_user_name !== runtimeRole ||
        evidence.rolsuper !== false ||
        evidence.rolbypassrls !== false
      ) {
        throw new Error("DNA Open Lab R2 budget owner isolation denied");
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
    status: "ready",
    readWindow: (ownerId) =>
      transact(ownerId, async (query) => {
        const result = await query(
          "SELECT * FROM dna.read_dna_open_lab_r2_budget_window($1::uuid)",
          [databaseOwnerId],
        );
        if (result.rows.length > 1)
          throw new Error("R2 budget window is ambiguous");
        return result.rows.length === 0 ? null : mapWindow(result.rows[0]);
      }),
    openWindow: (request) => {
      assertHash(request.windowId, "windowId");
      return transact(request.ownerId, async (query) => {
        const result = await query(
          "SELECT * FROM dna.open_dna_open_lab_r2_budget_window($1::uuid,$2::text,$3::timestamptz,$4::timestamptz,$5::timestamptz,$6::bigint,$7::bigint,$8::bigint)",
          [
            databaseOwnerId,
            request.windowId,
            request.windowStartAt,
            request.windowEndAt,
            request.measuredAt,
            request.baselineUsage.storageBytes,
            request.baselineUsage.classAOperations,
            request.baselineUsage.classBOperations,
          ],
        );
        if (result.rows.length !== 1)
          throw new Error("R2 budget window open failed");
        return mapWindow(result.rows[0]);
      });
    },
    reserve: (request) => {
      assertHash(request.windowId, "windowId");
      assertHash(request.refreshCycleId, "refreshCycleId");
      assertHash(request.requestSha256, "requestSha256");
      return transact(request.ownerId, async (query) => {
        const result = await query(
          "SELECT * FROM dna.reserve_dna_open_lab_r2_budget($1::uuid,$2::text,$3::text,$4::text,$5::bigint,$6::bigint,$7::bigint)",
          [
            databaseOwnerId,
            request.windowId,
            request.refreshCycleId,
            request.requestSha256,
            request.plannedUsage.storageBytes,
            request.plannedUsage.classAOperations,
            request.plannedUsage.classBOperations,
          ],
        );
        if (result.rows.length !== 1)
          throw new Error("R2 budget reservation failed");
        return mapDecision(result.rows[0]);
      });
    },
    account: (request) => {
      assertHash(request.windowId, "windowId");
      assertHash(request.refreshCycleId, "refreshCycleId");
      assertHash(request.requestSha256, "requestSha256");
      return transact(request.ownerId, async (query) => {
        const result = await query(
          "SELECT * FROM dna.account_dna_open_lab_r2_budget($1::uuid,$2::text,$3::text,$4::text,$5::bigint,$6::bigint,$7::bigint)",
          [
            databaseOwnerId,
            request.windowId,
            request.refreshCycleId,
            request.requestSha256,
            request.actualUsage.storageBytes,
            request.actualUsage.classAOperations,
            request.actualUsage.classBOperations,
          ],
        );
        if (result.rows.length !== 1)
          throw new Error("R2 budget accounting failed");
        return mapReservation(result.rows[0]);
      });
    },
  };
}

export function neonDnaOpenLabR2BudgetRepositoryFromEnvironment(
  environment: Environment,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): DnaOpenLabR2BudgetRepository {
  const databaseUrl = normalized(environment.databaseUrl);
  const databaseOwnerId = normalized(environment.databaseOwnerId);
  const runtimeRole = normalized(environment.runtimeRole);
  if (
    databaseUrl === null ||
    databaseOwnerId === null ||
    runtimeRole === null
  ) {
    return { status: "not_configured" };
  }
  return createNeonDnaOpenLabR2BudgetRepository({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
