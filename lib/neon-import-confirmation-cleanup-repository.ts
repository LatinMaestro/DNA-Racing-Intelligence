import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceClient,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

type QueryResult = Readonly<{ rows: readonly unknown[] }>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATABASE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const SHA_PATTERN = /^[a-f0-9]{64}$/;
const PREVIEW_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";

const VERIFY_ISOLATION_SQL = `
  SELECT
    owner.id::text AS database_owner_id,
    owner.clerk_user_id AS authenticated_owner_id,
    cleanup.relrowsecurity AS cleanup_rls,
    cleanup.relforcerowsecurity AS cleanup_force_rls,
    has_table_privilege(
      session_user,
      'dna.import_confirmation_cleanup',
      'SELECT'
    ) AS runtime_can_read_cleanup_receipts,
    has_function_privilege(
      session_user,
      'dna.cleanup_confirmed_import_before_dispatch(uuid,uuid,character,text,character,uuid,uuid,text,timestamp with time zone)',
      'EXECUTE'
    ) AS runtime_can_cleanup_confirmation,
    session_user::text AS session_user_name,
    current_user::text AS current_user_name,
    role.rolsuper AS runtime_is_superuser,
    role.rolbypassrls AS runtime_bypasses_rls,
    role.rolcreaterole AS runtime_can_create_roles,
    role.rolcreatedb AS runtime_can_create_databases,
    COALESCE(pg_has_role(session_user, (
      SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'neon_superuser'
    ), 'MEMBER'), false) AS runtime_is_neon_superuser_member
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_class cleanup
    ON cleanup.oid = 'dna.import_confirmation_cleanup'::regclass
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
`;

const CLEANUP_SQL = `
  SELECT
    status,
    confirmation_cleanup_id::text AS confirmation_cleanup_id,
    pre_activation_cleanup_id::text AS pre_activation_cleanup_id,
    file_count,
    verified_object_count,
    staged_batch_count
  FROM dna.cleanup_confirmed_import_before_dispatch(
    $1::uuid,
    $2::uuid,
    $3::character(64),
    $4::text,
    $5::character(64),
    $6::uuid,
    $7::uuid,
    $8::text,
    $9::timestamptz
  )
`;

export type ImportConfirmationCleanupInput = Readonly<{
  ownerId: string;
  uploadBatchId: string;
  requestFingerprintSha256: string;
  previewId: string;
  previewFingerprintSha256: string;
  updateSessionId: string;
  activationDispatchId: string;
  reason: string;
  cleanedAt: string;
}>;

export type ImportConfirmationCleanupResult = Readonly<{
  status: "cleaned" | "existing";
  confirmationCleanupId: string;
  preActivationCleanupId: string;
  fileCount: number;
  verifiedObjectCount: number;
  stagedBatchCount: number;
}>;

export type ImportConfirmationCleanupRepository = Readonly<{
  cleanupBeforeDispatch: (
    input: ImportConfirmationCleanupInput,
  ) => Promise<ImportConfirmationCleanupResult>;
}>;

export type ImportConfirmationCleanupEnvironment = Readonly<{
  databaseUrl: string | undefined;
  databaseOwnerId: string | undefined;
  runtimeRole: string | undefined;
}>;

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be a database record`);
  }
  return value as Record<string, unknown>;
}

function oneRow(result: QueryResult, field: string): Record<string, unknown> {
  if (result.rows.length !== 1) {
    throw new Error(`${field} must return exactly one row`);
  }
  return record(result.rows[0], field);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean`);
  return value;
}

function count(value: unknown, field: string): number {
  const result = typeof value === "string" ? Number(value) : value;
  if (
    typeof result !== "number" ||
    !Number.isSafeInteger(result) ||
    result < 0
  ) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return result;
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
  if (!ROLE_PATTERN.test(runtimeRole)) {
    throw new Error("runtimeRole is invalid");
  }
  return { databaseUrl, databaseOwnerId, runtimeRole };
}

function validateCleanup(input: ImportConfirmationCleanupInput) {
  const ownerId = input.ownerId.trim();
  const uploadBatchId = input.uploadBatchId.trim();
  const previewId = input.previewId.trim();
  const updateSessionId = input.updateSessionId.trim();
  const activationDispatchId = input.activationDispatchId.trim();
  const reason = input.reason.trim();
  if (!ownerId) throw new Error("ownerId is required");
  if (!DATABASE_UUID_PATTERN.test(uploadBatchId)) {
    throw new Error("uploadBatchId must be a UUID");
  }
  if (!SHA_PATTERN.test(input.requestFingerprintSha256)) {
    throw new Error("requestFingerprintSha256 is invalid");
  }
  if (previewId !== input.previewId || !PREVIEW_ID_PATTERN.test(previewId)) {
    throw new Error("previewId is invalid");
  }
  if (!SHA_PATTERN.test(input.previewFingerprintSha256)) {
    throw new Error("previewFingerprintSha256 is invalid");
  }
  if (!DATABASE_UUID_PATTERN.test(updateSessionId)) {
    throw new Error("updateSessionId must be a UUID");
  }
  if (!DATABASE_UUID_PATTERN.test(activationDispatchId)) {
    throw new Error("activationDispatchId must be a UUID");
  }
  if (
    reason.length < 10 ||
    reason.length > 500 ||
    CONTROL_CHARACTER_PATTERN.test(reason)
  ) {
    throw new Error(
      "reason must contain between 10 and 500 printable characters",
    );
  }
  if (
    input.cleanedAt.trim() === "" ||
    Number.isNaN(Date.parse(input.cleanedAt))
  ) {
    throw new Error("cleanedAt must be a timestamp");
  }
  return {
    ownerId,
    uploadBatchId,
    requestFingerprintSha256: input.requestFingerprintSha256,
    previewId,
    previewFingerprintSha256: input.previewFingerprintSha256,
    updateSessionId,
    activationDispatchId,
    reason,
    cleanedAt: input.cleanedAt,
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
  const row = oneRow(result, "confirmation cleanup isolation");
  if (
    text(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    text(row.authenticated_owner_id, "authenticated_owner_id") !== input.ownerId
  ) {
    throw new Error("Private Preview confirmation cleanup owner scope denied.");
  }
  if (
    !bool(row.cleanup_rls, "cleanup_rls") ||
    !bool(row.cleanup_force_rls, "cleanup_force_rls")
  ) {
    throw new Error(
      "Private Preview confirmation cleanup requires forced owner RLS.",
    );
  }
  if (
    !bool(
      row.runtime_can_read_cleanup_receipts,
      "runtime_can_read_cleanup_receipts",
    ) ||
    !bool(
      row.runtime_can_cleanup_confirmation,
      "runtime_can_cleanup_confirmation",
    )
  ) {
    throw new Error(
      "Private Preview confirmation cleanup runtime privileges are incomplete.",
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

function normalizeResult(
  row: Record<string, unknown>,
): ImportConfirmationCleanupResult {
  const status = text(row.status, "status");
  if (status !== "cleaned" && status !== "existing") {
    throw new Error("confirmation cleanup status is unsupported");
  }
  const confirmationCleanupId = text(
    row.confirmation_cleanup_id,
    "confirmation_cleanup_id",
  );
  const preActivationCleanupId = text(
    row.pre_activation_cleanup_id,
    "pre_activation_cleanup_id",
  );
  if (!DATABASE_UUID_PATTERN.test(confirmationCleanupId)) {
    throw new Error("confirmation_cleanup_id must be a UUID");
  }
  if (!DATABASE_UUID_PATTERN.test(preActivationCleanupId)) {
    throw new Error("pre_activation_cleanup_id must be a UUID");
  }
  const fileCount = count(row.file_count, "file_count");
  const verifiedObjectCount = count(
    row.verified_object_count,
    "verified_object_count",
  );
  const stagedBatchCount = count(row.staged_batch_count, "staged_batch_count");
  if (
    fileCount < 1 ||
    fileCount > 24 ||
    verifiedObjectCount > fileCount ||
    stagedBatchCount > fileCount
  ) {
    throw new Error("confirmation cleanup counts are inconsistent");
  }
  return {
    status,
    confirmationCleanupId,
    preActivationCleanupId,
    fileCount,
    verifiedObjectCount,
    stagedBatchCount,
  };
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

export function createNeonImportConfirmationCleanupRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): ImportConfirmationCleanupRepository {
  const config = configuration(input);
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  return {
    cleanupBeforeDispatch(cleanupInput) {
      const cleanup = validateCleanup(cleanupInput);
      return transaction({
        config,
        ownerId: cleanup.ownerId,
        sessionFactory,
        operation: async (client) =>
          normalizeResult(
            oneRow(
              await client.query(CLEANUP_SQL, [
                config.databaseOwnerId,
                cleanup.uploadBatchId,
                cleanup.requestFingerprintSha256,
                cleanup.previewId,
                cleanup.previewFingerprintSha256,
                cleanup.updateSessionId,
                cleanup.activationDispatchId,
                cleanup.reason,
                cleanup.cleanedAt,
              ]),
              "confirmation cleanup",
            ),
          ),
      });
    },
  };
}

export function neonImportConfirmationCleanupRepositoryFromEnvironment(
  environment: ImportConfirmationCleanupEnvironment,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): ImportConfirmationCleanupRepository | null {
  const databaseUrl = environment.databaseUrl?.trim();
  const databaseOwnerId = environment.databaseOwnerId?.trim();
  const runtimeRole = environment.runtimeRole?.trim();
  if (!databaseUrl || !databaseOwnerId || !runtimeRole) return null;
  return createNeonImportConfirmationCleanupRepository({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
