import type { TournamentCandidateRankingInput } from "@/domain/tournament-candidate-ranking";
import type { TournamentCandidateRepository } from "@/lib/tournament-workspace-service";
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
    table_meta.relrowsecurity AS row_security_enabled,
    table_meta.relforcerowsecurity AS force_row_security_enabled,
    session_user::text AS session_user_name,
    current_user::text AS current_user_name,
    role.rolsuper AS runtime_is_superuser,
    role.rolbypassrls AS runtime_bypasses_rls
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_class table_meta ON table_meta.oid = 'dna.tournament_configuration'::regclass
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
`;
const LIST_CONFIGURATIONS_SQL = `SELECT * FROM dna.list_tournament_configurations($1::uuid)`;

type Environment = Readonly<{
  databaseUrl: string | undefined;
  databaseOwnerId: string | undefined;
  runtimeRole: string | undefined;
}>;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Tournament configuration row is invalid.");
  }
  return value as Record<string, unknown>;
}

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

function normalized(value: string | undefined): string | null {
  const result = value?.trim() ?? "";
  return result === "" ? null : result;
}

function verifyOwner(
  result: QueryResult,
  authenticatedOwnerId: string,
  runtimeRole: string,
): void {
  if (result.rows.length !== 1) {
    throw new Error("Tournament configuration owner scope denied.");
  }
  const row = record(result.rows[0]);
  if (
    text(row.authenticated_owner_id, "authenticated owner") !==
      authenticatedOwnerId ||
    !bool(row.row_security_enabled, "Tournament RLS") ||
    !bool(row.force_row_security_enabled, "Tournament forced RLS") ||
    text(row.session_user_name, "session user") !== runtimeRole ||
    text(row.current_user_name, "current user") !== runtimeRole ||
    bool(row.runtime_is_superuser, "runtime superuser") ||
    bool(row.runtime_bypasses_rls, "runtime bypass RLS")
  ) {
    throw new Error(
      "Tournament configuration repository requires least-privilege owner isolation.",
    );
  }
}

function distances(value: unknown): readonly number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Tournament eligible distances are invalid.");
  }
  const parsed = value.map((item) =>
    typeof item === "string" && /^\d+$/.test(item) ? Number(item) : item,
  );
  if (
    parsed.some((item) => !Number.isSafeInteger(item) || (item as number) <= 0)
  ) {
    throw new Error("Tournament eligible distances are invalid.");
  }
  return parsed as number[];
}

export function createNeonTournamentConfigurationRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): TournamentCandidateRepository {
  const databaseUrl = text(input.databaseUrl, "databaseUrl");
  const databaseOwnerId = text(input.databaseOwnerId, "databaseOwnerId");
  const runtimeRole = text(input.runtimeRole, "runtimeRole");
  if (!UUID_PATTERN.test(databaseOwnerId)) {
    throw new Error("databaseOwnerId must be a UUID.");
  }
  if (!SAFE_RUNTIME_ROLE_PATTERN.test(runtimeRole)) {
    throw new Error("runtimeRole is invalid.");
  }
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  return {
    status: "ready",
    async listCandidateEvidenceByOwner(ownerId) {
      const authenticatedOwnerId = text(ownerId, "ownerId");
      const session = await sessionFactory(databaseUrl);
      try {
        await session.client.query("BEGIN READ ONLY");
        await session.client.query(SET_OWNER_SCOPE_SQL, [databaseOwnerId]);
        verifyOwner(
          await session.client.query(VERIFY_OWNER_SQL, [
            databaseOwnerId,
            authenticatedOwnerId,
          ]),
          authenticatedOwnerId,
          runtimeRole,
        );
        const result = await session.client.query(LIST_CONFIGURATIONS_SQL, [
          databaseOwnerId,
        ]);
        const brackets: TournamentCandidateRankingInput[] = result.rows.map(
          (value) => {
            const row = record(value);
            const mode = text(row.mode, "Tournament mode");
            const relevance = text(
              row.discovery_relevance,
              "Tournament Discovery relevance",
            );
            if (!["bike", "car", "horse"].includes(mode)) {
              throw new Error("Tournament mode is invalid.");
            }
            if (!["eligible", "priority"].includes(relevance)) {
              throw new Error("Tournament Discovery relevance is invalid.");
            }
            return {
              tournamentId: text(row.tournament_id, "Tournament ID"),
              tournamentLabel: text(row.tournament_label, "Tournament label"),
              bracketId: text(row.bracket_id, "Bracket ID"),
              splitLabel: text(row.split_label, "Split label"),
              mode: mode as TournamentCandidateRankingInput["mode"],
              eligibleDistancesMetres: distances(row.eligible_distances_metres),
              discoveryRelevance:
                relevance as TournamentCandidateRankingInput["discoveryRelevance"],
              qualificationMetricLabel: text(
                row.qualification_metric_label,
                "Qualification metric label",
              ),
              configurationVersion: text(
                row.configuration_version,
                "Configuration version",
              ),
              candidateSnapshotVersion: text(
                row.candidate_snapshot_version,
                "Candidate snapshot version",
              ),
              candidates: [],
            };
          },
        );
        await session.client.query("COMMIT");
        return { brackets, lastImportedAt: null };
      } catch (error) {
        await session.client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        await session.close();
      }
    },
  };
}

export function neonTournamentConfigurationRepositoryFromEnvironment(
  environment: Environment,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): TournamentCandidateRepository {
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
  return createNeonTournamentConfigurationRepository({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
