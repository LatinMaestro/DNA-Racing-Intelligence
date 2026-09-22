import { createHash } from "node:crypto";

import type { ProLeagueRosterSubstitution } from "@/domain/pro-league-roster-version";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";
import type { StoredProLeagueRosterSubstitution } from "@/lib/neon-pro-league-roster-version-repository";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_RUNTIME_ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;

const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";

const PROBE_LEDGER_SQL = `
  SELECT
    to_regclass('dna.pro_league_roster_substitution') IS NOT NULL
      AS substitution_table_exists,
    to_regprocedure(
      'dna.list_pro_league_roster_substitutions(uuid,integer)'
    ) IS NOT NULL AS list_function_exists
`;

const VERIFY_LEDGER_ISOLATION_SQL = `
  SELECT owner.clerk_user_id AS authenticated_owner_id,
    table_state.relrowsecurity AS row_security_enabled,
    table_state.relforcerowsecurity AS force_row_security_enabled,
    has_table_privilege(session_user, table_state.oid, 'SELECT')
      AS runtime_can_read_table,
    has_function_privilege(
      session_user,
      'dna.list_pro_league_roster_substitutions(uuid,integer)',
      'EXECUTE'
    ) AS runtime_can_list_substitutions,
    session_user::text AS session_user_name,
    current_user::text AS current_user_name,
    role.rolsuper AS runtime_is_superuser,
    role.rolbypassrls AS runtime_bypasses_rls,
    role.rolcreaterole AS runtime_can_create_roles,
    role.rolcreatedb AS runtime_can_create_databases,
    COALESCE(
      pg_has_role(
        session_user,
        (
          SELECT neon_role.oid
          FROM pg_catalog.pg_roles neon_role
          WHERE neon_role.rolname = 'neon_superuser'
        ),
        'MEMBER'
      ),
      false
    ) AS runtime_is_neon_superuser_member
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_class table_state
    ON table_state.oid = 'dna.pro_league_roster_substitution'::regclass
  JOIN pg_catalog.pg_roles role
    ON role.rolname = session_user
  WHERE owner.id = $1::uuid
    AND owner.clerk_user_id = $2
`;

const LIST_SUBSTITUTIONS_SQL =
  "SELECT * FROM dna.list_pro_league_roster_substitutions($1::uuid,$2::integer)";

type QueryResult = Readonly<{ rows: readonly unknown[] }>;
type Row = Readonly<Record<string, unknown>>;

export type ProLeagueSubstitutionLedgerReadRepository = Readonly<{
  listSubstitutions: (
    ownerId: string,
    seasonYear: number,
  ) => Promise<readonly StoredProLeagueRosterSubstitution[]>;
}>;

function row(value: unknown, label: string): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Pro League substitution ledger ${label} is invalid.`);
  }
  return value as Row;
}

function one(result: QueryResult, label: string): Row {
  if (result.rows.length !== 1) {
    throw new Error(
      `Pro League substitution ledger ${label} must return one row.`,
    );
  }
  return row(result.rows[0], label);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Pro League substitution ledger ${label} is invalid.`);
  }
  return value.trim();
}

function integer(value: unknown, label: string): number {
  const parsed =
    typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Pro League substitution ledger ${label} is invalid.`);
  }
  return parsed as number;
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Pro League substitution ledger ${label} is invalid.`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  const parsed = value instanceof Date ? value : new Date(text(value, label));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Pro League substitution ledger ${label} is invalid.`);
  }
  return parsed.toISOString();
}

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function verifyIsolation(
  result: QueryResult,
  ownerId: string,
  runtimeRole: string,
): void {
  const value = one(result, "isolation");
  if (
    text(value.authenticated_owner_id, "authenticated owner") !== ownerId ||
    !bool(value.row_security_enabled, "RLS") ||
    !bool(value.force_row_security_enabled, "forced RLS") ||
    bool(value.runtime_can_read_table, "direct table privilege") ||
    !bool(value.runtime_can_list_substitutions, "list privilege") ||
    text(value.session_user_name, "session user") !== runtimeRole ||
    text(value.current_user_name, "current user") !== runtimeRole ||
    bool(value.runtime_is_superuser, "runtime superuser") ||
    bool(value.runtime_bypasses_rls, "runtime bypass RLS") ||
    bool(value.runtime_can_create_roles, "runtime create-role authority") ||
    bool(
      value.runtime_can_create_databases,
      "runtime create-database authority",
    ) ||
    bool(
      value.runtime_is_neon_superuser_member,
      "runtime Neon superuser membership",
    )
  ) {
    throw new Error(
      "Pro League substitution ledger requires least-privilege read isolation.",
    );
  }
}

function parseSubstitution(value: unknown): StoredProLeagueRosterSubstitution {
  const stored = row(value, "substitution");
  const substitution = {
    seasonYear: integer(stored.season_year, "season year"),
    substitutionNumber: integer(
      stored.substitution_number,
      "substitution number",
    ),
    fromRosterVersionId: text(stored.from_roster_version_id, "from version"),
    toRosterVersionId: text(stored.to_roster_version_id, "to version"),
    outgoingCoreId: text(stored.outgoing_core_id, "outgoing Core"),
    incomingCoreId: text(stored.incoming_core_id, "incoming Core"),
    reason: text(stored.reason, "reason"),
    evidence: {
      asOf: timestamp(stored.evidence_as_of, "evidence timestamp"),
      generationId: text(stored.evidence_generation_id, "evidence generation"),
      sha256: text(stored.evidence_sha256, "evidence SHA-256"),
      confidence: text(
        stored.evidence_confidence,
        "evidence confidence",
      ) as ProLeagueRosterSubstitution["evidence"]["confidence"],
    },
    substitutionSha256: text(
      stored.substitution_sha256,
      "substitution SHA-256",
    ),
    recordedAt: timestamp(stored.recorded_at, "recorded timestamp"),
  };
  const fingerprintInput: ProLeagueRosterSubstitution = {
    seasonYear: substitution.seasonYear,
    substitutionNumber: substitution.substitutionNumber,
    fromRosterVersionId: substitution.fromRosterVersionId,
    toRosterVersionId: substitution.toRosterVersionId,
    outgoingCoreId: substitution.outgoingCoreId,
    incomingCoreId: substitution.incomingCoreId,
    reason: substitution.reason,
    evidence: substitution.evidence,
  };
  if (sha256(fingerprintInput) !== substitution.substitutionSha256) {
    throw new Error("Pro League substitution fingerprint drifted.");
  }
  return Object.freeze(substitution);
}

export function createNeonProLeagueSubstitutionLedgerReadRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    ownerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): ProLeagueSubstitutionLedgerReadRepository {
  const databaseUrl = text(input.databaseUrl, "database URL");
  const databaseOwnerId = text(input.databaseOwnerId, "database owner ID");
  const configuredOwnerId = text(input.ownerId, "owner ID");
  const runtimeRole = text(input.runtimeRole, "runtime role");
  if (!UUID_PATTERN.test(databaseOwnerId)) {
    throw new Error("Pro League substitution ledger database owner ID is invalid.");
  }
  if (!SAFE_RUNTIME_ROLE_PATTERN.test(runtimeRole)) {
    throw new Error("Pro League substitution ledger runtime role is invalid.");
  }
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  return Object.freeze({
    async listSubstitutions(ownerId, seasonYear) {
      const authenticatedOwnerId = text(ownerId, "authenticated owner ID");
      if (authenticatedOwnerId !== configuredOwnerId) {
        throw new Error("Pro League substitution ledger access denied.");
      }
      if (
        !Number.isSafeInteger(seasonYear) ||
        seasonYear < 2026 ||
        seasonYear > 9999
      ) {
        throw new Error("Pro League substitution ledger season is invalid.");
      }

      const session = await sessionFactory(databaseUrl);
      try {
        await session.client.query(
          "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
        );
        await session.client.query(SET_OWNER_SCOPE_SQL, [databaseOwnerId]);

        const availability = one(
          await session.client.query(PROBE_LEDGER_SQL),
          "availability",
        );
        if (
          !bool(availability.substitution_table_exists, "table availability") ||
          !bool(availability.list_function_exists, "function availability")
        ) {
          throw new Error(
            "Pro League substitution ledger persistence is not configured.",
          );
        }

        verifyIsolation(
          await session.client.query(VERIFY_LEDGER_ISOLATION_SQL, [
            databaseOwnerId,
            authenticatedOwnerId,
          ]),
          authenticatedOwnerId,
          runtimeRole,
        );

        const result = await session.client.query(LIST_SUBSTITUTIONS_SQL, [
          databaseOwnerId,
          seasonYear,
        ]);
        const substitutions = Object.freeze(
          result.rows.map(parseSubstitution),
        );
        await session.client.query("COMMIT");
        return substitutions;
      } catch (error) {
        try {
          await session.client.query("ROLLBACK");
        } catch {
          // Preserve the original failure.
        }
        throw error;
      } finally {
        await session.close();
      }
    },
  });
}
