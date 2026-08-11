import type {\n  CorePerformanceProfileRepository,\n} from "./core-intelligence-workspace-service";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_RUNTIME_ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

const SET_OWNER_SCOPE_SQL = `
  SELECT set_config('app.owner_id', $1, true) AS owner_scope
`;

const VERIFY_OWNER_ISOLATION_SQL = `
  SELECT
    owner.id::text AS database_owner_id,
    owner.clerk_user_id AS authenticated_owner_id,
    profile.relrowsecurity AS profile_row_security_enabled,
    profile.relforcerowsecurity AS profile_force_row_security_enabled,
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
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_class profile
    ON profile.oid = 'dna.core_performance_profile'::regclass
  JOIN pg_catalog.pg_roles runtime_role
    ON runtime_role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
`;

const LIST_PROFILES_SQL = `
  SELECT *
  FROM dna.list_core_performance_profiles($1::uuid, NULL::text, $2::integer)
`;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a database row.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean.`);
  return value;
}

function number(value: unknown, label: string): number {
  const parsed =
    typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new Error(`${label} must be finite.`);
  }
  return parsed;
}

function integer(value: unknown, label: string): number {
  const parsed = number(value, label);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} must be a safe integer.`);
  }
  return parsed;
}

function timestamp(value: unknown, label: string): string {
  const parsed = value instanceof Date ? value : new Date(text(value, label));
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is invalid.`);
  return parsed.toISOString();
}

function roundMetric(value: unknown, label: string): number {
  return Math.round(number(value, label) * 1_000) / 1_000;
}

function jsonObject(\n  value: unknown,\n  label: string,\n): Record<string, unknown> | null {
  if (value === null) return null;
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return record(parsed, label);
}

function databaseOwnerId(value: string): string {
  const normalized = value.trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw new Error("databaseOwnerId must be a UUID.");
  }
  return normalized;
}

function runtimeRole(value: string): string {
  const normalized = value.trim();
  if (!SAFE_RUNTIME_ROLE_PATTERN.test(normalized)) {
    throw new Error("runtimeRole is invalid.");
  }
  return normalized;
}

function normalized(value: string | undefined): string | null {
  const result = value?.trim() ?? "";
  return result === "" ? null : result;
}

function verifyOwnerIsolation(
  result: QueryResult,
  expected: Readonly<{
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    runtimeRole: string;
  }>,
): void {
  if (result.rows.length !== 1) {
    throw new Error("Core Intelligence owner scope denied.");
  }
  const row = record(result.rows[0], "Owner evidence");
  if (
    text(row.database_owner_id, "database_owner_id") !==
      expected.databaseOwnerId ||
    text(row.authenticated_owner_id, "authenticated_owner_id") !==
      expected.authenticatedOwnerId ||
    !bool(row.profile_row_security_enabled, "profile_row_security_enabled") ||
    !bool(
      row.profile_force_row_security_enabled,
      "profile_force_row_security_enabled",
    )
  ) {
    throw new Error("Core Intelligence requires forced owner isolation.");
  }
  if (
    text(row.session_user_name, "session_user_name") !== expected.runtimeRole ||
    text(row.current_user_name, "current_user_name") !== expected.runtimeRole ||
    bool(row.runtime_is_superuser, "runtime_is_superuser") ||
    bool(row.runtime_bypasses_rls, "runtime_bypasses_rls") ||
    bool(row.runtime_can_create_roles, "runtime_can_create_roles") ||
    bool(row.runtime_can_create_databases, "runtime_can_create_databases") ||
    bool(\n      row.runtime_is_neon_superuser_member,\n      "runtime_is_neon_superuser_member",\n    )
  ) {
    throw new Error("Core Intelligence runtime role is not least privileged.");
  }
}

function profile(rowValue: unknown): Record<string, unknown> {
  const row = record(rowValue, "Core Intelligence profile");
  return {
    coreId: text(row.core_id, "core_id"),
    mode: text(row.mode, "mode"),
    distance: integer(row.distance, "distance"),
    dataCurrentThrough: timestamp(
      row.data_current_through,
      "data_current_through",
    ),
    raceCount: integer(row.race_count, "race_count"),
    sampleStatus:
      integer(row.race_count, "race_count") >= 10
        ? "minimally_analytical"
        : "hypothesis_only",
    elapsedTime: {
      bestMilliseconds: roundMetric(
        row.best_milliseconds,
        "best_milliseconds",
      ),
      medianMilliseconds: roundMetric(
        row.median_milliseconds,
        "median_milliseconds",
      ),
      meanMilliseconds: roundMetric(
        row.mean_milliseconds,
        "mean_milliseconds",
      ),
      trimmedMeanMilliseconds: roundMetric(
        row.trimmed_mean_milliseconds,
        "trimmed_mean_milliseconds",
      ),
      standardDeviationMilliseconds: roundMetric(
        row.standard_deviation_milliseconds,
        "standard_deviation_milliseconds",
      ),
      interquartileRangeMilliseconds: roundMetric(
        row.interquartile_range_milliseconds,
        "interquartile_range_milliseconds",
      ),
    },
    speed: {
      bestMetresPerSecond: roundMetric(
        row.best_metres_per_second,
        "best_metres_per_second",
      ),
      medianMetresPerSecond: roundMetric(
        row.median_metres_per_second,
        "median_metres_per_second",
      ),
    },
    starProfile: jsonObject(row.star_profile, "star_profile"),
    analyticalStatus: "experimental",
  };
}

export function createNeonCorePerformanceProfileRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): CorePerformanceProfileRepository {
  const url = input.databaseUrl.trim();
  if (url === "") throw new Error("databaseUrl is required.");
  const owner = databaseOwnerId(input.databaseOwnerId);
  const role = runtimeRole(input.runtimeRole);
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  return {
    status: "ready",
    async listProfilesByOwner(authenticatedOwnerId) {
      const clerkOwner = authenticatedOwnerId.trim();
      if (clerkOwner === "") {\n        throw new Error("authenticated owner is required.");\n      }
      const session = await sessionFactory(url);
      let transactionStarted = false;
      try {
        await session.client.query(
          "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
        );
        transactionStarted = true;
        await session.client.query(SET_OWNER_SCOPE_SQL, [owner]);
        verifyOwnerIsolation(
          await session.client.query(VERIFY_OWNER_ISOLATION_SQL, [
            owner,
            clerkOwner,
          ]),
          {
            databaseOwnerId: owner,
            authenticatedOwnerId: clerkOwner,
            runtimeRole: role,
          },
        );
        const result = await session.client.query(LIST_PROFILES_SQL, [
          owner,
          5_000,
        ]);
        const profiles = result.rows.map(profile);
        const lastImportedAt =
          result.rows.length === 0
            ? null
            : timestamp(
                record(result.rows[0], "Core Intelligence profile")
                  .last_imported_at,
                "last_imported_at",
              );
        await session.client.query("COMMIT");
        transactionStarted = false;
        return { profiles, lastImportedAt };
      } catch (error) {
        if (transactionStarted) {
          await session.client.query("ROLLBACK").catch(() => undefined);
        }
        throw error;
      } finally {
        await session.close();
      }
    },
  };
}

export function neonCorePerformanceProfileRepositoryFromEnvironment(
  environment: Readonly<{
    databaseUrl: string | undefined;
    databaseOwnerId: string | undefined;
    runtimeRole: string | undefined;
  }>,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): CorePerformanceProfileRepository {
  const url = normalized(environment.databaseUrl);
  const owner = normalized(environment.databaseOwnerId);
  const role = normalized(environment.runtimeRole);
  if (url === null || owner === null || role === null) {
    return { status: "not_configured" };
  }
  return createNeonCorePerformanceProfileRepository({
    databaseUrl: url,
    databaseOwnerId: owner,
    runtimeRole: role,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
