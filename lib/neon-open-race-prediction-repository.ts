import { createHash } from "node:crypto";
import {
  freezeRacePredictionSnapshot,
  type FrozenRacePredictionSnapshot,
} from "@/domain/race-prediction-snapshot";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ROLE = /^[a-z_][a-z0-9_]{0,62}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_SNAPSHOTS = 24;
const MAX_BYTES = 512 * 1024;
const ERROR = "Open Race prediction persistence unavailable.";

type Configuration = Readonly<{
  databaseUrl: string;
  databaseOwnerId: string;
  authenticatedOwnerId: string;
  runtimeRole: string;
}>;

export type OpenRacePredictionRepository = Readonly<{
  status: "ready";
  publishSnapshotByOwner(
    ownerId: string,
    input: Readonly<{
      requestId: string;
      expectedWorkspaceSha256: string;
      publishedAt: string;
      snapshot: FrozenRacePredictionSnapshot;
    }>,
  ): Promise<
    Readonly<{
      status: "published" | "unchanged" | "source_changed" | "not_found";
    }>
  >;
  listSnapshotsByOwner(
    ownerId: string,
  ): Promise<readonly FrozenRacePredictionSnapshot[]>;
}>;

export type ConfiguredOpenRacePredictionRepository =
  OpenRacePredictionRepository | Readonly<{ status: "not_configured" }>;

const VERIFY_SQL = `
  SELECT owner.id::text AS database_owner_id,
    owner.clerk_user_id AS authenticated_owner_id,
    prediction.relrowsecurity AS row_security_enabled,
    prediction.relforcerowsecurity AS force_row_security_enabled,
    session_user::text AS session_user_name,
    current_user::text AS current_user_name,
    role.rolsuper AS runtime_is_superuser,
    role.rolbypassrls AS runtime_bypasses_rls,
    role.rolcreaterole AS runtime_can_create_roles,
    role.rolcreatedb AS runtime_can_create_databases,
    COALESCE(pg_has_role(session_user,
      (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'neon_superuser'),
      'MEMBER'), false) AS runtime_is_neon_superuser_member,
    has_table_privilege(session_user, prediction.oid,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS runtime_has_direct_table_access,
    has_function_privilege(session_user,
      'dna.read_open_race_prediction_snapshots(uuid,integer)', 'EXECUTE') AS runtime_can_read,
    has_function_privilege(session_user,
      'dna.publish_open_race_prediction_snapshot(uuid,text,text,text,text)', 'EXECUTE') AS runtime_can_publish
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_class prediction
    ON prediction.oid = 'dna.open_race_prediction_snapshot'::regclass
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2::text
`;

const READ_SQL = `
  SELECT snapshot_id, request_id, event_id, predicted_at, published_at,
    snapshot_sha256, snapshot_json
  FROM dna.read_open_race_prediction_snapshots($1::uuid, $2::integer)
`;

const PUBLISH_SQL = `
  SELECT dna.publish_open_race_prediction_snapshot(
    $1::uuid, $2::text, $3::text, $4::text, $5::text
  ) AS status
`;

function fail(): never {
  throw new Error(ERROR);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail();
  return value as Record<string, unknown>;
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

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
) {
  const keys = Object.keys(value);
  if (
    keys.length !== expected.length ||
    keys.some((key) => !expected.includes(key))
  )
    fail();
}

function normalizeSnapshot(value: unknown): FrozenRacePredictionSnapshot {
  try {
    const candidate = record(value) as unknown as FrozenRacePredictionSnapshot;
    if (
      candidate.frozen !== true ||
      candidate.predictionMutationAllowed !== false ||
      candidate.sameEventEvidenceIncluded !== false ||
      candidate.observedOutcomeIncluded !== false ||
      candidate.fairExOddsIncluded !== false ||
      candidate.reconciliationStatus !== "pending"
    )
      fail();
    return freezeRacePredictionSnapshot({
      snapshotId: candidate.snapshotId,
      eventId: candidate.eventId,
      predictedAt: candidate.predictedAt,
      eventStartsAt: candidate.eventStartsAt,
      evidenceCutoff: candidate.evidenceCutoff,
      modelVersion: candidate.modelVersion,
      context: candidate.context,
      field: candidate.field,
      sources: candidate.sources,
      predictions: candidate.predictions,
    });
  } catch {
    return fail();
  }
}

function decodeSnapshot(
  value: unknown,
  input: Readonly<{
    databaseOwnerId: string;
    snapshotId: string;
    requestId: string;
    eventId: string;
    predictedAt: string;
    publishedAt: string;
    sha256: string;
  }>,
): FrozenRacePredictionSnapshot {
  const json = required(value);
  if (
    Buffer.byteLength(json, "utf8") > MAX_BYTES ||
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
    "requestId",
    "publishedAt",
    "snapshot",
  ]);
  if (
    envelope.version !== 1 ||
    envelope.databaseOwnerId !== input.databaseOwnerId ||
    envelope.requestId !== input.requestId ||
    timestamp(envelope.publishedAt) !== input.publishedAt
  )
    fail();
  const snapshot = normalizeSnapshot(
    envelope.snapshot as FrozenRacePredictionSnapshot,
  );
  if (
    snapshot.snapshotId !== input.snapshotId ||
    snapshot.eventId !== input.eventId ||
    snapshot.predictedAt !== input.predictedAt
  )
    fail();
  return snapshot;
}

function verifyRuntime(value: unknown, configuration: Configuration) {
  const row = record(value);
  if (
    row.database_owner_id !== configuration.databaseOwnerId ||
    row.authenticated_owner_id !== configuration.authenticatedOwnerId ||
    row.session_user_name !== configuration.runtimeRole ||
    row.current_user_name !== configuration.runtimeRole ||
    row.row_security_enabled !== true ||
    row.force_row_security_enabled !== true ||
    row.runtime_can_read !== true ||
    row.runtime_can_publish !== true ||
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

async function withSession<T>(
  configuration: Configuration,
  factory: NeonImportPersistenceSessionFactory,
  transaction: string,
  callback: (
    session: Awaited<ReturnType<NeonImportPersistenceSessionFactory>>,
  ) => Promise<T>,
): Promise<T> {
  const session = await factory(configuration.databaseUrl).catch(() => fail());
  let started = false;
  try {
    await session.client.query(transaction);
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
    const result = await callback(session);
    await session.client.query("COMMIT");
    started = false;
    return result;
  } catch {
    if (started) await session.client.query("ROLLBACK").catch(() => undefined);
    return fail();
  } finally {
    try {
      await session.close();
    } catch {
      fail();
    }
  }
}

export function createNeonOpenRacePredictionRepository(
  input: Configuration &
    Readonly<{
      sessionFactory?: NeonImportPersistenceSessionFactory;
    }>,
): OpenRacePredictionRepository {
  if (
    !input.databaseUrl.trim() ||
    !UUID.test(input.databaseOwnerId) ||
    !input.authenticatedOwnerId.trim() ||
    input.authenticatedOwnerId !== input.authenticatedOwnerId.trim() ||
    !ROLE.test(input.runtimeRole)
  )
    fail();
  const configuration: Configuration = Object.freeze({
    databaseUrl: input.databaseUrl,
    databaseOwnerId: input.databaseOwnerId,
    authenticatedOwnerId: input.authenticatedOwnerId,
    runtimeRole: input.runtimeRole,
  });
  const factory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;
  return {
    status: "ready",
    async publishSnapshotByOwner(ownerId, candidate) {
      if (ownerId !== configuration.authenticatedOwnerId) fail();
      const requestId = required(candidate.requestId);
      if (!HASH.test(candidate.expectedWorkspaceSha256)) fail();
      const snapshot = normalizeSnapshot(candidate.snapshot);
      const publishedAt = timestamp(candidate.publishedAt);
      if (
        Date.parse(publishedAt) < Date.parse(snapshot.predictedAt) ||
        Date.parse(publishedAt) >= Date.parse(snapshot.eventStartsAt)
      )
        fail();
      const envelope = JSON.stringify({
        version: 1,
        databaseOwnerId: configuration.databaseOwnerId,
        requestId,
        publishedAt,
        snapshot,
      });
      if (Buffer.byteLength(envelope, "utf8") > MAX_BYTES) fail();
      const sha256 = createHash("sha256")
        .update(envelope, "utf8")
        .digest("hex");
      return withSession(
        configuration,
        factory,
        "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE",
        async (session) => {
          const result = await session.client.query(PUBLISH_SQL, [
            configuration.databaseOwnerId,
            requestId,
            candidate.expectedWorkspaceSha256,
            sha256,
            envelope,
          ]);
          if (result.rows.length !== 1) fail();
          const status = record(result.rows[0]).status;
          if (
            !["published", "unchanged", "source_changed", "not_found"].includes(
              String(status),
            )
          )
            fail();
          return { status } as Readonly<{
            status: "published" | "unchanged" | "source_changed" | "not_found";
          }>;
        },
      );
    },
    async listSnapshotsByOwner(ownerId) {
      if (ownerId !== configuration.authenticatedOwnerId) fail();
      return withSession(
        configuration,
        factory,
        "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
        async (session) => {
          const result = await session.client.query(READ_SQL, [
            configuration.databaseOwnerId,
            MAX_SNAPSHOTS,
          ]);
          if (result.rows.length > MAX_SNAPSHOTS) fail();
          return result.rows.map((value) => {
            const row = record(value);
            return decodeSnapshot(row.snapshot_json, {
              databaseOwnerId: configuration.databaseOwnerId,
              snapshotId: required(row.snapshot_id),
              requestId: required(row.request_id),
              eventId: required(row.event_id),
              predictedAt: timestamp(row.predicted_at),
              publishedAt: timestamp(row.published_at),
              sha256: required(row.snapshot_sha256),
            });
          });
        },
      );
    },
  };
}

export function neonOpenRacePredictionRepositoryFromEnvironment(
  environment: Readonly<{
    databaseUrl: string | undefined;
    databaseOwnerId: string | undefined;
    runtimeRole: string | undefined;
    authenticatedOwnerId: string | null;
  }>,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): ConfiguredOpenRacePredictionRepository {
  const values = [
    environment.databaseUrl,
    environment.databaseOwnerId,
    environment.runtimeRole,
    environment.authenticatedOwnerId,
  ];
  if (
    values.some(
      (value) => value === undefined || value === null || value.trim() === "",
    )
  ) {
    return { status: "not_configured" };
  }
  return createNeonOpenRacePredictionRepository({
    databaseUrl: environment.databaseUrl!,
    databaseOwnerId: environment.databaseOwnerId!,
    authenticatedOwnerId: environment.authenticatedOwnerId!,
    runtimeRole: environment.runtimeRole!,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
