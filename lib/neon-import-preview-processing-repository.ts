import type {
  ImportPreviewDispatchClaim,
  ImportPreviewProcessingRepository,
  PreviewObjectReference,
} from "./import-preview-processing-service";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceClient,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

type QueryResult = Readonly<{ rows: readonly unknown[] }>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const SHA_PATTERN = /^[a-f0-9]{64}$/;

const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";

const VERIFY_OWNER_ISOLATION_SQL = `
  SELECT owner.id::text AS database_owner_id,
    owner.clerk_user_id AS authenticated_owner_id,
    processing.relrowsecurity AS processing_rls,
    processing.relforcerowsecurity AS processing_force_rls,
    prepared.relrowsecurity AS prepared_rls,
    prepared.relforcerowsecurity AS prepared_force_rls,
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
  JOIN pg_catalog.pg_class processing
    ON processing.oid = 'dna.import_preview_processing'::regclass
  JOIN pg_catalog.pg_class prepared
    ON prepared.oid = 'dna.import_prepared_preview'::regclass
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid
    AND ($2::text IS NULL OR owner.clerk_user_id = $2)
`;

const CLAIM_SQL = `
  SELECT status, authenticated_owner_id,
    upload_batch_id::text AS upload_batch_id,
    upload_request_fingerprint_sha256,
    upload_manifest_fingerprint_sha256,
    CASE WHEN retry_after IS NULL THEN NULL ELSE to_char(
      retry_after AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ) END AS retry_after,
    preview_id, preview_fingerprint_sha256, confirmable, files
  FROM dna.claim_import_preview_dispatch(
    $1::uuid, $2::uuid, $3::text, $4::character(64),
    $5::timestamptz, $6::timestamptz
  )
`;

const PUBLISH_SQL = `
  SELECT disposition, upload_request_fingerprint_sha256,
    upload_manifest_fingerprint_sha256, preview_id,
    preview_fingerprint_sha256, confirmable
  FROM dna.publish_import_prepared_preview(
    $1::uuid, $2::uuid, $3::uuid, $4::character(64),
    $5::character(64), $6::text, $7::character(64),
    $8::integer, $9::integer, $10::integer, $11::boolean, $12::timestamptz
  )
`;

const FAILURE_SQL = `
  SELECT dna.record_import_preview_processing_failure(
    $1::uuid, $2::uuid, $3::uuid, $4::text,
    $5::character(64), $6::timestamptz
  )
`;

export type ImportPreviewProcessingRepositoryEnvironment = Readonly<{
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

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function sha(value: unknown, field: string): string {
  const result = string(value, field);
  if (!SHA_PATTERN.test(result)) throw new Error(`${field} is invalid`);
  return result;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean`);
  return value;
}

function files(value: unknown): readonly PreviewObjectReference[] {
  const parsed =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 24) {
    throw new Error("files count is invalid");
  }
  return parsed.map((item, index) => {
    const row = record(item, `files[${index}]`);
    const expectedByteLength =
      typeof row.expectedByteLength === "string"
        ? Number(row.expectedByteLength)
        : row.expectedByteLength;
    if (
      typeof expectedByteLength !== "number" ||
      !Number.isSafeInteger(expectedByteLength) ||
      expectedByteLength < 1
    ) {
      throw new Error(`files[${index}].expectedByteLength is invalid`);
    }
    const sourceFamily = string(
      row.sourceFamily,
      `files[${index}].sourceFamily`,
    );
    if (
      sourceFamily !== "race_merge" &&
      sourceFamily !== "core_details" &&
      sourceFamily !== "current_arena"
    ) {
      throw new Error(`files[${index}].sourceFamily is invalid`);
    }
    return {
      uploadFileId: string(row.uploadFileId, `files[${index}].uploadFileId`),
      objectId: string(row.objectId, `files[${index}].objectId`),
      sourceFamily,
      expectedByteLength,
      expectedSha256: sha(row.expectedSha256, `files[${index}].expectedSha256`),
    };
  });
}

function claim(row: Record<string, unknown>): ImportPreviewDispatchClaim {
  const status = string(row.status, "status");
  if (status === "not_found") return { status };
  const uploadRequestFingerprint = sha(
    row.upload_request_fingerprint_sha256,
    "upload_request_fingerprint_sha256",
  );
  if (status === "leased_elsewhere") {
    return {
      status,
      uploadRequestFingerprint,
      retryAfter: string(row.retry_after, "retry_after"),
    };
  }
  const uploadBatchId = string(row.upload_batch_id, "upload_batch_id");
  if (status === "already_complete") {
    return {
      status,
      uploadBatchId,
      uploadRequestFingerprint,
      previewId: string(row.preview_id, "preview_id"),
      previewFingerprintSha256: sha(
        row.preview_fingerprint_sha256,
        "preview_fingerprint_sha256",
      ),
      confirmable: bool(row.confirmable, "confirmable"),
    };
  }
  if (status !== "claimed") {
    throw new Error("preview processing status is unsupported");
  }
  return {
    status,
    ownerId: string(row.authenticated_owner_id, "authenticated_owner_id"),
    uploadBatchId,
    uploadRequestFingerprint,
    uploadManifestFingerprintSha256: sha(
      row.upload_manifest_fingerprint_sha256,
      "upload_manifest_fingerprint_sha256",
    ),
    files: files(row.files),
  };
}

function requireConfiguration(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
}) {
  const databaseUrl = input.databaseUrl.trim();
  const databaseOwnerId = input.databaseOwnerId.trim();
  const runtimeRole = input.runtimeRole.trim();
  if (databaseUrl === "") throw new Error("databaseUrl is required");
  if (!UUID_PATTERN.test(databaseOwnerId)) {
    throw new Error("databaseOwnerId must be a UUID");
  }
  if (!ROLE_PATTERN.test(runtimeRole))
    throw new Error("runtimeRole is invalid");
  return { databaseUrl, databaseOwnerId, runtimeRole };
}

function verifyIsolation(
  result: QueryResult,
  input: {
    databaseOwnerId: string;
    ownerId: string | null;
    runtimeRole: string;
  },
) {
  const row = oneRow(result, "owner isolation");
  if (
    string(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    (input.ownerId !== null &&
      string(row.authenticated_owner_id, "authenticated_owner_id") !==
        input.ownerId)
  ) {
    throw new Error("Private Preview repository owner scope denied.");
  }
  for (const field of [
    "processing_rls",
    "processing_force_rls",
    "prepared_rls",
    "prepared_force_rls",
  ]) {
    if (!bool(row[field], field)) {
      throw new Error("Private Preview repository requires forced owner RLS.");
    }
  }
  if (
    string(row.session_user_name, "session_user_name") !== input.runtimeRole ||
    string(row.current_user_name, "current_user_name") !== input.runtimeRole ||
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

async function transaction<Result>(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  ownerId: string | null;
  sessionFactory: NeonImportPersistenceSessionFactory;
  operation: (client: NeonImportPersistenceClient) => Promise<Result>;
}): Promise<Result> {
  const session = await input.sessionFactory(input.databaseUrl);
  let begun = false;
  try {
    await session.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    begun = true;
    await session.client.query(SET_OWNER_SCOPE_SQL, [input.databaseOwnerId]);
    verifyIsolation(
      await session.client.query(VERIFY_OWNER_ISOLATION_SQL, [
        input.databaseOwnerId,
        input.ownerId,
      ]),
      input,
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

export function createNeonImportPreviewProcessingRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): ImportPreviewProcessingRepository {
  const configuration = requireConfiguration(input);
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;
  const run = <Result>(
    ownerId: string | null,
    operation: (client: NeonImportPersistenceClient) => Promise<Result>,
  ) =>
    transaction({
      ...configuration,
      ownerId: ownerId?.trim() ?? null,
      sessionFactory,
      operation,
    });

  return {
    claimPreviewDispatch(input) {
      return run(null, async (client) => {
        // The database maps the authenticated owner from the configured UUID.
        const row = oneRow(
          await client.query(CLAIM_SQL, [
            configuration.databaseOwnerId,
            input.previewDispatchId,
            input.workerId,
            input.uploadRequestFingerprint,
            input.claimedAt,
            input.leaseExpiresAt,
          ]),
          "preview claim",
        );
        return claim(row);
      });
    },
    publishPreparedPreview(input) {
      return run(input.ownerId, async (client) => {
        const row = oneRow(
          await client.query(PUBLISH_SQL, [
            configuration.databaseOwnerId,
            input.uploadBatchId,
            input.previewDispatchId,
            input.uploadRequestFingerprint,
            input.uploadManifestFingerprintSha256,
            input.previewId,
            input.previewFingerprintSha256,
            input.fileCount,
            input.sourceFamilyCount,
            input.blockingIssueCount,
            input.confirmable,
            input.completedAt,
          ]),
          "preview publication",
        );
        const disposition = string(row.disposition, "disposition");
        if (disposition !== "created" && disposition !== "existing") {
          throw new Error("preview publication disposition is unsupported");
        }
        return {
          disposition,
          uploadRequestFingerprint: sha(
            row.upload_request_fingerprint_sha256,
            "upload_request_fingerprint_sha256",
          ),
          uploadManifestFingerprintSha256: sha(
            row.upload_manifest_fingerprint_sha256,
            "upload_manifest_fingerprint_sha256",
          ),
          previewId: string(row.preview_id, "preview_id"),
          previewFingerprintSha256: sha(
            row.preview_fingerprint_sha256,
            "preview_fingerprint_sha256",
          ),
          confirmable: bool(row.confirmable, "confirmable"),
        };
      });
    },
    recordPreviewFailure(input) {
      return run(input.ownerId, async (client) => {
        if (input.reason !== "preview_processor_failed") {
          throw new Error("preview failure reason is unsupported");
        }
        await client.query(FAILURE_SQL, [
          configuration.databaseOwnerId,
          input.uploadBatchId,
          input.previewDispatchId,
          input.workerId,
          input.uploadRequestFingerprint,
          input.failedAt,
        ]);
      });
    },
  };
}

export function neonImportPreviewProcessingRepositoryFromEnvironment(
  environment: ImportPreviewProcessingRepositoryEnvironment,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): ImportPreviewProcessingRepository | null {
  const databaseUrl = environment.databaseUrl?.trim();
  const databaseOwnerId = environment.databaseOwnerId?.trim();
  const runtimeRole = environment.runtimeRole?.trim();
  if (!databaseUrl || !databaseOwnerId || !runtimeRole) return null;
  return createNeonImportPreviewProcessingRepository({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
