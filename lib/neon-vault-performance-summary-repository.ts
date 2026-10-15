import type { VaultPerformanceSummaryRepository } from "./vault-performance-workspace-service";
import { decodeVaultPerformanceSummarySnapshot } from "./vault-performance-summary-snapshot";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceClient,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

// This dependency must read trusted compact ledger/correction authority in the
// same owner-scoped transaction. It must not scan the ledger or accept form/env
// digests. No production implementation is supplied until publication exists.
export type VaultPerformanceSourceIdentityReader = (
  client: NeonImportPersistenceClient,
  databaseOwnerId: string,
) => Promise<string | null>;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ROLE = /^[a-z_][a-z0-9_]{0,62}$/;
const HASH = /^[a-f0-9]{64}$/;
const VERIFY_SQL = `
  SELECT owner.id::text AS database_owner_id,
    owner.clerk_user_id AS authenticated_owner_id,
    summary.relrowsecurity AS row_security_enabled,
    summary.relforcerowsecurity AS force_row_security_enabled,
    session_user::text AS session_user_name,
    current_user::text AS current_user_name,
    role.rolsuper AS runtime_is_superuser,
    role.rolbypassrls AS runtime_bypasses_rls,
    role.rolcreaterole AS runtime_can_create_roles,
    role.rolcreatedb AS runtime_can_create_databases,
    COALESCE(pg_has_role(session_user,
      (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'neon_superuser'),
      'MEMBER'), false) AS runtime_is_neon_superuser_member,
    has_table_privilege(session_user, summary.oid,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AS runtime_has_direct_table_access
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_class summary
    ON summary.oid = 'dna.vault_performance_summary_snapshot'::regclass
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2::text
`;
const READ_SQL = `
  SELECT snapshot_json, snapshot_sha256
  FROM dna.read_vault_performance_summary_snapshot($1::uuid, $2::text)
`;

function fail(): never {
  // Provider errors can contain SQL parameters and protected evidence.
  throw new Error("Vault Performance summary read unavailable.");
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail();
  return value as Record<string, unknown>;
}

export function createNeonVaultPerformanceSummaryRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    runtimeRole: string;
    readSourceIdentity: VaultPerformanceSourceIdentityReader;
    sessionFactory?: NeonImportPersistenceSessionFactory;
    now?: () => Date;
  }>,
): VaultPerformanceSummaryRepository {
  if (
    !input.databaseUrl.trim() ||
    !UUID.test(input.databaseOwnerId) ||
    !input.authenticatedOwnerId.trim() ||
    input.authenticatedOwnerId !== input.authenticatedOwnerId.trim() ||
    !ROLE.test(input.runtimeRole) ||
    typeof input.readSourceIdentity !== "function"
  )
    fail();
  // Capture configuration, not the mutable caller-owned options object.
  const {
    databaseUrl,
    databaseOwnerId,
    authenticatedOwnerId,
    runtimeRole,
    readSourceIdentity,
  } = input;
  const factory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;
  const clock = input.now ?? (() => new Date());
  return {
    status: "ready",
    async loadSummaryByOwner(ownerId) {
      if (ownerId !== authenticatedOwnerId) fail();
      const now = clock();
      if (!(now instanceof Date) || Number.isNaN(now.getTime())) fail();
      const session = await factory(databaseUrl).catch(() => fail());
      let started = false;
      try {
        await session.client.query(
          "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
        );
        started = true;
        await session.client.query(
          "SELECT set_config('statement_timeout', '5000', true), set_config('lock_timeout', '1000', true)",
        );
        const scope = await session.client.query(
          "SELECT set_config('app.owner_id', $1, true) AS owner_scope",
          [databaseOwnerId],
        );
        if (
          scope.rows.length !== 1 ||
          record(scope.rows[0]).owner_scope !== databaseOwnerId
        )
          fail();
        const verified = await session.client.query(VERIFY_SQL, [
          databaseOwnerId,
          authenticatedOwnerId,
        ]);
        if (verified.rows.length !== 1) fail();
        const row = record(verified.rows[0]);
        if (
          row.database_owner_id !== databaseOwnerId ||
          row.authenticated_owner_id !== authenticatedOwnerId ||
          row.session_user_name !== runtimeRole ||
          row.current_user_name !== runtimeRole ||
          row.row_security_enabled !== true ||
          row.force_row_security_enabled !== true ||
          [
            "runtime_is_superuser",
            "runtime_bypasses_rls",
            "runtime_can_create_roles",
            "runtime_can_create_databases",
            "runtime_is_neon_superuser_member",
            "runtime_has_direct_table_access",
          ].some((key) => row[key] !== false)
        )
          fail();
        const source = await readSourceIdentity(
          session.client,
          databaseOwnerId,
        );
        if (
          source !== null &&
          (typeof source !== "string" || !HASH.test(source))
        )
          fail();
        let summary = null;
        if (source !== null) {
          const result = await session.client.query(READ_SQL, [
            databaseOwnerId,
            source,
          ]);
          if (result.rows.length > 1) fail();
          if (result.rows.length === 1) {
            const snapshot = record(result.rows[0]);
            if (
              typeof snapshot.snapshot_json !== "string" ||
              typeof snapshot.snapshot_sha256 !== "string"
            )
              fail();
            summary = decodeVaultPerformanceSummarySnapshot({
              json: snapshot.snapshot_json,
              sha256: snapshot.snapshot_sha256,
              databaseOwnerId,
              sourceLedgerSha256: source,
              now,
            });
          }
        }
        await session.client.query("COMMIT");
        started = false;
        return summary;
      } catch {
        if (started)
          await session.client.query("ROLLBACK").catch(() => undefined);
        return fail();
      } finally {
        try {
          await session.close();
        } catch {
          fail();
        }
      }
    },
  };
}
