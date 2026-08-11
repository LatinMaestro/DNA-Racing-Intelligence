import type { ProbeMode } from "@/domain/discovery-probe-plan";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

export type DiscoveryExactDistanceBenchmark = Readonly<{
  mode: ProbeMode;
  distanceMetres: number;
  dataCurrentThrough: string;
  raceEntryCount: number;
  winningEntryCount: number;
  topThreeEntryCount: number;
  winningP25Milliseconds: number;
  winningMedianMilliseconds: number;
  winningP75Milliseconds: number;
  topThreeP25Milliseconds: number;
  topThreeMedianMilliseconds: number;
  topThreeP75Milliseconds: number;
  refreshedAt: string;
}>;

export type DiscoveryBenchmarkRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      listBenchmarksByOwner: (
        ownerId: string,
      ) => Promise<readonly DiscoveryExactDistanceBenchmark[]>;
    }>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_RUNTIME_ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const SET_OWNER_SCOPE_SQL = `SELECT set_config('app.owner_id', $1, true) AS owner_scope`;
const VERIFY_OWNER_SQL = `
  SELECT
    owner.id::text AS database_owner_id,
    owner.clerk_user_id AS authenticated_owner_id,
    session_user::text AS session_user_name,
    current_user::text AS current_user_name,
    runtime_role.rolsuper AS runtime_is_superuser,
    runtime_role.rolbypassrls AS runtime_bypasses_rls
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_roles runtime_role ON runtime_role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
`;
const LIST_SQL = `SELECT * FROM dna.list_discovery_exact_distance_benchmarks($1::uuid, $2::integer)`;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;

function row(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Discovery benchmark evidence must be a database row.");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} is invalid.`);
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) <= 0) {
    throw new Error(`${label} is invalid.`);
  }
  return parsed as number;
}

function positiveFinite(value: unknown, label: string): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} is invalid.`);
  }
  return parsed;
}

function timestamp(value: unknown, label: string): string {
  const parsed = value instanceof Date ? value : new Date(text(value, label));
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is invalid.`);
  return parsed.toISOString();
}

function normalized(value: string | undefined): string | null {
  const result = value?.trim() ?? "";
  return result === "" ? null : result;
}

export function createNeonDiscoveryBenchmarkRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): DiscoveryBenchmarkRepository {
  const url = input.databaseUrl.trim();
  const owner = input.databaseOwnerId.trim();
  const role = input.runtimeRole.trim();
  if (
    url === "" ||
    !UUID_PATTERN.test(owner) ||
    !SAFE_RUNTIME_ROLE_PATTERN.test(role)
  ) {
    throw new Error("Discovery benchmark repository configuration is invalid.");
  }
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  return {
    status: "ready",
    async listBenchmarksByOwner(authenticatedOwnerId) {
      const clerkOwner = authenticatedOwnerId.trim();
      if (clerkOwner === "")
        throw new Error("authenticated owner is required.");
      const session = await sessionFactory(url);
      let transactionStarted = false;
      try {
        await session.client.query(
          "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
        );
        transactionStarted = true;
        await session.client.query(SET_OWNER_SCOPE_SQL, [owner]);
        const ownerResult = (await session.client.query(VERIFY_OWNER_SQL, [
          owner,
          clerkOwner,
        ])) as QueryResult;
        if (ownerResult.rows.length !== 1) {
          throw new Error("Discovery benchmark owner scope denied.");
        }
        const ownerRow = row(ownerResult.rows[0]);
        if (
          text(ownerRow.database_owner_id, "database_owner_id") !== owner ||
          text(ownerRow.authenticated_owner_id, "authenticated_owner_id") !==
            clerkOwner ||
          text(ownerRow.session_user_name, "session_user_name") !== role ||
          text(ownerRow.current_user_name, "current_user_name") !== role ||
          bool(ownerRow.runtime_is_superuser, "runtime_is_superuser") ||
          bool(ownerRow.runtime_bypasses_rls, "runtime_bypasses_rls")
        ) {
          throw new Error(
            "Discovery benchmark runtime owner isolation failed.",
          );
        }

        const result = (await session.client.query(LIST_SQL, [
          owner,
          5000,
        ])) as QueryResult;
        const benchmarks = result.rows.map(
          (value): DiscoveryExactDistanceBenchmark => {
            const record = row(value);
            const mode = text(record.mode, "mode");
            if (!["bike", "car", "horse"].includes(mode)) {
              throw new Error("Discovery benchmark mode is invalid.");
            }
            const benchmark: DiscoveryExactDistanceBenchmark = {
              mode: mode as ProbeMode,
              distanceMetres: positiveInteger(record.distance, "distance"),
              dataCurrentThrough: timestamp(
                record.data_current_through,
                "data_current_through",
              ),
              raceEntryCount: positiveInteger(
                record.race_entry_count,
                "race_entry_count",
              ),
              winningEntryCount: positiveInteger(
                record.winning_entry_count,
                "winning_entry_count",
              ),
              topThreeEntryCount: positiveInteger(
                record.top_three_entry_count,
                "top_three_entry_count",
              ),
              winningP25Milliseconds: positiveFinite(
                record.winning_p25_milliseconds,
                "winning_p25_milliseconds",
              ),
              winningMedianMilliseconds: positiveFinite(
                record.winning_median_milliseconds,
                "winning_median_milliseconds",
              ),
              winningP75Milliseconds: positiveFinite(
                record.winning_p75_milliseconds,
                "winning_p75_milliseconds",
              ),
              topThreeP25Milliseconds: positiveFinite(
                record.top_three_p25_milliseconds,
                "top_three_p25_milliseconds",
              ),
              topThreeMedianMilliseconds: positiveFinite(
                record.top_three_median_milliseconds,
                "top_three_median_milliseconds",
              ),
              topThreeP75Milliseconds: positiveFinite(
                record.top_three_p75_milliseconds,
                "top_three_p75_milliseconds",
              ),
              refreshedAt: timestamp(record.refreshed_at, "refreshed_at"),
            };
            if (
              benchmark.winningEntryCount > benchmark.topThreeEntryCount ||
              benchmark.topThreeEntryCount > benchmark.raceEntryCount ||
              benchmark.winningP25Milliseconds >
                benchmark.winningMedianMilliseconds ||
              benchmark.winningMedianMilliseconds >
                benchmark.winningP75Milliseconds ||
              benchmark.topThreeP25Milliseconds >
                benchmark.topThreeMedianMilliseconds ||
              benchmark.topThreeMedianMilliseconds >
                benchmark.topThreeP75Milliseconds
            ) {
              throw new Error("Discovery benchmark evidence is inconsistent.");
            }
            return benchmark;
          },
        );
        await session.client.query("COMMIT");
        transactionStarted = false;
        return benchmarks;
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

export function neonDiscoveryBenchmarkRepositoryFromEnvironment(
  environment: Readonly<{
    databaseUrl: string | undefined;
    databaseOwnerId: string | undefined;
    runtimeRole: string | undefined;
  }>,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): DiscoveryBenchmarkRepository {
  const url = normalized(environment.databaseUrl);
  const owner = normalized(environment.databaseOwnerId);
  const role = normalized(environment.runtimeRole);
  if (url === null || owner === null || role === null) {
    return { status: "not_configured" };
  }
  return createNeonDiscoveryBenchmarkRepository({
    databaseUrl: url,
    databaseOwnerId: owner,
    runtimeRole: role,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
