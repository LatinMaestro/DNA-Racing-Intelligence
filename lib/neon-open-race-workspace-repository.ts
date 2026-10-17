import { createHash, randomUUID } from "node:crypto";
import { lockOpenRaceField } from "@/domain/open-race-field-lock";
import { compareOpenRaceStars } from "@/domain/open-race-star-comparison";
import { recordOpenRaceStarObservation } from "@/domain/open-race-star-observation";
import type {
  OpenRaceWorkspaceEvidence,
  OpenRaceWorkspaceRepository,
} from "@/lib/open-race-workspace-service";
import { composeOpenRaceWorkspaceSession } from "@/lib/open-race-workspace-service";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ROLE = /^[a-z_][a-z0-9_]{0,62}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_SESSIONS = 24;
const MAX_SNAPSHOT_BYTES = 512 * 1024;
const ERROR = "Open Race workspace persistence unavailable.";

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
      'dna.read_open_race_workspace_sessions(uuid,integer)', 'EXECUTE')
      AS runtime_can_read_sessions,
    has_function_privilege(session_user,
      'dna.publish_open_race_field_lock(uuid,text,text,text,timestamptz,text,text)',
      'EXECUTE') AS runtime_can_publish_field_lock,
    has_function_privilege(session_user,
      'dna.publish_open_race_observation_comparison(uuid,text,text,text,timestamptz,text,text)',
      'EXECUTE') AS runtime_can_publish_observation_comparison
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_class snapshot
    ON snapshot.oid = 'dna.open_race_workspace_session_snapshot'::regclass
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2::text
`;

const READ_SQL = `
  SELECT request_id, session_version, field_version, eligibility_version,
    race_import_version, vault_snapshot_version,
    historical_aggregate_version, mode, distance_meters, field_captured_at,
    latest_accepted_race_import_at, latest_accepted_vault_import_at,
    published_at, snapshot_sha256, snapshot_json
  FROM dna.read_open_race_workspace_sessions($1::uuid, $2::integer)
`;

const PUBLISH_FIELD_LOCK_SQL = `
  SELECT dna.publish_open_race_field_lock(
    $1::uuid, $2::text, $3::text, $4::text,
    $5::timestamptz, $6::text, $7::text
  ) AS status
`;

const PUBLISH_OBSERVATION_COMPARISON_SQL = `
  SELECT dna.publish_open_race_observation_comparison(
    $1::uuid, $2::text, $3::text, $4::text,
    $5::timestamptz, $6::text, $7::text
  ) AS status
`;

function fail(): never {
  // Provider failures can include private SQL parameters and evidence.
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

function decodeSnapshot(
  value: unknown,
  input: Readonly<{
    databaseOwnerId: string;
    requestId: string;
    sessionVersion: string;
    fieldVersion: string;
    eligibilityVersion: string;
    raceImportVersion: string;
    vaultSnapshotVersion: string;
    historicalAggregateVersion: string;
    mode: string;
    distanceMeters: number;
    fieldCapturedAt: string;
    publishedAt: string;
    sha256: string;
  }>,
): OpenRaceWorkspaceEvidence {
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
    "evidence",
  ]);
  if (
    envelope.version !== 1 ||
    envelope.databaseOwnerId !== input.databaseOwnerId ||
    timestamp(envelope.publishedAt) !== input.publishedAt
  )
    fail();
  const evidence = record(envelope.evidence);
  exactKeys(evidence, [
    "bindings",
    "field",
    "eligibility",
    "ranking",
    "lock",
    "observation",
    "comparison",
  ]);
  const bindings = record(evidence.bindings);
  const field = record(evidence.field);
  if (
    bindings.sessionVersion !== input.sessionVersion ||
    bindings.fieldVersion !== input.fieldVersion ||
    bindings.eligibilityVersion !== input.eligibilityVersion ||
    bindings.raceImportVersion !== input.raceImportVersion ||
    bindings.vaultSnapshotVersion !== input.vaultSnapshotVersion ||
    bindings.historicalAggregateVersion !== input.historicalAggregateVersion ||
    field.requestId !== input.requestId ||
    field.mode !== input.mode ||
    field.distanceMeters !== input.distanceMeters ||
    timestamp(field.capturedAt) !== input.fieldCapturedAt
  )
    fail();
  return evidence as OpenRaceWorkspaceEvidence;
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
    row.runtime_can_read_sessions !== true ||
    row.runtime_can_publish_field_lock !== true ||
    row.runtime_can_publish_observation_comparison !== true ||
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

export function createNeonOpenRaceWorkspaceRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): OpenRaceWorkspaceRepository {
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
  return {
    status: "ready",
    async listSessionEvidenceByOwner(ownerId) {
      if (ownerId !== configuration.authenticatedOwnerId) fail();
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
          MAX_SESSIONS,
        ]);
        if (result.rows.length > MAX_SESSIONS) fail();
        const metadata = result.rows.map((value) => {
          const row = record(value);
          const distanceMeters = row.distance_meters;
          if (
            typeof distanceMeters !== "number" ||
            !Number.isSafeInteger(distanceMeters) ||
            distanceMeters <= 0
          )
            fail();
          const decoded = {
            requestId: required(row.request_id),
            sessionVersion: required(row.session_version),
            fieldVersion: required(row.field_version),
            eligibilityVersion: required(row.eligibility_version),
            raceImportVersion: required(row.race_import_version),
            vaultSnapshotVersion: required(row.vault_snapshot_version),
            historicalAggregateVersion: required(
              row.historical_aggregate_version,
            ),
            mode: required(row.mode),
            distanceMeters,
            fieldCapturedAt: timestamp(row.field_captured_at),
            latestAcceptedRaceImportAt: timestamp(
              row.latest_accepted_race_import_at,
            ),
            latestAcceptedVaultImportAt: timestamp(
              row.latest_accepted_vault_import_at,
            ),
            publishedAt: timestamp(row.published_at),
            sha256: required(row.snapshot_sha256),
          };
          return {
            ...decoded,
            evidence: decodeSnapshot(row.snapshot_json, {
              ...decoded,
              databaseOwnerId: configuration.databaseOwnerId,
            }),
          };
        });
        const first = metadata[0];
        if (
          first &&
          metadata.some(
            (row) =>
              row.latestAcceptedRaceImportAt !==
                first.latestAcceptedRaceImportAt ||
              row.latestAcceptedVaultImportAt !==
                first.latestAcceptedVaultImportAt ||
              row.raceImportVersion !== first.raceImportVersion ||
              row.vaultSnapshotVersion !== first.vaultSnapshotVersion ||
              row.historicalAggregateVersion !==
                first.historicalAggregateVersion,
          )
        )
          fail();
        await session.client.query("COMMIT");
        started = false;
        return {
          sessions: metadata.map(({ evidence }) => evidence),
          latestAcceptedRaceImportAt: first?.latestAcceptedRaceImportAt ?? null,
          latestAcceptedVaultImportAt:
            first?.latestAcceptedVaultImportAt ?? null,
          latestAcceptedRaceImportVersion: first?.raceImportVersion ?? null,
          latestAcceptedVaultSnapshotVersion:
            first?.vaultSnapshotVersion ?? null,
          latestPublishedHistoricalAggregateVersion:
            first?.historicalAggregateVersion ?? null,
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
    async lockSessionByOwner(ownerId, input) {
      if (ownerId !== configuration.authenticatedOwnerId) fail();
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
          MAX_SESSIONS,
        ]);
        if (result.rows.length > MAX_SESSIONS) fail();
        const matches = result.rows.filter(
          (value) => record(value).request_id === input.requestId,
        );
        if (matches.length === 0) {
          await session.client.query("COMMIT");
          started = false;
          return { status: "not_found" } as const;
        }
        if (matches.length !== 1) fail();
        const row = record(matches[0]);
        const distanceMeters = row.distance_meters;
        if (
          typeof distanceMeters !== "number" ||
          !Number.isSafeInteger(distanceMeters) ||
          distanceMeters <= 0
        )
          fail();
        const evidence = decodeSnapshot(row.snapshot_json, {
          databaseOwnerId: configuration.databaseOwnerId,
          requestId: required(row.request_id),
          sessionVersion: required(row.session_version),
          fieldVersion: required(row.field_version),
          eligibilityVersion: required(row.eligibility_version),
          raceImportVersion: required(row.race_import_version),
          vaultSnapshotVersion: required(row.vault_snapshot_version),
          historicalAggregateVersion: required(
            row.historical_aggregate_version,
          ),
          mode: required(row.mode),
          distanceMeters,
          fieldCapturedAt: timestamp(row.field_captured_at),
          publishedAt: timestamp(row.published_at),
          sha256: required(row.snapshot_sha256),
        });
        const composed = composeOpenRaceWorkspaceSession(evidence);
        if (composed.lock !== null) {
          if (composed.lock.selectedOwnedCoreId !== input.selectedOwnedCoreId)
            fail();
          await session.client.query("COMMIT");
          started = false;
          return { status: "unchanged" } as const;
        }
        if (
          composed.stage !== "provisional_selection" ||
          composed.ranking === null ||
          evidence.ranking === null
        )
          fail();
        const lock = {
          lockId: `open-race-lock:${randomUUID()}`,
          requestId: composed.field.requestId,
          preEntryRankingId: composed.ranking.rankingId,
          fieldCapturedAt: composed.field.capturedAt,
          rankingEvaluatedAt: composed.ranking.evaluatedAt,
          lockedAt: input.lockedAt,
          fieldStage: "forming" as const,
          gateCount: composed.field.gateCount,
          availableGates: 0,
          enteredCoreIds: [
            input.selectedOwnedCoreId,
            ...composed.field.opponentCoreIds,
          ],
          eventIdentity: composed.field.eventIdentity,
          selectedOwnedCoreId: input.selectedOwnedCoreId,
          provisionalRecommendedCoreId:
            composed.ranking.provisionalRecommendedCoreId,
          preEntryStatus: composed.ranking.status,
          userConfirmedCommittedEntry: input.userConfirmedCommittedEntry,
          allGatesFilled: true,
          raceSetToRun: input.raceSetToRun,
        };
        lockOpenRaceField(lock);
        const nextEvidence: OpenRaceWorkspaceEvidence = {
          ...evidence,
          bindings: {
            ...evidence.bindings,
            sessionVersion: `open-race-session:${randomUUID()}`,
            lockVersion: `open-race-lock-version:${randomUUID()}`,
          },
          lock,
        };
        composeOpenRaceWorkspaceSession(nextEvidence);
        const envelope = JSON.stringify({
          version: 1,
          databaseOwnerId: configuration.databaseOwnerId,
          publishedAt: input.lockedAt,
          evidence: nextEvidence,
        });
        if (Buffer.byteLength(envelope, "utf8") > MAX_SNAPSHOT_BYTES) fail();
        const nextSha256 = createHash("sha256")
          .update(envelope, "utf8")
          .digest("hex");
        const publication = await session.client.query(PUBLISH_FIELD_LOCK_SQL, [
          configuration.databaseOwnerId,
          composed.field.requestId,
          required(row.snapshot_sha256),
          evidence.bindings.sessionVersion,
          input.lockedAt,
          nextSha256,
          envelope,
        ]);
        if (publication.rows.length !== 1) fail();
        const status = record(publication.rows[0]).status;
        if (
          status !== "published" &&
          status !== "unchanged" &&
          status !== "source_changed"
        )
          fail();
        await session.client.query("COMMIT");
        started = false;
        return { status };
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
    async recordObservationByOwner(ownerId, input) {
      if (ownerId !== configuration.authenticatedOwnerId) fail();
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
          MAX_SESSIONS,
        ]);
        if (result.rows.length > MAX_SESSIONS) fail();
        const matches = result.rows.filter(
          (value) => record(value).request_id === input.requestId,
        );
        if (matches.length === 0) {
          await session.client.query("COMMIT");
          started = false;
          return { status: "not_found" } as const;
        }
        if (matches.length !== 1) fail();
        const row = record(matches[0]);
        const distanceMeters = row.distance_meters;
        if (
          typeof distanceMeters !== "number" ||
          !Number.isSafeInteger(distanceMeters) ||
          distanceMeters <= 0
        )
          fail();
        const evidence = decodeSnapshot(row.snapshot_json, {
          databaseOwnerId: configuration.databaseOwnerId,
          requestId: required(row.request_id),
          sessionVersion: required(row.session_version),
          fieldVersion: required(row.field_version),
          eligibilityVersion: required(row.eligibility_version),
          raceImportVersion: required(row.race_import_version),
          vaultSnapshotVersion: required(row.vault_snapshot_version),
          historicalAggregateVersion: required(
            row.historical_aggregate_version,
          ),
          mode: required(row.mode),
          distanceMeters,
          fieldCapturedAt: timestamp(row.field_captured_at),
          publishedAt: timestamp(row.published_at),
          sha256: required(row.snapshot_sha256),
        });
        const composed = composeOpenRaceWorkspaceSession(evidence);
        if (composed.observation !== null || composed.comparison !== null) {
          await session.client.query("COMMIT");
          started = false;
          return { status: "unchanged" } as const;
        }
        if (
          composed.stage !== "locked_observation" ||
          composed.lock === null ||
          composed.ranking === null
        )
          fail();
        const canonicalGameEventId =
          composed.lock.eventIdentity.status === "confirmed"
            ? composed.lock.eventIdentity.eventId
            : null;
        if (input.gameEventId !== canonicalGameEventId) fail();
        const observation = {
          observationId: `open-race-observation:${randomUUID()}`,
          lockId: composed.lock.lockId,
          gameEventId: canonicalGameEventId,
          lockedAt: composed.lock.lockedAt,
          observedAt: input.observedAt,
          fieldStage: "locked_observation" as const,
          gateCount: composed.lock.gateCount,
          enteredCoreIds: composed.lock.enteredCoreIds,
          selectedOwnedCoreId: composed.lock.selectedOwnedCoreId,
          gold: input.gold,
          blue: input.blue,
          note: input.note,
        };
        const recorded = recordOpenRaceStarObservation(observation);
        const comparison = {
          comparisonId: `open-race-comparison:${randomUUID()}`,
          lockId: composed.lock.lockId,
          observationId: recorded.observationId,
          rankingEvaluatedAt: composed.ranking.evaluatedAt,
          lockedAt: composed.lock.lockedAt,
          observedAt: recorded.observedAt,
          comparedAt: input.observedAt,
          gateCount: composed.lock.gateCount,
          enteredCoreIds: composed.lock.enteredCoreIds,
          rankedCandidateCoreIds: composed.ranking.rankedCandidates.map(
            ({ coreId }) => coreId,
          ),
          provisionalRecommendedCoreId:
            composed.ranking.provisionalRecommendedCoreId,
          selectedOwnedCoreId: composed.lock.selectedOwnedCoreId,
          gold: recorded.gold,
          blue: recorded.blue,
          observationRecordStatus: recorded.recordStatus,
        };
        compareOpenRaceStars(comparison);
        const nextEvidence: OpenRaceWorkspaceEvidence = {
          ...evidence,
          bindings: {
            ...evidence.bindings,
            sessionVersion: `open-race-session:${randomUUID()}`,
            observationVersion: `open-race-observation-version:${randomUUID()}`,
            comparisonVersion: `open-race-comparison-version:${randomUUID()}`,
          },
          observation,
          comparison,
        };
        composeOpenRaceWorkspaceSession(nextEvidence);
        const envelope = JSON.stringify({
          version: 1,
          databaseOwnerId: configuration.databaseOwnerId,
          publishedAt: input.observedAt,
          evidence: nextEvidence,
        });
        if (Buffer.byteLength(envelope, "utf8") > MAX_SNAPSHOT_BYTES) fail();
        const nextSha256 = createHash("sha256")
          .update(envelope, "utf8")
          .digest("hex");
        const publication = await session.client.query(
          PUBLISH_OBSERVATION_COMPARISON_SQL,
          [
            configuration.databaseOwnerId,
            composed.field.requestId,
            required(row.snapshot_sha256),
            evidence.bindings.sessionVersion,
            input.observedAt,
            nextSha256,
            envelope,
          ],
        );
        if (publication.rows.length !== 1) fail();
        const status = record(publication.rows[0]).status;
        if (
          status !== "published" &&
          status !== "unchanged" &&
          status !== "source_changed"
        )
          fail();
        await session.client.query("COMMIT");
        started = false;
        return { status };
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

export function neonOpenRaceWorkspaceRepositoryFromEnvironment(
  environment: Environment,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): OpenRaceWorkspaceRepository {
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
    return { status: "not_configured" };
  return createNeonOpenRaceWorkspaceRepository({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    authenticatedOwnerId,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
