import type {
  TournamentCoreSelection,
  TournamentCoreSelectionRepository,
} from "@/lib/tournament-core-selection-service";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_RUNTIME_ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";
const VERIFY_OWNER_SQL = `
  SELECT owner.clerk_user_id AS authenticated_owner_id,
    selection_table.relrowsecurity AS selection_row_security_enabled,
    selection_table.relforcerowsecurity AS selection_force_row_security_enabled,
    session_user::text AS session_user_name,
    current_user::text AS current_user_name,
    role.rolsuper AS runtime_is_superuser,
    role.rolbypassrls AS runtime_bypasses_rls
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_class selection_table
    ON selection_table.oid = 'dna.tournament_core_selection'::regclass
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
`;

type Row = Record<string, unknown>;
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

function row(value: unknown): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Tournament Core selection row is invalid.");
  }
  return value as Row;
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} is invalid.`);
  return value;
}

function selection(value: unknown): TournamentCoreSelection {
  const result = row(value);
  const coreIds = result.core_ids;
  if (
    !Array.isArray(coreIds) ||
    coreIds.some((value) => typeof value !== "string")
  ) {
    throw new Error("Tournament Core selection IDs are invalid.");
  }
  const updatedAt =
    result.updated_at instanceof Date
      ? result.updated_at.toISOString()
      : new Date(text(result.updated_at, "updated at")).toISOString();
  return {
    tournamentId: text(result.tournament_id, "tournament ID"),
    bracketId: text(result.bracket_id, "bracket ID"),
    configurationVersion: text(
      result.configuration_version,
      "configuration version",
    ),
    candidateSnapshotVersion: text(
      result.candidate_snapshot_version,
      "candidate snapshot version",
    ),
    coreIds: coreIds.map((value) => value.trim()),
    updatedAt,
  };
}

export function createNeonTournamentCoreSelectionRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): TournamentCoreSelectionRepository {
  const databaseUrl = text(input.databaseUrl, "databaseUrl");
  const databaseOwnerId = text(input.databaseOwnerId, "databaseOwnerId");
  const runtimeRole = text(input.runtimeRole, "runtimeRole");
  if (
    !UUID_PATTERN.test(databaseOwnerId) ||
    !SAFE_RUNTIME_ROLE_PATTERN.test(runtimeRole)
  ) {
    throw new Error("Tournament Core selection database identity is invalid.");
  }
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  async function scoped<T>(
    ownerId: string,
    work: (session: Awaited<ReturnType<typeof sessionFactory>>) => Promise<T>,
  ): Promise<T> {
    const session = await sessionFactory(databaseUrl);
    try {
      await session.client.query("BEGIN");
      await session.client.query(SET_OWNER_SCOPE_SQL, [databaseOwnerId]);
      const verified = await session.client.query(VERIFY_OWNER_SQL, [
        databaseOwnerId,
        ownerId,
      ]);
      if (verified.rows.length !== 1) throw new Error("Owner scope denied.");
      const verifiedRow = row(verified.rows[0]);
      if (
        text(verifiedRow.authenticated_owner_id, "authenticated owner") !==
          ownerId ||
        !bool(verifiedRow.selection_row_security_enabled, "selection RLS") ||
        !bool(
          verifiedRow.selection_force_row_security_enabled,
          "selection forced RLS",
        ) ||
        text(verifiedRow.session_user_name, "session user") !== runtimeRole ||
        text(verifiedRow.current_user_name, "current user") !== runtimeRole ||
        bool(verifiedRow.runtime_is_superuser, "runtime superuser") ||
        bool(verifiedRow.runtime_bypasses_rls, "runtime bypass RLS")
      ) {
        throw new Error("Tournament Core selection owner scope denied.");
      }
      const result = await work(session);
      await session.client.query("COMMIT");
      return result;
    } catch (error) {
      await session.client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await session.close();
    }
  }

  return {
    status: "ready",
    readSelection(ownerId, tournamentId, bracketId) {
      return scoped(ownerId, async (session) => {
        const result = await session.client.query(
          "SELECT * FROM dna.read_tournament_core_selection($1::uuid,$2::text,$3::text)",
          [databaseOwnerId, tournamentId, bracketId],
        );
        if (result.rows.length > 1) {
          throw new Error("Tournament Core selection read is duplicated.");
        }
        return result.rows.length === 0 ? null : selection(result.rows[0]);
      });
    },
    replaceSelection(ownerId, value) {
      return scoped(ownerId, async (session) => {
        const result = await session.client.query(
          "SELECT * FROM dna.replace_tournament_core_selection($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text[],$7::timestamptz)",
          [
            databaseOwnerId,
            value.tournamentId,
            value.bracketId,
            value.configurationVersion,
            value.candidateSnapshotVersion,
            [...value.coreIds],
            value.updatedAt,
          ],
        );
        if (result.rows.length !== 1) {
          throw new Error("Tournament Core selection write did not read back.");
        }
        return selection(result.rows[0]);
      });
    },
  };
}

export function neonTournamentCoreSelectionRepositoryFromEnvironment(
  environment: Environment,
): TournamentCoreSelectionRepository {
  const databaseUrl = environment.databaseUrl?.trim() ?? "";
  const databaseOwnerId = environment.databaseOwnerId?.trim() ?? "";
  const runtimeRole = environment.runtimeRole?.trim() ?? "";
  if (databaseUrl === "" || databaseOwnerId === "" || runtimeRole === "") {
    return { status: "not_configured" };
  }
  return createNeonTournamentCoreSelectionRepository({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
  });
}
