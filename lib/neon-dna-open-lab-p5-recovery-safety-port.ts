import { createHash } from "node:crypto";

import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";
import { DNA_OPEN_LAB_P5_OWNER_RELATION_NAMES } from "./neon-dna-open-lab-p5-capacity-port";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;

export const DNA_OPEN_LAB_P5_RECOVERY_OWNER_DATA_RELATIONS = Object.freeze([
  "dna_open_lab_active_race_snapshot",
  "dna_open_lab_core_supplemental_snapshot",
  "dna_open_lab_owned_core_snapshot",
  "dna_open_lab_race_fill_snapshot",
  "dna_open_lab_splice_arena_listing_snapshot",
  "dna_open_lab_splice_arena_mode_snapshot",
  "dna_open_lab_splice_arena_page_snapshot",
  "dna_open_lab_token_prices_snapshot",
] as const);

export const DNA_OPEN_LAB_P5_RECOVERY_CHECKPOINT_RELATIONS = Object.freeze([
  "dna_open_lab_current_state_acquisition_cycle",
  "dna_open_lab_finished_race_backfill_checkpoint",
] as const);

export const DNA_OPEN_LAB_P5_RECOVERY_SERVING_RELATIONS = Object.freeze([
  "dna_open_lab_sync_generation",
  "dna_open_lab_sync_state",
] as const);

export const DNA_OPEN_LAB_P5_RECOVERY_RETAINED_EVIDENCE_RELATIONS =
  Object.freeze([
    "dna_open_lab_current_state_evidence_index",
    "dna_open_lab_finished_race_window_receipt",
    "dna_open_lab_sync_family",
  ] as const);

const PARTITIONED_RELATIONS = [
  ...DNA_OPEN_LAB_P5_RECOVERY_OWNER_DATA_RELATIONS,
  ...DNA_OPEN_LAB_P5_RECOVERY_CHECKPOINT_RELATIONS,
  ...DNA_OPEN_LAB_P5_RECOVERY_SERVING_RELATIONS,
  ...DNA_OPEN_LAB_P5_RECOVERY_RETAINED_EVIDENCE_RELATIONS,
].sort();
const CAPACITY_RELATIONS = [...DNA_OPEN_LAB_P5_OWNER_RELATION_NAMES].sort();
if (
  new Set(PARTITIONED_RELATIONS).size !== PARTITIONED_RELATIONS.length ||
  JSON.stringify(PARTITIONED_RELATIONS) !== JSON.stringify(CAPACITY_RELATIONS)
) {
  throw new Error("DNA Open Lab P5 recovery relation partition is invalid.");
}

const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";

const READ_FINGERPRINTS_SQL = `
  SELECT evidence_group, row_count::text, fingerprint_payload
  FROM dna.read_dna_open_lab_p5_recovery_fingerprints($1::uuid)
  ORDER BY evidence_group
`;

const VERIFY_RUNTIME_SQL = `
  SELECT
    owner.id::text AS database_owner_id,
    owner.clerk_user_id AS authenticated_owner_id,
    session_user::text AS session_user_name,
    current_user::text AS current_user_name,
    role.rolsuper AS runtime_is_superuser,
    role.rolbypassrls AS runtime_bypasses_rls,
    role.rolcreaterole AS runtime_can_create_roles,
    role.rolcreatedb AS runtime_can_create_databases,
    has_database_privilege(session_user, current_database(), 'CREATE')
      AS runtime_can_create_in_database,
    has_schema_privilege(session_user, 'dna', 'CREATE')
      AS runtime_can_create_in_schema,
    COALESCE(
      pg_has_role(session_user, (
        SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'neon_superuser'
      ), 'MEMBER'),
      false
    ) AS runtime_is_neon_superuser_member
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
`;

export type DnaOpenLabP5RecoveryNeonSafetySnapshot = Readonly<{
  ownerDataSha256: string;
  checkpointStateSha256: string;
  servingStateSha256: string;
  retainedEvidenceSha256: string;
  persistentOwnerDataRowCount: number;
}>;

export type NeonDnaOpenLabP5RecoverySafetyConfiguration = Readonly<{
  authorizedOwnerId: string;
  databaseOwnerId: string;
  databaseUrl: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}>;

type DatabaseRow = Readonly<Record<string, unknown>>;

function safetyError(message: string): never {
  throw new Error(`DNA Open Lab P5 Neon recovery safety port: ${message}`);
}

function safeText(value: string, field: string, maximum: number): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)
  ) {
    safetyError(`${field} is invalid`);
  }
  return normalized;
}

function row(value: unknown): DatabaseRow {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    safetyError("provider response is invalid");
  }
  return value as DatabaseRow;
}

function oneRow(rows: readonly unknown[]): DatabaseRow {
  if (rows.length !== 1) safetyError("provider response is invalid");
  return row(rows[0]);
}

function stringField(value: DatabaseRow, field: string): string {
  const candidate = value[field];
  if (typeof candidate !== "string" || candidate.length < 1) {
    safetyError("provider response is invalid");
  }
  return candidate;
}

function booleanField(value: DatabaseRow, field: string): boolean {
  const candidate = value[field];
  if (typeof candidate !== "boolean")
    safetyError("provider response is invalid");
  return candidate;
}

function count(value: unknown): number {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    safetyError("provider response is invalid");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    safetyError("provider response is invalid");
  return parsed;
}

function sha256(domain: string, payload: string): string {
  return createHash("sha256")
    .update(`${domain}\u0000${payload}`, "utf8")
    .digest("hex");
}

function verifyRuntime(
  value: DatabaseRow,
  input: {
    authorizedOwnerId: string;
    databaseOwnerId: string;
    runtimeRole: string;
  },
): void {
  if (
    stringField(value, "database_owner_id") !== input.databaseOwnerId ||
    stringField(value, "authenticated_owner_id") !== input.authorizedOwnerId ||
    stringField(value, "session_user_name") !== input.runtimeRole ||
    stringField(value, "current_user_name") !== input.runtimeRole ||
    booleanField(value, "runtime_is_superuser") ||
    booleanField(value, "runtime_bypasses_rls") ||
    booleanField(value, "runtime_can_create_roles") ||
    booleanField(value, "runtime_can_create_databases") ||
    booleanField(value, "runtime_can_create_in_database") ||
    booleanField(value, "runtime_can_create_in_schema") ||
    booleanField(value, "runtime_is_neon_superuser_member")
  ) {
    safetyError("access denied");
  }
}

const FINGERPRINT_DOMAINS = Object.freeze({
  owner_data: "dna-open-lab-p5-owner-data",
  checkpoint_state: "dna-open-lab-p5-checkpoint-state",
  serving_state: "dna-open-lab-p5-serving-state",
  retained_evidence: "dna-open-lab-p5-retained-evidence",
} as const);

type FingerprintGroup = keyof typeof FINGERPRINT_DOMAINS;

function readFingerprints(
  rows: readonly unknown[],
): Readonly<
  Record<FingerprintGroup, Readonly<{ sha256: string; rowCount: number }>>
> {
  if (rows.length !== 4) safetyError("provider response is invalid");
  const fingerprints = new Map<
    FingerprintGroup,
    Readonly<{ sha256: string; rowCount: number }>
  >();
  for (const candidate of rows) {
    const result = row(candidate);
    const group = stringField(result, "evidence_group");
    if (
      !(group in FINGERPRINT_DOMAINS) ||
      fingerprints.has(group as FingerprintGroup)
    ) {
      safetyError("provider response is invalid");
    }
    const typedGroup = group as FingerprintGroup;
    fingerprints.set(
      typedGroup,
      Object.freeze({
        sha256: sha256(
          FINGERPRINT_DOMAINS[typedGroup],
          stringField(result, "fingerprint_payload"),
        ),
        rowCount: count(result.row_count),
      }),
    );
  }
  const required = Object.keys(FINGERPRINT_DOMAINS) as FingerprintGroup[];
  if (required.some((group) => !fingerprints.has(group))) {
    safetyError("provider response is invalid");
  }
  return Object.freeze(
    Object.fromEntries(fingerprints) as Record<
      FingerprintGroup,
      Readonly<{ sha256: string; rowCount: number }>
    >,
  );
}

/**
 * Reads compact owner-scoped fingerprints from the fixed API-only relation
 * inventory. Raw rows never leave PostgreSQL: each row is reduced to a stable
 * digest before the bounded group payload reaches the runtime.
 */
export function createNeonDnaOpenLabP5RecoverySafetyInspector(
  configuration: NeonDnaOpenLabP5RecoverySafetyConfiguration,
): () => Promise<DnaOpenLabP5RecoveryNeonSafetySnapshot> {
  const authorizedOwnerId = safeText(
    configuration.authorizedOwnerId,
    "authorizedOwnerId",
    512,
  );
  const databaseOwnerId = configuration.databaseOwnerId.trim().toLowerCase();
  if (!UUID_PATTERN.test(databaseOwnerId))
    safetyError("databaseOwnerId is invalid");
  const databaseUrl = safeText(configuration.databaseUrl, "databaseUrl", 4096);
  const runtimeRole = configuration.runtimeRole.trim();
  if (!ROLE_PATTERN.test(runtimeRole)) safetyError("runtimeRole is invalid");
  const sessionFactory =
    configuration.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  return async () => {
    let session: Awaited<ReturnType<NeonImportPersistenceSessionFactory>>;
    try {
      session = await sessionFactory(databaseUrl);
    } catch {
      return safetyError("inspection failed");
    }
    let transactionStarted = false;
    try {
      await session.client.query(
        "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY",
      );
      transactionStarted = true;
      const scope = oneRow(
        (await session.client.query(SET_OWNER_SCOPE_SQL, [databaseOwnerId]))
          .rows,
      );
      if (stringField(scope, "owner_scope") !== databaseOwnerId)
        safetyError("access denied");
      verifyRuntime(
        oneRow(
          (
            await session.client.query(VERIFY_RUNTIME_SQL, [
              databaseOwnerId,
              authorizedOwnerId,
            ])
          ).rows,
        ),
        { authorizedOwnerId, databaseOwnerId, runtimeRole },
      );
      const fingerprints = readFingerprints(
        (await session.client.query(READ_FINGERPRINTS_SQL, [databaseOwnerId]))
          .rows,
      );
      await session.client.query("COMMIT");
      return Object.freeze({
        ownerDataSha256: fingerprints.owner_data.sha256,
        checkpointStateSha256: fingerprints.checkpoint_state.sha256,
        servingStateSha256: fingerprints.serving_state.sha256,
        retainedEvidenceSha256: fingerprints.retained_evidence.sha256,
        persistentOwnerDataRowCount: fingerprints.owner_data.rowCount,
      });
    } catch {
      if (transactionStarted) {
        await session.client.query("ROLLBACK").catch(() => undefined);
      }
      return safetyError("inspection failed");
    } finally {
      await session.close().catch(() => undefined);
    }
  };
}
