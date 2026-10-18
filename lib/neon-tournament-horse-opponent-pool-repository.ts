import { createHash } from "node:crypto";

import type {
  TournamentHorseAcceptedSourceRepositories,
  TournamentHorseOpponentPoolGroup,
  TournamentHorseOpponentPoolSnapshot,
  TournamentHorseRosterCore,
} from "@/lib/tournament-horse-screening-accepted-source";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceClient,
  type NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const HASH = /^[a-f0-9]{64}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ROLE = /^[a-z_][a-z0-9_]{0,62}$/u;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const ERROR = "Tournament Horse opponent pool repository unavailable.";
const DISTANCES = [1000, 1400, 2200] as const;
const ELEMENTS = ["Metal", "Fire", "Earth", "Water"] as const;

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
      'dna.read_active_tournament_horse_opponent_pool_snapshot(uuid)',
      'EXECUTE') AS runtime_can_read_snapshot,
    has_function_privilege(session_user,
      'dna.publish_tournament_horse_opponent_pool_snapshot(uuid,text,text,text,timestamptz)',
      'EXECUTE') AS runtime_can_publish_snapshot
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_class snapshot ON snapshot.oid =
    'dna.tournament_horse_opponent_pool_snapshot'::regclass
  JOIN pg_catalog.pg_class active ON active.oid =
    'dna.tournament_horse_opponent_pool_snapshot_active'::regclass
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2::text
`;
const READ_SQL = `
  SELECT snapshot_version, payload_json, published_at
  FROM dna.read_active_tournament_horse_opponent_pool_snapshot($1::uuid)
`;
const PUBLISH_SQL = `
  SELECT dna.publish_tournament_horse_opponent_pool_snapshot(
    $1::uuid, $2::text, $3::text, $4::text, $5::timestamptz
  ) AS publication_status
`;

type Payload = Readonly<{
  version: 1;
  state: TournamentHorseOpponentPoolSnapshot["state"];
  completeForRosterElements: boolean;
  truncated: boolean;
  cores: readonly TournamentHorseRosterCore[];
  groups: readonly TournamentHorseOpponentPoolGroup[];
}>;

export type TournamentHorseOpponentPoolPublication = Readonly<{
  status: "published" | "unchanged" | "source_changed";
  snapshotVersion: string;
}>;

export type TournamentHorseOpponentPoolRepository =
  TournamentHorseAcceptedSourceRepositories["opponentPools"] &
    Readonly<{
      publishAcceptedHorseOpponentPools(
        ownerId: string,
        input: Readonly<{
          expectedActiveSnapshotVersion: string | null;
          state: TournamentHorseOpponentPoolSnapshot["state"];
          completeForRosterElements: boolean;
          truncated: boolean;
          cores: readonly TournamentHorseRosterCore[];
          groups: readonly TournamentHorseOpponentPoolGroup[];
          publishedAt: string;
        }>,
      ): Promise<TournamentHorseOpponentPoolPublication>;
    }>;

function fail(): never {
  throw new Error(ERROR);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail();
  return value as Record<string, unknown>;
}

function text(value: unknown, maximum = 512): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > maximum ||
    CONTROL.test(value)
  )
    fail();
  return value;
}

function timestamp(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) fail();
    return value.toISOString();
  }
  const supplied = text(value);
  const parsed = new Date(supplied);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== supplied)
    fail();
  return supplied;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") fail();
  return value;
}

function unique(values: unknown): readonly string[] {
  if (!Array.isArray(values) || values.length > 512) fail();
  const normalized = values.map((value) => text(value));
  if (new Set(normalized).size !== normalized.length) fail();
  return Object.freeze(normalized.sort());
}

function canonicalPayload(value: unknown): Payload {
  const source = record(value);
  const keys = Object.keys(source).sort();
  const expected = [
    "completeForRosterElements",
    "cores",
    "groups",
    "state",
    "truncated",
    "version",
  ].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    source.version !== 1 ||
    !["accepted", "partial", "unknown"].includes(String(source.state)) ||
    !Array.isArray(source.cores) ||
    source.cores.length < 1 ||
    source.cores.length > 512 ||
    !Array.isArray(source.groups) ||
    source.groups.length < 1 ||
    source.groups.length > 96
  )
    fail();
  const cores = source.cores
    .map((value) => {
      const core = record(value);
      if (
        Object.keys(core).length !== 3 ||
        !ELEMENTS.includes(core.element as (typeof ELEMENTS)[number])
      )
        fail();
      return Object.freeze({
        coreId: text(core.coreId),
        name: text(core.name),
        element: text(core.element, 128),
      });
    })
    .sort((left, right) => left.coreId.localeCompare(right.coreId));
  if (new Set(cores.map(({ coreId }) => coreId)).size !== cores.length) fail();
  const profiles = new Map(cores.map((core) => [core.coreId, core]));
  const groupKeys = new Set<string>();
  const groups = source.groups
    .map((value) => {
      const group = record(value);
      const element = text(group.element, 128);
      const distanceMetres = group.distanceMetres;
      if (
        Object.keys(group).length !== 5 ||
        !ELEMENTS.includes(element as (typeof ELEMENTS)[number]) ||
        !DISTANCES.includes(distanceMetres as (typeof DISTANCES)[number]) ||
        (group.status !== "confirmed" && group.status !== "review_required")
      )
        fail();
      const key = `${element}\u0000${distanceMetres}`;
      if (groupKeys.has(key)) fail();
      groupKeys.add(key);
      const fieldIds = unique(group.tournamentFieldOpponentCoreIds);
      const stressIds = unique(group.topTenPercentOpponentCoreIds);
      if (
        [...fieldIds, ...stressIds].some(
          (coreId) => profiles.get(coreId)?.element !== element,
        )
      )
        fail();
      return Object.freeze({
        element,
        distanceMetres: distanceMetres as (typeof DISTANCES)[number],
        tournamentFieldOpponentCoreIds: fieldIds,
        topTenPercentOpponentCoreIds: stressIds,
        status: group.status,
      });
    })
    .sort(
      (left, right) =>
        left.element.localeCompare(right.element) ||
        left.distanceMetres - right.distanceMetres,
    );
  const state = source.state as Payload["state"];
  const completeForRosterElements = boolean(source.completeForRosterElements);
  const truncated = boolean(source.truncated);
  if (
    state === "accepted" &&
    (!completeForRosterElements ||
      truncated ||
      groups.some(
        (group) =>
          group.status !== "confirmed" ||
          group.tournamentFieldOpponentCoreIds.length < 1 ||
          group.topTenPercentOpponentCoreIds.length < 1,
      ))
  )
    fail();
  return Object.freeze({
    version: 1,
    state,
    completeForRosterElements,
    truncated,
    cores: Object.freeze(cores),
    groups: Object.freeze(groups),
  });
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

export function createNeonTournamentHorseOpponentPoolRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  authenticatedOwnerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): TournamentHorseOpponentPoolRepository {
  const configuration = Object.freeze({
    databaseUrl: text(input.databaseUrl, 4096),
    databaseOwnerId: text(input.databaseOwnerId),
    authenticatedOwnerId: text(input.authenticatedOwnerId),
    runtimeRole: text(input.runtimeRole, 63),
  });
  if (
    !UUID.test(configuration.databaseOwnerId) ||
    !ROLE.test(configuration.runtimeRole)
  )
    fail();
  const factory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  async function transaction<T>(
    ownerId: string,
    readOnly: boolean,
    operation: (client: NeonImportPersistenceClient) => Promise<T>,
  ): Promise<T> {
    if (text(ownerId) !== configuration.authenticatedOwnerId) fail();
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
      const isolation = await session.client.query(VERIFY_SQL, [
        configuration.databaseOwnerId,
        configuration.authenticatedOwnerId,
      ]);
      if (isolation.rows.length !== 1) fail();
      verifyIsolation(isolation.rows[0], configuration);
      const result = await operation(session.client);
      await session.client.query("COMMIT");
      started = false;
      return result;
    } catch {
      if (started)
        await session.client.query("ROLLBACK").catch(() => undefined);
      return fail();
    } finally {
      await session.close().catch(() => fail());
    }
  }

  async function read(ownerId: string) {
    return transaction(ownerId, true, async (client) => {
      const result = await client.query(READ_SQL, [
        configuration.databaseOwnerId,
      ]);
      if (result.rows.length === 0) return null;
      if (result.rows.length !== 1) fail();
      const row = record(result.rows[0]);
      const version = text(row.snapshot_version);
      const payloadJson = text(row.payload_json, 1_048_576);
      if (
        !HASH.test(version) ||
        createHash("sha256").update(payloadJson, "utf8").digest("hex") !==
          version
      )
        fail();
      const payload = canonicalPayload(JSON.parse(payloadJson) as unknown);
      if (JSON.stringify(payload) !== payloadJson) fail();
      timestamp(row.published_at);
      return Object.freeze({ version, payload });
    });
  }

  return Object.freeze({
    async loadAcceptedHorseOpponentPoolsByOwner(ownerId) {
      const active = await read(ownerId);
      if (active === null) return null;
      return Object.freeze({
        databaseOwnerId: configuration.databaseOwnerId,
        opponentPoolSnapshotVersion: active.version,
        state: active.payload.state,
        completeForRosterElements: active.payload.completeForRosterElements,
        truncated: active.payload.truncated,
        cores: active.payload.cores,
        groups: active.payload.groups,
      });
    },

    async readAcceptedHorseOpponentPoolVersionByOwner(ownerId) {
      return (await read(ownerId))?.version ?? null;
    },

    async publishAcceptedHorseOpponentPools(ownerId, candidate) {
      const payload = canonicalPayload({
        version: 1,
        state: candidate.state,
        completeForRosterElements: candidate.completeForRosterElements,
        truncated: candidate.truncated,
        cores: candidate.cores,
        groups: candidate.groups,
      });
      const payloadJson = JSON.stringify(payload);
      const snapshotVersion = createHash("sha256")
        .update(payloadJson, "utf8")
        .digest("hex");
      const expected = candidate.expectedActiveSnapshotVersion;
      if (expected !== null && !HASH.test(expected)) fail();
      const publishedAt = timestamp(candidate.publishedAt);
      const status = await transaction(ownerId, false, async (client) => {
        const result = await client.query(PUBLISH_SQL, [
          configuration.databaseOwnerId,
          snapshotVersion,
          expected,
          payloadJson,
          publishedAt,
        ]);
        if (result.rows.length !== 1) fail();
        const value = record(result.rows[0]).publication_status;
        if (
          !["published", "unchanged", "source_changed"].includes(String(value))
        )
          fail();
        return value as TournamentHorseOpponentPoolPublication["status"];
      });
      return Object.freeze({ status, snapshotVersion });
    },
  });
}
