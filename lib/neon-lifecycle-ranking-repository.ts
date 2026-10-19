import { createHash } from "node:crypto";
import {
  rankLifecycleActions,
  type LifecycleActionRankingInput,
} from "@/domain/lifecycle-action-ranking";
import {
  unavailableLifecycleRankingRepository,
  type LifecycleRankingRepository,
} from "@/lib/lifecycle-workspace-service";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ROLE = /^[a-z_][a-z0-9_]{0,62}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_SNAPSHOT_BYTES = 512 * 1024;
const ERROR = "Lifecycle ranking evidence read unavailable.";

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
    has_function_privilege(session_user,
      'dna.read_lifecycle_ranking_evidence_snapshot(uuid)', 'EXECUTE')
      AS runtime_can_read_ranking
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_class snapshot
    ON snapshot.oid = 'dna.lifecycle_ranking_evidence_snapshot'::regclass
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2::text
`;

const READ_SQL = `
  SELECT ranking_id, configuration_version, candidate_snapshot_version,
    racing_snapshot_version, discovery_snapshot_version,
    maiden_snapshot_version, breeding_snapshot_version,
    lineage_snapshot_version, market_snapshot_version,
    data_current_through, latest_accepted_import_at, evaluated_at,
    published_at, snapshot_sha256, snapshot_json
  FROM dna.read_lifecycle_ranking_evidence_snapshot($1::uuid)
`;

const VERSION_KEYS = [
  "configurationVersion",
  "candidateSnapshotVersion",
  "racingSnapshotVersion",
  "discoverySnapshotVersion",
  "maidenSnapshotVersion",
  "breedingSnapshotVersion",
  "lineageSnapshotVersion",
  "marketSnapshotVersion",
] as const;

function fail(): never {
  // Provider failures can include protected SQL parameters and evidence.
  throw new Error(ERROR);
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

function required(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") fail();
  return value;
}

function timestamp(value: unknown): string {
  const parsed = value instanceof Date ? value : new Date(required(value));
  if (Number.isNaN(parsed.getTime())) fail();
  return parsed.toISOString();
}

function exactKeys(value: Record<string, unknown>, fields: readonly string[]) {
  const keys = Object.keys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => !fields.includes(key))
  )
    fail();
}

function verifyRankingShape(value: Record<string, unknown>) {
  exactKeys(value, [
    "rankingId",
    "rankingLabel",
    ...VERSION_KEYS,
    "evaluatedAt",
    "dataCurrentThrough",
    "lastImported",
    "freshness",
    "cores",
  ]);
  if (!Array.isArray(value.cores)) fail();
  for (const suppliedCore of value.cores) {
    const core = record(suppliedCore);
    exactKeys(core, [
      "coreId",
      "coreClass",
      "activeOwnership",
      "protectionStatus",
      "evidenceCoverage",
      "racingState",
      "maidenState",
      "discoveryState",
      "breedingState",
      "lineageState",
      "marketEvidence",
      "costBasisStatus",
      "starEvidenceState",
      "nonStarNegativeEvidencePresent",
      "evidenceVersions",
      "actionEvidence",
    ]);
    exactKeys(record(core.evidenceVersions), VERSION_KEYS);
    if (!Array.isArray(core.actionEvidence)) fail();
    for (const suppliedAction of core.actionEvidence) {
      exactKeys(record(suppliedAction), [
        "action",
        "supportStatus",
        "scoreBasisPoints",
        "evidenceReasons",
      ]);
    }
  }
}

function decodeSnapshot(
  value: unknown,
  input: Readonly<{
    databaseOwnerId: string;
    publishedAt: string;
    latestAcceptedImportAt: string;
    sha256: string;
    bindings: Record<string, string>;
  }>,
): LifecycleActionRankingInput {
  const json = required(value);
  if (
    Buffer.byteLength(json, "utf8") > MAX_SNAPSHOT_BYTES ||
    !HASH.test(input.sha256) ||
    createHash("sha256").update(json, "utf8").digest("hex") !== input.sha256
  )
    fail();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    return fail();
  }
  const envelope = record(parsed);
  exactKeys(envelope, [
    "version",
    "databaseOwnerId",
    "publishedAt",
    "latestAcceptedImportAt",
    "ranking",
  ]);
  if (
    envelope.version !== 1 ||
    envelope.databaseOwnerId !== input.databaseOwnerId ||
    timestamp(envelope.publishedAt) !== input.publishedAt ||
    timestamp(envelope.latestAcceptedImportAt) !== input.latestAcceptedImportAt
  )
    fail();
  const ranking = record(envelope.ranking);
  verifyRankingShape(ranking);
  if (
    ranking.lastImported !== input.latestAcceptedImportAt ||
    Object.entries(input.bindings).some(
      ([key, expected]) => ranking[key] !== expected,
    )
  )
    fail();
  try {
    rankLifecycleActions(ranking as unknown as LifecycleActionRankingInput);
  } catch {
    return fail();
  }
  return ranking as unknown as LifecycleActionRankingInput;
}

function verifyRuntime(
  value: unknown,
  input: Readonly<{
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    runtimeRole: string;
  }>,
) {
  const row = record(value);
  if (
    row.database_owner_id !== input.databaseOwnerId ||
    row.authenticated_owner_id !== input.authenticatedOwnerId ||
    row.session_user_name !== input.runtimeRole ||
    row.current_user_name !== input.runtimeRole ||
    row.row_security_enabled !== true ||
    row.force_row_security_enabled !== true ||
    row.runtime_can_read_ranking !== true ||
    [
      "runtime_is_superuser",
      "runtime_bypasses_rls",
      "runtime_can_create_roles",
      "runtime_can_create_databases",
      "runtime_is_neon_superuser_member",
      "runtime_has_direct_table_access",
    ].some((field) => row[field] !== false)
  )
    fail();
}

export function createNeonLifecycleRankingRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
    now?: () => Date;
  }>,
): LifecycleRankingRepository {
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
  const clock = input.now ?? (() => new Date());
  return {
    status: "ready",
    async loadRankingEvidenceByOwner(ownerId) {
      if (ownerId !== configuration.authenticatedOwnerId) fail();
      const readAt = clock();
      if (!(readAt instanceof Date) || Number.isNaN(readAt.getTime())) fail();
      const session = await factory(configuration.databaseUrl).catch(() =>
        fail(),
      );
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
        verifyRuntime(verified.rows[0], configuration);
        const result = await session.client.query(READ_SQL, [
          configuration.databaseOwnerId,
        ]);
        if (result.rows.length > 1) fail();
        let ranking: LifecycleActionRankingInput | null = null;
        let latestAcceptedImportAt: string | null = null;
        let publishedAt: string | null = null;
        let snapshotSha256: string | null = null;
        if (result.rows.length === 1) {
          const row = record(result.rows[0]);
          latestAcceptedImportAt = timestamp(row.latest_accepted_import_at);
          publishedAt = timestamp(row.published_at);
          snapshotSha256 = required(row.snapshot_sha256);
          const evaluatedAt = timestamp(row.evaluated_at);
          const dataCurrentThrough = timestamp(row.data_current_through);
          if (
            Date.parse(dataCurrentThrough) >
              Date.parse(latestAcceptedImportAt) ||
            Date.parse(latestAcceptedImportAt) > Date.parse(evaluatedAt) ||
            Date.parse(evaluatedAt) > Date.parse(publishedAt) ||
            Date.parse(publishedAt) > readAt.getTime()
          )
            fail();
          const bindings = {
            rankingId: required(row.ranking_id),
            configurationVersion: required(row.configuration_version),
            candidateSnapshotVersion: required(row.candidate_snapshot_version),
            racingSnapshotVersion: required(row.racing_snapshot_version),
            discoverySnapshotVersion: required(row.discovery_snapshot_version),
            maidenSnapshotVersion: required(row.maiden_snapshot_version),
            breedingSnapshotVersion: required(row.breeding_snapshot_version),
            lineageSnapshotVersion: required(row.lineage_snapshot_version),
            marketSnapshotVersion: required(row.market_snapshot_version),
            dataCurrentThrough,
            evaluatedAt,
          };
          ranking = decodeSnapshot(row.snapshot_json, {
            databaseOwnerId: configuration.databaseOwnerId,
            publishedAt,
            latestAcceptedImportAt,
            sha256: snapshotSha256,
            bindings,
          });
        }
        await session.client.query("COMMIT");
        started = false;
        return {
          ranking,
          latestAcceptedImportAt,
          publishedAt,
          snapshotSha256,
        };
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

export function neonLifecycleRankingRepositoryFromEnvironment(
  environment: Environment,
  sessionFactory?: NeonImportPersistenceSessionFactory,
  now?: () => Date,
): LifecycleRankingRepository {
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
    return unavailableLifecycleRankingRepository;
  return createNeonLifecycleRankingRepository({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    authenticatedOwnerId,
    ...(sessionFactory ? { sessionFactory } : {}),
    ...(now ? { now } : {}),
  });
}
