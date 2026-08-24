import type { StagedSourceSchema } from "@/domain/source-schema";
import type {
  DurableImportPreviewStagingRepository,
  DurablePreviewObjectResult,
  DurablePreviewStagedRow,
} from "./durable-import-preview-staging-sink";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceClient,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const SHA_PATTERN = /^[a-f0-9]{64}$/;

const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";

const VERIFY_ISOLATION_SQL = `
  SELECT owner.clerk_user_id AS authenticated_owner_id,
    bool_and(table_class.relrowsecurity) AS staging_rls,
    bool_and(table_class.relforcerowsecurity) AS staging_force_rls,
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
  CROSS JOIN pg_catalog.pg_roles role
  CROSS JOIN LATERAL unnest(ARRAY[
    'dna.import_batch'::regclass,
    'dna.dataset_staged_record'::regclass,
    'dna.normalized_race_staged_fact'::regclass,
    'dna.normalized_core_staged_fact'::regclass,
    'dna.normalized_arena_staged_fact'::regclass,
    'dna.import_preview_evidence_receipt'::regclass
  ]) relation(oid)
  JOIN pg_catalog.pg_class table_class ON table_class.oid = relation.oid
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
    AND role.rolname = session_user
  GROUP BY owner.clerk_user_id, role.rolsuper, role.rolbypassrls,
    role.rolcreaterole, role.rolcreatedb
`;

const VERIFY_OBJECT_SQL = `
  SELECT file.id::text AS import_batch_id
  FROM dna.import_preview_processing processing
  JOIN dna.import_verified_upload_object object
    ON object.owner_id = processing.owner_id
    AND object.preview_dispatch_id = processing.preview_dispatch_id
  JOIN dna.import_upload_file file
    ON file.owner_id = object.owner_id AND file.id = object.upload_file_id
  WHERE processing.owner_id = $1::uuid
    AND processing.preview_dispatch_id = $2::uuid
    AND processing.state = 'processing'
    AND object.object_id = $3
    AND file.source_family = $4
    AND file.byte_length = $5::bigint
    AND file.sha256 = $6::character(64)
    AND object.advertised_byte_length = file.byte_length
`;

const RESUME_OBJECT_SQL = `
  SELECT batch.id::text AS import_batch_id, batch.source_rows,
    batch.accepted_rows, batch.rejected_rows, batch.warning_rows
  FROM dna.import_preview_processing processing
  JOIN dna.import_verified_upload_object object
    ON object.owner_id = processing.owner_id
    AND object.preview_dispatch_id = processing.preview_dispatch_id
  JOIN dna.import_upload_file file
    ON file.owner_id = object.owner_id AND file.id = object.upload_file_id
  JOIN dna.import_batch batch
    ON batch.owner_id = file.owner_id AND batch.id = file.id
  WHERE processing.owner_id = $1::uuid
    AND processing.preview_dispatch_id = $2::uuid
    AND processing.state = 'processing'
    AND object.object_id = $3
    AND file.source_family = $4
    AND file.byte_length = $5::bigint
    AND file.sha256 = $6::character(64)
    AND object.advertised_byte_length = file.byte_length
    AND batch.status = 'validating'
    AND batch.source_rows = COALESCE((
      SELECT sum(receipt.row_count)
      FROM dna.import_preview_evidence_receipt receipt
      WHERE receipt.owner_id = batch.owner_id
        AND receipt.import_batch_id = batch.id
        AND receipt.source_type = batch.source_type
        AND receipt.object_kind = 'staged_rows'
    ), 0)
`;

const RECORD_EVIDENCE_RECEIPTS_SQL = `
  SELECT dna.record_import_preview_evidence_receipts(
    $1::uuid, $2::uuid, $3::jsonb
  ) AS recorded_count
`;

const FINALIZE_EVIDENCE_RECEIPTS_SQL = `
  SELECT staged_batch_count, receipt_count, registered_manifest_count
  FROM dna.finalize_import_preview_evidence_receipts(
    $1::uuid, $2::uuid[], $3::timestamptz
  )
`;

const STAGE_SCHEMA_SQL = `
  INSERT INTO dna.import_batch (
    id, owner_id, source_type, source_filename, checksum_sha256,
    raw_object_key, detected_encoding, schema_version, status, uploaded_at,
    source_rows, accepted_rows, rejected_rows, warning_rows
  )
  SELECT file.id, file.owner_id, file.source_family, file.original_file_name,
    file.sha256, object.object_id, $4, $5, 'validating', batch.requested_at,
    0, 0, 0, 0
  FROM dna.import_verified_upload_object object
  JOIN dna.import_upload_file file
    ON file.owner_id = object.owner_id AND file.id = object.upload_file_id
  JOIN dna.import_upload_batch batch
    ON batch.owner_id = file.owner_id AND batch.id = file.upload_batch_id
  WHERE object.owner_id = $1::uuid
    AND object.preview_dispatch_id = $2::uuid AND object.object_id = $3
  ON CONFLICT (owner_id, id) DO NOTHING
  RETURNING id::text AS import_batch_id
`;

const STAGE_RECORDS_SQL = `
  WITH rows AS (
    SELECT value FROM jsonb_array_elements($3::jsonb) value
  )
  INSERT INTO dna.dataset_staged_record (
    owner_id, import_batch_id, source_row_number, natural_key,
    fingerprint_sha256, status, issue_codes
  )
  SELECT $1::uuid, $2::uuid, (value->>'sourceRowNumber')::bigint,
    value->>'naturalKey', value->>'fingerprintSha256',
    value->'row'->>'status', COALESCE(ARRAY(
      SELECT issue->>'code'
      FROM jsonb_array_elements(value->'row'->'issues') issue
    ), ARRAY[]::text[])
  FROM rows
`;

const STAGE_RACE_SQL = `
  WITH rows AS (
    SELECT value, value->'row'->'record' record
    FROM jsonb_array_elements($3::jsonb) value
    WHERE value->'row'->>'status' = 'ready'
      AND value->'row'->'record'->>'sourceType' = 'race_merge'
  )
  INSERT INTO dna.normalized_race_staged_fact (
    owner_id, import_batch_id, source_row_number, source_event_id, event_at,
    source_event_datetime, mode, distance, source_core_id, source_core_name,
    source_gate, gate_count, gold_star, blue_star, raw_gold_star, raw_blue_star,
    star_data_status, finish_position, elapsed_time_source_value,
    source_format_label, source_race_class, raw_entry_fee, raw_payout, raw_prize,
    raw_asset, economic_data_status, race_asset, entry_fee_amount,
    gross_payout_amount, payout_mechanism_source_value, race_tags_source_value
  )
  SELECT $1::uuid, $2::uuid, (value->>'sourceRowNumber')::bigint,
    record->>'sourceEventId', (record->>'eventAt')::timestamptz,
    NULLIF(record->>'sourceEventDatetime', '')::timestamptz,
    record->>'mode', (record->>'distance')::integer, record->>'sourceCoreId',
    record->>'coreNameSourceValue', NULLIF(record->>'gate', '')::smallint,
    (record->>'gateCount')::smallint, (record->>'goldStar')::boolean,
    (record->>'blueStar')::boolean, COALESCE(record->>'goldStarSourceValue', ''),
    COALESCE(record->>'blueStarSourceValue', ''), record->>'starDataStatus',
    (record->>'finishPosition')::smallint, record->>'elapsedTimeSourceValue',
    record->>'sourceFormat', record->>'sourceRaceClass',
    record->>'feeSourceValue', record->>'payoutMechanismSourceValue',
    record->>'prizeSourceValue', record->>'assetSourceValue',
    record->>'economicDataStatus', record->>'raceAsset',
    NULLIF(record->>'entryFeeAmount', '')::numeric,
    NULLIF(record->>'grossPayoutAmount', '')::numeric,
    record->>'payoutMechanismSourceValue', record->>'raceTagsSourceValue'
  FROM rows
`;

const STAGE_CORE_SQL = `
  WITH rows AS (
    SELECT value, value->'row'->'record' record
    FROM jsonb_array_elements($3::jsonb) value
    WHERE value->'row'->>'status' = 'ready'
      AND value->'row'->'record'->>'sourceType' = 'core_details'
  )
  INSERT INTO dna.normalized_core_staged_fact (
    owner_id, import_batch_id, source_row_number, source_core_id, display_name,
    core_class, element, f_number, sex, color_source_value,
    father_source_core_id, father_name_source_value,
    mother_source_core_id, mother_name_source_value
  )
  SELECT $1::uuid, $2::uuid, (value->>'sourceRowNumber')::bigint,
    record->>'sourceCoreId', record->>'displayName', record->>'coreClass',
    record->>'element', (record->>'fNumber')::integer, record->>'sex',
    record->>'colorSourceValue', record->>'fatherSourceCoreId',
    record->>'fatherNameSourceValue', record->>'motherSourceCoreId',
    record->>'motherNameSourceValue'
  FROM rows
`;

const STAGE_ARENA_SQL = `
  WITH rows AS (
    SELECT value, value->'row'->'record' record
    FROM jsonb_array_elements($3::jsonb) value
    WHERE value->'row'->>'status' = 'ready'
      AND value->'row'->'record'->>'sourceType' = 'current_arena'
  )
  INSERT INTO dna.normalized_arena_staged_fact (
    owner_id, import_batch_id, source_row_number, source_core_id,
    price_usd_source_value, creates_economic_transaction
  )
  SELECT $1::uuid, $2::uuid, (value->>'sourceRowNumber')::bigint,
    record->>'sourceCoreId', record->>'priceUsdSourceValue', false
  FROM rows
`;

const UPDATE_COUNTS_SQL = `
  UPDATE dna.import_batch SET
    source_rows = source_rows + $3::bigint,
    accepted_rows = accepted_rows + $4::bigint,
    rejected_rows = rejected_rows + $5::bigint,
    warning_rows = warning_rows + $6::bigint,
    minimum_accepted_event_at = CASE
      WHEN $7::timestamptz IS NULL THEN minimum_accepted_event_at
      WHEN minimum_accepted_event_at IS NULL THEN $7::timestamptz
      ELSE LEAST(minimum_accepted_event_at, $7::timestamptz)
    END,
    maximum_accepted_event_at = CASE
      WHEN $8::timestamptz IS NULL THEN maximum_accepted_event_at
      WHEN maximum_accepted_event_at IS NULL THEN $8::timestamptz
      ELSE GREATEST(maximum_accepted_event_at, $8::timestamptz)
    END
  WHERE owner_id = $1::uuid AND id = $2::uuid AND status = 'validating'
  RETURNING id::text AS import_batch_id
`;

const RESULT_SQL = `
  SELECT batch.id::text AS import_batch_id, batch.source_rows,
    batch.accepted_rows, batch.rejected_rows, batch.warning_rows
  FROM dna.import_batch batch
  JOIN dna.import_verified_upload_object object
    ON object.owner_id = batch.owner_id AND object.upload_file_id = batch.id
  JOIN dna.import_upload_file file
    ON file.owner_id = object.owner_id AND file.id = object.upload_file_id
  WHERE batch.owner_id = $1::uuid AND batch.id = $2::uuid
    AND object.preview_dispatch_id = $3::uuid
    AND file.byte_length = $4::bigint AND file.sha256 = $5::character(64)
    AND batch.status = 'validating'
`;

const ASSERT_PREVIEW_SQL = `
  SELECT count(*)::integer AS matched_count
  FROM jsonb_array_elements($5::jsonb) expected
  JOIN dna.import_verified_upload_object object
    ON object.owner_id = $1::uuid
    AND object.preview_dispatch_id = $3::uuid
    AND object.object_id = expected->>'objectId'
  JOIN dna.import_upload_file file
    ON file.owner_id = object.owner_id AND file.id = object.upload_file_id
  JOIN dna.import_batch batch
    ON batch.owner_id = file.owner_id AND batch.id = file.id
  JOIN dna.import_preview_processing processing
    ON processing.owner_id = object.owner_id
    AND processing.preview_dispatch_id = object.preview_dispatch_id
  WHERE file.upload_batch_id = $2::uuid
    AND processing.upload_manifest_fingerprint_sha256 = $4::character(64)
    AND file.source_family = expected->>'sourceFamily'
    AND file.sha256 = expected->>'sha256'
    AND batch.status = 'validating'
`;

const ABORT_PREVIEW_SQL = `
  DELETE FROM dna.import_batch batch
  USING dna.import_verified_upload_object object, dna.import_upload_file file
  WHERE batch.owner_id = $1::uuid AND file.upload_batch_id = $2::uuid
    AND object.preview_dispatch_id = $3::uuid
    AND object.owner_id = batch.owner_id AND file.owner_id = batch.owner_id
    AND file.id = object.upload_file_id AND batch.id = file.id
    AND batch.status IN ('uploaded', 'validating', 'quarantined')
`;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;
type DbRow = Record<string, unknown>;

function record(value: unknown, field: string): DbRow {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${field} must be a database record`);
  return value as DbRow;
}
function oneRow(result: QueryResult, field: string): DbRow {
  if (result.rows.length !== 1)
    throw new Error(`${field} must return exactly one row`);
  return record(result.rows[0], field);
}
function optionalRow(result: QueryResult, field: string): DbRow | null {
  if (result.rows.length > 1)
    throw new Error(`${field} must return at most one row`);
  return result.rows.length === 0 ? null : record(result.rows[0], field);
}
function objectResult(row: DbRow): DurablePreviewObjectResult {
  return {
    importBatchId: text(row.import_batch_id, "import_batch_id"),
    sourceRowCount: count(row.source_rows, "source_rows"),
    readyRowCount: count(row.accepted_rows, "accepted_rows"),
    quarantinedRowCount: count(row.rejected_rows, "rejected_rows"),
    warningRowCount: count(row.warning_rows, "warning_rows"),
    blockingIssueCount: count(row.rejected_rows, "rejected_rows"),
  };
}
function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean`);
  return value;
}
function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${field} must be a non-empty string`);
  return value;
}
function count(value: unknown, field: string): number {
  const result = typeof value === "string" ? Number(value) : value;
  if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 0)
    throw new Error(`${field} must be a non-negative safe integer`);
  return result;
}

function acceptedRaceEventBounds(
  rows: readonly DurablePreviewStagedRow[],
): readonly [string | null, string | null] {
  const timestamps = rows.flatMap(({ row }) =>
    row.status === "ready" && row.record?.sourceType === "race_merge"
      ? [Date.parse(row.record.eventAt)]
      : [],
  );
  if (timestamps.length === 0) return [null, null];
  return [
    new Date(Math.min(...timestamps)).toISOString(),
    new Date(Math.max(...timestamps)).toISOString(),
  ];
}

function configuration(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
}) {
  const result = {
    databaseUrl: input.databaseUrl.trim(),
    databaseOwnerId: input.databaseOwnerId.trim(),
    runtimeRole: input.runtimeRole.trim(),
  };
  if (!result.databaseUrl) throw new Error("databaseUrl is required");
  if (!UUID_PATTERN.test(result.databaseOwnerId))
    throw new Error("databaseOwnerId must be a UUID");
  if (!ROLE_PATTERN.test(result.runtimeRole))
    throw new Error("runtimeRole is invalid");
  return result;
}

function verifyIsolation(
  result: QueryResult,
  ownerId: string,
  runtimeRole: string,
) {
  const row = oneRow(result, "staging isolation");
  if (text(row.authenticated_owner_id, "authenticated_owner_id") !== ownerId)
    throw new Error("Private Preview staging owner scope denied.");
  if (
    !bool(row.staging_rls, "staging_rls") ||
    !bool(row.staging_force_rls, "staging_force_rls")
  )
    throw new Error("Private Preview staging requires forced owner RLS.");
  if (
    text(row.session_user_name, "session_user_name") !== runtimeRole ||
    text(row.current_user_name, "current_user_name") !== runtimeRole ||
    bool(row.runtime_is_superuser, "runtime_is_superuser") ||
    bool(row.runtime_bypasses_rls, "runtime_bypasses_rls") ||
    bool(row.runtime_can_create_roles, "runtime_can_create_roles") ||
    bool(row.runtime_can_create_databases, "runtime_can_create_databases") ||
    bool(
      row.runtime_is_neon_superuser_member,
      "runtime_is_neon_superuser_member",
    )
  )
    throw new Error("Private Preview runtime role is not least privileged.");
}

async function beginTransaction(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  ownerId: string;
  sessionFactory: NeonImportPersistenceSessionFactory;
}) {
  const session = await input.sessionFactory(input.databaseUrl);
  try {
    await session.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await session.client.query(SET_OWNER_SCOPE_SQL, [input.databaseOwnerId]);
    verifyIsolation(
      await session.client.query(VERIFY_ISOLATION_SQL, [
        input.databaseOwnerId,
        input.ownerId,
      ]),
      input.ownerId,
      input.runtimeRole,
    );
    return session;
  } catch (error) {
    await session.client.query("ROLLBACK").catch(() => undefined);
    await session.close();
    throw error;
  }
}

async function transaction<Result>(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  ownerId: string;
  sessionFactory: NeonImportPersistenceSessionFactory;
  operation: (client: NeonImportPersistenceClient) => Promise<Result>;
}) {
  const session = await beginTransaction(input);
  try {
    const result = await input.operation(session.client);
    await session.client.query("COMMIT");
    return result;
  } catch (error) {
    await session.client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await session.close();
  }
}

export function createNeonDurableImportPreviewStagingRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): DurableImportPreviewStagingRepository {
  const config = configuration(input);
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;
  const run = <Result>(
    ownerId: string,
    operation: (client: NeonImportPersistenceClient) => Promise<Result>,
  ) => transaction({ ...config, ownerId, sessionFactory, operation });

  return {
    resumeObject(object) {
      if (!SHA_PATTERN.test(object.expectedSha256))
        throw new Error("expectedSha256 is invalid");
      return run(object.ownerId, async (client) => {
        const row = optionalRow(
          await client.query(RESUME_OBJECT_SQL, [
            config.databaseOwnerId,
            object.previewDispatchId,
            object.objectId,
            object.sourceFamily,
            object.expectedByteLength,
            object.expectedSha256,
          ]),
          "resumable Preview object",
        );
        return row === null ? null : objectResult(row);
      });
    },
    async beginObject(object) {
      if (!SHA_PATTERN.test(object.expectedSha256))
        throw new Error("expectedSha256 is invalid");
      const session = await beginTransaction({
        ...config,
        ownerId: object.ownerId,
        sessionFactory,
      });
      let open = true;
      let schemaStaged = false;
      try {
        const evidence = oneRow(
          await session.client.query(VERIFY_OBJECT_SQL, [
            config.databaseOwnerId,
            object.previewDispatchId,
            object.objectId,
            object.sourceFamily,
            object.expectedByteLength,
            object.expectedSha256,
          ]),
          "verified Preview object",
        );
        const importBatchId = text(evidence.import_batch_id, "import_batch_id");
        const close = async (statement: "COMMIT" | "ROLLBACK") => {
          if (!open) return;
          open = false;
          try {
            await session.client.query(statement);
          } finally {
            await session.close();
          }
        };
        return {
          importBatchId,
          async stageSchema(schema: StagedSourceSchema) {
            if (schemaStaged)
              throw new Error("Preview schema was already staged");
            if (
              schema.status !== "ready" ||
              schema.sourceType !== object.sourceFamily ||
              schema.schemaVersion === null
            )
              throw new Error(
                "Preview schema is not ready for this source family",
              );
            const inserted = await session.client.query(STAGE_SCHEMA_SQL, [
              config.databaseOwnerId,
              object.previewDispatchId,
              object.objectId,
              schema.encoding,
              schema.schemaVersion,
            ]);
            if (inserted.rows.length !== 1)
              throw new Error("Preview import batch could not be staged");
            schemaStaged = true;
          },
          async stageRows(rows: readonly DurablePreviewStagedRow[]) {
            if (!schemaStaged || !open)
              throw new Error("Preview object is not stageable");
            if (rows.length === 0) return;
            const json = JSON.stringify(rows);
            await session.client.query(STAGE_RECORDS_SQL, [
              config.databaseOwnerId,
              importBatchId,
              json,
            ]);
            await session.client.query(STAGE_RACE_SQL, [
              config.databaseOwnerId,
              importBatchId,
              json,
            ]);
            await session.client.query(STAGE_CORE_SQL, [
              config.databaseOwnerId,
              importBatchId,
              json,
            ]);
            await session.client.query(STAGE_ARENA_SQL, [
              config.databaseOwnerId,
              importBatchId,
              json,
            ]);
            const ready = rows.filter(
              ({ row }) => row.status === "ready",
            ).length;
            const warnings = rows.filter(
              ({ row }) => row.issues.length > 0,
            ).length;
            const [minimumAcceptedEventAt, maximumAcceptedEventAt] =
              acceptedRaceEventBounds(rows);
            oneRow(
              await session.client.query(UPDATE_COUNTS_SQL, [
                config.databaseOwnerId,
                importBatchId,
                rows.length,
                ready,
                rows.length - ready,
                warnings,
                minimumAcceptedEventAt,
                maximumAcceptedEventAt,
              ]),
              "staged Preview row counts",
            );
          },
          async commitVerified(verified): Promise<DurablePreviewObjectResult> {
            if (!schemaStaged || !open)
              throw new Error("Preview object is not committable");
            if (
              verified.byteLength !== object.expectedByteLength ||
              verified.sha256 !== object.expectedSha256 ||
              !Number.isSafeInteger(verified.chunkCount) ||
              verified.chunkCount < 1
            )
              throw new Error(
                "Preview object verification does not match reservation",
              );
            if (verified.evidenceRegistrations !== undefined) {
              const receiptRow = oneRow(
                await session.client.query(RECORD_EVIDENCE_RECEIPTS_SQL, [
                  config.databaseOwnerId,
                  importBatchId,
                  JSON.stringify(verified.evidenceRegistrations),
                ]),
                "Preview evidence receipt recording",
              );
              if (
                count(receiptRow.recorded_count, "recorded_count") !==
                verified.evidenceRegistrations.length
              ) {
                throw new Error("Preview evidence receipt recording is incomplete");
              }
            }
            const row = oneRow(
              await session.client.query(RESULT_SQL, [
                config.databaseOwnerId,
                importBatchId,
                object.previewDispatchId,
                verified.byteLength,
                verified.sha256,
              ]),
              "staged Preview object",
            );
            const result = objectResult(row);
            await close("COMMIT");
            return result;
          },
          rollback: async () => close("ROLLBACK"),
        };
      } catch (error) {
        if (open) {
          open = false;
          await session.client.query("ROLLBACK").catch(() => undefined);
          await session.close();
        }
        throw error;
      }
    },
    finalizePreviewEvidence(finalization) {
      if (
        finalization.importBatchIds.length < 1 ||
        finalization.importBatchIds.length > 24 ||
        new Set(finalization.importBatchIds).size !==
          finalization.importBatchIds.length
      ) {
        throw new Error("Preview evidence finalization batch set is invalid");
      }
      return run(finalization.ownerId, async (client) => {
        await client.query("SET LOCAL statement_timeout = '60000ms'");
        const row = oneRow(
          await client.query(FINALIZE_EVIDENCE_RECEIPTS_SQL, [
            config.databaseOwnerId,
            finalization.importBatchIds,
            new Date().toISOString(),
          ]),
          "Preview evidence finalization",
        );
        const stagedBatchCount = count(
          row.staged_batch_count,
          "staged_batch_count",
        );
        const receiptCount = count(row.receipt_count, "receipt_count");
        const registeredManifestCount = count(
          row.registered_manifest_count,
          "registered_manifest_count",
        );
        if (
          stagedBatchCount !== finalization.importBatchIds.length ||
          registeredManifestCount !== receiptCount
        ) {
          throw new Error("Preview evidence finalization is incomplete");
        }
      });
    },
    assertPreviewObjects(assertion) {
      return run(assertion.ownerId, async (client) => {
        const expected = assertion.objects.map(
          ({ objectId, sourceFamily, sha256 }) => ({
            objectId,
            sourceFamily,
            sha256,
          }),
        );
        const row = oneRow(
          await client.query(ASSERT_PREVIEW_SQL, [
            config.databaseOwnerId,
            assertion.uploadBatchId,
            assertion.previewDispatchId,
            assertion.uploadManifestFingerprintSha256,
            JSON.stringify(expected),
          ]),
          "staged Preview assertion",
        );
        if (count(row.matched_count, "matched_count") !== expected.length)
          throw new Error(
            "Prepared Preview objects do not match durable staging",
          );
      });
    },
    abortPreview(abort) {
      return run(abort.ownerId, async (client) => {
        await client.query(ABORT_PREVIEW_SQL, [
          config.databaseOwnerId,
          abort.uploadBatchId,
          abort.previewDispatchId,
        ]);
      });
    },
  };
}

export function neonDurableImportPreviewStagingRepositoryFromEnvironment(
  environment: Readonly<{
    databaseUrl: string | undefined;
    databaseOwnerId: string | undefined;
    runtimeRole: string | undefined;
  }>,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): DurableImportPreviewStagingRepository | null {
  const databaseUrl = environment.databaseUrl?.trim();
  const databaseOwnerId = environment.databaseOwnerId?.trim();
  const runtimeRole = environment.runtimeRole?.trim();
  if (!databaseUrl || !databaseOwnerId || !runtimeRole) return null;
  return createNeonDurableImportPreviewStagingRepository({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
