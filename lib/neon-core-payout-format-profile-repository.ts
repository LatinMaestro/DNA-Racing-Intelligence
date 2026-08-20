import { raceModes, type RaceMode } from "@/domain/core-performance";
import { deriveFreshness, type FreshnessState } from "@/domain/freshness";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

export type CorePayoutFormatProfile = Readonly<{
  coreId: string;
  mode: RaceMode;
  payoutFormatKey: string;
  payoutFormatLabel: string;
  dataCurrentThrough: string;
  firstEventAt: string;
  raceCount: number;
  winCount: number;
  topThreeCount: number;
  exactDistanceCount: number;
  timedRaceCount: number;
  refreshedAt: string;
  sampleStatus: "hypothesis_only" | "minimally_supported";
  freshness: FreshnessState;
}>;

export type CorePayoutFormatProfileRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      listProfilesByOwner: (
        authenticatedOwnerId: string,
        sourceCoreId?: string | null,
      ) => Promise<
        Readonly<{
          profiles: readonly CorePayoutFormatProfile[];
          lastImportedAt: string | null;
        }>
      >;
    }>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_RUNTIME_ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const SAFE_CORE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/;

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
    ON profile.oid = 'dna.core_payout_format_profile'::regclass
  JOIN pg_catalog.pg_roles runtime_role
    ON runtime_role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
`;

const LIST_PROFILES_SQL = `
  SELECT *
  FROM dna.list_core_payout_format_profiles($1::uuid, $2::text, $3::integer)
`;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a database row.`);
  }
  return value as Record<string, unknown>;
}

function textValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean.`);
  return value;
}

function integer(value: unknown, label: string): number {
  const parsed =
    typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < 0
  ) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return parsed;
}

function timestamp(value: unknown, label: string): string {
  const parsed =
    value instanceof Date ? value : new Date(textValue(value, label));
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is invalid.`);
  return parsed.toISOString();
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

function coreId(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalizedValue = value.trim();
  if (!SAFE_CORE_ID_PATTERN.test(normalizedValue)) {
    throw new Error("coreId is invalid.");
  }
  return normalizedValue;
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
    throw new Error("Payout-format owner scope denied.");
  }
  const row = record(result.rows[0], "Owner evidence");
  if (
    textValue(row.database_owner_id, "database_owner_id") !==
      expected.databaseOwnerId ||
    textValue(row.authenticated_owner_id, "authenticated_owner_id") !==
      expected.authenticatedOwnerId ||
    !bool(row.profile_row_security_enabled, "profile_row_security_enabled") ||
    !bool(
      row.profile_force_row_security_enabled,
      "profile_force_row_security_enabled",
    )
  ) {
    throw new Error("Payout-format evidence requires forced owner isolation.");
  }
  if (
    textValue(row.session_user_name, "session_user_name") !==
      expected.runtimeRole ||
    textValue(row.current_user_name, "current_user_name") !==
      expected.runtimeRole ||
    bool(row.runtime_is_superuser, "runtime_is_superuser") ||
    bool(row.runtime_bypasses_rls, "runtime_bypasses_rls") ||
    bool(row.runtime_can_create_roles, "runtime_can_create_roles") ||
    bool(row.runtime_can_create_databases, "runtime_can_create_databases") ||
    bool(
      row.runtime_is_neon_superuser_member,
      "runtime_is_neon_superuser_member",
    )
  ) {
    throw new Error("Payout-format runtime role is not least privileged.");
  }
}

function profile(rowValue: unknown, now: Date): CorePayoutFormatProfile {
  const row = record(rowValue, "Payout-format profile");
  const mode = textValue(row.mode, "mode");
  if (!raceModes.includes(mode as RaceMode)) {
    throw new Error("mode must be bike, car or horse.");
  }
  const raceCount = integer(row.race_count, "race_count");
  const winCount = integer(row.win_count, "win_count");
  const topThreeCount = integer(row.top_three_count, "top_three_count");
  const exactDistanceCount = integer(
    row.exact_distance_count,
    "exact_distance_count",
  );
  const timedRaceCount = integer(row.timed_race_count, "timed_race_count");
  if (
    raceCount === 0 ||
    exactDistanceCount === 0 ||
    winCount > topThreeCount ||
    topThreeCount > raceCount ||
    timedRaceCount > raceCount
  ) {
    throw new Error("Payout-format profile counts are inconsistent.");
  }
  const dataCurrentThrough = timestamp(
    row.data_current_through,
    "data_current_through",
  );
  const firstEventAt = timestamp(row.first_event_at, "first_event_at");
  if (firstEventAt > dataCurrentThrough) {
    throw new Error("Payout-format chronology is invalid.");
  }
  return {
    coreId: textValue(row.core_id, "core_id"),
    mode: mode as RaceMode,
    payoutFormatKey: textValue(row.payout_format_key, "payout_format_key"),
    payoutFormatLabel: textValue(
      row.payout_format_label,
      "payout_format_label",
    ),
    dataCurrentThrough,
    firstEventAt,
    raceCount,
    winCount,
    topThreeCount,
    exactDistanceCount,
    timedRaceCount,
    refreshedAt: timestamp(row.refreshed_at, "refreshed_at"),
    sampleStatus:
      raceCount >= 10 ? "minimally_supported" : "hypothesis_only",
    freshness: deriveFreshness(new Date(dataCurrentThrough), now),
  };
}

export function createNeonCorePayoutFormatProfileRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    runtimeRole: string;
    now?: Date;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): CorePayoutFormatProfileRepository {
  const url = input.databaseUrl.trim();
  if (url === "") throw new Error("databaseUrl is required.");
  const owner = databaseOwnerId(input.databaseOwnerId);
  const role = runtimeRole(input.runtimeRole);
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error("now is invalid.");
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  return {
    status: "ready",
    async listProfilesByOwner(authenticatedOwnerId, sourceCoreId = null) {
      const clerkOwner = authenticatedOwnerId.trim();
      if (clerkOwner === "") {
        throw new Error("authenticated owner is required.");
      }
      const selectedCoreId = coreId(sourceCoreId);
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
          selectedCoreId,
          selectedCoreId === null ? 5_000 : 250,
        ]);
        const profiles = result.rows.map((row) => profile(row, now));
        const lastImportedAt =
          result.rows.length === 0
            ? null
            : timestamp(
                record(result.rows[0], "Payout-format profile")
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

export function neonCorePayoutFormatProfileRepositoryFromEnvironment(
  environment: Readonly<{
    databaseUrl: string | undefined;
    databaseOwnerId: string | undefined;
    runtimeRole: string | undefined;
  }>,
  options?: Readonly<{
    now?: Date;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): CorePayoutFormatProfileRepository {
  const url = normalized(environment.databaseUrl);
  const owner = normalized(environment.databaseOwnerId);
  const role = normalized(environment.runtimeRole);
  if (url === null || owner === null || role === null) {
    return { status: "not_configured" };
  }
  return createNeonCorePayoutFormatProfileRepository({
    databaseUrl: url,
    databaseOwnerId: owner,
    runtimeRole: role,
    ...(options?.now ? { now: options.now } : {}),
    ...(options?.sessionFactory
      ? { sessionFactory: options.sessionFactory }
      : {}),
  });
}
