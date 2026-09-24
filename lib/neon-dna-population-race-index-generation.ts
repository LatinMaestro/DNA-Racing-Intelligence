import type {
  DnaPopulationRaceIndexAuthority,
  DnaPopulationRaceIndexCheckpoint,
  DnaPopulationRaceIndexCompactIdentity,
  DnaPopulationRaceIndexGenerationRepository,
  DnaPopulationRaceIndexR2ChunkManifest,
  DnaPopulationRaceIndexWriteBatch,
} from "./dna-population-race-index-generation";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;
const WORKER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;
type DbRow = Record<string, unknown>;

const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";
const VERIFY_ISOLATION_SQL = `
SELECT owner.id::text AS database_owner_id,
  owner.clerk_user_id AS authenticated_owner_id,
  bool_and(relation.relrowsecurity) AS all_rls_enabled,
  bool_and(relation.relforcerowsecurity) AS all_force_rls_enabled,
  bool_or(has_table_privilege(session_user, relation.oid,
    'SELECT,INSERT,UPDATE,DELETE')) AS runtime_can_access_tables,
  has_function_privilege(session_user,
    'dna.begin_dna_population_race_index_generation(uuid,text,jsonb,timestamp with time zone)',
    'EXECUTE') AS runtime_can_begin,
  has_function_privilege(session_user,
    'dna.append_dna_population_race_index_batch(uuid,text,jsonb,timestamp with time zone)',
    'EXECUTE') AS runtime_can_legacy_append,
  has_function_privilege(session_user,
    'dna.read_dna_population_race_index_legacy_chunk(uuid,text,text,integer)',
    'EXECUTE') AS runtime_can_read_legacy,
  has_function_privilege(session_user,
    'dna.register_dna_population_race_index_r2_compaction_chunk(uuid,text,text,jsonb,jsonb,timestamp with time zone)',
    'EXECUTE') AS runtime_can_register_compaction,
  has_function_privilege(session_user,
    'dna.finalize_dna_population_race_index_r2_compaction(uuid,text,text,timestamp with time zone)',
    'EXECUTE') AS runtime_can_finalize_compaction,
  has_function_privilege(session_user,
    'dna.read_dna_population_race_index_r2_chunk_manifests(uuid,text,integer,integer)',
    'EXECUTE') AS runtime_can_read_r2_manifests,
  has_function_privilege(session_user,
    'dna.register_dna_population_race_index_compact_identity_chunk(uuid,text,text,integer,jsonb,timestamp with time zone)',
    'EXECUTE') AS runtime_can_register_identities,
  has_function_privilege(session_user,
    'dna.lookup_dna_population_race_index_compact_identities(uuid,text,jsonb)',
    'EXECUTE') AS runtime_can_lookup_identities,
  has_function_privilege(session_user,
    'dna.append_dna_population_race_index_r2_batch(uuid,text,jsonb,jsonb,jsonb,timestamp with time zone)',
    'EXECUTE') AS runtime_can_append,
  has_function_privilege(session_user,
    'dna.publish_dna_population_race_index_generation(uuid,text,text,timestamp with time zone)',
    'EXECUTE') AS runtime_can_publish,
  has_function_privilege(session_user,
    'dna.read_dna_population_race_index_generation(uuid,text)',
    'EXECUTE') AS runtime_can_read,
  session_user::text AS session_user_name,
  current_user::text AS current_user_name,
  role.rolsuper AS runtime_is_superuser,
  role.rolbypassrls AS runtime_bypasses_rls,
  role.rolcreaterole AS runtime_can_create_roles,
  role.rolcreatedb AS runtime_can_create_databases,
  has_database_privilege(session_user, current_database(), 'CREATE')
    AS runtime_can_create_in_database,
  has_schema_privilege(session_user, 'dna', 'CREATE')
    AS runtime_can_create_in_schema,
  COALESCE(pg_has_role(session_user, (
    SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'neon_superuser'
  ), 'MEMBER'), false) AS runtime_is_neon_superuser_member
FROM dna.app_owner owner
CROSS JOIN LATERAL unnest(ARRAY[
  'dna.dna_population_race_index_generation'::regclass,
  'dna.dna_population_race_index_batch_receipt'::regclass,
  'dna.dna_population_race_index_race'::regclass,
  'dna.dna_population_race_index_entrant'::regclass,
  'dna.dna_population_race_index_active'::regclass,
  'dna.dna_population_race_index_compact_identity'::regclass,
  'dna.dna_population_race_index_r2_chunk'::regclass
]) target(oid)
JOIN pg_catalog.pg_class relation ON relation.oid = target.oid
JOIN pg_catalog.pg_roles role ON role.rolname = session_user
WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
GROUP BY owner.id, owner.clerk_user_id, role.rolsuper, role.rolbypassrls,
  role.rolcreaterole, role.rolcreatedb`;

function record(value: unknown, field: string): DbRow {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
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
  if (typeof value !== "string" || value.trim() !== value || value === "") {
    throw new Error(`${field} is invalid`);
  }
  return value;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean`);
  return value;
}

function uuid(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new Error(`${field} is invalid`);
  return normalized;
}

function sha256(value: unknown, field: string): string {
  const normalized = text(value, field);
  if (!SHA_256_PATTERN.test(normalized)) throw new Error(`${field} is invalid`);
  return normalized;
}

function timestamp(value: unknown, field: string): string {
  if (value === null) throw new Error(`${field} is invalid`);
  const parsed = value instanceof Date ? value : new Date(text(value, field));
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} is invalid`);
  return parsed.toISOString();
}

function optionalTimestamp(value: unknown, field: string): string | null {
  return value === null || value === undefined ? null : timestamp(value, field);
}

function count(value: unknown, field: string): number {
  const parsed =
    typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) < 0) {
    throw new Error(`${field} is invalid`);
  }
  return parsed as number;
}

function ownerId(value: string): string {
  if (
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 512 ||
    CONTROL_PATTERN.test(value)
  ) {
    throw new Error("ownerId is invalid");
  }
  return value;
}

function workerId(value: string): string {
  if (!WORKER_PATTERN.test(value)) throw new Error("workerId is invalid");
  return value;
}

function validateAuthority(
  authority: DnaPopulationRaceIndexAuthority,
): DnaPopulationRaceIndexAuthority {
  if (
    authority.version !== 1 ||
    sha256(authority.generationId, "generationId") !==
      sha256(authority.baselineCompletionSha256, "baselineCompletionSha256") ||
    count(
      authority.baselineLogicalRequestCount,
      "baselineLogicalRequestCount",
    ) < 1 ||
    count(authority.baselineRetainedR2Bytes, "baselineRetainedR2Bytes") < 1
  ) {
    throw new Error("population race index authority is invalid");
  }
  count(
    authority.baselineOmittedIdentityObservationCount,
    "baselineOmittedIdentityObservationCount",
  );
  return authority;
}

function validateBatch(batch: DnaPopulationRaceIndexWriteBatch): void {
  if (
    batch.version !== 1 ||
    batch.generationId !== sha256(batch.generationId, "generationId") ||
    batch.batchSha256 !== sha256(batch.batchSha256, "batchSha256") ||
    !Number.isSafeInteger(batch.afterRequestOrdinal) ||
    batch.afterRequestOrdinal < 0 ||
    !Number.isSafeInteger(batch.processedReceiptCount) ||
    batch.processedReceiptCount < 1 ||
    batch.processedReceiptCount > 100 ||
    batch.nextRequestOrdinal !==
      batch.afterRequestOrdinal + batch.processedReceiptCount + 1 ||
    batch.canonicalDocumentObservationCount !== batch.documents.length ||
    batch.documents.length > 5_000
  ) {
    throw new Error("population race index batch is invalid");
  }
}

function parseCheckpoint(row: DbRow): DnaPopulationRaceIndexCheckpoint {
  const state = text(row.state, "state");
  if (state !== "staging" && state !== "complete" && state !== "published") {
    throw new Error("population race index state is invalid");
  }
  const checkpoint: DnaPopulationRaceIndexCheckpoint = Object.freeze({
    version: count(row.version, "version") as 1,
    generationId: sha256(row.generation_id, "generationId"),
    baselineCompletionSha256: sha256(
      row.baseline_completion_sha256,
      "baselineCompletionSha256",
    ),
    baselineLogicalRequestCount: count(
      row.baseline_logical_request_count,
      "baselineLogicalRequestCount",
    ),
    baselineRetainedR2Bytes: count(
      row.baseline_retained_r2_bytes,
      "baselineRetainedR2Bytes",
    ),
    baselineOmittedIdentityObservationCount: count(
      row.baseline_omitted_identity_observation_count,
      "baselineOmittedIdentityObservationCount",
    ),
    state,
    lastRequestOrdinal: count(row.last_request_ordinal, "lastRequestOrdinal"),
    processedReceiptCount: count(
      row.processed_receipt_count,
      "processedReceiptCount",
    ),
    processedReceiptBytes: count(
      row.processed_receipt_bytes,
      "processedReceiptBytes",
    ),
    processedIdentityOmissionCount: count(
      row.processed_identity_omission_count,
      "processedIdentityOmissionCount",
    ),
    finishedRaceReceiptCount: count(
      row.finished_race_receipt_count,
      "finishedRaceReceiptCount",
    ),
    canonicalDocumentObservationCount: count(
      row.canonical_document_observation_count,
      "canonicalDocumentObservationCount",
    ),
    uniqueRaceCount: count(row.unique_race_count, "uniqueRaceCount"),
    uniqueEntrantCoreCount: count(
      row.unique_entrant_core_count,
      "uniqueEntrantCoreCount",
    ),
    storageLayout: (() => {
      const value = text(row.storage_layout, "storageLayout");
      if (value !== "legacy_neon_v1" && value !== "r2_chunked_v1") {
        throw new Error("population race index storage layout is invalid");
      }
      return value;
    })(),
    r2ChunkCount: count(row.r2_chunk_count, "r2ChunkCount"),
    r2CompactedRaceCount: count(
      row.r2_compacted_race_count,
      "r2CompactedRaceCount",
    ),
    r2LastSourceRaceId:
      row.r2_last_source_race_id === null ||
      row.r2_last_source_race_id === undefined
        ? null
        : text(row.r2_last_source_race_id, "r2LastSourceRaceId"),
    compactedAt: optionalTimestamp(row.compacted_at, "compactedAt"),
    legacyStorageRetiredAt: optionalTimestamp(
      row.legacy_storage_retired_at,
      "legacyStorageRetiredAt",
    ),
    updatedAt: timestamp(row.updated_at, "updatedAt"),
    completedAt: optionalTimestamp(row.completed_at, "completedAt"),
    publishedAt: optionalTimestamp(row.published_at, "publishedAt"),
  });
  if (
    checkpoint.version !== 1 ||
    checkpoint.generationId !== checkpoint.baselineCompletionSha256
  ) {
    throw new Error("population race index checkpoint authority drifted");
  }
  return checkpoint;
}

function verifyIsolation(
  result: QueryResult,
  input: { databaseOwnerId: string; ownerId: string; runtimeRole: string },
): void {
  const row = oneRow(result, "population race index isolation");
  if (
    text(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    text(row.authenticated_owner_id, "authenticated_owner_id") !==
      input.ownerId ||
    !bool(row.all_rls_enabled, "all_rls_enabled") ||
    !bool(row.all_force_rls_enabled, "all_force_rls_enabled") ||
    bool(row.runtime_can_access_tables, "runtime_can_access_tables") ||
    !bool(row.runtime_can_begin, "runtime_can_begin") ||
    bool(row.runtime_can_legacy_append, "runtime_can_legacy_append") ||
    !bool(row.runtime_can_read_legacy, "runtime_can_read_legacy") ||
    !bool(row.runtime_can_register_compaction, "runtime_can_register_compaction") ||
    !bool(row.runtime_can_finalize_compaction, "runtime_can_finalize_compaction") ||
    !bool(row.runtime_can_read_r2_manifests, "runtime_can_read_r2_manifests") ||
    !bool(row.runtime_can_register_identities, "runtime_can_register_identities") ||
    !bool(row.runtime_can_lookup_identities, "runtime_can_lookup_identities") ||
    !bool(row.runtime_can_append, "runtime_can_append") ||
    !bool(row.runtime_can_publish, "runtime_can_publish") ||
    !bool(row.runtime_can_read, "runtime_can_read") ||
    text(row.session_user_name, "session_user_name") !== input.runtimeRole ||
    text(row.current_user_name, "current_user_name") !== input.runtimeRole ||
    bool(row.runtime_is_superuser, "runtime_is_superuser") ||
    bool(row.runtime_bypasses_rls, "runtime_bypasses_rls") ||
    bool(row.runtime_can_create_roles, "runtime_can_create_roles") ||
    bool(row.runtime_can_create_databases, "runtime_can_create_databases") ||
    bool(
      row.runtime_can_create_in_database,
      "runtime_can_create_in_database",
    ) ||
    bool(row.runtime_can_create_in_schema, "runtime_can_create_in_schema") ||
    bool(
      row.runtime_is_neon_superuser_member,
      "runtime_is_neon_superuser_member",
    )
  ) {
    throw new Error(
      "population race index requires least-privilege owner isolation",
    );
  }
}

function compactIdentity(value: unknown): DnaPopulationRaceIndexCompactIdentity {
  const row = record(value, "compact identity");
  return Object.freeze({
    sourceRaceId: text(row.source_race_id ?? row.sourceRaceId, "sourceRaceId"),
    rawEvidenceSha256: sha256(
      row.raw_evidence_sha256 ?? row.rawEvidenceSha256,
      "rawEvidenceSha256",
    ),
  });
}

function r2ChunkManifest(value: unknown): DnaPopulationRaceIndexR2ChunkManifest {
  const row = record(value, "population R2 chunk manifest");
  const chunkOrdinal = count(row.chunk_ordinal, "chunkOrdinal");
  if (chunkOrdinal < 1) {
    throw new Error("population R2 chunk ordinal is invalid");
  }
  return Object.freeze({
    version: 1 as const,
    generationId: "",
    chunkOrdinal,
    objectKey: text(row.object_key, "objectKey"),
    bodySha256: sha256(row.body_sha256, "bodySha256"),
    byteLength: count(row.byte_length, "byteLength"),
    rowCount: count(row.row_count, "rowCount"),
    firstSourceRaceId: text(row.first_source_race_id, "firstSourceRaceId"),
    lastSourceRaceId: text(row.last_source_race_id, "lastSourceRaceId"),
    registeredAt: timestamp(row.registered_at, "registeredAt"),
    identityRegisteredAt: optionalTimestamp(
      row.identity_registered_at,
      "identityRegisteredAt",
    ),
  });
}

function legacyDocument(value: unknown) {
  const row = record(value, "legacy population race");
  const canonical = record(row.canonical, "legacy population race canonical");
  const endpoint = text(row.endpoint, "legacy endpoint");
  if (endpoint !== "races.finished" && endpoint !== "races.docs") {
    throw new Error("legacy population race endpoint is invalid");
  }
  const sourceRaceId = text(row.source_race_id, "legacy sourceRaceId");
  if (
    canonical.sourceType !== "race_document" ||
    canonical.sourceRaceId !== sourceRaceId
  ) {
    throw new Error("legacy population race canonical authority drifted");
  }
  return Object.freeze({
    requestOrdinal: count(row.request_ordinal, "legacy requestOrdinal"),
    endpoint,
    observedAt: timestamp(row.observed_at, "legacy observedAt"),
    sourceRaceId,
    rawEvidenceSha256: sha256(row.raw_evidence_sha256, "legacy rawEvidenceSha256"),
    canonical: Object.freeze({ ...canonical }),
  });
}

function validateIdentities(
  identities: readonly DnaPopulationRaceIndexCompactIdentity[],
): readonly DnaPopulationRaceIndexCompactIdentity[] {
  if (identities.length > 5_000) {
    throw new Error("population race identity batch is too large");
  }
  const seen = new Set<string>();
  return Object.freeze(
    identities.map((identity) => {
      const sourceRaceId = text(identity.sourceRaceId, "sourceRaceId");
      const rawEvidenceSha256 = sha256(
        identity.rawEvidenceSha256,
        "rawEvidenceSha256",
      );
      if (seen.has(sourceRaceId)) {
        throw new Error("population race identity batch contains duplicates");
      }
      seen.add(sourceRaceId);
      return Object.freeze({ sourceRaceId, rawEvidenceSha256 });
    }),
  );
}

export function createNeonDnaPopulationRaceIndexGenerationRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  ownerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): DnaPopulationRaceIndexGenerationRepository {
  const databaseUrl = input.databaseUrl.trim();
  if (databaseUrl === "") throw new Error("databaseUrl is required");
  const databaseOwnerId = uuid(input.databaseOwnerId, "databaseOwnerId");
  const configuredOwnerId = ownerId(input.ownerId);
  if (!ROLE_PATTERN.test(input.runtimeRole))
    throw new Error("runtimeRole is invalid");
  const runtimeRole = input.runtimeRole;
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  async function transaction<T>(request: {
    ownerId: string;
    readOnly: boolean;
    run: (
      client: Awaited<ReturnType<typeof sessionFactory>>["client"],
    ) => Promise<T>;
  }): Promise<T> {
    if (ownerId(request.ownerId) !== configuredOwnerId) {
      throw new Error("population race index owner access denied");
    }
    const session = await sessionFactory(databaseUrl);
    let begun = false;
    try {
      await session.client.query(
        request.readOnly
          ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
          : "BEGIN ISOLATION LEVEL SERIALIZABLE",
      );
      begun = true;
      await session.client.query(SET_OWNER_SCOPE_SQL, [databaseOwnerId]);
      verifyIsolation(
        await session.client.query(VERIFY_ISOLATION_SQL, [
          databaseOwnerId,
          configuredOwnerId,
        ]),
        { databaseOwnerId, ownerId: configuredOwnerId, runtimeRole },
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
    async begin(requestOwnerId, request) {
      const authority = validateAuthority(request.authority);
      return transaction({
        ownerId: requestOwnerId,
        readOnly: false,
        async run(client) {
          return parseCheckpoint(
            oneRow(
              await client.query(
                "SELECT * FROM dna.begin_dna_population_race_index_generation($1::uuid,$2::text,$3::jsonb,$4::timestamptz)",
                [
                  databaseOwnerId,
                  workerId(request.workerId),
                  JSON.stringify(authority),
                  timestamp(request.startedAt, "startedAt"),
                ],
              ),
              "population race index begin",
            ),
          );
        },
      });
    },

    async readLegacyChunk(requestOwnerId, request) {
      if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 5_000) {
        throw new Error("legacy population race read limit is invalid");
      }
      return transaction({
        ownerId: requestOwnerId,
        readOnly: true,
        async run(client) {
          const result = await client.query(
            "SELECT * FROM dna.read_dna_population_race_index_legacy_chunk($1::uuid,$2::text,$3::text,$4::integer)",
            [
              databaseOwnerId,
              sha256(request.generationId, "generationId"),
              request.afterSourceRaceId,
              request.limit,
            ],
          );
          return Object.freeze({
            documents: Object.freeze(result.rows.map(legacyDocument)),
          });
        },
      });
    },

    async registerCompactionChunk(requestOwnerId, request) {
      const identities = validateIdentities(request.identities);
      return transaction({
        ownerId: requestOwnerId,
        readOnly: false,
        async run(client) {
          return parseCheckpoint(
            oneRow(
              await client.query(
                "SELECT * FROM dna.register_dna_population_race_index_r2_compaction_chunk($1::uuid,$2::text,$3::text,$4::jsonb,$5::jsonb,$6::timestamptz)",
                [
                  databaseOwnerId,
                  workerId(request.workerId),
                  sha256(request.generationId, "generationId"),
                  JSON.stringify(request.receipt),
                  JSON.stringify(identities),
                  timestamp(request.registeredAt, "registeredAt"),
                ],
              ),
              "population race R2 compaction registration",
            ),
          );
        },
      });
    },

    async finalizeCompaction(requestOwnerId, request) {
      return transaction({
        ownerId: requestOwnerId,
        readOnly: false,
        async run(client) {
          return parseCheckpoint(
            oneRow(
              await client.query(
                "SELECT * FROM dna.finalize_dna_population_race_index_r2_compaction($1::uuid,$2::text,$3::text,$4::timestamptz)",
                [
                  databaseOwnerId,
                  workerId(request.workerId),
                  sha256(request.generationId, "generationId"),
                  timestamp(request.compactedAt, "compactedAt"),
                ],
              ),
              "population race R2 compaction finalization",
            ),
          );
        },
      });
    },

    async listR2ChunkManifests(requestOwnerId, request) {
      if (
        !Number.isSafeInteger(request.afterChunkOrdinal) ||
        request.afterChunkOrdinal < 0 ||
        !Number.isSafeInteger(request.limit) ||
        request.limit < 1 ||
        request.limit > 100
      ) {
        throw new Error("population R2 manifest read bounds are invalid");
      }
      const generationId = sha256(request.generationId, "generationId");
      return transaction({
        ownerId: requestOwnerId,
        readOnly: true,
        async run(client) {
          const result = await client.query(
            "SELECT * FROM dna.read_dna_population_race_index_r2_chunk_manifests($1::uuid,$2::text,$3::integer,$4::integer)",
            [
              databaseOwnerId,
              generationId,
              request.afterChunkOrdinal,
              request.limit,
            ],
          );
          return Object.freeze(
            result.rows.map((row) =>
              Object.freeze({
                ...r2ChunkManifest(row),
                generationId,
              }),
            ),
          );
        },
      });
    },

    async registerCompactIdentityChunk(requestOwnerId, request) {
      const identities = validateIdentities(request.identities);
      if (
        !Number.isSafeInteger(request.chunkOrdinal) ||
        request.chunkOrdinal < 1
      ) {
        throw new Error("population compact identity chunk ordinal is invalid");
      }
      return transaction({
        ownerId: requestOwnerId,
        readOnly: false,
        async run(client) {
          return parseCheckpoint(
            oneRow(
              await client.query(
                "SELECT * FROM dna.register_dna_population_race_index_compact_identity_chunk($1::uuid,$2::text,$3::text,$4::integer,$5::jsonb,$6::timestamptz)",
                [
                  databaseOwnerId,
                  workerId(request.workerId),
                  sha256(request.generationId, "generationId"),
                  request.chunkOrdinal,
                  JSON.stringify(identities),
                  timestamp(request.registeredAt, "registeredAt"),
                ],
              ),
              "population compact identity registration",
            ),
          );
        },
      });
    },

    async lookupIdentities(requestOwnerId, request) {
      const sourceRaceIds = request.sourceRaceIds.map((value) =>
        text(value, "sourceRaceId"),
      );
      if (sourceRaceIds.length > 5_000 || new Set(sourceRaceIds).size !== sourceRaceIds.length) {
        throw new Error("population race identity lookup is invalid");
      }
      if (sourceRaceIds.length === 0) return Object.freeze([]);
      return transaction({
        ownerId: requestOwnerId,
        readOnly: true,
        async run(client) {
          const result = await client.query(
            "SELECT * FROM dna.lookup_dna_population_race_index_compact_identities($1::uuid,$2::text,$3::jsonb)",
            [
              databaseOwnerId,
              sha256(request.generationId, "generationId"),
              JSON.stringify(sourceRaceIds),
            ],
          );
          return Object.freeze(result.rows.map(compactIdentity));
        },
      });
    },

    async appendR2Batch(requestOwnerId, request) {
      validateBatch(request.batch);
      const identities = validateIdentities(request.newIdentities);
      if ((identities.length === 0) !== (request.chunk === null)) {
        throw new Error("population race R2 chunk presence is invalid");
      }
      return transaction({
        ownerId: requestOwnerId,
        readOnly: false,
        async run(client) {
          return parseCheckpoint(
            oneRow(
              await client.query(
                "SELECT * FROM dna.append_dna_population_race_index_r2_batch($1::uuid,$2::text,$3::jsonb,$4::jsonb,$5::jsonb,$6::timestamptz)",
                [
                  databaseOwnerId,
                  workerId(request.workerId),
                  JSON.stringify(request.batch),
                  JSON.stringify(identities),
                  request.chunk === null ? null : JSON.stringify(request.chunk),
                  timestamp(request.writtenAt, "writtenAt"),
                ],
              ),
              "population race R2 append",
            ),
          );
        },
      });
    },

    async publish(requestOwnerId, request) {
      return transaction({
        ownerId: requestOwnerId,
        readOnly: false,
        async run(client) {
          return parseCheckpoint(
            oneRow(
              await client.query(
                "SELECT * FROM dna.publish_dna_population_race_index_generation($1::uuid,$2::text,$3::text,$4::timestamptz)",
                [
                  databaseOwnerId,
                  workerId(request.workerId),
                  sha256(request.generationId, "generationId"),
                  timestamp(request.publishedAt, "publishedAt"),
                ],
              ),
              "population race index publication",
            ),
          );
        },
      });
    },

    async load(requestOwnerId, generationId) {
      return transaction({
        ownerId: requestOwnerId,
        readOnly: true,
        async run(client) {
          const result = await client.query(
            "SELECT * FROM dna.read_dna_population_race_index_generation($1::uuid,$2::text)",
            [databaseOwnerId, sha256(generationId, "generationId")],
          );
          return result.rows.length === 0
            ? null
            : parseCheckpoint(oneRow(result, "population race index read"));
        },
      });
    },
  });
}
