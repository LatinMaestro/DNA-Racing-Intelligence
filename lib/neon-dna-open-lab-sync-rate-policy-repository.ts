import type { DnaOpenLabSyncRatePolicy } from "@/domain/dna-open-lab-sync-rate-policy";
import type { DnaOpenLabSyncRatePolicyRepository } from "./dna-open-lab-sync-rate-policy-service";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_ROLE = /^[a-z_][a-z0-9_]{0,62}$/u;

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
    throw new Error("DNA Open Lab rate policy row is invalid");
  }
  return value as Row;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is invalid`);
  }
  return value;
}

function integer(value: unknown, field: string, minimum = 0): number {
  const parsed =
    typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < minimum) {
    throw new Error(`${field} is invalid`);
  }
  return Number(parsed);
}

function optionalTimestamp(value: unknown, field: string): string | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(text(value, field));
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} is invalid`);
  return parsed.toISOString();
}

function mapPolicy(value: unknown): DnaOpenLabSyncRatePolicy {
  const data = row(value);
  const fallback = data.fallback_reason;
  if (
    fallback !== null &&
    fallback !== "elevation_expired" &&
    fallback !== "provider_limit_reduced" &&
    fallback !== "rate_limit_observed"
  )
    throw new Error("fallback_reason is invalid");
  return Object.freeze({
    requestedRequestsPerMinute: integer(
      data.requested_requests_per_minute,
      "requested rate",
      30,
    ),
    effectiveRequestsPerMinute: integer(
      data.effective_requests_per_minute,
      "effective rate",
      30,
    ),
    elevatedUntil: optionalTimestamp(data.elevated_until, "elevated_until"),
    fallbackReason: fallback,
    consecutiveRateLimits: integer(
      data.consecutive_rate_limits,
      "consecutive rate limits",
    ),
    lastRateLimitedAt: optionalTimestamp(
      data.last_rate_limited_at,
      "last_rate_limited_at",
    ),
    lastProviderLimit:
      data.last_provider_limit === null
        ? null
        : integer(data.last_provider_limit, "last provider limit", 1),
    version: integer(data.version, "version", 1),
    updatedAt:
      optionalTimestamp(data.updated_at, "updated_at") ??
      (() => {
        throw new Error("updated_at is missing");
      })(),
  });
}

export function createNeonDnaOpenLabSyncRatePolicyRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): DnaOpenLabSyncRatePolicyRepository {
  const databaseUrl = input.databaseUrl.trim();
  const databaseOwnerId = input.databaseOwnerId.trim();
  const runtimeRole = input.runtimeRole.trim();
  if (
    databaseUrl === "" ||
    !UUID_PATTERN.test(databaseOwnerId) ||
    !SAFE_ROLE.test(runtimeRole)
  ) {
    throw new Error("DNA Open Lab rate repository configuration is invalid");
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
        policy.relrowsecurity AS rls, policy.relforcerowsecurity AS force_rls,
        session_user::text AS session_user_name, current_user::text AS current_user_name,
        role.rolsuper, role.rolbypassrls
        FROM dna.app_owner owner
        JOIN pg_catalog.pg_class policy ON policy.oid = 'dna.dna_open_lab_sync_rate_policy'::regclass
        JOIN pg_catalog.pg_roles role ON role.rolname = session_user
        WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2`,
        [databaseOwnerId, ownerId],
      );
      const verifiedRow =
        verified.rows.length === 1 ? row(verified.rows[0]) : null;
      if (
        verifiedRow === null ||
        verifiedRow.owner_id !== databaseOwnerId ||
        verifiedRow.clerk_user_id !== ownerId ||
        verifiedRow.rls !== true ||
        verifiedRow.force_rls !== true ||
        verifiedRow.session_user_name !== runtimeRole ||
        verifiedRow.current_user_name !== runtimeRole ||
        verifiedRow.rolsuper !== false ||
        verifiedRow.rolbypassrls !== false
      ) {
        throw new Error("DNA Open Lab rate repository owner isolation denied");
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
    read: (ownerId) =>
      transact(ownerId, async (query) => {
        const result = await query(
          "SELECT * FROM dna.read_dna_open_lab_sync_rate_policy($1::uuid)",
          [databaseOwnerId],
        );
        if (result.rows.length > 1)
          throw new Error("DNA Open Lab rate policy is ambiguous");
        return result.rows.length === 0 ? null : mapPolicy(result.rows[0]);
      }),
    set: (mutation) =>
      transact(mutation.ownerId, async (query) => {
        const result = await query(
          "SELECT * FROM dna.set_dna_open_lab_sync_rate_policy($1::uuid,$2::integer,$3::timestamptz,$4::bigint,$5::timestamptz)",
          [
            databaseOwnerId,
            mutation.requestedRequestsPerMinute,
            mutation.elevatedUntil,
            mutation.expectedVersion,
            mutation.requestedAt,
          ],
        );
        if (result.rows.length !== 1)
          throw new Error("DNA Open Lab rate write returned an invalid result");
        return mapPolicy(result.rows[0]);
      }),
    recordObservation: (observation) =>
      transact(observation.ownerId, async (query) => {
        const result = await query(
          "SELECT * FROM dna.record_dna_open_lab_rate_observation($1::uuid,$2::boolean,$3::integer,$4::timestamptz)",
          [
            databaseOwnerId,
            observation.rateLimited,
            observation.providerLimit,
            observation.observedAt,
          ],
        );
        if (result.rows.length !== 1)
          throw new Error(
            "DNA Open Lab rate observation returned an invalid result",
          );
        return mapPolicy(result.rows[0]);
      }),
  };
}

export function neonDnaOpenLabSyncRatePolicyRepositoryFromEnvironment(
  environment: Environment,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): DnaOpenLabSyncRatePolicyRepository {
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
  return createNeonDnaOpenLabSyncRatePolicyRepository({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
