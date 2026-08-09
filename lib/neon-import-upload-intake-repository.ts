import type {
  ImportUploadCandidate,
  ImportUploadIntakeRepository,
  ReservedImportUpload,
} from "./import-upload-intake-service";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSession,
  NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

type QueryResult = Readonly<{ rows: readonly unknown[] }>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_RUNTIME_ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;

const SET_OWNER_SCOPE_SQL = `
  SELECT set_config('app.owner_id', $1, true) AS owner_scope
`;

const VERIFY_OWNER_ISOLATION_SQL = `
  SELECT
    owner.id::text AS database_owner_id,
    owner.clerk_user_id AS authenticated_owner_id,
    batch_table.relrowsecurity AS batch_row_security_enabled,
    batch_table.relforcerowsecurity AS batch_force_row_security_enabled,
    file_table.relrowsecurity AS file_row_security_enabled,
    file_table.relforcerowsecurity AS file_force_row_security_enabled,
    session_user::text AS session_user_name,
    current_user::text AS current_user_name,
    runtime_role.rolsuper AS runtime_is_superuser,
    runtime_role.rolbypassrls AS runtime_bypasses_rls,
    runtime_role.rolcreaterole AS runtime_can_create_roles,
    runtime_role.rolcreatedb AS runtime_can_create_databases,
    COALESCE(
      pg_has_role(
        session_user,
        (
          SELECT role.oid
          FROM pg_catalog.pg_roles role
          WHERE role.rolname = 'neon_superuser'
        ),
        'MEMBER'
      ),
      false
    ) AS runtime_is_neon_superuser_member
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_class batch_table
    ON batch_table.oid = 'dna.import_upload_batch'::regclass
  JOIN pg_catalog.pg_class file_table
    ON file_table.oid = 'dna.import_upload_file'::regclass
  JOIN pg_catalog.pg_roles runtime_role
    ON runtime_role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
`;

const RESERVE_UPLOAD_BATCH_SQL = `
  SELECT
    disposition,
    upload_batch_id::text AS upload_batch_id,
    request_fingerprint_sha256,
    reserved_files
  FROM dna.reserve_import_upload_batch(
    $1::uuid,
    $2::text,
    $3::character(64),
    $4::timestamptz,
    $5::jsonb
  )
`;

const MARK_UPLOAD_TARGETS_READY_SQL = `
  SELECT dna.mark_import_upload_targets_ready(
    $1::uuid,
    $2::uuid,
    $3::uuid[],
    $4::character(64),
    $5::timestamptz
  )
`;

const MARK_UPLOAD_RESERVATION_FAILED_SQL = `
  SELECT dna.mark_import_upload_reservation_failed(
    $1::uuid,
    $2::uuid,
    $3::character(64),
    $4::timestamptz
  )
`;

export type ImportUploadRepositoryEnvironment = Readonly<{
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

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

function normalized(value: string | undefined): string | null {
  const result = value?.trim() ?? "";
  return result === "" ? null : result;
}

function requireDatabaseOwnerId(value: string): string {
  const result = value.trim();
  if (!UUID_PATTERN.test(result)) {
    throw new Error("databaseOwnerId must be a UUID");
  }
  return result;
}

function requireRuntimeRole(value: string): string {
  const result = value.trim();
  if (!SAFE_RUNTIME_ROLE_PATTERN.test(result)) {
    throw new Error("runtimeRole is invalid");
  }
  return result;
}

function verifyOwnerIsolation(
  result: QueryResult,
  input: {
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    runtimeRole: string;
  },
): void {
  if (result.rows.length !== 1) {
    throw new Error("Private upload repository owner scope denied.");
  }
  const row = record(result.rows[0], "owner isolation");
  if (
    requiredString(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    requiredString(row.authenticated_owner_id, "authenticated_owner_id") !==
      input.authenticatedOwnerId
  ) {
    throw new Error("Private upload repository owner scope denied.");
  }
  if (
    !requiredBoolean(
      row.batch_row_security_enabled,
      "batch_row_security_enabled",
    ) ||
    !requiredBoolean(
      row.batch_force_row_security_enabled,
      "batch_force_row_security_enabled",
    ) ||
    !requiredBoolean(
      row.file_row_security_enabled,
      "file_row_security_enabled",
    ) ||
    !requiredBoolean(
      row.file_force_row_security_enabled,
      "file_force_row_security_enabled",
    )
  ) {
    throw new Error("Private upload repository requires forced owner RLS.");
  }
  if (
    requiredString(row.session_user_name, "session_user_name") !==
      input.runtimeRole ||
    requiredString(row.current_user_name, "current_user_name") !==
      input.runtimeRole ||
    requiredBoolean(row.runtime_is_superuser, "runtime_is_superuser") ||
    requiredBoolean(row.runtime_bypasses_rls, "runtime_bypasses_rls") ||
    requiredBoolean(row.runtime_can_create_roles, "runtime_can_create_roles") ||
    requiredBoolean(
      row.runtime_can_create_databases,
      "runtime_can_create_databases",
    ) ||
    requiredBoolean(
      row.runtime_is_neon_superuser_member,
      "runtime_is_neon_superuser_member",
    )
  ) {
    throw new Error("Private upload runtime role is not least privileged.");
  }
}

function reservedFiles(value: unknown): readonly ReservedImportUpload[] {
  const parsed =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(parsed)) {
    throw new Error("reserved_files must be an array");
  }
  return parsed.map((item, index) => {
    const file = record(item, `reserved_files[${index}]`);
    return {
      clientFileId: requiredString(
        file.clientFileId,
        `reserved_files[${index}].clientFileId`,
      ),
      uploadFileId: requiredString(
        file.uploadFileId,
        `reserved_files[${index}].uploadFileId`,
      ),
    };
  });
}

function persistenceFiles(files: readonly ImportUploadCandidate[]): string {
  return JSON.stringify(
    files.map((file) => ({
      client_file_id: file.clientFileId,
      source_family: file.sourceFamily,
      original_file_name: file.originalFileName,
      content_type: file.contentType,
      byte_length: file.byteLength,
      sha256: file.sha256,
    })),
  );
}

async function defaultSessionFactory(
  databaseUrl: string,
): Promise<NeonImportPersistenceSession> {
  const { Pool } = await import("@neondatabase/serverless");
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  try {
    const client = await pool.connect();
    return {
      client,
      async close() {
        client.release();
        await pool.end();
      },
    };
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
}

async function ownerTransaction<Result>(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  authenticatedOwnerId: string;
  sessionFactory: NeonImportPersistenceSessionFactory;
  operation: (client: NeonImportPersistenceClient) => Promise<Result>;
}): Promise<Result> {
  const session = await input.sessionFactory(input.databaseUrl);
  let transactionStarted = false;
  try {
    await session.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    transactionStarted = true;
    await session.client.query(SET_OWNER_SCOPE_SQL, [input.databaseOwnerId]);
    verifyOwnerIsolation(
      await session.client.query(VERIFY_OWNER_ISOLATION_SQL, [
        input.databaseOwnerId,
        input.authenticatedOwnerId,
      ]),
      input,
    );
    const result = await input.operation(session.client);
    await session.client.query("COMMIT");
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      await session.client.query("ROLLBACK").catch(() => undefined);
    }
    throw error;
  } finally {
    await session.close();
  }
}

export function createNeonImportUploadIntakeRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): ImportUploadIntakeRepository {
  const databaseUrl = input.databaseUrl.trim();
  if (databaseUrl === "") throw new Error("databaseUrl is required");
  const databaseOwnerId = requireDatabaseOwnerId(input.databaseOwnerId);
  const runtimeRole = requireRuntimeRole(input.runtimeRole);
  const sessionFactory = input.sessionFactory ?? defaultSessionFactory;

  const run = <Result>(
    authenticatedOwnerId: string,
    operation: (client: NeonImportPersistenceClient) => Promise<Result>,
  ) => {
    const ownerId = authenticatedOwnerId.trim();
    if (ownerId === "") throw new Error("ownerId is required");
    return ownerTransaction({
      databaseUrl,
      databaseOwnerId,
      runtimeRole,
      authenticatedOwnerId: ownerId,
      sessionFactory,
      operation,
    });
  };

  return {
    reserveUploadBatch(input) {
      return run(input.ownerId, async (client) => {
        const row = oneRow(
          await client.query(RESERVE_UPLOAD_BATCH_SQL, [
            databaseOwnerId,
            input.idempotencyKey,
            input.requestFingerprint,
            input.requestedAt,
            persistenceFiles(input.files),
          ]),
          "upload batch reservation",
        );
        const disposition = requiredString(row.disposition, "disposition");
        if (disposition !== "created" && disposition !== "existing") {
          throw new Error("disposition is unsupported");
        }
        const requestFingerprint = requiredString(
          row.request_fingerprint_sha256,
          "request_fingerprint_sha256",
        );
        if (!SHA_256_PATTERN.test(requestFingerprint)) {
          throw new Error("request_fingerprint_sha256 is invalid");
        }
        return {
          disposition,
          uploadBatchId: requiredString(row.upload_batch_id, "upload_batch_id"),
          requestFingerprint,
          files: reservedFiles(row.reserved_files),
        };
      });
    },

    markUploadTargetsReady(input) {
      return run(input.ownerId, async (client) => {
        await client.query(MARK_UPLOAD_TARGETS_READY_SQL, [
          databaseOwnerId,
          input.uploadBatchId,
          input.uploadFileIds,
          input.requestFingerprint,
          input.expiresAt,
        ]);
      });
    },

    markUploadReservationFailed(input) {
      return run(input.ownerId, async (client) => {
        if (input.reason !== "private_object_target_unavailable") {
          throw new Error("upload reservation failure reason is unsupported");
        }
        await client.query(MARK_UPLOAD_RESERVATION_FAILED_SQL, [
          databaseOwnerId,
          input.uploadBatchId,
          input.requestFingerprint,
          input.failedAt,
        ]);
      });
    },
  };
}

export function neonImportUploadIntakeRepositoryFromEnvironment(
  environment: ImportUploadRepositoryEnvironment,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): ImportUploadIntakeRepository | null {
  const databaseUrl = normalized(environment.databaseUrl);
  const databaseOwnerId = normalized(environment.databaseOwnerId);
  const runtimeRole = normalized(environment.runtimeRole);
  if (
    databaseUrl === null ||
    databaseOwnerId === null ||
    runtimeRole === null
  ) {
    return null;
  }
  return createNeonImportUploadIntakeRepository({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
