import type { DatasetEvidenceObjectRegistration } from "./neon-dataset-evidence-object-repository";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceClient,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const SHA_PATTERN = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;
type DbRow = Record<string, unknown>;

export type RacePreactivationEvidenceManifest = Readonly<{
  importBatchId: string;
  sourceRowCount: number;
  acceptedRowCount: number;
  rejectedRowCount: number;
  warningRowCount: number;
  partitionCount: number;
  byteSize: number;
  objects: readonly DatasetEvidenceObjectRegistration[];
}>;

export type RacePreactivationEvidenceManifestRepository = Readonly<{
  list: (input: {
    ownerId: string;
    importBatchId: string;
    maximumPartitions: number;
  }) => Promise<
    | Readonly<{ status: "missing" }>
    | Readonly<{
        status: "ready";
        manifest: RacePreactivationEvidenceManifest;
      }>
  >;
}>;

const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";

const VERIFY_ISOLATION_SQL = [
  "SELECT",
  "  owner.id::text AS database_owner_id,",
  "  owner.clerk_user_id AS authenticated_owner_id,",
  "  evidence.relrowsecurity AS evidence_rls,",
  "  evidence.relforcerowsecurity AS evidence_force_rls,",
  "  receipt.relrowsecurity AS receipt_rls,",
  "  receipt.relforcerowsecurity AS receipt_force_rls,",
  "  has_table_privilege(session_user, 'dna.dataset_evidence_object', 'SELECT')",
  "    AS runtime_can_read_evidence,",
  "  has_table_privilege(session_user, 'dna.import_preview_evidence_receipt', 'SELECT')",
  "    AS runtime_can_read_receipts,",
  "  has_function_privilege(",
  "    session_user,",
  "    'dna.list_race_preactivation_evidence_manifest(uuid,uuid,integer)',",
  "    'EXECUTE'",
  "  ) AS runtime_can_read_manifest,",
  "  session_user::text AS session_user_name,",
  "  current_user::text AS current_user_name,",
  "  role.rolsuper AS runtime_is_superuser,",
  "  role.rolbypassrls AS runtime_bypasses_rls,",
  "  role.rolcreaterole AS runtime_can_create_roles,",
  "  role.rolcreatedb AS runtime_can_create_databases,",
  "  COALESCE(pg_has_role(session_user, (",
  "    SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'neon_superuser'",
  "  ), 'MEMBER'), false) AS runtime_is_neon_superuser_member",
  "FROM dna.app_owner owner",
  "JOIN pg_catalog.pg_class evidence",
  "  ON evidence.oid = 'dna.dataset_evidence_object'::regclass",
  "JOIN pg_catalog.pg_class receipt",
  "  ON receipt.oid = 'dna.import_preview_evidence_receipt'::regclass",
  "JOIN pg_catalog.pg_roles role ON role.rolname = session_user",
  "WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2",
].join("\n");

const LIST_SQL = [
  "SELECT",
  "  import_batch_id::text AS import_batch_id,",
  "  source_row_count::text AS source_row_count,",
  "  accepted_row_count::text AS accepted_row_count,",
  "  rejected_row_count::text AS rejected_row_count,",
  "  warning_row_count::text AS warning_row_count,",
  "  partition_count, evidence_byte_size::text AS evidence_byte_size,",
  "  partition_number, object_format, object_key,",
  "  checksum_sha256::text AS checksum_sha256,",
  "  byte_size::text AS byte_size, row_count::text AS row_count,",
  "  first_natural_key, last_natural_key, created_at",
  "FROM dna.list_race_preactivation_evidence_manifest(",
  "  $1::uuid, $2::uuid, $3::integer",
  ")",
  "ORDER BY partition_number",
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

function count(value: unknown, field: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return parsed;
}

function uuid(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized))
    throw new Error(`${field} must be a UUID`);
  return normalized;
}

function safeOwner(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 512 ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new Error("ownerId is invalid");
  }
  return normalized;
}

function naturalKey(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 512 ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new Error(`${field} is invalid`);
  }
  return value;
}

function timestamp(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value !== "string")
    throw new Error("created_at must be a timestamp");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()))
    throw new Error("created_at must be a timestamp");
  return parsed.toISOString();
}

function boundedPartitions(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new Error("maximumPartitions is invalid");
  }
  return value;
}

function configuration(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
}) {
  const databaseUrl = input.databaseUrl.trim();
  const databaseOwnerId = uuid(input.databaseOwnerId, "databaseOwnerId");
  const runtimeRole = input.runtimeRole.trim();
  if (!databaseUrl) throw new Error("databaseUrl is required");
  if (!ROLE_PATTERN.test(runtimeRole))
    throw new Error("runtimeRole is invalid");
  return { databaseUrl, databaseOwnerId, runtimeRole };
}

function verifyIsolation(
  result: QueryResult,
  input: {
    databaseOwnerId: string;
    ownerId: string;
    runtimeRole: string;
  },
): void {
  const row = oneRow(result, "Race preactivation evidence isolation");
  if (
    text(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    text(row.authenticated_owner_id, "authenticated_owner_id") !== input.ownerId
  ) {
    throw new Error("Race preactivation evidence owner scope denied.");
  }
  if (
    !bool(row.evidence_rls, "evidence_rls") ||
    !bool(row.evidence_force_rls, "evidence_force_rls") ||
    !bool(row.receipt_rls, "receipt_rls") ||
    !bool(row.receipt_force_rls, "receipt_force_rls")
  ) {
    throw new Error("Race preactivation evidence requires forced owner RLS.");
  }
  if (
    !bool(row.runtime_can_read_evidence, "runtime_can_read_evidence") ||
    !bool(row.runtime_can_read_receipts, "runtime_can_read_receipts") ||
    !bool(row.runtime_can_read_manifest, "runtime_can_read_manifest")
  ) {
    throw new Error(
      "Race preactivation evidence runtime privilege is incomplete.",
    );
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
      "Race preactivation evidence runtime role is not least privileged.",
    );
  }
}

function normalizeManifest(input: {
  ownerId: string;
  importBatchId: string;
  maximumPartitions: number;
  rows: readonly unknown[];
}): RacePreactivationEvidenceManifest | null {
  if (input.rows.length === 0) return null;
  if (input.rows.length > input.maximumPartitions) {
    throw new Error(
      "Race preactivation partition count exceeds the read bound.",
    );
  }

  const first = record(input.rows[0], "Race preactivation manifest");
  const importBatchId = uuid(
    text(first.import_batch_id, "import_batch_id"),
    "import_batch_id",
  );
  if (importBatchId !== input.importBatchId) {
    throw new Error("Race preactivation import batch identity changed.");
  }
  const sourceRowCount = count(first.source_row_count, "source_row_count");
  const acceptedRowCount = count(
    first.accepted_row_count,
    "accepted_row_count",
  );
  const rejectedRowCount = count(
    first.rejected_row_count,
    "rejected_row_count",
  );
  const warningRowCount = count(first.warning_row_count, "warning_row_count");
  const partitionCount = count(first.partition_count, "partition_count");
  const byteSize = count(first.evidence_byte_size, "evidence_byte_size");
  if (
    sourceRowCount < 1 ||
    acceptedRowCount < 1 ||
    acceptedRowCount + rejectedRowCount !== sourceRowCount ||
    warningRowCount > sourceRowCount ||
    partitionCount !== input.rows.length ||
    partitionCount > input.maximumPartitions ||
    byteSize < 1
  ) {
    throw new Error("Race preactivation manifest coverage is invalid.");
  }

  let observedRows = 0;
  let observedBytes = 0;
  const objects = input.rows.map((raw, index) => {
    const row = record(raw, `Race preactivation partition[${index}]`);
    if (
      uuid(text(row.import_batch_id, "import_batch_id"), "import_batch_id") !==
        importBatchId ||
      count(row.source_row_count, "source_row_count") !== sourceRowCount ||
      count(row.accepted_row_count, "accepted_row_count") !==
        acceptedRowCount ||
      count(row.rejected_row_count, "rejected_row_count") !==
        rejectedRowCount ||
      count(row.warning_row_count, "warning_row_count") !== warningRowCount ||
      count(row.partition_count, "partition_count") !== partitionCount ||
      count(row.evidence_byte_size, "evidence_byte_size") !== byteSize
    ) {
      throw new Error("Race preactivation manifest rows are inconsistent.");
    }
    const partitionNumber = count(row.partition_number, "partition_number");
    if (partitionNumber !== index) {
      throw new Error("Race preactivation partitions are not contiguous.");
    }
    const objectFormat = text(row.object_format, "object_format");
    if (objectFormat !== "ndjson_gzip") {
      throw new Error("Race preactivation object format is invalid.");
    }
    const checksumSha256 = text(row.checksum_sha256, "checksum_sha256");
    if (!SHA_PATTERN.test(checksumSha256)) {
      throw new Error("Race preactivation checksum is invalid.");
    }
    const objectByteSize = count(row.byte_size, "byte_size");
    const rowCount = count(row.row_count, "row_count");
    if (objectByteSize < 1 || rowCount < 1) {
      throw new Error("Race preactivation partition size is invalid.");
    }
    observedRows += rowCount;
    observedBytes += objectByteSize;
    if (
      !Number.isSafeInteger(observedRows) ||
      !Number.isSafeInteger(observedBytes)
    ) {
      throw new Error("Race preactivation evidence totals are unsafe.");
    }
    const firstNaturalKey = naturalKey(
      row.first_natural_key,
      "first_natural_key",
    );
    const lastNaturalKey = naturalKey(row.last_natural_key, "last_natural_key");
    if ((firstNaturalKey === null) !== (lastNaturalKey === null)) {
      throw new Error("Race preactivation natural-key range is incomplete.");
    }
    return Object.freeze({
      ownerId: input.ownerId,
      importBatchId,
      sourceType: "race_merge" as const,
      objectKind: "staged_rows" as const,
      partitionNumber,
      objectFormat: "ndjson_gzip" as const,
      objectKey: text(row.object_key, "object_key"),
      checksumSha256,
      byteSize: objectByteSize,
      rowCount,
      firstNaturalKey,
      lastNaturalKey,
      createdAt: timestamp(row.created_at),
    });
  });

  if (observedRows !== sourceRowCount || observedBytes !== byteSize) {
    throw new Error(
      "Race preactivation evidence coverage conflicts with its manifest.",
    );
  }

  return Object.freeze({
    importBatchId,
    sourceRowCount,
    acceptedRowCount,
    rejectedRowCount,
    warningRowCount,
    partitionCount,
    byteSize,
    objects: Object.freeze(objects),
  });
}

export function createNeonRacePreactivationEvidenceManifestRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): RacePreactivationEvidenceManifestRepository {
  const config = configuration(input);
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  return Object.freeze({
    async list(request) {
      const ownerId = safeOwner(request.ownerId);
      const importBatchId = uuid(request.importBatchId, "importBatchId");
      const maximumPartitions = boundedPartitions(request.maximumPartitions);
      const session = await sessionFactory(config.databaseUrl);
      let begun = false;
      try {
        await session.client.query(
          "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY",
        );
        begun = true;
        await session.client.query(SET_OWNER_SCOPE_SQL, [
          config.databaseOwnerId,
        ]);
        verifyIsolation(
          await session.client.query(VERIFY_ISOLATION_SQL, [
            config.databaseOwnerId,
            ownerId,
          ]),
          { ...config, ownerId },
        );
        const result = await session.client.query(LIST_SQL, [
          config.databaseOwnerId,
          importBatchId,
          maximumPartitions,
        ]);
        const manifest = normalizeManifest({
          ownerId,
          importBatchId,
          maximumPartitions,
          rows: result.rows,
        });
        await session.client.query("COMMIT");
        begun = false;
        return manifest === null
          ? Object.freeze({ status: "missing" as const })
          : Object.freeze({ status: "ready" as const, manifest });
      } catch (error) {
        if (begun)
          await session.client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        await session.close();
      }
    },
  });
}
