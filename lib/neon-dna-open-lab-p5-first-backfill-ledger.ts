import { createHash } from "node:crypto";

import type { DnaOpenLabP5FirstBackfillApprovalPacket } from "./dna-open-lab-p5-first-backfill-approval";
import type { DnaOpenLabP5FirstBackfillEvidenceReceipt } from "./dna-open-lab-p5-first-backfill-r2-evidence";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const MAXIMUM_RECEIPT_PAGE = 500;
const SOURCE_FAMILIES = new Set([
  "finished_races",
  "race_activity",
  "token_prices",
  "vault_identity",
  "core_current_state",
  "splice_arena",
]);

type QueryResult = Readonly<{ rows: readonly unknown[] }>;
type DbRow = Record<string, unknown>;

export type DnaOpenLabP5FirstBackfillLedgerState = Readonly<{
  revision: string;
  status: "running" | "complete";
  nextRequestOrdinal: number;
  logicalRequestCount: number;
  retainedR2Bytes: number;
  omittedIdentityObservationCount: number;
  completionSha256: string | null;
}>;

export type DnaOpenLabP5FirstBackfillDurableReceipt =
  DnaOpenLabP5FirstBackfillEvidenceReceipt &
    Readonly<{
      omittedIdentityObservationCount: 0 | 1;
      quarantineBound: boolean;
    }>;

export type DnaOpenLabP5FirstBackfillLedger = Readonly<{
  initialize: () => Promise<DnaOpenLabP5FirstBackfillLedgerState>;
  load: () => Promise<DnaOpenLabP5FirstBackfillLedgerState | null>;
  loadReceipts: (input: {
    afterRequestOrdinal: number;
    limit?: number;
  }) => Promise<readonly DnaOpenLabP5FirstBackfillDurableReceipt[]>;
  record: (input: {
    expectedRevision: string;
    receipt: DnaOpenLabP5FirstBackfillEvidenceReceipt;
    omittedIdentityObservationCount: 0 | 1;
  }) => Promise<DnaOpenLabP5FirstBackfillLedgerState>;
  complete: (input: {
    expectedRevision: string;
    completionSha256: string;
  }) => Promise<DnaOpenLabP5FirstBackfillLedgerState>;
}>;

const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";

const VERIFY_ISOLATION_SQL = [
  "SELECT",
  "  owner.id::text AS database_owner_id,",
  "  owner.clerk_user_id AS authenticated_owner_id,",
  "  run.relrowsecurity AS run_rls, run.relforcerowsecurity AS run_force_rls,",
  "  receipt.relrowsecurity AS receipt_rls, receipt.relforcerowsecurity AS receipt_force_rls,",
  "  (has_table_privilege(session_user, 'dna.dna_open_lab_p5_first_backfill_run', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_p5_first_backfill_run', 'INSERT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_p5_first_backfill_run', 'UPDATE')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_p5_first_backfill_run', 'DELETE'))",
  "    AS runtime_can_access_run,",
  "  (has_table_privilege(session_user, 'dna.dna_open_lab_p5_first_backfill_request_receipt', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_p5_first_backfill_request_receipt', 'INSERT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_p5_first_backfill_request_receipt', 'UPDATE')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_p5_first_backfill_request_receipt', 'DELETE'))",
  "    AS runtime_can_access_receipt,",
  "  has_function_privilege(session_user,",
  "    'dna.initialize_dna_open_lab_p5_first_backfill_run(uuid,text,text,timestamp with time zone)', 'EXECUTE')",
  "    AS runtime_can_initialize,",
  "  has_function_privilege(session_user,",
  "    'dna.record_dna_open_lab_p5_first_backfill_receipt(uuid,text,bigint,integer,text,timestamp with time zone,text,integer,text,integer,boolean)', 'EXECUTE')",
  "    AS runtime_can_record,",
  "  has_function_privilege(session_user,",
  "    'dna.complete_dna_open_lab_p5_first_backfill_run(uuid,text,bigint,text)', 'EXECUTE')",
  "    AS runtime_can_complete,",
  "  has_function_privilege(session_user,",
  "    'dna.read_dna_open_lab_p5_first_backfill_run(uuid,text)', 'EXECUTE')",
  "    AS runtime_can_read_run,",
  "  has_function_privilege(session_user,",
  "    'dna.read_dna_open_lab_p5_first_backfill_receipts(uuid,text,integer,integer)', 'EXECUTE')",
  "    AS runtime_can_read_receipts,",
  "  session_user::text AS session_user_name, current_user::text AS current_user_name,",
  "  role.rolsuper AS runtime_is_superuser, role.rolbypassrls AS runtime_bypasses_rls,",
  "  role.rolcreaterole AS runtime_can_create_roles, role.rolcreatedb AS runtime_can_create_databases,",
  "  COALESCE(pg_has_role(session_user, (SELECT oid FROM pg_catalog.pg_roles",
  "    WHERE rolname = 'neon_superuser'), 'MEMBER'), false) AS runtime_is_neon_superuser_member",
  "FROM dna.app_owner owner",
  "JOIN pg_catalog.pg_class run",
  "  ON run.oid = 'dna.dna_open_lab_p5_first_backfill_run'::regclass",
  "JOIN pg_catalog.pg_class receipt",
  "  ON receipt.oid = 'dna.dna_open_lab_p5_first_backfill_request_receipt'::regclass",
  "JOIN pg_catalog.pg_roles role ON role.rolname = session_user",
  "WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2",
].join("\n");

function record(value: unknown, field: string): DbRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be a database record`);
  }
  return value as DbRow;
}

function oneRow(result: QueryResult, field: string): DbRow {
  if (result.rows.length !== 1) {
    throw new Error(`${field} must return exactly one row`);
  }
  return record(result.rows[0], field);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean`);
  return value;
}

function safeInteger(value: unknown, field: string, minimum = 0): number {
  const normalized =
    typeof value === "number" ? String(value) : text(value, field);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(normalized)) {
    throw new Error(`${field} must be a safe integer`);
  }
  const number = Number(normalized);
  if (!Number.isSafeInteger(number) || number < minimum) {
    throw new Error(`${field} must be a safe integer`);
  }
  return number;
}

function uuid(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized))
    throw new Error(`${field} must be a UUID`);
  return normalized;
}

function owner(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 512 ||
    CONTROL_PATTERN.test(normalized)
  ) {
    throw new Error("ownerId is invalid");
  }
  return normalized;
}

function sha256(value: string, field: string): string {
  const normalized = value.trim();
  if (!SHA_256_PATTERN.test(normalized)) throw new Error(`${field} is invalid`);
  return normalized;
}

function revision(value: unknown, field: string): string {
  const normalized = text(value, field);
  if (!/^[1-9][0-9]*$/u.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function timestamp(value: unknown, field: string): string {
  const normalized =
    value instanceof Date ? value.toISOString() : text(value, field);
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new Error(`${field} must be an ISO timestamp`);
  }
  return new Date(normalized).toISOString();
}

function state(row: DbRow): DnaOpenLabP5FirstBackfillLedgerState {
  const status = text(row.status, "status");
  if (status !== "running" && status !== "complete") {
    throw new Error("status is unsupported");
  }
  const completionSha256 =
    row.completion_sha256 === null
      ? null
      : sha256(
          text(row.completion_sha256, "completion_sha256"),
          "completion_sha256",
        );
  if ((status === "complete") !== (completionSha256 !== null)) {
    throw new Error("completion authority is inconsistent");
  }
  const nextRequestOrdinal = safeInteger(
    row.next_request_ordinal,
    "next_request_ordinal",
    1,
  );
  const logicalRequestCount = safeInteger(
    row.logical_request_count,
    "logical_request_count",
  );
  const retainedR2Bytes = safeInteger(
    row.retained_r2_bytes,
    "retained_r2_bytes",
  );
  const omittedIdentityObservationCount = safeInteger(
    row.omitted_identity_observation_count,
    "omitted_identity_observation_count",
  );
  if (
    logicalRequestCount > 17_453 ||
    nextRequestOrdinal !== logicalRequestCount + 1 ||
    retainedR2Bytes > 1_151_071_826 ||
    omittedIdentityObservationCount > 1
  ) {
    throw new Error("P5 first-backfill ledger state exceeds its authority.");
  }
  return Object.freeze({
    revision: revision(row.revision, "revision"),
    status,
    nextRequestOrdinal,
    logicalRequestCount,
    retainedR2Bytes,
    omittedIdentityObservationCount,
    completionSha256,
  });
}

function durableReceipt(row: DbRow): DnaOpenLabP5FirstBackfillDurableReceipt {
  const omittedIdentityObservationCount = safeInteger(
    row.omitted_identity_observation_count,
    "omitted_identity_observation_count",
  );
  if (
    omittedIdentityObservationCount !== 0 &&
    omittedIdentityObservationCount !== 1
  ) {
    throw new Error("omitted_identity_observation_count is invalid");
  }
  const quarantineBound = bool(row.quarantine_bound, "quarantine_bound");
  if (quarantineBound !== (omittedIdentityObservationCount === 1)) {
    throw new Error("quarantine authority is inconsistent");
  }
  const family = text(row.family, "family");
  const requestOrdinal = safeInteger(row.request_ordinal, "request_ordinal", 1);
  const byteLength = safeInteger(row.byte_length, "byte_length", 1);
  if (
    !SOURCE_FAMILIES.has(family) ||
    requestOrdinal > 17_453 ||
    byteLength > 8_388_608
  ) {
    throw new Error("durable receipt exceeds its authority");
  }
  return Object.freeze({
    family: family as DnaOpenLabP5FirstBackfillEvidenceReceipt["family"],
    requestOrdinal,
    observedAt: timestamp(row.observed_at, "observed_at"),
    contentSha256: sha256(
      text(row.content_sha256, "content_sha256"),
      "content_sha256",
    ),
    byteLength,
    evidenceObjectKey: text(row.evidence_object_key, "evidence_object_key"),
    omittedIdentityObservationCount,
    quarantineBound,
  });
}

function verifyIsolation(
  result: QueryResult,
  input: { databaseOwnerId: string; ownerId: string; runtimeRole: string },
): void {
  const row = oneRow(result, "P5 first-backfill ledger isolation");
  if (
    text(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    text(row.authenticated_owner_id, "authenticated_owner_id") !== input.ownerId
  ) {
    throw new Error("P5 first-backfill ledger owner scope denied.");
  }
  for (const field of [
    "run_rls",
    "run_force_rls",
    "receipt_rls",
    "receipt_force_rls",
  ] as const) {
    if (!bool(row[field], field)) {
      throw new Error("P5 first-backfill ledger requires forced owner RLS.");
    }
  }
  if (
    bool(row.runtime_can_access_run, "runtime_can_access_run") ||
    bool(row.runtime_can_access_receipt, "runtime_can_access_receipt")
  ) {
    throw new Error("P5 first-backfill ledger table access is not bounded.");
  }
  for (const field of [
    "runtime_can_initialize",
    "runtime_can_record",
    "runtime_can_complete",
    "runtime_can_read_run",
    "runtime_can_read_receipts",
  ] as const) {
    if (!bool(row[field], field)) {
      throw new Error(
        "P5 first-backfill ledger function privilege is incomplete.",
      );
    }
  }
  if (
    text(row.session_user_name, "session_user_name") !== input.runtimeRole ||
    text(row.current_user_name, "current_user_name") !== input.runtimeRole ||
    bool(row.runtime_is_superuser, "runtime_is_superuser") ||
    bool(row.runtime_bypasses_rls, "runtime_bypasses_rls") ||
    bool(row.runtime_can_create_roles, "runtime_can_create_roles") ||
    bool(row.runtime_can_create_databases, "runtime_can_create_databases") ||
    bool(
      row.runtime_is_neon_superuser_member,
      "runtime_is_neon_superuser_member",
    )
  ) {
    throw new Error(
      "P5 first-backfill ledger runtime role is not least privileged.",
    );
  }
}

export function createNeonDnaOpenLabP5FirstBackfillLedger(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  ownerId: string;
  runtimeRole: string;
  approvalPacket: DnaOpenLabP5FirstBackfillApprovalPacket;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): DnaOpenLabP5FirstBackfillLedger {
  const databaseUrl = input.databaseUrl.trim();
  if (databaseUrl === "") throw new Error("databaseUrl is required");
  const databaseOwnerId = uuid(input.databaseOwnerId, "databaseOwnerId");
  const ownerId = owner(input.ownerId);
  const runtimeRole = input.runtimeRole.trim();
  if (!ROLE_PATTERN.test(runtimeRole))
    throw new Error("runtimeRole is invalid");
  const measured = input.approvalPacket.measuredUpperBound;
  const omission = input.approvalPacket.identityOmissionAuthority;
  const authorization = input.approvalPacket.ownerAuthorization;
  if (
    input.approvalPacket.status !==
      "approved_for_first_private_preview_backfill" ||
    !input.approvalPacket.firstPersistentPrivatePreviewBackfillAllowed ||
    input.approvalPacket.productionChangesAllowed ||
    measured === null ||
    omission === null ||
    authorization === null
  ) {
    throw new Error(
      "P5 first-backfill ledger requires exact bounded Preview approval.",
    );
  }
  const measurementSha256 = sha256(
    omission.measurementEvidenceSha256,
    "measurementEvidenceSha256",
  );
  const approvalRefSha256 = createHash("sha256")
    .update(authorization.approvalRef, "utf8")
    .digest("hex");
  const authorityCutoffAt = timestamp(
    measured.authorityCutoffAt,
    "authorityCutoffAt",
  );
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  async function transaction<T>(request: {
    readOnly: boolean;
    run: (
      client: Awaited<ReturnType<typeof sessionFactory>>["client"],
    ) => Promise<T>;
  }): Promise<T> {
    const session = await sessionFactory(databaseUrl);
    let begun = false;
    try {
      await session.client.query(
        request.readOnly
          ? "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY"
          : "BEGIN ISOLATION LEVEL SERIALIZABLE",
      );
      begun = true;
      await session.client.query(SET_OWNER_SCOPE_SQL, [databaseOwnerId]);
      verifyIsolation(
        await session.client.query(VERIFY_ISOLATION_SQL, [
          databaseOwnerId,
          ownerId,
        ]),
        { databaseOwnerId, ownerId, runtimeRole },
      );
      const result = await request.run(session.client);
      await session.client.query("COMMIT");
      begun = false;
      return result;
    } catch (error) {
      if (begun) await session.client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await session.close();
    }
  }

  return Object.freeze({
    initialize: () =>
      transaction({
        readOnly: false,
        async run(client) {
          return state(
            oneRow(
              await client.query(
                "SELECT revision::text, status, next_request_ordinal, logical_request_count, retained_r2_bytes::text, omitted_identity_observation_count, completion_sha256 FROM dna.initialize_dna_open_lab_p5_first_backfill_run($1::uuid,$2::text,$3::text,$4::timestamptz)",
                [
                  databaseOwnerId,
                  measurementSha256,
                  approvalRefSha256,
                  authorityCutoffAt,
                ],
              ),
              "P5 first-backfill ledger initialization",
            ),
          );
        },
      }),

    load: () =>
      transaction({
        readOnly: true,
        async run(client) {
          const result = await client.query(
            "SELECT revision::text, status, next_request_ordinal, logical_request_count, retained_r2_bytes::text, omitted_identity_observation_count, completion_sha256 FROM dna.read_dna_open_lab_p5_first_backfill_run($1::uuid,$2::text)",
            [databaseOwnerId, measurementSha256],
          );
          return result.rows.length === 0
            ? null
            : state(oneRow(result, "P5 first-backfill ledger run"));
        },
      }),

    loadReceipts({ afterRequestOrdinal, limit = MAXIMUM_RECEIPT_PAGE }) {
      if (
        !Number.isSafeInteger(afterRequestOrdinal) ||
        afterRequestOrdinal < 0 ||
        afterRequestOrdinal > 17_453 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > MAXIMUM_RECEIPT_PAGE
      ) {
        throw new Error("P5 first-backfill receipt page is invalid.");
      }
      return transaction({
        readOnly: true,
        async run(client) {
          const result = await client.query(
            "SELECT family, request_ordinal, observed_at, content_sha256, byte_length, evidence_object_key, omitted_identity_observation_count, quarantine_bound FROM dna.read_dna_open_lab_p5_first_backfill_receipts($1::uuid,$2::text,$3::integer,$4::integer)",
            [databaseOwnerId, measurementSha256, afterRequestOrdinal, limit],
          );
          return Object.freeze(
            result.rows.map((row) => durableReceipt(record(row, "receipt"))),
          );
        },
      });
    },

    record({ expectedRevision, receipt, omittedIdentityObservationCount }) {
      const expected = revision(expectedRevision, "expectedRevision");
      if (
        omittedIdentityObservationCount !== 0 &&
        omittedIdentityObservationCount !== 1
      ) {
        throw new Error("omittedIdentityObservationCount is invalid");
      }
      return transaction({
        readOnly: false,
        async run(client) {
          return state(
            oneRow(
              await client.query(
                "SELECT revision::text, status, next_request_ordinal, logical_request_count, retained_r2_bytes::text, omitted_identity_observation_count, completion_sha256 FROM dna.record_dna_open_lab_p5_first_backfill_receipt($1::uuid,$2::text,$3::bigint,$4::integer,$5::text,$6::timestamptz,$7::text,$8::integer,$9::text,$10::integer,$11::boolean)",
                [
                  databaseOwnerId,
                  measurementSha256,
                  expected,
                  receipt.requestOrdinal,
                  receipt.family,
                  receipt.observedAt,
                  receipt.contentSha256,
                  receipt.byteLength,
                  receipt.evidenceObjectKey,
                  omittedIdentityObservationCount,
                  omittedIdentityObservationCount === 1,
                ],
              ),
              "P5 first-backfill ledger receipt",
            ),
          );
        },
      });
    },

    complete({ expectedRevision, completionSha256 }) {
      const expected = revision(expectedRevision, "expectedRevision");
      const completion = sha256(completionSha256, "completionSha256");
      return transaction({
        readOnly: false,
        async run(client) {
          return state(
            oneRow(
              await client.query(
                "SELECT revision::text, status, next_request_ordinal, logical_request_count, retained_r2_bytes::text, omitted_identity_observation_count, completion_sha256 FROM dna.complete_dna_open_lab_p5_first_backfill_run($1::uuid,$2::text,$3::bigint,$4::text)",
                [databaseOwnerId, measurementSha256, expected, completion],
              ),
              "P5 first-backfill ledger completion",
            ),
          );
        },
      });
    },
  });
}
