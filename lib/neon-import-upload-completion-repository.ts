import {
  importUploadSourceFamilies,
  type ImportUploadSourceFamily,
} from "./import-upload-intake-service";
import type {
  ImportUploadCompletionRepository,
  ReservedImportUploadObject,
  UploadCompletionClaim,
  VerifiedUploadedObject,
} from "./import-upload-completion-service";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceClient,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

type QueryResult = Readonly<{ rows: readonly unknown[] }>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_RUNTIME_ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_UPLOAD_FILES = 24;
const sourceFamilySet = new Set<ImportUploadSourceFamily>(
  importUploadSourceFamilies,
);

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
    completion_table.relrowsecurity AS completion_row_security_enabled,
    completion_table.relforcerowsecurity AS completion_force_row_security_enabled,
    dispatch_table.relrowsecurity AS dispatch_row_security_enabled,
    dispatch_table.relforcerowsecurity AS dispatch_force_row_security_enabled,
    verified_table.relrowsecurity AS verified_row_security_enabled,
    verified_table.relforcerowsecurity AS verified_force_row_security_enabled,
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
  JOIN pg_catalog.pg_class completion_table
    ON completion_table.oid = 'dna.import_upload_completion'::regclass
  JOIN pg_catalog.pg_class dispatch_table
    ON dispatch_table.oid = 'dna.import_preview_dispatch'::regclass
  JOIN pg_catalog.pg_class verified_table
    ON verified_table.oid = 'dna.import_verified_upload_object'::regclass
  JOIN pg_catalog.pg_roles runtime_role
    ON runtime_role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
`;

const CLAIM_UPLOAD_COMPLETION_SQL = `
  SELECT
    status,
    completion_id::text AS completion_id,
    upload_request_fingerprint_sha256,
    CASE
      WHEN upload_target_expires_at IS NULL THEN NULL
      ELSE to_char(
        upload_target_expires_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    END AS upload_target_expires_at,
    preview_dispatch_id::text AS preview_dispatch_id,
    file_count,
    reserved_files
  FROM dna.claim_import_upload_completion(
    $1::uuid,
    $2::uuid,
    $3::text,
    $4::character(64),
    $5::timestamptz
  )
`;

const RESERVE_PREVIEW_DISPATCH_SQL = `
  SELECT
    preview_dispatch_id::text AS preview_dispatch_id,
    disposition,
    dispatch_state,
    upload_request_fingerprint_sha256
  FROM dna.reserve_import_preview_dispatch(
    $1::uuid,
    $2::uuid,
    $3::uuid,
    $4::character(64),
    $5::timestamptz,
    $6::jsonb
  )
`;

const MARK_PREVIEW_DISPATCH_QUEUED_SQL = `
  SELECT dna.mark_import_preview_dispatch_queued(
    $1::uuid,
    $2::uuid,
    $3::uuid,
    $4::timestamptz
  )
`;

const MARK_PREVIEW_DISPATCH_FAILED_SQL = `
  SELECT dna.mark_import_preview_dispatch_failed(
    $1::uuid,
    $2::uuid,
    $3::uuid,
    $4::timestamptz
  )
`;

const RECORD_UPLOAD_VERIFICATION_FAILURE_SQL = `
  SELECT dna.record_import_upload_verification_failure(
    $1::uuid,
    $2::uuid,
    $3::uuid,
    $4::timestamptz,
    $5::text
  )
`;

export type ImportUploadCompletionRepositoryEnvironment = Readonly<{
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

function optionalString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requiredString(value, field);
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

function boundedFileCount(value: unknown, field: string): number {
  const parsed =
    typeof value === "string" && /^[0-9]+$/.test(value)
      ? Number(value)
      : value;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_UPLOAD_FILES
  ) {
    throw new Error(`${field} is invalid`);
  }
  return parsed;
}

function positiveByteLength(value: unknown, field: string): number {
  const parsed =
    typeof value === "string" && /^[0-9]+$/.test(value)
      ? Number(value)
      : value;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > 5 * 1024 * 1024 * 1024
  ) {
    throw new Error(`${field} is invalid`);
  }
  return parsed;
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
    throw new Error("Private upload completion repository owner scope denied.");
  }
  const row = record(result.rows[0], "owner isolation");
  if (
    requiredString(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    requiredString(row.authenticated_owner_id, "authenticated_owner_id") !==
      input.authenticatedOwnerId
  ) {
    throw new Error("Private upload completion repository owner scope denied.");
  }
  for (const field of [
    "batch_row_security_enabled",
    "batch_force_row_security_enabled",
    "file_row_security_enabled",
    "file_force_row_security_enabled",
    "completion_row_security_enabled",
    "completion_force_row_security_enabled",
    "dispatch_row_security_enabled",
    "dispatch_force_row_security_enabled",
    "verified_row_security_enabled",
    "verified_force_row_security_enabled",
  ] as const) {
    if (!requiredBoolean(row[field], field)) {
      throw new Error(
        "Private upload completion repository requires forced owner RLS.",
      );
    }
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
    throw new Error(
      "Private upload completion runtime role is not least privileged.",
    );
  }
}

function parseJsonArray(value: unknown, field: string): readonly unknown[] {
  const parsed =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(parsed)) {
    throw new Error(`${field} must be an array`);
  }
  return parsed;
}

function reservedFiles(value: unknown): readonly ReservedImportUploadObject[] {
  const parsed = parseJsonArray(value, "reserved_files");
  if (parsed.length < 1 || parsed.length > MAX_UPLOAD_FILES) {
    throw new Error("reserved_files count is invalid");
  }
  const fileIds = new Set<string>();
  const objectIds = new Set<string>();
  return parsed.map((item, index) => {
    const file = record(item, `reserved_files[${index}]`);
    const uploadFileId = requiredString(
      file.uploadFileId,
      `reserved_files[${index}].uploadFileId`,
    );
    const objectId = requiredString(
      file.objectId,
      `reserved_files[${index}].objectId`,
    );
    if (fileIds.has(uploadFileId) || objectIds.has(objectId)) {
      throw new Error("reserved_files identities must be unique");
    }
    fileIds.add(uploadFileId);
    objectIds.add(objectId);
    const sourceFamily = requiredString(
      file.sourceFamily,
      `reserved_files[${index}].sourceFamily`,
    ) as ImportUploadSourceFamily;
    if (!sourceFamilySet.has(sourceFamily)) {
      throw new Error(
        `reserved_files[${index}].sourceFamily is unsupported`,
      );
    }
    const expectedSha256 = requiredString(
      file.expectedSha256,
      `reserved_files[${index}].expectedSha256`,
    );
    if (!SHA_256_PATTERN.test(expectedSha256)) {
      throw new Error(
        `reserved_files[${index}].expectedSha256 is invalid`,
      );
    }
    return {
      uploadFileId,
      objectId,
      sourceFamily,
      expectedByteLength: positiveByteLength(
        file.expectedByteLength,
        `reserved_files[${index}].expectedByteLength`,
      ),
      expectedSha256,
      expectedContentType: requiredString(
        file.expectedContentType,
        `reserved_files[${index}].expectedContentType`,
      ),
    };
  });
}

function uploadCompletionClaim(row: Record<string, unknown>): UploadCompletionClaim {
  const status = requiredString(row.status, "status");
  if (status === "not_found") return { status };
  const uploadRequestFingerprint = requiredString(
    row.upload_request_fingerprint_sha256,
    "upload_request_fingerprint_sha256",
  );
  if (!SHA_256_PATTERN.test(uploadRequestFingerprint)) {
    throw new Error("upload_request_fingerprint_sha256 is invalid");
  }
  const fileCount = boundedFileCount(row.file_count, "file_count");
  if (status === "already_queued") {
    return {
      status,
      uploadBatchId: "",
      uploadRequestFingerprint,
      previewDispatchId: requiredString(
        row.preview_dispatch_id,
        "preview_dispatch_id",
      ),
      fileCount,
    };
  }
  if (status !== "claimed") {
    throw new Error("upload completion status is unsupported");
  }
  const files = reservedFiles(row.reserved_files);
  if (files.length !== fileCount) {
    throw new Error("claimed upload file count is inconsistent");
  }
  return {
    status,
    completionId: requiredString(row.completion_id, "completion_id"),
    uploadRequestFingerprint,
    uploadTargetExpiresAt: requiredString(
      row.upload_target_expires_at,
      "upload_target_expires_at",
    ),
    files,
  };
}

function persistenceFiles(files: readonly VerifiedUploadedObject[]): string {
  return JSON.stringify(
    files.map((file) => ({
      upload_file_id: file.uploadFileId,
      object_id: file.objectId,
      object_version: file.objectVersion,
      advertised_byte_length: file.advertisedByteLength,
      advertised_content_type: file.advertisedContentType,
      provider_sha256: file.providerSha256,
      scope: file.scope,
      owner_id: file.ownerId,
      upload_batch_id: file.uploadBatchId,
    })),
  );
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

export function createNeonImportUploadCompletionRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): ImportUploadCompletionRepository {
  const databaseUrl = input.databaseUrl.trim();
  if (databaseUrl === "") throw new Error("databaseUrl is required");
  const databaseOwnerId = requireDatabaseOwnerId(input.databaseOwnerId);
  const runtimeRole = requireRuntimeRole(input.runtimeRole);
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

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
    claimUploadCompletion(input) {
      return run(input.ownerId, async (client) => {
        const row = oneRow(
          await client.query(CLAIM_UPLOAD_COMPLETION_SQL, [
            databaseOwnerId,
            input.uploadBatchId,
            input.idempotencyKey,
            input.uploadRequestFingerprint,
            input.claimedAt,
          ]),
          "upload completion claim",
        );
        const claim = uploadCompletionClaim(row);
        if (claim.status === "already_queued") {
          return { ...claim, uploadBatchId: input.uploadBatchId };
        }
        return claim;
      });
    },

    reservePreviewDispatch(input) {
      return run(input.ownerId, async (client) => {
        const row = oneRow(
          await client.query(RESERVE_PREVIEW_DISPATCH_SQL, [
            databaseOwnerId,
            input.uploadBatchId,
            input.completionId,
            input.uploadRequestFingerprint,
            input.verifiedAt,
            persistenceFiles(input.files),
          ]),
          "preview dispatch reservation",
        );
        const disposition = requiredString(row.disposition, "disposition");
        if (disposition !== "created" && disposition !== "existing") {
          throw new Error("preview dispatch disposition is unsupported");
        }
        const dispatchState = requiredString(
          row.dispatch_state,
          "dispatch_state",
        );
        if (dispatchState !== "pending" && dispatchState !== "queued") {
          throw new Error("preview dispatch state is unsupported");
        }
        const uploadRequestFingerprint = requiredString(
          row.upload_request_fingerprint_sha256,
          "upload_request_fingerprint_sha256",
        );
        if (!SHA_256_PATTERN.test(uploadRequestFingerprint)) {
          throw new Error("upload_request_fingerprint_sha256 is invalid");
        }
        return {
          previewDispatchId: requiredString(
            row.preview_dispatch_id,
            "preview_dispatch_id",
          ),
          disposition,
          dispatchState,
          uploadRequestFingerprint,
        };
      });
    },

    markPreviewDispatchQueued(input) {
      return run(input.ownerId, async (client) => {
        await client.query(MARK_PREVIEW_DISPATCH_QUEUED_SQL, [
          databaseOwnerId,
          input.uploadBatchId,
          input.previewDispatchId,
          input.queuedAt,
        ]);
      });
    },

    markPreviewDispatchFailed(input) {
      return run(input.ownerId, async (client) => {
        if (input.reason !== "preview_queue_unavailable") {
          throw new Error("preview dispatch failure reason is unsupported");
        }
        await client.query(MARK_PREVIEW_DISPATCH_FAILED_SQL, [
          databaseOwnerId,
          input.uploadBatchId,
          input.previewDispatchId,
          input.failedAt,
        ]);
      });
    },

    recordUploadVerificationFailure(input) {
      return run(input.ownerId, async (client) => {
        await client.query(RECORD_UPLOAD_VERIFICATION_FAILURE_SQL, [
          databaseOwnerId,
          input.uploadBatchId,
          input.completionId,
          input.failedAt,
          input.reason,
        ]);
      });
    },
  };
}

export function neonImportUploadCompletionRepositoryFromEnvironment(
  environment: ImportUploadCompletionRepositoryEnvironment,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): ImportUploadCompletionRepository | null {
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
  return createNeonImportUploadCompletionRepository({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
