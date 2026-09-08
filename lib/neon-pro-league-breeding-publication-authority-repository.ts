import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";
import type {
  ProLeagueBreedingPublicationAuthority,
  ProLeagueBreedingPublicationAuthoritySource,
} from "@/lib/pro-league-breeding-ranking-publication-runner";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;
const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";
const VERIFY_ISOLATION_SQL = `
  SELECT owner.clerk_user_id AS authenticated_owner_id,
    bool_or(has_table_privilege(session_user, class.oid,
      'SELECT,INSERT,UPDATE,DELETE')) AS runtime_can_access_tables,
    has_function_privilege(session_user,
      'dna.read_current_pro_league_breeding_publication_authority(uuid)',
      'EXECUTE') AS runtime_can_read,
    session_user::text AS session_user_name,
    current_user::text AS current_user_name,
    role.rolsuper AS runtime_is_superuser,
    role.rolbypassrls AS runtime_bypasses_rls,
    role.rolcreaterole AS runtime_can_create_roles,
    role.rolcreatedb AS runtime_can_create_databases,
    COALESCE(pg_has_role(session_user, (
      SELECT neon_role.oid FROM pg_catalog.pg_roles neon_role
      WHERE neon_role.rolname = 'neon_superuser'
    ), 'MEMBER'), false) AS runtime_is_neon_superuser_member
  FROM dna.app_owner owner
  CROSS JOIN LATERAL (
    SELECT relation.oid FROM pg_catalog.pg_class relation
    WHERE relation.oid IN (
      'dna.pro_league_evidence_generation'::regclass,
      'dna.pro_league_evidence_active'::regclass
    )
  ) class
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
  GROUP BY owner.clerk_user_id, role.rolsuper, role.rolbypassrls,
    role.rolcreaterole, role.rolcreatedb
`;
const READ_SQL =
  "SELECT * FROM dna.read_current_pro_league_breeding_publication_authority($1::uuid)";

type Row = Readonly<Record<string, unknown>>;

export type NeonProLeagueBreedingPublicationAuthorityRepository = Readonly<{
  status: "ready";
  loadCurrentAuthorityByOwner: Extract<
    ProLeagueBreedingPublicationAuthoritySource,
    { status: "ready" }
  >["loadCurrentAuthorityByOwner"];
}>;

function row(value: unknown, label: string): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Pro League breeding authority ${label} is invalid.`);
  }
  return value as Row;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Pro League breeding authority ${label} is invalid.`);
  }
  return value;
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Pro League breeding authority ${label} is invalid.`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  const parsed = value instanceof Date ? value : new Date(text(value, label));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Pro League breeding authority ${label} is invalid.`);
  }
  return parsed.toISOString();
}

function optionalTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : timestamp(value, label);
}

function configuration(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  ownerId: string;
  runtimeRole: string;
}) {
  const result = {
    databaseUrl: input.databaseUrl.trim(),
    databaseOwnerId: input.databaseOwnerId.trim(),
    ownerId: input.ownerId.trim(),
    runtimeRole: input.runtimeRole.trim(),
  };
  if (
    result.databaseUrl === "" ||
    !UUID_PATTERN.test(result.databaseOwnerId) ||
    result.ownerId === "" ||
    !SAFE_ROLE_PATTERN.test(result.runtimeRole)
  ) {
    throw new Error(
      "Pro League breeding authority repository configuration is invalid.",
    );
  }
  return result;
}

function verifyIsolation(
  value: unknown,
  ownerId: string,
  runtimeRole: string,
): void {
  const result = row(value, "isolation receipt");
  if (
    text(result.authenticated_owner_id, "authenticated owner") !== ownerId ||
    bool(result.runtime_can_access_tables, "direct table privilege") ||
    !bool(result.runtime_can_read, "read privilege") ||
    text(result.session_user_name, "session role") !== runtimeRole ||
    text(result.current_user_name, "current role") !== runtimeRole ||
    bool(result.runtime_is_superuser, "superuser state") ||
    bool(result.runtime_bypasses_rls, "RLS bypass state") ||
    bool(result.runtime_can_create_roles, "role creation state") ||
    bool(result.runtime_can_create_databases, "database creation state") ||
    bool(result.runtime_is_neon_superuser_member, "Neon role membership")
  ) {
    throw new Error(
      "Pro League breeding publication authority owner isolation failed.",
    );
  }
}

export function createNeonProLeagueBreedingPublicationAuthorityRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    ownerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): NeonProLeagueBreedingPublicationAuthorityRepository {
  const config = configuration(input);
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  return Object.freeze({
    status: "ready" as const,
    async loadCurrentAuthorityByOwner(ownerId: string) {
      if (ownerId !== config.ownerId) {
        throw new Error("Pro League breeding authority owner scope denied.");
      }
      const session = await sessionFactory(config.databaseUrl);
      let started = false;
      try {
        await session.client.query(
          "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
        );
        started = true;
        await session.client.query(SET_OWNER_SCOPE_SQL, [
          config.databaseOwnerId,
        ]);
        const verified = await session.client.query(VERIFY_ISOLATION_SQL, [
          config.databaseOwnerId,
          ownerId,
        ]);
        if (verified.rows.length !== 1) {
          throw new Error("Pro League breeding authority owner scope denied.");
        }
        verifyIsolation(verified.rows[0], ownerId, config.runtimeRole);
        const result = await session.client.query(READ_SQL, [
          config.databaseOwnerId,
        ]);
        if (result.rows.length > 1) {
          throw new Error(
            "Pro League breeding authority returned multiple current rows.",
          );
        }
        const authority: ProLeagueBreedingPublicationAuthority | null =
          result.rows.length === 0
            ? null
            : (() => {
                const stored = row(result.rows[0], "current row");
                return Object.freeze({
                  rosterEvidenceCutoffAt: timestamp(
                    stored.roster_evidence_cutoff_at,
                    "roster evidence cutoff",
                  ),
                  latestAcceptedPerformanceImportAt: timestamp(
                    stored.latest_performance_import_at,
                    "performance import",
                  ),
                  latestAcceptedArenaImportAt: optionalTimestamp(
                    stored.latest_arena_import_at,
                    "Arena import",
                  ),
                });
              })();
        await session.client.query("COMMIT");
        started = false;
        return authority;
      } catch (error) {
        if (started) {
          await session.client.query("ROLLBACK").catch(() => undefined);
        }
        throw error;
      } finally {
        await session.close();
      }
    },
  });
}

function configured(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

export function neonProLeagueBreedingPublicationAuthoritySourceFromEnvironment(
  environment: Readonly<{
    databaseUrl?: string;
    databaseOwnerId?: string;
    ownerId?: string;
    runtimeRole?: string;
  }>,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): ProLeagueBreedingPublicationAuthoritySource {
  const databaseUrl = configured(environment.databaseUrl);
  const databaseOwnerId = configured(environment.databaseOwnerId);
  const ownerId = configured(environment.ownerId);
  const runtimeRole = configured(environment.runtimeRole);
  if (
    databaseUrl === null ||
    databaseOwnerId === null ||
    ownerId === null ||
    runtimeRole === null
  ) {
    return Object.freeze({ status: "not_configured" });
  }
  const repository = createNeonProLeagueBreedingPublicationAuthorityRepository({
    databaseUrl,
    databaseOwnerId,
    ownerId,
    runtimeRole,
    ...(sessionFactory === undefined ? {} : { sessionFactory }),
  });
  return Object.freeze({
    status: "ready",
    loadCurrentAuthorityByOwner: repository.loadCurrentAuthorityByOwner,
  });
}
