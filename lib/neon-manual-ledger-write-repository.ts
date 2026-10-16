import type {
  ManualLedgerAssetRegistry,
  ManualLedgerPersistenceResult,
  ManualLedgerWriteRepository,
} from "@/lib/manual-ledger-write-service";
import type { ValidatedManualLedgerEntry } from "@/domain/manual-ledger";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceClient,
  type NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ROLE = /^[a-z_][a-z0-9_]{0,62}$/;
const HASH = /^[a-f0-9]{64}$/;

const VERIFY_SQL = `
  SELECT owner.id::text AS database_owner_id,
    owner.clerk_user_id AS authenticated_owner_id,
    entry.relrowsecurity AS entry_rls,
    entry.relforcerowsecurity AS entry_force_rls,
    reversal.relrowsecurity AS reversal_rls,
    reversal.relforcerowsecurity AS reversal_force_rls,
    session_user::text AS session_user_name,
    current_user::text AS current_user_name,
    role.rolsuper AS runtime_is_superuser,
    role.rolbypassrls AS runtime_bypasses_rls,
    role.rolcreaterole AS runtime_can_create_roles,
    role.rolcreatedb AS runtime_can_create_databases,
    COALESCE(pg_has_role(session_user,
      (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='neon_superuser'),
      'MEMBER'), false) AS runtime_is_neon_superuser_member,
    has_table_privilege(session_user, entry.oid,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AS runtime_has_direct_entry_access,
    has_table_privilege(session_user, reversal.oid,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AS runtime_has_direct_reversal_access
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_class entry
    ON entry.oid='dna.manual_economic_entry'::regclass
  JOIN pg_catalog.pg_class reversal
    ON reversal.oid='dna.manual_economic_reversal'::regclass
  JOIN pg_catalog.pg_roles role ON role.rolname=session_user
  WHERE owner.id=$1::uuid AND owner.clerk_user_id=$2::text
`;
const CONTEXT_SQL = `
  SELECT asset_registry_version, assets_json, ledger_version
  FROM dna.read_manual_economic_write_context($1::uuid)
`;
const CAMPAIGN_SQL = `
  SELECT tournament_id, evidence_id, configuration_version,
    owner_acknowledged_at
  FROM dna.read_manual_economic_tournament_binding($1::uuid,$2::text)
`;
const SAVE_ENTRY_SQL = `
  SELECT disposition, fingerprint, ledger_version, reversal_id
  FROM dna.write_manual_economic_entry(
    $1::uuid,$2::text,$3::character(64),$4::text,$5::text
  )
`;
const READ_ENTRY_SQL = `
  SELECT entry_json, fingerprint
  FROM dna.read_manual_economic_entry($1::uuid,$2::text)
`;
const SAVE_REVERSAL_SQL = `
  SELECT disposition, fingerprint, ledger_version, reversal_id
  FROM dna.write_manual_economic_reversal(
    $1::uuid,$2::text,$3::text,$4::character(64),$5::text,
    $6::character(64),$7::text
  )
`;

type Environment = Readonly<{
  databaseUrl: string | undefined;
  databaseOwnerId: string | undefined;
  runtimeRole: string | undefined;
}>;

export type ManualLedgerWriteContext = Readonly<{
  assetRegistry: Extract<ManualLedgerAssetRegistry, { status: "ready" }>;
  ledgerVersion: string;
}>;

export type NeonManualLedgerPersistence =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      repository: Extract<ManualLedgerWriteRepository, { status: "ready" }>;
      loadContextByOwner: (
        ownerId: string,
      ) => Promise<ManualLedgerWriteContext>;
    }>;

function fail(): never {
  throw new Error("Manual economic persistence unavailable.");
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return fail();
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return fail();
  return value;
}

function timestamp(value: unknown): string {
  const parsed = new Date(text(value));
  if (Number.isNaN(parsed.getTime())) return fail();
  return parsed.toISOString();
}

function integer(value: unknown): number {
  const parsed =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) < 0) return fail();
  return parsed as number;
}

function json<T>(value: unknown): T {
  if (typeof value !== "string") return fail();
  try {
    return JSON.parse(value) as T;
  } catch {
    return fail();
  }
}

function normalized(value: string | undefined): string | null {
  const result = value?.trim() ?? "";
  return result === "" ? null : result;
}

function verify(
  rowValue: unknown,
  input: Readonly<{
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    runtimeRole: string;
  }>,
): void {
  const row = object(rowValue);
  if (
    row.database_owner_id !== input.databaseOwnerId ||
    row.authenticated_owner_id !== input.authenticatedOwnerId ||
    row.session_user_name !== input.runtimeRole ||
    row.current_user_name !== input.runtimeRole ||
    ["entry_rls", "entry_force_rls", "reversal_rls", "reversal_force_rls"].some(
      (field) => row[field] !== true,
    ) ||
    [
      "runtime_is_superuser",
      "runtime_bypasses_rls",
      "runtime_can_create_roles",
      "runtime_can_create_databases",
      "runtime_is_neon_superuser_member",
      "runtime_has_direct_entry_access",
      "runtime_has_direct_reversal_access",
    ].some((field) => row[field] !== false)
  )
    fail();
}

function result(rowValue: unknown): ManualLedgerPersistenceResult {
  const row = object(rowValue);
  const status = text(row.disposition);
  const ledgerVersion = text(row.ledger_version);
  if (status === "created") return { status, ledgerVersion };
  if (["already_exists", "conflict", "original_changed"].includes(status)) {
    const fingerprint = text(row.fingerprint);
    if (!HASH.test(fingerprint)) return fail();
    return {
      status: status as "already_exists" | "conflict" | "original_changed",
      fingerprint,
      ledgerVersion,
    };
  }
  if (status === "version_conflict") return { status, ledgerVersion };
  if (status === "original_already_reversed") {
    return { status, reversalId: text(row.reversal_id), ledgerVersion };
  }
  return fail();
}

function validateConfiguration(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    runtimeRole: string;
  }>,
): void {
  if (
    !input.databaseUrl.trim() ||
    !UUID.test(input.databaseOwnerId) ||
    !ROLE.test(input.runtimeRole)
  )
    fail();
}

export function createNeonManualLedgerPersistence(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): Extract<NeonManualLedgerPersistence, { status: "ready" }> {
  validateConfiguration(input);
  const factory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;
  const configuration = Object.freeze({
    databaseUrl: input.databaseUrl,
    databaseOwnerId: input.databaseOwnerId,
    runtimeRole: input.runtimeRole,
  });

  async function transaction<T>(
    ownerId: string,
    operation: (client: NeonImportPersistenceClient) => Promise<T>,
  ): Promise<T> {
    if (!ownerId.trim()) return fail();
    const session = await factory(configuration.databaseUrl).catch(() =>
      fail(),
    );
    let started = false;
    try {
      await session.client.query(
        "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE",
      );
      started = true;
      await session.client.query(
        "SELECT set_config('statement_timeout','10000',true), set_config('lock_timeout','1000',true)",
      );
      const scope = await session.client.query(
        "SELECT set_config('app.owner_id',$1,true) AS owner_scope",
        [configuration.databaseOwnerId],
      );
      if (
        scope.rows.length !== 1 ||
        object(scope.rows[0]).owner_scope !== configuration.databaseOwnerId
      )
        fail();
      const evidence = await session.client.query(VERIFY_SQL, [
        configuration.databaseOwnerId,
        ownerId,
      ]);
      if (evidence.rows.length !== 1) fail();
      verify(evidence.rows[0], {
        databaseOwnerId: configuration.databaseOwnerId,
        authenticatedOwnerId: ownerId,
        runtimeRole: configuration.runtimeRole,
      });
      const value = await operation(session.client);
      await session.client.query("COMMIT");
      started = false;
      return value;
    } catch {
      if (started)
        await session.client.query("ROLLBACK").catch(() => undefined);
      return fail();
    } finally {
      await session.close().catch(() => fail());
    }
  }

  const repository: Extract<ManualLedgerWriteRepository, { status: "ready" }> =
    {
      status: "ready",
      async loadTournamentCampaignBindingByOwner(ownerId, tournamentId) {
        return transaction(ownerId, async (client) => {
          const rows = await client.query(CAMPAIGN_SQL, [
            configuration.databaseOwnerId,
            tournamentId,
          ]);
          if (rows.rows.length > 1) return fail();
          if (rows.rows.length === 0) return null;
          const row = object(rows.rows[0]);
          return Object.freeze({
            tournamentId: text(row.tournament_id),
            evidenceId: text(row.evidence_id),
            configurationVersion: text(row.configuration_version),
            ownerAcknowledgedAt: timestamp(row.owner_acknowledged_at),
          });
        });
      },
      async saveEntryByOwner(
        ownerId,
        entry,
        fingerprint,
        expectedLedgerVersion,
      ) {
        return transaction(ownerId, async (client) => {
          const rows = await client.query(SAVE_ENTRY_SQL, [
            configuration.databaseOwnerId,
            entry.entryId,
            fingerprint,
            JSON.stringify(entry),
            expectedLedgerVersion,
          ]);
          if (rows.rows.length !== 1) return fail();
          return result(rows.rows[0]);
        });
      },
      async loadEntryByOwner(ownerId, entryId) {
        return transaction(ownerId, async (client) => {
          const rows = await client.query(READ_ENTRY_SQL, [
            configuration.databaseOwnerId,
            entryId,
          ]);
          if (rows.rows.length > 1) return fail();
          if (rows.rows.length === 0) return null;
          const row = object(rows.rows[0]);
          const fingerprint = text(row.fingerprint);
          if (!HASH.test(fingerprint)) return fail();
          return Object.freeze({
            entry: json<ValidatedManualLedgerEntry>(row.entry_json),
            fingerprint,
          });
        });
      },
      async saveReversalByOwner(
        ownerId,
        reversal,
        fingerprint,
        expectedLedgerVersion,
        expectedOriginalFingerprint,
      ) {
        return transaction(ownerId, async (client) => {
          const rows = await client.query(SAVE_REVERSAL_SQL, [
            configuration.databaseOwnerId,
            reversal.reversalId,
            reversal.originalEntryId,
            fingerprint,
            JSON.stringify(reversal),
            expectedOriginalFingerprint,
            expectedLedgerVersion,
          ]);
          if (rows.rows.length !== 1) return fail();
          return result(rows.rows[0]);
        });
      },
    };

  return {
    status: "ready",
    repository,
    async loadContextByOwner(ownerId) {
      return transaction(ownerId, async (client) => {
        const rows = await client.query(CONTEXT_SQL, [
          configuration.databaseOwnerId,
        ]);
        if (rows.rows.length !== 1) return fail();
        const row = object(rows.rows[0]);
        const version = text(row.asset_registry_version);
        if (!HASH.test(version)) return fail();
        const assets = json<unknown[]>(row.assets_json);
        if (!Array.isArray(assets) || assets.length === 0) return fail();
        const normalizedAssets = assets.map((value) => {
          const asset = object(value);
          const kind = text(asset.kind);
          if (!["crypto", "fiat", "game_credit"].includes(kind)) return fail();
          return Object.freeze({
            code: text(asset.code),
            kind: kind as "crypto" | "fiat" | "game_credit",
            precision: integer(asset.precision),
          });
        });
        return Object.freeze({
          assetRegistry: Object.freeze({
            status: "ready" as const,
            version,
            assets: Object.freeze(normalizedAssets),
          }),
          ledgerVersion: text(row.ledger_version),
        });
      });
    },
  };
}

export function neonManualLedgerPersistenceFromEnvironment(
  environment: Environment,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): NeonManualLedgerPersistence {
  const databaseUrl = normalized(environment.databaseUrl);
  const databaseOwnerId = normalized(environment.databaseOwnerId);
  const runtimeRole = normalized(environment.runtimeRole);
  if (databaseUrl === null || databaseOwnerId === null || runtimeRole === null)
    return Object.freeze({ status: "not_configured" });
  return createNeonManualLedgerPersistence({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
