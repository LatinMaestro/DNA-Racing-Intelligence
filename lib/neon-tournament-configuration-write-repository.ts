import type {
  TournamentConfigurationWrite,
  TournamentConfigurationWriteRepository,
} from "@/lib/tournament-configuration-write-service";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_RUNTIME_ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const SERVER_CONFIGURATION_VERSION = /^cfg-[a-f0-9]{32}$/;

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
const UPSERT_SQL = `
  SELECT * FROM dna.upsert_complete_tournament_configuration(
    $1::uuid,
    $2::text,
    $3::text,
    $4::text,
    $5::timestamptz,
    $6::timestamptz,
    $7::text,
    $8::text,
    $9::text,
    $10::integer[],
    $11::integer,
    $12::numeric,
    $13::text,
    $14::text,
    $15::text[],
    $16::text[],
    $17::text[],
    $18::integer[],
    $19::jsonb,
    $20::jsonb,
    $21::text,
    $22::jsonb,
    $23::integer,
    $24::integer,
    $25::numeric,
    $26::text,
    $27::integer,
    $28::jsonb,
    $29::jsonb,
    $30::text,
    $31::text,
    $32::text,
    $33::text,
    $34::text,
    $35::jsonb,
    $36::jsonb
  )
`;

type Environment = Readonly<{
  databaseUrl: string | undefined;
  databaseOwnerId: string | undefined;
  runtimeRole: string | undefined;
}>;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Tournament configuration write evidence is invalid.");
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

function timestamp(value: unknown, label: string): void {
  const date = value instanceof Date ? value : new Date(text(value, label));
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is invalid.`);
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
    throw new Error("Tournament configuration write owner scope denied.");
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
      "Tournament configuration write requires least-privilege owner isolation.",
    );
  }
}

function verifyWrite(result: QueryResult): void {
  if (result.rows.length !== 1) {
    throw new Error("Tournament configuration write did not persist.");
  }
  const row = record(result.rows[0]);
  if (
    !SERVER_CONFIGURATION_VERSION.test(
      text(row.configuration_version, "server configuration version"),
    )
  ) {
    throw new Error("Tournament server configuration version is invalid.");
  }
  text(row.candidate_snapshot_version, "candidate snapshot version");
  timestamp(row.updated_at, "Tournament server update timestamp");
}

export function createNeonTournamentConfigurationWriteRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): TournamentConfigurationWriteRepository {
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
    async saveByOwner(
      ownerId: string,
      configuration: TournamentConfigurationWrite,
    ) {
      const authenticatedOwnerId = text(ownerId, "ownerId");
      const target = configuration.qualification.target;
      const session = await sessionFactory(databaseUrl);
      try {
        await session.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        await session.client.query(SET_OWNER_SCOPE_SQL, [databaseOwnerId]);
        verifyOwner(
          await session.client.query(VERIFY_OWNER_SQL, [
            databaseOwnerId,
            authenticatedOwnerId,
          ]),
          authenticatedOwnerId,
          runtimeRole,
        );
        verifyWrite(
          await session.client.query(UPSERT_SQL, [
            databaseOwnerId,
            configuration.tournamentId,
            configuration.tournamentLabel,
            configuration.seasonLabel,
            configuration.qualificationStartsAt,
            configuration.qualificationEndsAt,
            configuration.bracketId,
            configuration.splitLabel,
            configuration.mode,
            configuration.eligibleDistancesMetres,
            configuration.gateCount,
            configuration.entryFee.amount,
            configuration.entryFee.asset,
            configuration.raceFormat,
            configuration.eligibility.breeds,
            configuration.eligibility.classes,
            configuration.eligibility.elements,
            configuration.eligibility.fNumbers,
            configuration.eligibility.fNumberRanges,
            configuration.eligibility.groups,
            configuration.leaderboard.splitDimension,
            configuration.leaderboard.groups,
            configuration.qualification.minimumRaceCount,
            target.kind === "count" ? target.value : null,
            target.kind === "percentage" ? target.value : null,
            configuration.qualification.rankingMetric,
            configuration.qualification.topFinishPosition,
            configuration.qualification.pointsTable,
            configuration.qualification.customScoringConfiguration,
            configuration.leaderboard.qualifyingRaceSemantics,
            configuration.discoveryRelevance,
            configuration.evidence.status,
            configuration.evidence.notes,
            configuration.evidence.sourceEvidence,
            configuration.evidence.provenance,
            configuration.campaignAction,
          ]),
        );
        await session.client.query("COMMIT");
      } catch (error) {
        await session.client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        await session.close();
      }
    },
  };
}

export function neonTournamentConfigurationWriteRepositoryFromEnvironment(
  environment: Environment,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): TournamentConfigurationWriteRepository {
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
  return createNeonTournamentConfigurationWriteRepository({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
