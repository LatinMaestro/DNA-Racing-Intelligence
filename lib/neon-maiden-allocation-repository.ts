import {
  unavailableMaidenAllocationRepository,
  type MaidenAllocationRepository,
} from "./maiden-workspace-service";
import { decodeMaidenAllocationEvidenceSnapshotEnvelope } from "./maiden-allocation-evidence-snapshot";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ROLE = /^[a-z_][a-z0-9_]{0,62}$/;
const HASH = /^[a-f0-9]{64}$/;

type Environment = Readonly<{
  databaseUrl: string | undefined;
  databaseOwnerId: string | undefined;
  runtimeRole: string | undefined;
  authenticatedOwnerId: string | null;
}>;

const VERIFY_SQL = `
  SELECT owner.id::text AS database_owner_id,
    owner.clerk_user_id AS authenticated_owner_id,
    snapshot.relrowsecurity AS row_security_enabled,
    snapshot.relforcerowsecurity AS force_row_security_enabled,
    source.relrowsecurity AS source_row_security_enabled,
    source.relforcerowsecurity AS source_force_row_security_enabled,
    session_user::text AS session_user_name,
    current_user::text AS current_user_name,
    role.rolsuper AS runtime_is_superuser,
    role.rolbypassrls AS runtime_bypasses_rls,
    role.rolcreaterole AS runtime_can_create_roles,
    role.rolcreatedb AS runtime_can_create_databases,
    COALESCE(pg_has_role(session_user,
      (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'neon_superuser'),
      'MEMBER'), false) AS runtime_is_neon_superuser_member,
    has_table_privilege(session_user, snapshot.oid,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AS runtime_has_direct_table_access,
    has_table_privilege(session_user, source.oid,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AS runtime_has_direct_source_access,
    has_function_privilege(session_user,
      'dna.read_maiden_allocation_accepted_source_identity(uuid)', 'EXECUTE')
      AS runtime_can_read_accepted_identity
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_class snapshot
    ON snapshot.oid = 'dna.maiden_allocation_evidence_snapshot'::regclass
  JOIN pg_catalog.pg_class source
    ON source.oid = 'dna.maiden_allocation_accepted_generation'::regclass
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2::text
`;

const READ_SQL = `
  SELECT snapshot.source_evidence_sha256, snapshot.snapshot_json,
    snapshot.snapshot_sha256
  FROM dna.read_maiden_allocation_evidence_snapshot($1::uuid) snapshot
  JOIN dna.read_maiden_allocation_accepted_source_identity($1::uuid) accepted
    ON accepted.source_evidence_sha256 = snapshot.source_evidence_sha256
`;

function fail(): never {
  // Provider errors can contain SQL parameters and protected evidence.
  throw new Error("Maiden allocation evidence read unavailable.");
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail();
  return value as Record<string, unknown>;
}

function normalized(value: string | null | undefined): string | null {
  const result = value?.trim() ?? "";
  return result === "" ? null : result;
}

export function createNeonMaidenAllocationRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
    now?: () => Date;
  }>,
): MaidenAllocationRepository {
  if (
    !input.databaseUrl.trim() ||
    !UUID.test(input.databaseOwnerId) ||
    !input.authenticatedOwnerId.trim() ||
    input.authenticatedOwnerId !== input.authenticatedOwnerId.trim() ||
    !ROLE.test(input.runtimeRole)
  )
    fail();
  const { databaseUrl, databaseOwnerId, authenticatedOwnerId, runtimeRole } =
    input;
  const factory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;
  const clock = input.now ?? (() => new Date());

  return {
    status: "ready",
    async loadAllocationEvidenceByOwner(ownerId) {
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
        const evidence = record(verified.rows[0]);
        if (
          evidence.database_owner_id !== databaseOwnerId ||
          evidence.authenticated_owner_id !== authenticatedOwnerId ||
          evidence.session_user_name !== runtimeRole ||
          evidence.current_user_name !== runtimeRole ||
          evidence.row_security_enabled !== true ||
          evidence.force_row_security_enabled !== true ||
          evidence.source_row_security_enabled !== true ||
          evidence.source_force_row_security_enabled !== true ||
          evidence.runtime_can_read_accepted_identity !== true ||
          [
            "runtime_is_superuser",
            "runtime_bypasses_rls",
            "runtime_can_create_roles",
            "runtime_can_create_databases",
            "runtime_is_neon_superuser_member",
            "runtime_has_direct_table_access",
            "runtime_has_direct_source_access",
          ].some((key) => evidence[key] !== false)
        )
          fail();

        const result = await session.client.query(READ_SQL, [databaseOwnerId]);
        if (result.rows.length > 1) fail();
        let allocation = null;
        if (result.rows.length === 1) {
          const snapshot = record(result.rows[0]);
          if (
            typeof snapshot.source_evidence_sha256 !== "string" ||
            !HASH.test(snapshot.source_evidence_sha256) ||
            typeof snapshot.snapshot_json !== "string" ||
            typeof snapshot.snapshot_sha256 !== "string"
          )
            fail();
          const decoded = decodeMaidenAllocationEvidenceSnapshotEnvelope({
            json: snapshot.snapshot_json,
            sha256: snapshot.snapshot_sha256,
            databaseOwnerId,
            sourceEvidenceSha256: snapshot.source_evidence_sha256,
            now,
          });
          allocation = {
            evidence: decoded.evidence,
            sourceEvidenceSha256: decoded.sourceEvidenceSha256,
            snapshotSha256: snapshot.snapshot_sha256,
            materializedAt: decoded.materializedAt,
          };
        }
        await session.client.query("COMMIT");
        started = false;
        return allocation;
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

export function neonMaidenAllocationRepositoryFromEnvironment(
  environment: Environment,
  sessionFactory?: NeonImportPersistenceSessionFactory,
  now?: () => Date,
): MaidenAllocationRepository {
  const databaseUrl = normalized(environment.databaseUrl);
  const databaseOwnerId = normalized(environment.databaseOwnerId);
  const runtimeRole = normalized(environment.runtimeRole);
  const authenticatedOwnerId = normalized(environment.authenticatedOwnerId);
  if (
    databaseUrl === null ||
    databaseOwnerId === null ||
    runtimeRole === null ||
    authenticatedOwnerId === null
  )
    return unavailableMaidenAllocationRepository;

  return createNeonMaidenAllocationRepository({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    authenticatedOwnerId,
    ...(sessionFactory ? { sessionFactory } : {}),
    ...(now ? { now } : {}),
  });
}
