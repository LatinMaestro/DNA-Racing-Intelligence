import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceClient,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";
import type { DatasetEvidenceObjectRegistration } from "./neon-dataset-evidence-object-repository";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const MAXIMUM_PARTITION_LIMIT = 10_000;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;

export type SealedRaceArchiveManifest = Readonly<{
  datasetVersionId: string;
  importBatchId: string;
  sourceType: "race_merge";
  evidenceKind: "staged_rows" | "normalized_partition";
  partitionCount: number;
  rowCount: number;
  byteSize: number;
  objects: readonly DatasetEvidenceObjectRegistration[];
}>;

export type SealedRaceArchiveManifestRepository = Readonly<{
  list: (input: {
    ownerId: string;
    datasetVersionId: string;
    maximumPartitions: number;
  }) => Promise<
    | Readonly<{ status: "missing" }>
    | Readonly<{ status: "ready"; manifest: SealedRaceArchiveManifest }>
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
  "  (receipt.relrowsecurity AND prepublication.relrowsecurity) AS receipt_rls,",
  "  (receipt.relforcerowsecurity AND prepublication.relforcerowsecurity)",
  "    AS receipt_force_rls,",
  "  has_table_privilege(session_user, 'dna.dataset_evidence_object', 'SELECT')",
  "    AS runtime_can_read_evidence,",
  "  (has_table_privilege(session_user, 'dna.dataset_version_evidence_receipt', 'SELECT')",
  "   AND has_table_privilege(session_user,",
  "     'dna.race_archive_prepublication_evidence_receipt', 'SELECT'))",
  "    AS runtime_can_read_receipts,",
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
  "  ON receipt.oid = 'dna.dataset_version_evidence_receipt'::regclass",
  "JOIN pg_catalog.pg_class prepublication",
  "  ON prepublication.oid =",
  "    'dna.race_archive_prepublication_evidence_receipt'::regclass",
  "JOIN pg_catalog.pg_roles role ON role.rolname = session_user",
  "WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2",
].join("\n");

const LIST_SQL = [
  "WITH archive_authority AS (",
  "  SELECT",
  "    prepublication.import_batch_id,",
  "    prepublication.source_type,",
  "    prepublication.evidence_kind,",
  "    prepublication.evidence_partition_count,",
  "    prepublication.evidence_row_count,",
  "    prepublication.evidence_byte_size",
  "  FROM dna.race_archive_prepublication_evidence_receipt prepublication",
  "  WHERE prepublication.owner_id = $1::uuid",
  "    AND prepublication.dataset_version_id = $2::uuid",
  "    AND prepublication.source_type = 'race_merge'",
  "  UNION ALL",
  "  SELECT",
  "    sealed.import_batch_id,",
  "    sealed.source_type,",
  "    sealed.evidence_kind,",
  "    sealed.evidence_partition_count,",
  "    sealed.evidence_row_count,",
  "    sealed.evidence_byte_size",
  "  FROM dna.dataset_version_evidence_receipt sealed",
  "  WHERE sealed.owner_id = $1::uuid",
  "    AND sealed.dataset_version_id = $2::uuid",
  "    AND sealed.source_type = 'race_merge'",
  "    AND NOT EXISTS (",
  "      SELECT 1",
  "      FROM dna.race_archive_prepublication_evidence_receipt prepublication",
  "      WHERE prepublication.owner_id = sealed.owner_id",
  "        AND prepublication.dataset_version_id = sealed.dataset_version_id",
  "    )",
  ")",
  "SELECT",
  "  receipt.import_batch_id::text AS import_batch_id,",
  "  receipt.source_type,",
  "  receipt.evidence_kind,",
  "  receipt.evidence_partition_count,",
  "  receipt.evidence_row_count::text AS evidence_row_count,",
  "  receipt.evidence_byte_size::text AS evidence_byte_size,",
  "  object.partition_number,",
  "  object.object_format,",
  "  object.object_key,",
  "  object.checksum_sha256::text AS checksum_sha256,",
  "  object.byte_size::text AS byte_size,",
  "  object.row_count::text AS row_count,",
  "  object.first_natural_key,",
  "  object.last_natural_key,",
  "  object.created_at",
  "FROM archive_authority receipt",
  "JOIN dna.dataset_evidence_object object",
  "  ON object.owner_id = $1::uuid",
  " AND object.import_batch_id = receipt.import_batch_id",
  " AND object.source_type = receipt.source_type",
  " AND object.object_kind = receipt.evidence_kind",
  "ORDER BY object.partition_number",
  "LIMIT $3::integer",
].join("\n");

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(field + " must be a database record");
  }
  return value as Record<string, unknown>;
}

function oneRow(result: QueryResult, field: string): Record<string, unknown> {
  if (result.rows.length !== 1) {
    throw new Error(field + " must return exactly one row");
  }
  return record(result.rows[0], field);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(field + " must be a non-empty string");
  }
  return value.trim();
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(field + " must be boolean");
  return value;
}

function safeOwner(value: string): string {
  const normalized = value.trim();
  if (
    normalized === "" ||
    normalized.length > 512 ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new Error("ownerId is invalid");
  }
  return normalized;
}

function uuid(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new Error(field + " must be a UUID");
  }
  return normalized;
}

function boundedPartitions(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAXIMUM_PARTITION_LIMIT
  ) {
    throw new Error("maximumPartitions is invalid");
  }
  return value;
}

function safeInteger(value: unknown, field: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(field + " must be a safe integer");
  }
  return parsed;
}

function timestamp(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value !== "string") {
    throw new Error("created_at must be a timestamp");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("created_at must be a timestamp");
  }
  return parsed.toISOString();
}

function nullableNaturalKey(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 512 ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new Error(field + " is invalid");
  }
  return value;
}

function verifyIsolation(
  result: QueryResult,
  input: {
    databaseOwnerId: string;
    ownerId: string;
    runtimeRole: string;
  },
): void {
  const row = oneRow(result, "sealed Race archive isolation");
  if (
    text(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    text(row.authenticated_owner_id, "authenticated_owner_id") !== input.ownerId
  ) {
    throw new Error("Sealed Race archive owner scope denied.");
  }
  if (
    !bool(row.evidence_rls, "evidence_rls") ||
    !bool(row.evidence_force_rls, "evidence_force_rls") ||
    !bool(row.receipt_rls, "receipt_rls") ||
    !bool(row.receipt_force_rls, "receipt_force_rls")
  ) {
    throw new Error("Sealed Race archive requires forced owner RLS.");
  }
  if (
    !bool(row.runtime_can_read_evidence, "runtime_can_read_evidence") ||
    !bool(row.runtime_can_read_receipts, "runtime_can_read_receipts")
  ) {
    throw new Error(
      "Sealed Race archive runtime read privilege is incomplete.",
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
      "Sealed Race archive runtime role is not least privileged.",
    );
  }
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

function normalizeManifest(input: {
  ownerId: string;
  datasetVersionId: string;
  maximumPartitions: number;
  rows: readonly unknown[];
}): SealedRaceArchiveManifest | null {
  if (input.rows.length === 0) return null;
  if (input.rows.length > input.maximumPartitions) {
    throw new Error(
      "Sealed Race archive partition count exceeds the read bound.",
    );
  }

  const first = record(input.rows[0], "sealed Race archive manifest");
  const importBatchId = uuid(
    text(first.import_batch_id, "import_batch_id"),
    "import_batch_id",
  );
  if (text(first.source_type, "source_type") !== "race_merge") {
    throw new Error("Sealed Race archive source type is invalid.");
  }
  const evidenceKind = text(first.evidence_kind, "evidence_kind");
  if (
    evidenceKind !== "staged_rows" &&
    evidenceKind !== "normalized_partition"
  ) {
    throw new Error("Sealed Race archive evidence kind is invalid.");
  }
  const partitionCount = safeInteger(
    first.evidence_partition_count,
    "evidence_partition_count",
  );
  const rowCount = safeInteger(first.evidence_row_count, "evidence_row_count");
  const byteSize = safeInteger(first.evidence_byte_size, "evidence_byte_size");
  if (
    partitionCount < 1 ||
    partitionCount !== input.rows.length ||
    partitionCount > input.maximumPartitions ||
    rowCount < 1 ||
    byteSize < 1
  ) {
    throw new Error("Sealed Race archive receipt coverage is invalid.");
  }

  let observedRows = 0;
  let observedBytes = 0;
  const objects = input.rows.map((raw, index) => {
    const row = record(raw, "sealed Race archive partition");
    if (
      uuid(text(row.import_batch_id, "import_batch_id"), "import_batch_id") !==
        importBatchId ||
      text(row.source_type, "source_type") !== "race_merge" ||
      text(row.evidence_kind, "evidence_kind") !== evidenceKind ||
      safeInteger(row.evidence_partition_count, "evidence_partition_count") !==
        partitionCount ||
      safeInteger(row.evidence_row_count, "evidence_row_count") !== rowCount ||
      safeInteger(row.evidence_byte_size, "evidence_byte_size") !== byteSize
    ) {
      throw new Error("Sealed Race archive receipt rows are inconsistent.");
    }
    const partitionNumber = safeInteger(
      row.partition_number,
      "partition_number",
    );
    if (partitionNumber !== index) {
      throw new Error("Sealed Race archive partitions are not contiguous.");
    }
    const objectFormat = text(row.object_format, "object_format");
    if (objectFormat !== "ndjson_gzip" && objectFormat !== "parquet") {
      throw new Error("Sealed Race archive object format is invalid.");
    }
    const checksumSha256 = text(row.checksum_sha256, "checksum_sha256");
    if (!SHA_256_PATTERN.test(checksumSha256)) {
      throw new Error("Sealed Race archive checksum is invalid.");
    }
    const objectRowCount = safeInteger(row.row_count, "row_count");
    const objectByteSize = safeInteger(row.byte_size, "byte_size");
    if (objectRowCount < 1 || objectByteSize < 1) {
      throw new Error("Sealed Race archive partition size is invalid.");
    }
    const firstNaturalKey = nullableNaturalKey(
      row.first_natural_key,
      "first_natural_key",
    );
    const lastNaturalKey = nullableNaturalKey(
      row.last_natural_key,
      "last_natural_key",
    );
    if ((firstNaturalKey === null) !== (lastNaturalKey === null)) {
      throw new Error("Sealed Race archive natural-key range is incomplete.");
    }
    observedRows += objectRowCount;
    observedBytes += objectByteSize;
    if (
      !Number.isSafeInteger(observedRows) ||
      !Number.isSafeInteger(observedBytes)
    ) {
      throw new Error(
        "Sealed Race archive coverage exceeds safe integer bounds.",
      );
    }
    return {
      ownerId: input.ownerId,
      importBatchId,
      sourceType: "race_merge" as const,
      objectKind: evidenceKind,
      partitionNumber,
      objectFormat,
      objectKey: text(row.object_key, "object_key"),
      checksumSha256,
      byteSize: objectByteSize,
      rowCount: objectRowCount,
      firstNaturalKey,
      lastNaturalKey,
      createdAt: timestamp(row.created_at),
    } satisfies DatasetEvidenceObjectRegistration;
  });

  if (observedRows !== rowCount || observedBytes !== byteSize) {
    throw new Error(
      "Sealed Race archive object coverage conflicts with its receipt.",
    );
  }

  return {
    datasetVersionId: input.datasetVersionId,
    importBatchId,
    sourceType: "race_merge",
    evidenceKind,
    partitionCount,
    rowCount,
    byteSize,
    objects,
  };
}

export function createNeonSealedRaceArchiveManifestRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): SealedRaceArchiveManifestRepository {
  const config = configuration(input);
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  return Object.freeze({
    async list(request) {
      const ownerId = safeOwner(request.ownerId);
      const datasetVersionId = uuid(
        request.datasetVersionId,
        "datasetVersionId",
      );
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
          datasetVersionId,
          maximumPartitions + 1,
        ]);
        const manifest = normalizeManifest({
          ownerId,
          datasetVersionId,
          maximumPartitions,
          rows: result.rows,
        });
        await session.client.query("COMMIT");
        begun = false;
        return manifest === null
          ? ({ status: "missing" } as const)
          : ({ status: "ready", manifest } as const);
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
