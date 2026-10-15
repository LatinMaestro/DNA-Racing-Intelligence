import { createHash } from "node:crypto";
import type {
  VaultPerformanceCanonicalSourceState,
  VaultPerformanceSummaryMaterializer,
  VaultPerformanceSummaryPublicationCandidate,
  VaultPerformanceSummaryPublicationResult,
} from "@/lib/vault-performance-summary-materializer";
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
    source.relrowsecurity AS source_row_security_enabled,
    source.relforcerowsecurity AS source_force_row_security_enabled,
    summary.relrowsecurity AS summary_row_security_enabled,
    summary.relforcerowsecurity AS summary_force_row_security_enabled,
    session_user::text AS session_user_name,
    current_user::text AS current_user_name,
    role.rolsuper AS runtime_is_superuser,
    role.rolbypassrls AS runtime_bypasses_rls,
    role.rolcreaterole AS runtime_can_create_roles,
    role.rolcreatedb AS runtime_can_create_databases,
    COALESCE(pg_has_role(session_user,
      (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'neon_superuser'),
      'MEMBER'), false) AS runtime_is_neon_superuser_member,
    has_table_privilege(session_user, source.oid,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AS runtime_has_direct_source_access,
    has_table_privilege(session_user, summary.oid,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AS runtime_has_direct_summary_access,
    has_function_privilege(session_user,
      'dna.read_vault_performance_canonical_source(uuid)', 'EXECUTE')
      AS runtime_can_read_canonical_source,
    has_function_privilege(session_user,
      'dna.claim_vault_performance_source_identity(uuid,bigint,text)', 'EXECUTE')
      AS runtime_can_claim_source,
    has_function_privilege(session_user,
      'dna.publish_vault_performance_summary_snapshot(uuid,text,timestamptz,text,text)',
      'EXECUTE') AS runtime_can_publish_summary
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_class source
    ON source.oid = 'dna.vault_performance_summary_source_state'::regclass
  JOIN pg_catalog.pg_class summary
    ON summary.oid = 'dna.vault_performance_summary_snapshot'::regclass
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2::text
`;
const READ_SOURCE_SQL = `
  SELECT source_revision::text, records_json, coverage_json,
    unsupported_count::text
  FROM dna.read_vault_performance_canonical_source($1::uuid)
`;
const CLAIM_SOURCE_SQL = `
  SELECT dna.claim_vault_performance_source_identity(
    $1::uuid, $2::bigint, $3::text
  ) AS claimed
`;
const PUBLISH_SQL = `
  SELECT dna.publish_vault_performance_summary_snapshot(
    $1::uuid, $2::text, $3::timestamptz, $4::text, $5::text
  ) AS publication_status
`;
const READ_IDENTITY_SQL = `
  SELECT source_ledger_sha256
  FROM dna.read_vault_performance_source_identity($1::uuid)
`;

const unavailable =
  "Vault Performance canonical source materialization unavailable.";

function fail(): never {
  // Do not forward SQL, owner, transaction, provider or financial values.
  throw new Error(unavailable);
}

function row(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail();
  return value as Record<string, unknown>;
}

function json(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fail();
  }
}

function integerString(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return String(value);
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value))
    return value;
  return fail();
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value !== "object") return fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail();
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`;
}

function sourceDigest(
  input: Readonly<{
    databaseOwnerId: string;
    sourceRevision: string;
    records: unknown;
    coverage: unknown;
  }>,
): string {
  return createHash("sha256")
    .update(
      canonical({
        version: 1,
        databaseOwnerId: input.databaseOwnerId,
        sourceRevision: input.sourceRevision,
        records: input.records,
        coverage: input.coverage,
      }),
      "utf8",
    )
    .digest("hex");
}

function verifyEvidence(
  value: unknown,
  input: Readonly<{
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    runtimeRole: string;
  }>,
): void {
  const evidence = row(value);
  if (
    evidence.database_owner_id !== input.databaseOwnerId ||
    evidence.authenticated_owner_id !== input.authenticatedOwnerId ||
    evidence.session_user_name !== input.runtimeRole ||
    evidence.current_user_name !== input.runtimeRole ||
    [
      "source_row_security_enabled",
      "source_force_row_security_enabled",
      "summary_row_security_enabled",
      "summary_force_row_security_enabled",
      "runtime_can_read_canonical_source",
      "runtime_can_claim_source",
      "runtime_can_publish_summary",
    ].some((field) => evidence[field] !== true) ||
    [
      "runtime_is_superuser",
      "runtime_bypasses_rls",
      "runtime_can_create_roles",
      "runtime_can_create_databases",
      "runtime_is_neon_superuser_member",
      "runtime_has_direct_source_access",
      "runtime_has_direct_summary_access",
    ].some((field) => evidence[field] !== false)
  )
    fail();
}

function validateConfiguration(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    runtimeRole: string;
  }>,
): void {
  if (
    !input.databaseUrl.trim() ||
    !UUID.test(input.databaseOwnerId) ||
    !input.authenticatedOwnerId.trim() ||
    input.authenticatedOwnerId !== input.authenticatedOwnerId.trim() ||
    !ROLE.test(input.runtimeRole)
  )
    fail();
}

function validIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

async function beginVerified(
  client: NeonImportPersistenceClient,
  input: Readonly<{
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    runtimeRole: string;
  }>,
): Promise<void> {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
  await client.query(
    "SELECT set_config('statement_timeout', '10000', true), set_config('lock_timeout', '1000', true)",
  );
  const scope = await client.query(
    "SELECT set_config('app.owner_id', $1, true) AS owner_scope",
    [input.databaseOwnerId],
  );
  if (
    scope.rows.length !== 1 ||
    row(scope.rows[0]).owner_scope !== input.databaseOwnerId
  )
    fail();
  const verified = await client.query(VERIFY_SQL, [
    input.databaseOwnerId,
    input.authenticatedOwnerId,
  ]);
  if (verified.rows.length !== 1) fail();
  verifyEvidence(verified.rows[0], input);
}

export async function readNeonVaultPerformanceSourceIdentity(
  client: NeonImportPersistenceClient,
  databaseOwnerId: string,
): Promise<string | null> {
  try {
    if (!UUID.test(databaseOwnerId)) fail();
    const result = await client.query(READ_IDENTITY_SQL, [databaseOwnerId]);
    if (result.rows.length > 1) fail();
    if (result.rows.length === 0) return null;
    const source = row(result.rows[0]).source_ledger_sha256;
    if (typeof source !== "string" || !HASH.test(source)) fail();
    return source;
  } catch {
    return fail();
  }
}

export function createNeonVaultPerformanceSummaryMaterializer(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): VaultPerformanceSummaryMaterializer {
  validateConfiguration(input);
  const configuration = Object.freeze({
    databaseUrl: input.databaseUrl,
    databaseOwnerId: input.databaseOwnerId,
    authenticatedOwnerId: input.authenticatedOwnerId,
    runtimeRole: input.runtimeRole,
  });
  const factory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  return {
    async loadCanonicalSource(databaseOwnerId) {
      if (databaseOwnerId !== configuration.databaseOwnerId) return fail();
      const session = await factory(configuration.databaseUrl).catch(() =>
        fail(),
      );
      let started = false;
      try {
        started = true;
        await beginVerified(session.client, configuration);
        const result = await session.client.query(READ_SOURCE_SQL, [
          configuration.databaseOwnerId,
        ]);
        if (result.rows.length !== 1) fail();
        const source = row(result.rows[0]);
        const revision = integerString(source.source_revision);
        const unsupported = integerString(source.unsupported_count);
        const records = json(source.records_json);
        const coverage = json(source.coverage_json);
        if (unsupported !== "0" || coverage === null) {
          await session.client.query("COMMIT");
          started = false;
          return null;
        }
        if (!Array.isArray(records) || typeof coverage !== "object") fail();
        const digest = sourceDigest({
          databaseOwnerId: configuration.databaseOwnerId,
          sourceRevision: revision,
          records,
          coverage,
        });
        const claimed = await session.client.query(CLAIM_SOURCE_SQL, [
          configuration.databaseOwnerId,
          revision,
          digest,
        ]);
        if (
          claimed.rows.length !== 1 ||
          row(claimed.rows[0]).claimed !== true
        ) {
          await session.client.query("ROLLBACK");
          started = false;
          return null;
        }
        await session.client.query("COMMIT");
        started = false;
        return Object.freeze({
          sourceLedgerSha256: digest,
          records: records as VaultPerformanceCanonicalSourceState["records"],
          coverage:
            coverage as VaultPerformanceCanonicalSourceState["coverage"],
        });
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

    async publishCandidate(
      candidate: VaultPerformanceSummaryPublicationCandidate,
    ): Promise<VaultPerformanceSummaryPublicationResult> {
      if (
        candidate.databaseOwnerId !== configuration.databaseOwnerId ||
        !HASH.test(candidate.expectedSourceLedgerSha256) ||
        !HASH.test(candidate.snapshotSha256) ||
        typeof candidate.snapshotJson !== "string" ||
        !validIsoTimestamp(candidate.materializedAt)
      )
        return fail();
      const session = await factory(configuration.databaseUrl).catch(() =>
        fail(),
      );
      let started = false;
      try {
        started = true;
        await beginVerified(session.client, configuration);
        const result = await session.client.query(PUBLISH_SQL, [
          configuration.databaseOwnerId,
          candidate.expectedSourceLedgerSha256,
          candidate.materializedAt,
          candidate.snapshotJson,
          candidate.snapshotSha256,
        ]);
        if (result.rows.length !== 1) fail();
        const status = row(result.rows[0]).publication_status;
        if (
          !(["published", "unchanged", "source_changed"] as const).includes(
            status as VaultPerformanceSummaryPublicationResult,
          )
        )
          fail();
        await session.client.query("COMMIT");
        started = false;
        return status as VaultPerformanceSummaryPublicationResult;
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
