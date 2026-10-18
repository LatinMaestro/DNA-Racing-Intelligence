import { createHash } from "node:crypto";

import type {
  TournamentHorseScreeningPublicationBoundary,
  TournamentHorseScreeningPublicationCandidate,
  TournamentHorseScreeningPublicationOutcome,
} from "@/lib/tournament-horse-screening-materializer";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceClient,
  type NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const ROLE = /^[a-z_][a-z0-9_]{0,62}$/u;
const ERROR = "Tournament Horse screening publication unavailable.";

const VERIFY_SQL = `
  SELECT owner.id::text AS database_owner_id,
    owner.clerk_user_id AS authenticated_owner_id,
    snapshot.relrowsecurity AS snapshot_row_security_enabled,
    snapshot.relforcerowsecurity AS snapshot_force_row_security_enabled,
    active.relrowsecurity AS active_row_security_enabled,
    active.relforcerowsecurity AS active_force_row_security_enabled,
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
      AS runtime_has_direct_snapshot_access,
    has_table_privilege(session_user, active.oid,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AS runtime_has_direct_active_access,
    has_function_privilege(session_user,
      'dna.read_active_tournament_horse_screening_snapshot(uuid)', 'EXECUTE')
      AS runtime_can_read_snapshot,
    has_function_privilege(session_user,
      'dna.publish_tournament_horse_screening_snapshot(uuid,text,text,text,timestamptz)',
      'EXECUTE') AS runtime_can_publish_snapshot
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_class snapshot
    ON snapshot.oid = 'dna.tournament_horse_screening_snapshot'::regclass
  JOIN pg_catalog.pg_class active
    ON active.oid = 'dna.tournament_horse_screening_snapshot_active'::regclass
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2::text
`;
const READ_ACTIVE_SQL = `
  SELECT snapshot_version
  FROM dna.read_active_tournament_horse_screening_snapshot($1::uuid)
`;
const PUBLISH_SQL = `
  SELECT dna.publish_tournament_horse_screening_snapshot(
    $1::uuid, $2::text, $3::text, $4::text, $5::timestamptz
  ) AS publication_status
`;

function fail(): never {
  throw new Error(ERROR);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail();
  return value as Record<string, unknown>;
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function verifyIsolation(
  value: unknown,
  configuration: Readonly<{
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    runtimeRole: string;
  }>,
): void {
  const row = record(value);
  if (
    row.database_owner_id !== configuration.databaseOwnerId ||
    row.authenticated_owner_id !== configuration.authenticatedOwnerId ||
    row.session_user_name !== configuration.runtimeRole ||
    row.current_user_name !== configuration.runtimeRole ||
    [
      "snapshot_row_security_enabled",
      "snapshot_force_row_security_enabled",
      "active_row_security_enabled",
      "active_force_row_security_enabled",
      "runtime_can_read_snapshot",
      "runtime_can_publish_snapshot",
    ].some((field) => row[field] !== true) ||
    [
      "runtime_is_superuser",
      "runtime_bypasses_rls",
      "runtime_can_create_roles",
      "runtime_can_create_databases",
      "runtime_is_neon_superuser_member",
      "runtime_has_direct_snapshot_access",
      "runtime_has_direct_active_access",
    ].some((field) => row[field] !== false)
  )
    fail();
}

function validateCandidate(
  candidate: TournamentHorseScreeningPublicationCandidate,
  databaseOwnerId: string,
): void {
  if (
    candidate.databaseOwnerId !== databaseOwnerId ||
    (candidate.expectedActiveSnapshotVersion !== null &&
      !HASH.test(candidate.expectedActiveSnapshotVersion)) ||
    !HASH.test(candidate.sourceSnapshotVersion) ||
    !HASH.test(candidate.snapshotVersion) ||
    typeof candidate.payloadJson !== "string" ||
    Buffer.byteLength(candidate.payloadJson, "utf8") < 1 ||
    Buffer.byteLength(candidate.payloadJson, "utf8") > 1_048_576 ||
    !canonicalTimestamp(candidate.publishedAt) ||
    createHash("sha256").update(candidate.payloadJson, "utf8").digest("hex") !==
      candidate.snapshotVersion
  )
    fail();
  try {
    const payload = record(JSON.parse(candidate.payloadJson) as unknown);
    if (payload.sourceSnapshotVersion !== candidate.sourceSnapshotVersion)
      fail();
  } catch {
    fail();
  }
}

export function createNeonTournamentHorseScreeningPublicationBoundary(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): TournamentHorseScreeningPublicationBoundary {
  if (
    input.databaseUrl.trim() === "" ||
    !UUID.test(input.databaseOwnerId) ||
    input.authenticatedOwnerId.trim() === "" ||
    input.authenticatedOwnerId.trim() !== input.authenticatedOwnerId ||
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
    readOnly: boolean,
    operation: (client: NeonImportPersistenceClient) => Promise<T>,
  ): Promise<T> {
    const session = await factory(configuration.databaseUrl).catch(() =>
      fail(),
    );
    let started = false;
    try {
      await session.client.query(
        `BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE${readOnly ? " READ ONLY" : ""}`,
      );
      started = true;
      await session.client.query(
        "SELECT set_config('statement_timeout', '10000', true), set_config('lock_timeout', '1000', true)",
      );
      const scope = await session.client.query(
        "SELECT set_config('app.owner_id', $1, true) AS owner_scope",
        [configuration.databaseOwnerId],
      );
      if (
        scope.rows.length !== 1 ||
        record(scope.rows[0]).owner_scope !== configuration.databaseOwnerId
      )
        fail();
      const verified = await session.client.query(VERIFY_SQL, [
        configuration.databaseOwnerId,
        configuration.authenticatedOwnerId,
      ]);
      if (verified.rows.length !== 1) fail();
      verifyIsolation(verified.rows[0], configuration);
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

  return Object.freeze({
    async readActiveSnapshotVersionByOwner(ownerId) {
      if (ownerId !== configuration.databaseOwnerId) fail();
      return run(true, async (client) => {
        const result = await client.query(READ_ACTIVE_SQL, [ownerId]);
        if (result.rows.length === 0) return null;
        if (result.rows.length !== 1) fail();
        const version = record(result.rows[0]).snapshot_version;
        if (typeof version !== "string" || !HASH.test(version)) fail();
        return version;
      });
    },

    async publishCandidate(candidate) {
      validateCandidate(candidate, configuration.databaseOwnerId);
      return run(false, async (client) => {
        const result = await client.query(PUBLISH_SQL, [
          candidate.databaseOwnerId,
          candidate.snapshotVersion,
          candidate.expectedActiveSnapshotVersion,
          candidate.payloadJson,
          candidate.publishedAt,
        ]);
        if (result.rows.length !== 1) fail();
        const status = record(result.rows[0]).publication_status;
        if (
          status !== "published" &&
          status !== "unchanged" &&
          status !== "source_changed"
        )
          fail();
        return status as TournamentHorseScreeningPublicationOutcome;
      });
    },
  });
}
