import type { AcceptedDatasetPreparationRepository } from "./bounded-accepted-dataset-processor";
import type {
  ImportActivationRepository,
  PrivateRawUploadStore,
} from "./import-activation-service";
import type {
  BackgroundDispatchClaim,
  BackgroundImportProcessingRepository,
} from "./import-background-processing-service";
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

const VERIFY_ISOLATION_SQL = `
  SELECT owner.id::text AS database_owner_id,
    owner.clerk_user_id AS authenticated_owner_id,
    dispatch.relrowsecurity AS dispatch_rls,
    dispatch.relforcerowsecurity AS dispatch_force_rls,
    processing.relrowsecurity AS processing_rls,
    processing.relforcerowsecurity AS processing_force_rls,
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
  JOIN pg_catalog.pg_class dispatch
    ON dispatch.oid = 'dna.import_activation_dispatch'::regclass
  JOIN pg_catalog.pg_class processing
    ON processing.oid = 'dna.import_activation_processing'::regclass
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid
    AND ($2::text IS NULL OR owner.clerk_user_id = $2)
`;

const ASSERT_READINESS_SQL = `
  SELECT dna.assert_import_activation_ready(
    $1::uuid, $2::text, $3::character(64)
  )
`;

const RESERVE_SQL = `
  SELECT disposition, update_session_id::text AS update_session_id,
    dispatch_id::text AS dispatch_id, dispatch_state
  FROM dna.reserve_import_activation(
    $1::uuid, $2::text, $3::character(64), $4::text, $5::timestamptz
  )
`;
const MARK_QUEUED_SQL = `
  SELECT dna.mark_import_activation_dispatch_queued(
    $1::uuid, $2::uuid, $3::uuid, $4::timestamptz
  )
`;
const MARK_DISPATCH_FAILED_SQL = `
  SELECT dna.mark_import_activation_dispatch_failed(
    $1::uuid, $2::uuid, $3::uuid, $4::timestamptz
  )
`;
const CLAIM_SQL = `
  SELECT status, authenticated_owner_id,
    update_session_id::text AS update_session_id,
    preview_fingerprint_sha256,
    CASE WHEN retry_after IS NULL THEN NULL ELSE to_char(
      retry_after AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ) END AS retry_after
  FROM dna.claim_import_activation_dispatch(
    $1::uuid, $2::uuid, $3::text, $4::timestamptz, $5::timestamptz
  )
`;
const LIST_AGGREGATE_REFRESHES_SQL = `
  SELECT refresh_id::text AS refresh_id
  FROM dna.list_import_activation_aggregate_refreshes(
    $1::uuid, $2::uuid, $3::uuid, $4::integer
  )
`;

const ACTIVATE_SQL = `
  SELECT dna.complete_import_activation(
    $1::uuid, $2::uuid, $3::uuid, $4::text, $5::timestamptz,
    $6::integer, $7::bigint, $8::boolean
  )
`;
const PREPARE_ACCEPTED_DATASET_SQL = `
  SELECT prepared_result_id, source_version_count,
    quarantined_record_count, aggregate_refresh_required
  FROM dna.prepare_import_activation_dataset(
    $1::uuid, $2::uuid, $3::uuid, $4::character(64), $5::integer
  )
`;
const COMPACT_ACCEPTED_DATASET_SQL = `
  SELECT status, source_version_count, deleted_staged_record_count,
    deleted_contribution_count
  FROM dna.compact_import_activation_dataset_evidence(
    $1::uuid, $2::uuid, $3::uuid, clock_timestamp(), $4::integer
  )
`;
const PROCESSING_FAILURE_SQL = `
  SELECT dna.record_import_activation_failure(
    $1::uuid, $2::uuid, $3::uuid, $4::text, $5::timestamptz
  )
`;

export type ImportActivationDatabaseEnvironment = Readonly<{
  databaseUrl: string | undefined;
  databaseOwnerId: string | undefined;
  runtimeRole: string | undefined;
}>;

export type NeonImportActivationRepositories = Readonly<{
  activationRepository: ImportActivationRepository;
  readinessStore: PrivateRawUploadStore;
  processingRepository: BackgroundImportProcessingRepository;
  preparationRepository: AcceptedDatasetPreparationRepository;
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

function sha(value: unknown, field: string): string {
  const result = string(value, field);
  if (!SHA_PATTERN.test(result)) throw new Error(`${field} is invalid`);
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
    throw new Error("Private Preview activation owner scope denied.");
  }
  for (const field of [
    "dispatch_rls",
    "dispatch_force_rls",
    "processing_rls",
    "processing_force_rls",
  ]) {
    if (!bool(row[field], field)) {
      throw new Error("Private Preview activation requires forced owner RLS.");
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
  config: ReturnType<typeof configuration>;
  ownerId: string | null;
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

function normalizeClaim(row: Record<string, unknown>): BackgroundDispatchClaim {
  const status = string(row.status, "status");
  if (status === "not_found") return { status };
  if (status === "already_complete") {
    return {
      status,
      ownerId: string(row.authenticated_owner_id, "authenticated_owner_id"),
      updateSessionId: string(row.update_session_id, "update_session_id"),
    };
  }
  if (status === "leased_elsewhere") {
    return { status, retryAfter: string(row.retry_after, "retry_after") };
  }
  if (status !== "claimed")
    throw new Error("activation claim status is unsupported");
  return {
    status,
    ownerId: string(row.authenticated_owner_id, "authenticated_owner_id"),
    updateSessionId: string(row.update_session_id, "update_session_id"),
    previewFingerprintSha256: sha(
      row.preview_fingerprint_sha256,
      "preview_fingerprint_sha256",
    ),
  };
}

export function createNeonImportActivationRepositories(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): NeonImportActivationRepositories {
  const config = configuration(input);
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;
  const run = <Result>(
    ownerId: string | null,
    operation: (client: NeonImportPersistenceClient) => Promise<Result>,
  ) => transaction({ config, ownerId, sessionFactory, operation });

  const activationRepository: ImportActivationRepository = {
    reserveConfirmedUpdate(input) {
      return run(input.ownerId, async (client) => {
        const row = oneRow(
          await client.query(RESERVE_SQL, [
            config.databaseOwnerId,
            input.previewId,
            input.previewFingerprintSha256,
            input.idempotencyKey,
            input.confirmedAt,
          ]),
          "activation reservation",
        );
        const disposition = string(row.disposition, "disposition");
        const dispatchState = string(row.dispatch_state, "dispatch_state");
        if (disposition !== "created" && disposition !== "existing") {
          throw new Error("activation reservation disposition is unsupported");
        }
        if (dispatchState !== "pending" && dispatchState !== "queued") {
          throw new Error("activation dispatch state is unsupported");
        }
        return {
          disposition,
          dispatchState,
          updateSessionId: string(row.update_session_id, "update_session_id"),
          dispatchId: string(row.dispatch_id, "dispatch_id"),
        };
      });
    },
    markDispatchQueued(input) {
      return run(input.ownerId, async (client) => {
        await client.query(MARK_QUEUED_SQL, [
          config.databaseOwnerId,
          input.updateSessionId,
          input.dispatchId,
          input.queuedAt,
        ]);
      });
    },
    markDispatchFailed(input) {
      if (input.reason !== "queue_unavailable") {
        throw new Error("activation dispatch failure reason is unsupported");
      }
      return run(input.ownerId, async (client) => {
        await client.query(MARK_DISPATCH_FAILED_SQL, [
          config.databaseOwnerId,
          input.updateSessionId,
          input.dispatchId,
          input.failedAt,
        ]);
      });
    },
  };

  const readinessStore: PrivateRawUploadStore = {
    assertPreviewUploadsReady(input) {
      return run(input.ownerId, async (client) => {
        await client.query(ASSERT_READINESS_SQL, [
          config.databaseOwnerId,
          input.previewId,
          input.previewFingerprintSha256,
        ]);
      });
    },
  };

  const processingRepository: BackgroundImportProcessingRepository = {
    claimDispatch(input) {
      return run(null, async (client) =>
        normalizeClaim(
          oneRow(
            await client.query(CLAIM_SQL, [
              config.databaseOwnerId,
              input.dispatchId,
              input.workerId,
              input.claimedAt,
              input.leaseExpiresAt,
            ]),
            "activation claim",
          ),
        ),
      );
    },
    listAggregateRefreshIds(input) {
      return run(input.ownerId, async (client) => {
        const result = await client.query(LIST_AGGREGATE_REFRESHES_SQL, [
          config.databaseOwnerId,
          input.updateSessionId,
          input.dispatchId,
          input.maximumRefreshes,
        ]);
        return result.rows.map((value, index) =>
          string(
            record(value, `aggregate refresh[${index}]`).refresh_id,
            `aggregate refresh[${index}].refresh_id`,
          ),
        );
      });
    },
    activatePreparedResult(input) {
      return run(input.ownerId, async (client) => {
        await client.query(ACTIVATE_SQL, [
          config.databaseOwnerId,
          input.updateSessionId,
          input.dispatchId,
          input.preparedResultId,
          input.completedAt,
          input.sourceVersionCount,
          input.quarantinedRecordCount,
          input.aggregateRefreshRequired,
        ]);
      });
    },
    recordProcessingFailure(input) {
      if (input.reason !== "processor_failed") {
        throw new Error("activation processing failure reason is unsupported");
      }
      return run(input.ownerId, async (client) => {
        await client.query(PROCESSING_FAILURE_SQL, [
          config.databaseOwnerId,
          input.updateSessionId,
          input.dispatchId,
          input.workerId,
          input.failedAt,
        ]);
      });
    },
  };

  const preparationRepository: AcceptedDatasetPreparationRepository = {
    prepareAcceptedDataset(input) {
      return run(input.ownerId, async (client) => {
        const row = oneRow(
          await client.query(PREPARE_ACCEPTED_DATASET_SQL, [
            config.databaseOwnerId,
            input.updateSessionId,
            input.dispatchId,
            input.previewFingerprintSha256,
            input.maximumSourceVersions,
          ]),
          "accepted dataset preparation",
        );
        const sourceVersionCount = count(
          row.source_version_count,
          "source_version_count",
        );
        const compaction = oneRow(
          await client.query(COMPACT_ACCEPTED_DATASET_SQL, [
            config.databaseOwnerId,
            input.updateSessionId,
            input.dispatchId,
            input.maximumSourceVersions,
          ]),
          "accepted dataset compaction",
        );
        const compactionStatus = string(compaction.status, "compaction.status");
        if (
          (compactionStatus !== "compacted" &&
            compactionStatus !== "existing") ||
          count(
            compaction.source_version_count,
            "compaction.source_version_count",
          ) !== sourceVersionCount
        ) {
          throw new Error("accepted dataset compaction evidence is invalid");
        }
        count(
          compaction.deleted_staged_record_count,
          "compaction.deleted_staged_record_count",
        );
        count(
          compaction.deleted_contribution_count,
          "compaction.deleted_contribution_count",
        );
        return {
          preparedResultId: string(
            row.prepared_result_id,
            "prepared_result_id",
          ),
          sourceVersionCount,
          quarantinedRecordCount: count(
            row.quarantined_record_count,
            "quarantined_record_count",
          ),
          aggregateRefreshRequired: bool(
            row.aggregate_refresh_required,
            "aggregate_refresh_required",
          ),
        };
      });
    },
  };

  return {
    activationRepository,
    readinessStore,
    processingRepository,
    preparationRepository,
  };
}

export function neonImportActivationRepositoriesFromEnvironment(
  environment: ImportActivationDatabaseEnvironment,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): NeonImportActivationRepositories | null {
  const databaseUrl = environment.databaseUrl?.trim();
  const databaseOwnerId = environment.databaseOwnerId?.trim();
  const runtimeRole = environment.runtimeRole?.trim();
  if (!databaseUrl || !databaseOwnerId || !runtimeRole) return null;
  return createNeonImportActivationRepositories({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
