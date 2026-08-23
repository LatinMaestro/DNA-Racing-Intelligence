import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceClient,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

type QueryResult = Readonly<{ rows: readonly unknown[] }>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const sourceTypes = ["race_merge", "core_details", "current_arena"] as const;
const objectKinds = [
  "staged_rows",
  "accepted_contributions",
  "normalized_partition",
] as const;
const objectFormats = ["ndjson_gzip", "parquet"] as const;

export type DatasetEvidenceSourceType = (typeof sourceTypes)[number];
export type DatasetEvidenceObjectKind = (typeof objectKinds)[number];
export type DatasetEvidenceObjectFormat = (typeof objectFormats)[number];

export type DatasetEvidenceObjectRegistration = Readonly<{
  ownerId: string;
  importBatchId: string;
  sourceType: DatasetEvidenceSourceType;
  objectKind: DatasetEvidenceObjectKind;
  partitionNumber: number;
  objectFormat: DatasetEvidenceObjectFormat;
  objectKey: string;
  checksumSha256: string;
  byteSize: number;
  rowCount: number;
  firstNaturalKey: string | null;
  lastNaturalKey: string | null;
  createdAt: string;
}>;

export type DatasetEvidenceObjectRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      register: (input: DatasetEvidenceObjectRegistration) => Promise<
        Readonly<{
          status: "created" | "existing";
          evidenceObjectId: string;
        }>
      >;
      inspect: (
        input: DatasetEvidenceObjectRegistration,
      ) => Promise<Readonly<{ status: "missing" | "exact" | "conflict" }>>;
    }>;

export type NeonDatasetEvidenceObjectEnvironment = Readonly<{
  databaseUrl: string | undefined;
  databaseOwnerId: string | undefined;
  runtimeRole: string | undefined;
}>;

const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";

const VERIFY_ISOLATION_SQL = [
  "SELECT",
  "  owner.id::text AS database_owner_id,",
  "  owner.clerk_user_id AS authenticated_owner_id,",
  "  evidence.relrowsecurity AS evidence_rls,",
  "  evidence.relforcerowsecurity AS evidence_force_rls,",
  "  has_table_privilege(session_user, 'dna.dataset_evidence_object', 'SELECT')",
  "    AS runtime_can_read_evidence,",
  "  has_function_privilege(",
  "    session_user,",
  "    'dna.register_dataset_evidence_object(uuid,uuid,text,text,integer,text,text,character,bigint,bigint,text,text,timestamp with time zone)',",
  "    'EXECUTE'",
  "  ) AS runtime_can_register_evidence,",
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
  "JOIN pg_catalog.pg_roles role ON role.rolname = session_user",
  "WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2",
].join("\n");

const REGISTER_SQL = [
  "SELECT status, evidence_object_id::text AS evidence_object_id",
  "FROM dna.register_dataset_evidence_object(",
  "  $1::uuid, $2::uuid, $3::text, $4::text, $5::integer, $6::text,",
  "  $7::text, $8::character(64), $9::bigint, $10::bigint,",
  "  $11::text, $12::text, $13::timestamptz",
  ")",
].join("\n");

const INSPECT_SQL = [
  "SELECT CASE",
  "  WHEN count(*) = 0 THEN 'missing'",
  "  WHEN bool_and(",
  "    source_type = $3::text",
  "    AND object_format = $6::text",
  "    AND object_key = $7::text",
  "    AND checksum_sha256 = $8::character(64)",
  "    AND byte_size = $9::bigint",
  "    AND row_count = $10::bigint",
  "    AND first_natural_key IS NOT DISTINCT FROM $11::text",
  "    AND last_natural_key IS NOT DISTINCT FROM $12::text",
  "    AND created_at = $13::timestamptz",
  "  ) THEN 'exact'",
  "  ELSE 'conflict'",
  "END AS status",
  "FROM dna.dataset_evidence_object",
  "WHERE owner_id = $1::uuid",
  "  AND import_batch_id = $2::uuid",
  "  AND object_kind = $4::text",
  "  AND partition_number = $5::integer",
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
  return value;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(field + " must be boolean");
  return value;
}

function configuration(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
}) {
  const databaseUrl = input.databaseUrl.trim();
  const databaseOwnerId = input.databaseOwnerId.trim();
  const runtimeRole = input.runtimeRole.trim();
  if (!databaseUrl) throw new Error("databaseUrl is required");
  if (!UUID_PATTERN.test(databaseOwnerId)) {
    throw new Error("databaseOwnerId must be a UUID");
  }
  if (!ROLE_PATTERN.test(runtimeRole))
    throw new Error("runtimeRole is invalid");
  return { databaseUrl, databaseOwnerId, runtimeRole };
}

function boundedNaturalKey(value: string | null, field: string): string | null {
  if (value === null) return null;
  if (
    value.length < 1 ||
    value.length > 512 ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new Error(field + " is invalid");
  }
  return value;
}

function validateRegistration(
  input: DatasetEvidenceObjectRegistration,
): DatasetEvidenceObjectRegistration {
  const ownerId = input.ownerId.trim();
  const importBatchId = input.importBatchId.trim();
  const objectKey = input.objectKey.trim();
  if (!ownerId) throw new Error("ownerId is required");
  if (!UUID_PATTERN.test(importBatchId)) {
    throw new Error("importBatchId must be a UUID");
  }
  if (!sourceTypes.includes(input.sourceType)) {
    throw new Error("sourceType is unsupported");
  }
  if (!objectKinds.includes(input.objectKind)) {
    throw new Error("objectKind is unsupported");
  }
  if (!objectFormats.includes(input.objectFormat)) {
    throw new Error("objectFormat is unsupported");
  }
  if (
    !Number.isSafeInteger(input.partitionNumber) ||
    input.partitionNumber < 0 ||
    input.partitionNumber > 9999
  ) {
    throw new Error("partitionNumber is invalid");
  }
  if (
    objectKey.length < 1 ||
    objectKey.length > 1024 ||
    objectKey.startsWith("/") ||
    objectKey.split("/").includes("..") ||
    CONTROL_CHARACTER_PATTERN.test(objectKey)
  ) {
    throw new Error("objectKey is invalid");
  }
  if (!SHA_256_PATTERN.test(input.checksumSha256)) {
    throw new Error("checksumSha256 is invalid");
  }
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0) {
    throw new Error("byteSize is invalid");
  }
  if (!Number.isSafeInteger(input.rowCount) || input.rowCount <= 0) {
    throw new Error("rowCount is invalid");
  }
  const firstNaturalKey = boundedNaturalKey(
    input.firstNaturalKey,
    "firstNaturalKey",
  );
  const lastNaturalKey = boundedNaturalKey(
    input.lastNaturalKey,
    "lastNaturalKey",
  );
  if ((firstNaturalKey === null) !== (lastNaturalKey === null)) {
    throw new Error("natural key range must be complete");
  }
  if (
    input.createdAt.trim() === "" ||
    Number.isNaN(Date.parse(input.createdAt))
  ) {
    throw new Error("createdAt must be a timestamp");
  }
  return {
    ...input,
    ownerId,
    importBatchId,
    objectKey,
    firstNaturalKey,
    lastNaturalKey,
  };
}

function verifyIsolation(
  result: QueryResult,
  input: {
    databaseOwnerId: string;
    ownerId: string;
    runtimeRole: string;
  },
) {
  const row = oneRow(result, "dataset evidence object isolation");
  if (
    text(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    text(row.authenticated_owner_id, "authenticated_owner_id") !== input.ownerId
  ) {
    throw new Error("Private Preview evidence object owner scope denied.");
  }
  if (
    !bool(row.evidence_rls, "evidence_rls") ||
    !bool(row.evidence_force_rls, "evidence_force_rls")
  ) {
    throw new Error(
      "Private Preview evidence objects require forced owner RLS.",
    );
  }
  if (
    !bool(row.runtime_can_read_evidence, "runtime_can_read_evidence") ||
    !bool(row.runtime_can_register_evidence, "runtime_can_register_evidence")
  ) {
    throw new Error(
      "Private Preview evidence object runtime privileges are incomplete.",
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
    throw new Error("Private Preview runtime role is not least privileged.");
  }
}

function normalizeRegistration(row: Record<string, unknown>) {
  const status = text(row.status, "status");
  if (status !== "created" && status !== "existing") {
    throw new Error("evidence object registration status is unsupported");
  }
  const evidenceObjectId = text(row.evidence_object_id, "evidence_object_id");
  if (!UUID_PATTERN.test(evidenceObjectId)) {
    throw new Error("evidenceObjectId must be a UUID");
  }
  return { status, evidenceObjectId } as const;
}

function normalizeInspection(row: Record<string, unknown>) {
  const status = text(row.status, "status");
  if (status !== "missing" && status !== "exact" && status !== "conflict") {
    throw new Error("evidence object inspection status is unsupported");
  }
  return { status } as const;
}

async function transaction<Result>(input: {
  config: ReturnType<typeof configuration>;
  ownerId: string;
  sessionFactory: NeonImportPersistenceSessionFactory;
  operation: (client: NeonImportPersistenceClient) => Promise<Result>;
}): Promise<Result> {
  const session = await input.sessionFactory(input.config.databaseUrl);
  let begun = false;
  try {
    await session.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    begun = true;
    await session.client.query(SET_OWNER_SCOPE_SQL, [
      input.config.databaseOwnerId,
    ]);
    verifyIsolation(
      await session.client.query(VERIFY_ISOLATION_SQL, [
        input.config.databaseOwnerId,
        input.ownerId,
      ]),
      { ...input.config, ownerId: input.ownerId },
    );
    const result = await input.operation(session.client);
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

export function createNeonDatasetEvidenceObjectRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): Extract<DatasetEvidenceObjectRepository, Readonly<{ status: "ready" }>> {
  const config = configuration(input);
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;
  return {
    status: "ready",
    register(registrationInput) {
      const registration = validateRegistration(registrationInput);
      return transaction({
        config,
        ownerId: registration.ownerId,
        sessionFactory,
        operation: async (client) =>
          normalizeRegistration(
            oneRow(
              await client.query(REGISTER_SQL, [
                config.databaseOwnerId,
                registration.importBatchId,
                registration.sourceType,
                registration.objectKind,
                registration.partitionNumber,
                registration.objectFormat,
                registration.objectKey,
                registration.checksumSha256,
                registration.byteSize,
                registration.rowCount,
                registration.firstNaturalKey,
                registration.lastNaturalKey,
                registration.createdAt,
              ]),
              "dataset evidence object registration",
            ),
          ),
      });
    },
    inspect(registrationInput) {
      const registration = validateRegistration(registrationInput);
      return transaction({
        config,
        ownerId: registration.ownerId,
        sessionFactory,
        operation: async (client) =>
          normalizeInspection(
            oneRow(
              await client.query(INSPECT_SQL, [
                config.databaseOwnerId,
                registration.importBatchId,
                registration.sourceType,
                registration.objectKind,
                registration.partitionNumber,
                registration.objectFormat,
                registration.objectKey,
                registration.checksumSha256,
                registration.byteSize,
                registration.rowCount,
                registration.firstNaturalKey,
                registration.lastNaturalKey,
                registration.createdAt,
              ]),
              "dataset evidence object inspection",
            ),
          ),
      });
    },
  };
}

export function neonDatasetEvidenceObjectRepositoryFromEnvironment(
  environment: NeonDatasetEvidenceObjectEnvironment,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): DatasetEvidenceObjectRepository {
  const databaseUrl = environment.databaseUrl?.trim();
  const databaseOwnerId = environment.databaseOwnerId?.trim();
  const runtimeRole = environment.runtimeRole?.trim();
  if (!databaseUrl || !databaseOwnerId || !runtimeRole) {
    return { status: "not_configured" };
  }
  return createNeonDatasetEvidenceObjectRepository({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
