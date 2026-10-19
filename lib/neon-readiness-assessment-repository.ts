import { createHash } from "node:crypto";
import {
  assessPrivateProductionReadiness,
  type PrivateProductionReadinessInput,
} from "@/domain/private-production-readiness";
import {
  unavailableReadinessAssessmentRepository,
  type ReadinessAssessmentRepository,
} from "@/lib/readiness-workspace-service";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ROLE = /^[a-z_][a-z0-9_]{0,62}$/;
const HASH = /^[a-f0-9]{64}$/;
const HEAD = /^[a-f0-9]{40}$/;
const MAX_SNAPSHOT_BYTES = 32 * 1024;
const ERROR = "Readiness assessment read unavailable.";

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
      'dna.read_private_readiness_assessment_snapshot(uuid)', 'EXECUTE')
      AS runtime_can_read_assessment
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_class snapshot
    ON snapshot.oid = 'dna.private_readiness_assessment_snapshot'::regclass
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2::text
`;

const READ_SQL = `
  SELECT assessment_id, assessment_version, exact_head_sha,
    evidence_current_through, assessed_at, published_at,
    snapshot_sha256, snapshot_json
  FROM dna.read_private_readiness_assessment_snapshot($1::uuid)
`;

const ASSESSMENT_KEYS = [
  "assessmentId",
  "assessmentVersion",
  "assessedAt",
  "evidenceCurrentThrough",
  "evidenceFreshness",
  "exactHeadSha",
  "gates",
  "exactHeadCi",
  "representativePrivateImport",
  "recoveryValidation",
  "performanceCapacity",
  "securityPrivacy",
  "accessibilityResponsive",
  "migrations",
  "knownLimitationsDocumented",
  "productionDisabled",
  "customDomainAttached",
  "publicRoutesExposed",
  "fullPrivateDataInProduction",
  "recurringPaidInfrastructureEnabled",
  "ownerGateFApproval",
  "activationRequested",
] as const;
const MODULE_BOUNDARY_STATES = [
  "not_verified",
  "fixture_verified",
  "connected_verified",
  "failed",
] as const;

function fail(): never {
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

function oneOf(value: unknown, allowed: readonly string[]) {
  if (typeof value !== "string" || !allowed.includes(value)) fail();
}

function verifyAssessmentShape(value: Record<string, unknown>) {
  exactKeys(
    value,
    value.moduleBoundaries === undefined
      ? ASSESSMENT_KEYS
      : [...ASSESSMENT_KEYS, "moduleBoundaries"],
  );
  exactKeys(record(value.gates), ["gateA", "gateB", "gateC", "gateD", "gateE"]);
  for (const gate of Object.values(record(value.gates)))
    oneOf(gate, ["accepted", "not_accepted", "blocked"]);
  oneOf(value.evidenceFreshness, ["current", "ageing", "stale"]);
  for (const state of [
    value.exactHeadCi,
    value.representativePrivateImport,
    value.recoveryValidation,
    value.performanceCapacity,
    value.securityPrivacy,
    value.accessibilityResponsive,
  ])
    oneOf(state, ["passed", "not_run", "failed"]);
  oneOf(value.migrations, [
    "reversible_verified",
    "not_verified",
    "irreversible",
  ]);
  for (const field of [
    "knownLimitationsDocumented",
    "productionDisabled",
    "customDomainAttached",
    "publicRoutesExposed",
    "fullPrivateDataInProduction",
    "recurringPaidInfrastructureEnabled",
    "ownerGateFApproval",
    "activationRequested",
  ])
    if (typeof value[field] !== "boolean") fail();
  if (value.moduleBoundaries !== undefined) {
    const boundaries = record(value.moduleBoundaries);
    exactKeys(boundaries, ["vaultPerformance", "openRace", "lifecycle"]);
    const vaultPerformance = record(boundaries.vaultPerformance);
    exactKeys(vaultPerformance, ["readModel", "economicEvidenceWrites"]);
    const openRace = record(boundaries.openRace);
    exactKeys(openRace, ["readModel", "fieldLock", "postLockObservation"]);
    const lifecycle = record(boundaries.lifecycle);
    exactKeys(lifecycle, ["readModel", "economicEvidenceWrites"]);
    for (const state of [
      ...Object.values(vaultPerformance),
      ...Object.values(openRace),
      ...Object.values(lifecycle),
    ])
      oneOf(state, MODULE_BOUNDARY_STATES);
  }
}

function decodeSnapshot(
  value: unknown,
  input: Readonly<{
    databaseOwnerId: string;
    assessmentId: string;
    assessmentVersion: string;
    exactHeadSha: string;
    evidenceCurrentThrough: string;
    assessedAt: string;
    publishedAt: string;
    sha256: string;
  }>,
): PrivateProductionReadinessInput {
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
    "assessment",
  ]);
  if (
    envelope.version !== 1 ||
    envelope.databaseOwnerId !== input.databaseOwnerId ||
    timestamp(envelope.publishedAt) !== input.publishedAt
  )
    fail();
  const assessment = record(envelope.assessment);
  verifyAssessmentShape(assessment);
  if (
    assessment.assessmentId !== input.assessmentId ||
    assessment.assessmentVersion !== input.assessmentVersion ||
    assessment.exactHeadSha !== input.exactHeadSha ||
    timestamp(assessment.evidenceCurrentThrough) !==
      input.evidenceCurrentThrough ||
    timestamp(assessment.assessedAt) !== input.assessedAt
  )
    fail();
  try {
    assessPrivateProductionReadiness(
      assessment as unknown as PrivateProductionReadinessInput,
    );
  } catch {
    return fail();
  }
  return assessment as unknown as PrivateProductionReadinessInput;
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
    row.runtime_can_read_assessment !== true ||
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

export function createNeonReadinessAssessmentRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
    now?: () => Date;
  }>,
): ReadinessAssessmentRepository {
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
    async loadLatestAssessmentByOwner(ownerId) {
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
        if (result.rows.length === 0) {
          await session.client.query("COMMIT");
          started = false;
          return {
            assessment: null,
            acceptedAssessmentVersion: null,
            publishedAt: null,
            snapshotSha256: null,
          };
        }
        const row = record(result.rows[0]);
        const publishedAt = timestamp(row.published_at);
        const assessedAt = timestamp(row.assessed_at);
        const evidenceCurrentThrough = timestamp(row.evidence_current_through);
        const exactHeadSha = required(row.exact_head_sha).toLowerCase();
        if (
          !HEAD.test(exactHeadSha) ||
          Date.parse(evidenceCurrentThrough) > Date.parse(assessedAt) ||
          Date.parse(assessedAt) > Date.parse(publishedAt) ||
          Date.parse(publishedAt) > readAt.getTime()
        )
          fail();
        const assessmentVersion = required(row.assessment_version);
        const snapshotSha256 = required(row.snapshot_sha256);
        const assessment = decodeSnapshot(row.snapshot_json, {
          databaseOwnerId: configuration.databaseOwnerId,
          assessmentId: required(row.assessment_id),
          assessmentVersion,
          exactHeadSha,
          evidenceCurrentThrough,
          assessedAt,
          publishedAt,
          sha256: snapshotSha256,
        });
        await session.client.query("COMMIT");
        started = false;
        return {
          assessment,
          acceptedAssessmentVersion: assessmentVersion,
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

export function neonReadinessAssessmentRepositoryFromEnvironment(
  environment: Environment,
  sessionFactory?: NeonImportPersistenceSessionFactory,
  now?: () => Date,
): ReadinessAssessmentRepository {
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
    return unavailableReadinessAssessmentRepository;
  return createNeonReadinessAssessmentRepository({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    authenticatedOwnerId,
    ...(sessionFactory ? { sessionFactory } : {}),
    ...(now ? { now } : {}),
  });
}
