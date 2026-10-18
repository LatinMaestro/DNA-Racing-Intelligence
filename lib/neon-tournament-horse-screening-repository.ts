import type { TournamentHorseScreeningRepository } from "@/lib/tournament-horse-screening-service";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_RUNTIME_ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const SET_OWNER_SCOPE_SQL = `SELECT set_config('app.owner_id', $1, true) AS owner_scope`;
const VERIFY_OWNER_SQL = `
  SELECT owner.clerk_user_id AS authenticated_owner_id,
    snapshot.relrowsecurity AS snapshot_row_security_enabled,
    snapshot.relforcerowsecurity AS snapshot_force_row_security_enabled,
    active.relrowsecurity AS active_row_security_enabled,
    active.relforcerowsecurity AS active_force_row_security_enabled,
    session_user::text AS session_user_name,
    current_user::text AS current_user_name,
    role.rolsuper AS runtime_is_superuser,
    role.rolbypassrls AS runtime_bypasses_rls
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_class snapshot
    ON snapshot.oid = 'dna.tournament_horse_screening_snapshot'::regclass
  JOIN pg_catalog.pg_class active
    ON active.oid = 'dna.tournament_horse_screening_snapshot_active'::regclass
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
`;
const READ_ACTIVE_SQL = `SELECT * FROM dna.read_active_tournament_horse_screening_snapshot($1::uuid)`;

type Environment = Readonly<{
  databaseUrl: string | undefined;
  databaseOwnerId: string | undefined;
  runtimeRole: string | undefined;
}>;

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is invalid.`);
  }
  return value.trim();
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} is invalid.`);
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Horse screening database row is invalid.");
  }
  return value as Record<string, unknown>;
}

function normalized(value: string | undefined): string | null {
  const result = value?.trim() ?? "";
  return result === "" ? null : result;
}

export function createNeonTournamentHorseScreeningRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): TournamentHorseScreeningRepository {
  const databaseUrl = text(input.databaseUrl, "databaseUrl");
  const databaseOwnerId = text(input.databaseOwnerId, "databaseOwnerId");
  const runtimeRole = text(input.runtimeRole, "runtimeRole");
  if (!UUID_PATTERN.test(databaseOwnerId))
    throw new Error("databaseOwnerId must be a UUID.");
  if (!SAFE_RUNTIME_ROLE_PATTERN.test(runtimeRole))
    throw new Error("runtimeRole is invalid.");
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;
  return {
    status: "ready",
    async readActiveByOwner(ownerId) {
      const authenticatedOwnerId = text(ownerId, "ownerId");
      const session = await sessionFactory(databaseUrl);
      try {
        await session.client.query(
          "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
        );
        await session.client.query(SET_OWNER_SCOPE_SQL, [databaseOwnerId]);
        const ownerResult = await session.client.query(VERIFY_OWNER_SQL, [
          databaseOwnerId,
          authenticatedOwnerId,
        ]);
        if (ownerResult.rows.length !== 1)
          throw new Error("Horse screening owner scope denied.");
        const owner = record(ownerResult.rows[0]);
        if (
          text(owner.authenticated_owner_id, "authenticated owner") !==
            authenticatedOwnerId ||
          !bool(owner.snapshot_row_security_enabled, "Horse screening RLS") ||
          !bool(
            owner.snapshot_force_row_security_enabled,
            "Horse screening forced RLS",
          ) ||
          !bool(
            owner.active_row_security_enabled,
            "Horse screening active RLS",
          ) ||
          !bool(
            owner.active_force_row_security_enabled,
            "Horse screening active forced RLS",
          ) ||
          text(owner.session_user_name, "session user") !== runtimeRole ||
          text(owner.current_user_name, "current user") !== runtimeRole ||
          bool(owner.runtime_is_superuser, "runtime superuser") ||
          bool(owner.runtime_bypasses_rls, "runtime bypass RLS")
        ) {
          throw new Error(
            "Horse screening repository requires least-privilege owner isolation.",
          );
        }
        const result = await session.client.query(READ_ACTIVE_SQL, [
          databaseOwnerId,
        ]);
        if (result.rows.length > 1)
          throw new Error("Horse screening active snapshot is ambiguous.");
        await session.client.query("COMMIT");
        if (result.rows.length === 0) return null;
        const row = record(result.rows[0]);
        const published =
          row.published_at instanceof Date
            ? row.published_at.toISOString()
            : text(row.published_at, "Horse screening publication time");
        return {
          snapshotVersion: text(
            row.snapshot_version,
            "Horse screening snapshot version",
          ),
          payloadJson: text(row.payload_json, "Horse screening payload"),
          publishedAt: published,
        };
      } catch (error) {
        await session.client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        await session.close();
      }
    },
  };
}

export function neonTournamentHorseScreeningRepositoryFromEnvironment(
  environment: Environment,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): TournamentHorseScreeningRepository {
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
  return createNeonTournamentHorseScreeningRepository({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
