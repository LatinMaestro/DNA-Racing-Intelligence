import { createHash } from "node:crypto";

import {
  restoreProLeagueLineupVersion,
  restoreProLeagueMatchLock,
  type ProLeagueLineupVersion,
  type ProLeagueMatchLock,
} from "@/domain/pro-league-lineup-version";
import type {
  ProLeagueMapId,
  ProLeagueMapLineupEntry,
} from "@/domain/pro-league-maps";
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
      'dna.store_pro_league_lineup_version(uuid,text,integer,text,text,text,text,text,jsonb)',
      'EXECUTE') AS runtime_can_store_lineup,
    has_function_privilege(session_user,
      'dna.read_pro_league_lineup_version(uuid,text)',
      'EXECUTE') AS runtime_can_read_lineup,
    has_function_privilege(session_user,
      'dna.store_pro_league_match_lock(uuid,text,text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,text,text,text)',
      'EXECUTE') AS runtime_can_store_lock,
    has_function_privilege(session_user,
      'dna.read_pro_league_match_lock(uuid,text)',
      'EXECUTE') AS runtime_can_read_lock,
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
      'dna.pro_league_lineup_version'::regclass,
      'dna.pro_league_lineup_entry_snapshot'::regclass,
      'dna.pro_league_match_lock'::regclass
    )
  ) table_state
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
  GROUP BY owner.clerk_user_id, role.rolsuper, role.rolbypassrls,
    role.rolcreaterole, role.rolcreatedb
`;
const STORE_LINEUP_SQL = `SELECT * FROM dna.store_pro_league_lineup_version(
  $1::uuid,$2::text,$3::integer,$4::text,$5::text,$6::text,$7::text,
  $8::text,$9::jsonb
)`;
const READ_LINEUP_SQL =
  "SELECT * FROM dna.read_pro_league_lineup_version($1::uuid,$2::text)";
const STORE_LOCK_SQL = `SELECT * FROM dna.store_pro_league_match_lock(
  $1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,
  $9::text,$10::timestamptz,$11::timestamptz,$12::text,$13::text,$14::text,
  $15::text,$16::text,$17::text,$18::text,$19::text,$20::text
)`;
const READ_LOCK_SQL =
  "SELECT * FROM dna.read_pro_league_match_lock($1::uuid,$2::text)";

type QueryResult = Readonly<{ rows: readonly unknown[] }>;
type Row = Readonly<Record<string, unknown>>;

export type StoredProLeagueLineupVersion = Readonly<{
  version: ProLeagueLineupVersion;
  versionSha256: string;
  createdAt: string;
}>;

export type StoredProLeagueMatchLock = Readonly<{
  lock: ProLeagueMatchLock;
  matchLockSha256: string;
  createdAt: string;
}>;

export type ProLeagueLineupRepository = Readonly<{
  saveLineup: (
    ownerId: string,
    version: ProLeagueLineupVersion,
  ) => Promise<
    Readonly<{ disposition: "created" | "existing"; versionSha256: string }>
  >;
  loadLineup: (
    ownerId: string,
    lineupVersionId: string,
  ) => Promise<StoredProLeagueLineupVersion | null>;
  saveMatchLock: (
    ownerId: string,
    lock: ProLeagueMatchLock,
  ) => Promise<
    Readonly<{ disposition: "created" | "existing"; matchLockSha256: string }>
  >;
  loadMatchLock: (
    ownerId: string,
    matchLockId: string,
  ) => Promise<StoredProLeagueMatchLock | null>;
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

function optionalText(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : text(value, label);
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

function flatEntries(version: ProLeagueLineupVersion) {
  return version.maps
    .flatMap(({ entries }) => entries)
    .map((entry) => ({
      mapId: entry.mapId,
      raceNumber: entry.raceNumber,
      raceType: entry.raceType,
      distanceMetres: entry.distanceMetres,
      totalGateEntries: entry.totalGateEntries,
      gateEntriesPerVault: entry.gateEntriesPerVault,
      coreId: entry.coreId,
      sourceRaceNumber: entry.sourceRaceNumber,
      scope: entry.scope,
    }));
}

function versionFingerprint(version: ProLeagueLineupVersion): string {
  return sha256({
    lineupVersionId: version.lineupVersionId,
    versionNumber: version.versionNumber,
    rosterVersionId: version.rosterVersionId,
    authorityId: version.authorityId,
    mapCatalogueId: version.mapCatalogueId,
    rationale: version.rationale,
    entries: flatEntries(version),
  });
}

function lockFingerprint(lock: ProLeagueMatchLock): string {
  return sha256(lock);
}

function verifyIsolation(
  result: QueryResult,
  ownerId: string,
  runtimeRole: string,
): void {
  const value = one(result, "lineup isolation");
  if (
    text(value.authenticated_owner_id, "authenticated owner") !== ownerId ||
    !bool(value.all_rls_enabled, "RLS") ||
    !bool(value.all_force_rls_enabled, "forced RLS") ||
    bool(value.runtime_can_read_tables, "direct table privilege") ||
    !bool(value.runtime_can_store_lineup, "lineup store privilege") ||
    !bool(value.runtime_can_read_lineup, "lineup read privilege") ||
    !bool(value.runtime_can_store_lock, "match lock store privilege") ||
    !bool(value.runtime_can_read_lock, "match lock read privilege") ||
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
      "Pro League lineup repository requires least-privilege owner isolation.",
    );
  }
}

function parseEntries(value: unknown): readonly ProLeagueMapLineupEntry[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed))
    throw new Error("Pro League lineup entries are invalid.");
  return parsed.map((item) => {
    const entry = row(item, "lineup entry");
    return {
      mapId: text(entry.mapId, "map ID") as ProLeagueMapId,
      raceNumber: integer(entry.raceNumber, "race number"),
      mode: "bike" as const,
      raceType: text(entry.raceType, "race type"),
      distanceMetres: integer(entry.distanceMetres, "distance"),
      totalGateEntries: integer(entry.totalGateEntries, "total gate entries"),
      gateEntriesPerVault: integer(
        entry.gateEntriesPerVault,
        "Vault gate entries",
      ),
      coreId: text(entry.coreId, "mapped Core ID"),
      sourceRaceNumber: integer(entry.sourceRaceNumber, "source race number"),
      scope: text(
        entry.scope,
        "assignment scope",
      ) as ProLeagueMapLineupEntry["scope"],
    };
  });
}

export function createNeonProLeagueLineupRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    ownerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): ProLeagueLineupRepository {
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
      throw new Error("Pro League lineup access denied.");
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
        /* preserve original */
      }
      throw error;
    } finally {
      await session.close();
    }
  }

  return {
    async saveLineup(ownerId, version) {
      const entries = flatEntries(version);
      const versionSha256 = versionFingerprint(version);
      return transaction({
        ownerId,
        readOnly: false,
        async execute(query) {
          const stored = one(
            await query(STORE_LINEUP_SQL, [
              databaseOwnerId,
              version.lineupVersionId,
              version.versionNumber,
              version.rosterVersionId,
              version.authorityId,
              version.mapCatalogueId,
              version.rationale,
              versionSha256,
              JSON.stringify(entries),
            ]),
            "lineup write",
          );
          const disposition = text(
            stored.disposition,
            "lineup write disposition",
          );
          if (disposition !== "created" && disposition !== "existing")
            throw new Error("Pro League lineup write disposition is invalid.");
          if (integer(stored.entry_count, "lineup entry count") !== 168)
            throw new Error("Pro League lineup write is incomplete.");
          return { disposition, versionSha256 };
        },
      });
    },

    async loadLineup(ownerId, lineupVersionId) {
      return transaction({
        ownerId,
        readOnly: true,
        async execute(query) {
          const result = await query(READ_LINEUP_SQL, [
            databaseOwnerId,
            text(lineupVersionId, "lineup version ID"),
          ]);
          if (result.rows.length === 0) return null;
          const stored = one(result, "lineup read");
          const entries = parseEntries(stored.entries);
          const version = restoreProLeagueLineupVersion({
            lineupVersionId: text(
              stored.lineup_version_id,
              "lineup version ID",
            ),
            versionNumber: integer(
              stored.version_number,
              "lineup version number",
            ),
            rosterVersionId: text(
              stored.roster_version_id,
              "roster version ID",
            ),
            rosterCoreIds: [...new Set(entries.map(({ coreId }) => coreId))],
            authorityId: text(stored.authority_id, "lineup authority ID"),
            mapCatalogueId: text(stored.map_catalogue_id, "map catalogue ID"),
            rationale: text(stored.rationale, "lineup rationale"),
            entries,
          });
          const versionSha256 = text(stored.version_sha256, "lineup SHA-256");
          if (versionFingerprint(version) !== versionSha256)
            throw new Error("Pro League lineup fingerprint drifted.");
          return {
            version,
            versionSha256,
            createdAt: timestamp(
              stored.created_at,
              "lineup creation timestamp",
            ),
          };
        },
      });
    },

    async saveMatchLock(ownerId, lock) {
      const matchLockSha256 = lockFingerprint(lock);
      return transaction({
        ownerId,
        readOnly: false,
        async execute(query) {
          const stored = one(
            await query(STORE_LOCK_SQL, [
              databaseOwnerId,
              lock.matchLockId,
              lock.matchId,
              lock.lineupVersionId,
              lock.rosterVersionId,
              lock.ourVaultId,
              lock.homeVaultId,
              lock.awayVaultId,
              lock.ourSide,
              lock.scheduledAt,
              lock.lockedAt,
              lock.rulesetSource,
              lock.selection.policy,
              lock.selection.map1,
              lock.selection.deniedMap,
              lock.selection.map2,
              lock.selection.thirdMap,
              lock.fallback?.source ?? null,
              lock.fallback?.reference ?? null,
              matchLockSha256,
            ]),
            "match lock write",
          );
          const disposition = text(
            stored.disposition,
            "match lock disposition",
          );
          if (disposition !== "created" && disposition !== "existing")
            throw new Error("Pro League match lock disposition is invalid.");
          return { disposition, matchLockSha256 };
        },
      });
    },

    async loadMatchLock(ownerId, matchLockId) {
      return transaction({
        ownerId,
        readOnly: true,
        async execute(query) {
          const result = await query(READ_LOCK_SQL, [
            databaseOwnerId,
            text(matchLockId, "match lock ID"),
          ]);
          if (result.rows.length === 0) return null;
          const stored = one(result, "match lock read");
          const fallbackSource = optionalText(
            stored.fallback_source,
            "fallback source",
          );
          const fallbackReference = optionalText(
            stored.fallback_reference,
            "fallback reference",
          );
          const lock = restoreProLeagueMatchLock({
            matchLockId: text(stored.match_lock_id, "match lock ID"),
            matchId: text(stored.match_id, "match ID"),
            lineupVersionId: text(
              stored.lineup_version_id,
              "lineup version ID",
            ),
            rosterVersionId: text(
              stored.roster_version_id,
              "roster version ID",
            ),
            ourVaultId: text(stored.our_vault_id, "our Vault ID"),
            homeVaultId: text(stored.home_vault_id, "home Vault ID"),
            awayVaultId: text(stored.away_vault_id, "away Vault ID"),
            scheduledAt: timestamp(stored.scheduled_at, "scheduled timestamp"),
            lockedAt: timestamp(stored.locked_at, "lock timestamp"),
            rulesetSource: text(stored.ruleset_source, "ruleset source"),
            thirdMapPolicy: text(
              stored.third_map_policy,
              "third-map policy",
            ) as ProLeagueMatchLock["selection"]["policy"],
            homeMapPick: text(
              stored.home_map_pick,
              "home map pick",
            ) as ProLeagueMapId,
            homeDeniedMap: text(
              stored.home_denied_map,
              "home denied map",
            ) as ProLeagueMapId,
            awayMapPick: text(
              stored.away_map_pick,
              "away map pick",
            ) as ProLeagueMapId,
            thirdMap: text(stored.third_map, "third map") as ProLeagueMapId,
            fallback:
              fallbackSource === null || fallbackReference === null
                ? null
                : {
                    source: fallbackSource as NonNullable<
                      ProLeagueMatchLock["fallback"]
                    >["source"],
                    reference: fallbackReference,
                  },
          });
          if (lock.ourSide !== text(stored.our_side, "our side"))
            throw new Error("Pro League match side drifted.");
          const matchLockSha256 = text(
            stored.match_lock_sha256,
            "match lock SHA-256",
          );
          if (lockFingerprint(lock) !== matchLockSha256)
            throw new Error("Pro League match lock fingerprint drifted.");
          return {
            lock,
            matchLockSha256,
            createdAt: timestamp(
              stored.created_at,
              "match lock creation timestamp",
            ),
          };
        },
      });
    },
  };
}
