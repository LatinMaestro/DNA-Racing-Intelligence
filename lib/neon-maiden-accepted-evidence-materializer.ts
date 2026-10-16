import type {
  MaidenAcceptedGenerationSource,
  MaidenEvidenceMaterializationBoundary,
  MaidenEvidencePublicationCandidate,
  MaidenEvidencePublicationOutcome,
} from "@/lib/maiden-accepted-evidence-materializer";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceClient,
  type NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ROLE = /^[a-z_][a-z0-9_]{0,62}$/;
const HASH = /^[a-f0-9]{64}$/;
const ERROR = "Maiden accepted generation persistence unavailable.";

const VERIFY_SQL = `
  SELECT owner.id::text AS database_owner_id,
    owner.clerk_user_id AS authenticated_owner_id,
    source.relrowsecurity AS source_row_security_enabled,
    source.relforcerowsecurity AS source_force_row_security_enabled,
    snapshot.relrowsecurity AS snapshot_row_security_enabled,
    snapshot.relforcerowsecurity AS snapshot_force_row_security_enabled,
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
    has_table_privilege(session_user, snapshot.oid,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AS runtime_has_direct_snapshot_access,
    has_function_privilege(session_user,
      'dna.read_maiden_allocation_accepted_generation(uuid)', 'EXECUTE')
      AS runtime_can_read_generation,
    has_function_privilege(session_user,
      'dna.read_maiden_allocation_accepted_source_identity(uuid)', 'EXECUTE')
      AS runtime_can_read_identity,
    has_function_privilege(session_user,
      'dna.publish_maiden_allocation_evidence_snapshot(uuid,text,timestamptz,text,text)',
      'EXECUTE') AS runtime_can_publish_snapshot
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_class source
    ON source.oid = 'dna.maiden_allocation_accepted_generation'::regclass
  JOIN pg_catalog.pg_class snapshot
    ON snapshot.oid = 'dna.maiden_allocation_evidence_snapshot'::regclass
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2::text
`;
const READ_SOURCE_SQL = `
  SELECT source_evidence_sha256, generation_json
  FROM dna.read_maiden_allocation_accepted_generation($1::uuid)
`;
const READ_IDENTITY_SQL = `
  SELECT source_evidence_sha256
  FROM dna.read_maiden_allocation_accepted_source_identity($1::uuid)
`;
const PUBLISH_SQL = `
  SELECT dna.publish_maiden_allocation_evidence_snapshot(
    $1::uuid, $2::text, $3::timestamptz, $4::text, $5::text
  ) AS publication_status
`;

function fail(): never {
  throw new Error(ERROR);
}

function row(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail();
  return value as Record<string, unknown>;
}

function parseSource(value: unknown): MaidenAcceptedGenerationSource {
  if (typeof value !== "string") fail();
  try {
    return row(JSON.parse(value) as unknown) as MaidenAcceptedGenerationSource;
  } catch {
    return fail();
  }
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
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
      "snapshot_row_security_enabled",
      "snapshot_force_row_security_enabled",
      "runtime_can_read_generation",
      "runtime_can_read_identity",
      "runtime_can_publish_snapshot",
    ].some((field) => evidence[field] !== true) ||
    [
      "runtime_is_superuser",
      "runtime_bypasses_rls",
      "runtime_can_create_roles",
      "runtime_can_create_databases",
      "runtime_is_neon_superuser_member",
      "runtime_has_direct_source_access",
      "runtime_has_direct_snapshot_access",
    ].some((field) => evidence[field] !== false)
  )
    fail();
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

export function createNeonMaidenAcceptedEvidenceMaterializer(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): MaidenEvidenceMaterializationBoundary {
  if (
    !input.databaseUrl.trim() ||
    !UUID.test(input.databaseOwnerId) ||
    !input.authenticatedOwnerId.trim() ||
    input.authenticatedOwnerId !== input.authenticatedOwnerId.trim() ||
    !ROLE.test(input.runtimeRole)
  )
    fail();
  const configuration = Object.freeze({
    databaseUrl: input.databaseUrl,
    databaseOwnerId: input.databaseOwnerId,
    authenticatedOwnerId: input.authenticatedOwnerId,
    runtimeRole: input.runtimeRole,
  });
  const factory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  async function run<T>(
    operation: (client: NeonImportPersistenceClient) => Promise<T>,
  ): Promise<T> {
    const session = await factory(configuration.databaseUrl).catch(() =>
      fail(),
    );
    let started = false;
    try {
      started = true;
      await beginVerified(session.client, configuration);
      const result = await operation(session.client);
      await session.client.query("COMMIT");
      started = false;
      return result;
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
  }

  return {
    async loadCanonicalSource(ownerId) {
      if (ownerId !== configuration.databaseOwnerId) return fail();
      return run(async (client) => {
        const result = await client.query(READ_SOURCE_SQL, [ownerId]);
        if (result.rows.length === 0) return null;
        if (result.rows.length !== 1) fail();
        const persisted = row(result.rows[0]);
        const sourceHash = persisted.source_evidence_sha256;
        if (typeof sourceHash !== "string" || !HASH.test(sourceHash)) fail();
        const source = parseSource(persisted.generation_json);
        if (
          source.databaseOwnerId !== ownerId ||
          source.sourceEvidenceSha256 !== sourceHash
        )
          fail();
        return source;
      });
    },

    async readAcceptedSourceIdentity(ownerId) {
      if (ownerId !== configuration.databaseOwnerId) return fail();
      return run(async (client) => {
        const result = await client.query(READ_IDENTITY_SQL, [ownerId]);
        if (result.rows.length === 0) return null;
        if (result.rows.length !== 1) fail();
        const source = row(result.rows[0]).source_evidence_sha256;
        if (typeof source !== "string" || !HASH.test(source)) fail();
        return source;
      });
    },

    async publishCandidate(candidate: MaidenEvidencePublicationCandidate) {
      if (
        candidate.databaseOwnerId !== configuration.databaseOwnerId ||
        !HASH.test(candidate.expectedSourceEvidenceSha256) ||
        !HASH.test(candidate.snapshotSha256) ||
        typeof candidate.snapshotJson !== "string" ||
        !validTimestamp(candidate.materializedAt)
      )
        return fail();
      return run(async (client) => {
        const result = await client.query(PUBLISH_SQL, [
          candidate.databaseOwnerId,
          candidate.expectedSourceEvidenceSha256,
          candidate.materializedAt,
          candidate.snapshotJson,
          candidate.snapshotSha256,
        ]);
        if (result.rows.length !== 1) fail();
        const status = row(result.rows[0]).publication_status;
        if (
          status !== "published" &&
          status !== "unchanged" &&
          status !== "source_changed"
        )
          fail();
        return status as MaidenEvidencePublicationOutcome;
      });
    },
  };
}
