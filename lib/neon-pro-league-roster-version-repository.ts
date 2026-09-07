import { createHash } from "node:crypto";

import {
  buildProLeagueRosterVersion,
  type ProLeagueRosterSubstitution,
  type ProLeagueRosterVersion,
  type ProLeagueRosterVersionMemberInput,
} from "@/domain/pro-league-roster-version";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_RUNTIME_ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;

const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";
const VERIFY_ISOLATION_SQL = `
  SELECT owner.clerk_user_id AS authenticated_owner_id,
    bool_and(table_state.relrowsecurity) AS all_rls_enabled,
    bool_and(table_state.relforcerowsecurity) AS all_force_rls_enabled,
    bool_or(has_table_privilege(session_user, table_state.oid, 'SELECT'))
      AS runtime_can_read_tables,
    has_function_privilege(session_user,
      'dna.store_pro_league_roster_version(uuid,text,integer,text,text,text,timestamp with time zone,text,text,jsonb)',
      'EXECUTE') AS runtime_can_store_version,
    has_function_privilege(session_user,
      'dna.read_pro_league_roster_version(uuid,text)',
      'EXECUTE') AS runtime_can_read_version,
    has_function_privilege(session_user,
      'dna.record_pro_league_roster_substitution(uuid,integer,integer,text,text,text,text,text,timestamp with time zone,text,text,text,text)',
      'EXECUTE') AS runtime_can_record_substitution,
    has_function_privilege(session_user,
      'dna.list_pro_league_roster_substitutions(uuid,integer)',
      'EXECUTE') AS runtime_can_list_substitutions,
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
    SELECT class.oid, class.relrowsecurity, class.relforcerowsecurity
    FROM pg_catalog.pg_class class
    WHERE class.oid IN (
      'dna.pro_league_roster_version'::regclass,
      'dna.pro_league_roster_member_snapshot'::regclass,
      'dna.pro_league_roster_substitution'::regclass
    )
  ) table_state
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
  GROUP BY owner.clerk_user_id, role.rolsuper, role.rolbypassrls,
    role.rolcreaterole, role.rolcreatedb
`;
const STORE_VERSION_SQL = `SELECT * FROM dna.store_pro_league_roster_version(
  $1::uuid,$2::text,$3::integer,$4::text,$5::text,$6::text,$7::timestamptz,
  $8::text,$9::text,$10::jsonb
)`;
const READ_VERSION_SQL =
  "SELECT * FROM dna.read_pro_league_roster_version($1::uuid,$2::text)";
const RECORD_SUBSTITUTION_SQL = `SELECT * FROM dna.record_pro_league_roster_substitution(
  $1::uuid,$2::integer,$3::integer,$4::text,$5::text,$6::text,$7::text,
  $8::text,$9::timestamptz,$10::text,$11::text,$12::text,$13::text
)`;
const LIST_SUBSTITUTIONS_SQL =
  "SELECT * FROM dna.list_pro_league_roster_substitutions($1::uuid,$2::integer)";

type QueryResult = Readonly<{ rows: readonly unknown[] }>;
type Row = Readonly<Record<string, unknown>>;

export type StoredProLeagueRosterVersion = Readonly<{
  version: ProLeagueRosterVersion;
  versionSha256: string;
  createdAt: string;
}>;

export type StoredProLeagueRosterSubstitution = ProLeagueRosterSubstitution &
  Readonly<{ substitutionSha256: string; recordedAt: string }>;

export type ProLeagueRosterVersionRepository = Readonly<{
  saveVersion: (
    ownerId: string,
    version: ProLeagueRosterVersion,
  ) => Promise<
    Readonly<{ disposition: "created" | "existing"; versionSha256: string }>
  >;
  loadVersion: (
    ownerId: string,
    rosterVersionId: string,
  ) => Promise<StoredProLeagueRosterVersion | null>;
  recordSubstitution: (
    ownerId: string,
    substitution: ProLeagueRosterSubstitution,
  ) => Promise<
    Readonly<{
      disposition: "created" | "existing";
      substitutionSha256: string;
    }>
  >;
  listSubstitutions: (
    ownerId: string,
    seasonYear: number,
  ) => Promise<readonly StoredProLeagueRosterSubstitution[]>;
}>;

function row(value: unknown, label: string): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Pro League ${label} row is invalid.`);
  }
  return value as Row;
}

function one(result: QueryResult, label: string): Row {
  if (result.rows.length !== 1) {
    throw new Error(`Pro League ${label} must return one row.`);
  }
  return row(result.rows[0], label);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Pro League ${label} is invalid.`);
  }
  return value.trim();
}

function integer(value: unknown, label: string): number {
  const parsed =
    typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed))
    throw new Error(`Pro League ${label} is invalid.`);
  return parsed as number;
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean")
    throw new Error(`Pro League ${label} is invalid.`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  const parsed = value instanceof Date ? value : new Date(text(value, label));
  if (Number.isNaN(parsed.getTime()))
    throw new Error(`Pro League ${label} is invalid.`);
  return parsed.toISOString();
}

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function members(
  version: ProLeagueRosterVersion,
): readonly Record<string, unknown>[] {
  return [...version.members]
    .sort(
      (left, right) =>
        (left.disposition === right.disposition
          ? 0
          : left.disposition === "rostered"
            ? -1
            : 1) || left.position - right.position,
    )
    .map((member) => ({
      coreId: member.core.coreId,
      displayName: member.core.displayName,
      element: member.core.element,
      coreClass: member.core.coreClass,
      sex: member.core.sex,
      fNumber: member.core.fNumber,
      inMyVault: member.core.inMyVault,
      disposition: member.disposition,
      role: member.role,
      position: member.position,
      reason: member.reason,
      evidence: member.evidence,
    }));
}

function versionFingerprint(version: ProLeagueRosterVersion): string {
  return sha256({
    rosterVersionId: version.rosterVersionId,
    versionNumber: version.versionNumber,
    rulesetId: version.rulesetId,
    strategyId: version.strategyId,
    initialRosterCountingPolicy: version.initialRosterCountingPolicy,
    evidenceCutoffAt: version.evidenceCutoffAt,
    rationale: version.rationale,
    members: members(version),
  });
}

function verifyIsolation(
  result: QueryResult,
  ownerId: string,
  runtimeRole: string,
): void {
  const value = one(result, "isolation");
  if (
    text(value.authenticated_owner_id, "authenticated owner") !== ownerId ||
    !bool(value.all_rls_enabled, "RLS") ||
    !bool(value.all_force_rls_enabled, "forced RLS") ||
    bool(value.runtime_can_read_tables, "direct table privilege") ||
    !bool(value.runtime_can_store_version, "store privilege") ||
    !bool(value.runtime_can_read_version, "read privilege") ||
    !bool(
      value.runtime_can_record_substitution,
      "substitution write privilege",
    ) ||
    !bool(
      value.runtime_can_list_substitutions,
      "substitution read privilege",
    ) ||
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
      "Pro League roster repository requires least-privilege owner isolation.",
    );
  }
}

function parseMembers(
  value: unknown,
): readonly ProLeagueRosterVersionMemberInput[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed))
    throw new Error("Pro League roster members are invalid.");
  return parsed.map((item) => {
    const value = row(item, "roster member");
    const evidence = row(value.evidence, "roster evidence");
    return {
      core: {
        coreId: text(value.coreId, "Core ID"),
        displayName: text(value.displayName, "Core name"),
        element: text(
          value.element,
          "Core element",
        ) as ProLeagueRosterVersionMemberInput["core"]["element"],
        coreClass: text(
          value.coreClass,
          "Core class",
        ) as ProLeagueRosterVersionMemberInput["core"]["coreClass"],
        sex: text(
          value.sex,
          "Core sex",
        ) as ProLeagueRosterVersionMemberInput["core"]["sex"],
        fNumber: integer(value.fNumber, "F-number"),
        inMyVault: bool(value.inMyVault, "Vault membership"),
      },
      disposition: text(
        value.disposition,
        "member disposition",
      ) as ProLeagueRosterVersionMemberInput["disposition"],
      role: text(
        value.role,
        "member role",
      ) as ProLeagueRosterVersionMemberInput["role"],
      reason: text(value.reason, "member reason"),
      evidence: {
        asOf: text(evidence.asOf, "evidence timestamp"),
        generationId: text(evidence.generationId, "evidence generation"),
        sha256: text(evidence.sha256, "evidence SHA-256"),
        confidence: text(
          evidence.confidence,
          "evidence confidence",
        ) as ProLeagueRosterVersionMemberInput["evidence"]["confidence"],
      },
    };
  });
}

export function createNeonProLeagueRosterVersionRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    ownerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): ProLeagueRosterVersionRepository {
  const databaseUrl = text(input.databaseUrl, "database URL");
  const databaseOwnerId = text(input.databaseOwnerId, "database owner ID");
  const configuredOwnerId = text(input.ownerId, "owner ID");
  const runtimeRole = text(input.runtimeRole, "runtime role");
  if (!UUID_PATTERN.test(databaseOwnerId))
    throw new Error("Pro League database owner ID is invalid.");
  if (!SAFE_RUNTIME_ROLE_PATTERN.test(runtimeRole))
    throw new Error("Pro League runtime role is invalid.");
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  async function transaction<T>(
    options: Readonly<{
      ownerId: string;
      readOnly: boolean;
      execute: (
        query: (
          statement: string,
          values?: readonly unknown[],
        ) => Promise<QueryResult>,
      ) => Promise<T>;
    }>,
  ): Promise<T> {
    const ownerId = text(options.ownerId, "authenticated owner ID");
    if (ownerId !== configuredOwnerId)
      throw new Error("Pro League roster access denied.");
    const session = await sessionFactory(databaseUrl);
    try {
      await session.client.query(
        options.readOnly
          ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
          : "BEGIN ISOLATION LEVEL SERIALIZABLE",
      );
      await session.client.query(SET_OWNER_SCOPE_SQL, [databaseOwnerId]);
      verifyIsolation(
        await session.client.query(VERIFY_ISOLATION_SQL, [
          databaseOwnerId,
          ownerId,
        ]),
        ownerId,
        runtimeRole,
      );
      const result = await options.execute(session.client.query);
      await session.client.query("COMMIT");
      return result;
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
  }

  return {
    async saveVersion(ownerId, version) {
      const serializedMembers = members(version);
      const versionSha256 = versionFingerprint(version);
      return transaction({
        ownerId,
        readOnly: false,
        async execute(query) {
          const stored = one(
            await query(STORE_VERSION_SQL, [
              databaseOwnerId,
              version.rosterVersionId,
              version.versionNumber,
              version.rulesetId,
              version.strategyId,
              version.initialRosterCountingPolicy,
              version.evidenceCutoffAt,
              version.rationale,
              versionSha256,
              JSON.stringify(serializedMembers),
            ]),
            "roster version write",
          );
          const disposition = text(stored.disposition, "write disposition");
          if (disposition !== "created" && disposition !== "existing") {
            throw new Error("Pro League roster write disposition is invalid.");
          }
          return { disposition, versionSha256 };
        },
      });
    },

    async loadVersion(ownerId, rosterVersionId) {
      return transaction({
        ownerId,
        readOnly: true,
        async execute(query) {
          const result = await query(READ_VERSION_SQL, [
            databaseOwnerId,
            text(rosterVersionId, "roster version ID"),
          ]);
          if (result.rows.length === 0) return null;
          const stored = one(result, "roster version read");
          const version = buildProLeagueRosterVersion({
            rosterVersionId: text(
              stored.roster_version_id,
              "roster version ID",
            ),
            versionNumber: integer(stored.version_number, "version number"),
            initialRosterCountingPolicy: text(
              stored.initial_roster_counting_policy,
              "initial-roster counting policy",
            ) as ProLeagueRosterVersion["initialRosterCountingPolicy"],
            evidenceCutoffAt: timestamp(
              stored.evidence_cutoff_at,
              "evidence cutoff",
            ),
            rationale: text(stored.rationale, "roster rationale"),
            members: parseMembers(stored.members),
          });
          if (
            version.rulesetId !== text(stored.ruleset_id, "ruleset ID") ||
            version.strategyId !== text(stored.strategy_id, "strategy ID")
          ) {
            throw new Error("Pro League roster authority drifted.");
          }
          const versionSha256 = text(stored.version_sha256, "version SHA-256");
          if (versionFingerprint(version) !== versionSha256) {
            throw new Error("Pro League roster version fingerprint drifted.");
          }
          return {
            version,
            versionSha256,
            createdAt: timestamp(stored.created_at, "created timestamp"),
          };
        },
      });
    },

    async recordSubstitution(ownerId, substitution) {
      const substitutionSha256 = sha256(substitution);
      return transaction({
        ownerId,
        readOnly: false,
        async execute(query) {
          const stored = one(
            await query(RECORD_SUBSTITUTION_SQL, [
              databaseOwnerId,
              substitution.seasonYear,
              substitution.substitutionNumber,
              substitution.fromRosterVersionId,
              substitution.toRosterVersionId,
              substitution.outgoingCoreId,
              substitution.incomingCoreId,
              substitution.reason,
              substitution.evidence.asOf,
              substitution.evidence.generationId,
              substitution.evidence.sha256,
              substitution.evidence.confidence,
              substitutionSha256,
            ]),
            "substitution write",
          );
          const disposition = text(stored.disposition, "write disposition");
          if (disposition !== "created" && disposition !== "existing") {
            throw new Error(
              "Pro League substitution write disposition is invalid.",
            );
          }
          return { disposition, substitutionSha256 };
        },
      });
    },

    async listSubstitutions(ownerId, seasonYear) {
      if (
        !Number.isSafeInteger(seasonYear) ||
        seasonYear < 2026 ||
        seasonYear > 9999
      ) {
        throw new Error("Pro League substitution season is invalid.");
      }
      return transaction({
        ownerId,
        readOnly: true,
        async execute(query) {
          const result = await query(LIST_SUBSTITUTIONS_SQL, [
            databaseOwnerId,
            seasonYear,
          ]);
          return result.rows.map((value) => {
            const stored = row(value, "substitution");
            const substitution = {
              seasonYear: integer(stored.season_year, "season year"),
              substitutionNumber: integer(
                stored.substitution_number,
                "substitution number",
              ),
              fromRosterVersionId: text(
                stored.from_roster_version_id,
                "from version",
              ),
              toRosterVersionId: text(
                stored.to_roster_version_id,
                "to version",
              ),
              outgoingCoreId: text(stored.outgoing_core_id, "outgoing Core"),
              incomingCoreId: text(stored.incoming_core_id, "incoming Core"),
              reason: text(stored.reason, "substitution reason"),
              evidence: {
                asOf: timestamp(stored.evidence_as_of, "evidence timestamp"),
                generationId: text(
                  stored.evidence_generation_id,
                  "evidence generation",
                ),
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
            return substitution;
          });
        },
      });
    },
  };
}
