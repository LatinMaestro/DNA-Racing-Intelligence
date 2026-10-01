import {
  DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_CHECKPOINT_VERSION,
  type DnaPopulationEntrantAuthoritySuccessorCheckpoint,
  type DnaPopulationEntrantAuthoritySuccessorCheckpointAuthority,
  type DnaPopulationEntrantAuthoritySuccessorCheckpointRepository,
  type DnaPopulationEntrantAuthoritySuccessorChunkManifest,
} from "./dna-population-entrant-authority-successor-checkpoint";
import type { DnaPopulationEntrantAuthorityR2ChunkReceipt } from "./dna-population-entrant-authority-r2-store";
import {
  DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_BYTES,
  DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS,
} from "./dna-population-race-index-r2-chunk";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;
type DbRow = Record<string, unknown>;

const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";

const VERIFY_ISOLATION_SQL = [
  "SELECT owner.id::text AS database_owner_id,",
  "  owner.clerk_user_id AS authenticated_owner_id,",
  "  bool_and(relation.relrowsecurity) AS all_rls_enabled,",
  "  bool_and(relation.relforcerowsecurity) AS all_force_rls_enabled,",
  "  bool_or(has_table_privilege(session_user, relation.oid,",
  "    'SELECT,INSERT,UPDATE,DELETE')) AS runtime_can_access_tables,",
  "  has_function_privilege(session_user,",
  "    'dna.begin_dna_population_entrant_authority_successor_generation(uuid,jsonb,timestamp with time zone)',",
  "    'EXECUTE') AS runtime_can_begin,",
  "  has_function_privilege(session_user,",
  "    'dna.register_dna_population_entrant_authority_successor_chunk(uuid,text,jsonb,timestamp with time zone)',",
  "    'EXECUTE') AS runtime_can_register,",
  "  has_function_privilege(session_user,",
  "    'dna.read_dna_population_entrant_authority_successor_generation(uuid,text)',",
  "    'EXECUTE') AS runtime_can_read,",
  "  has_function_privilege(session_user,",
  "    'dna.read_dna_population_entrant_authority_successor_chunk_manifests(uuid,text,integer,integer)',",
  "    'EXECUTE') AS runtime_can_list_manifests,",
  "  has_function_privilege(session_user,",
  "    'dna.reject_dna_population_entrant_authority_successor_chunk_mutation()',",
  "    'EXECUTE') AS runtime_can_mutate_manifests,",
  "  session_user::text AS session_user_name,",
  "  current_user::text AS current_user_name,",
  "  role.rolsuper AS runtime_is_superuser,",
  "  role.rolbypassrls AS runtime_bypasses_rls,",
  "  role.rolcreaterole AS runtime_can_create_roles,",
  "  role.rolcreatedb AS runtime_can_create_databases,",
  "  has_database_privilege(session_user, current_database(), 'CREATE')",
  "    AS runtime_can_create_in_database,",
  "  has_schema_privilege(session_user, 'dna', 'CREATE')",
  "    AS runtime_can_create_in_schema,",
  "  COALESCE(pg_has_role(session_user, (",
  "    SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'neon_superuser'",
  "  ), 'MEMBER'), false) AS runtime_is_neon_superuser_member",
  "FROM dna.app_owner owner",
  "CROSS JOIN LATERAL unnest(ARRAY[",
  "  'dna.dna_population_entrant_authority_successor_generation'::regclass,",
  "  'dna.dna_population_entrant_authority_successor_chunk'::regclass",
  "]) target(oid)",
  "JOIN pg_catalog.pg_class relation ON relation.oid = target.oid",
  "JOIN pg_catalog.pg_roles role ON role.rolname = session_user",
  "WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2",
  "GROUP BY owner.id, owner.clerk_user_id, role.rolsuper, role.rolbypassrls,",
  "  role.rolcreaterole, role.rolcreatedb",
].join("\n");

function record(value: unknown, field: string): DbRow {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(field + " must be a database record");
  }
  return value as DbRow;
}

function oneRow(result: QueryResult, field: string): DbRow {
  if (result.rows.length !== 1) {
    throw new Error(field + " must return exactly one row");
  }
  return record(result.rows[0], field);
}

function text(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    CONTROL_PATTERN.test(value)
  ) {
    throw new Error(field + " is invalid");
  }
  return value;
}

function boundedText(
  value: unknown,
  field: string,
  maximumLength: number,
): string {
  const normalized = text(value, field);
  if (normalized.length > maximumLength) {
    throw new Error(field + " is invalid");
  }
  return normalized;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(field + " must be boolean");
  }
  return value;
}

function uuid(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new Error(field + " is invalid");
  }
  return normalized;
}

function sha256(value: unknown, field: string): string {
  const normalized = text(value, field).toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) {
    throw new Error(field + " is invalid");
  }
  return normalized;
}

function timestamp(value: unknown, field: string): string {
  if (value === null || value === undefined) {
    throw new Error(field + " is invalid");
  }
  const parsed = value instanceof Date ? value : new Date(text(value, field));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(field + " is invalid");
  }
  return parsed.toISOString();
}

function count(value: unknown, field: string): number {
  const parsed =
    typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) < 0) {
    throw new Error(field + " is invalid");
  }
  return parsed as number;
}

function positive(
  value: unknown,
  field: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const normalized = count(value, field);
  if (normalized < 1 || normalized > maximum) {
    throw new Error(field + " is invalid");
  }
  return normalized;
}

function ownerId(value: string): string {
  return boundedText(value, "ownerId", 512);
}

function validateAuthority(
  value: DnaPopulationEntrantAuthoritySuccessorCheckpointAuthority,
): DnaPopulationEntrantAuthoritySuccessorCheckpointAuthority {
  const baseGenerationId = sha256(value.baseGenerationId, "baseGenerationId");
  const baseRecordSetSha256 = sha256(
    value.baseRecordSetSha256,
    "baseRecordSetSha256",
  );
  const successorGenerationId = sha256(
    value.successorGenerationId,
    "successorGenerationId",
  );
  const successorRecordSetSha256 = sha256(
    value.successorRecordSetSha256,
    "successorRecordSetSha256",
  );
  const unresolvedRaceSetSha256 = sha256(
    value.unresolvedRaceSetSha256,
    "unresolvedRaceSetSha256",
  );
  const unresolvedRaceCount = positive(
    value.unresolvedRaceCount,
    "unresolvedRaceCount",
  );
  const replacementRaceCount = positive(
    value.replacementRaceCount,
    "replacementRaceCount",
  );
  const replacementRaceSetSha256 = sha256(
    value.replacementRaceSetSha256,
    "replacementRaceSetSha256",
  );
  const replacementRecordSetSha256 = sha256(
    value.replacementRecordSetSha256,
    "replacementRecordSetSha256",
  );
  const quarantinedRaceCountBefore = positive(
    value.quarantinedRaceCountBefore,
    "quarantinedRaceCountBefore",
  );
  const quarantinedRaceCountAfter = count(
    value.quarantinedRaceCountAfter,
    "quarantinedRaceCountAfter",
  );
  if (
    value.version !==
      DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_CHECKPOINT_VERSION ||
    baseGenerationId !== unresolvedRaceSetSha256 ||
    successorGenerationId === baseGenerationId ||
    replacementRaceCount > unresolvedRaceCount ||
    quarantinedRaceCountBefore > unresolvedRaceCount ||
    quarantinedRaceCountAfter >= quarantinedRaceCountBefore ||
    quarantinedRaceCountBefore - quarantinedRaceCountAfter !==
      replacementRaceCount
  ) {
    throw new Error(
      "population entrant authority successor checkpoint authority is invalid",
    );
  }
  return Object.freeze({
    version: DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_CHECKPOINT_VERSION,
    baseGenerationId,
    baseRecordSetSha256,
    successorGenerationId,
    successorRecordSetSha256,
    unresolvedRaceCount,
    unresolvedRaceSetSha256,
    replacementRaceCount,
    replacementRaceSetSha256,
    replacementRecordSetSha256,
    quarantinedRaceCountBefore,
    quarantinedRaceCountAfter,
  });
}

function validateReceipt(
  value: DnaPopulationEntrantAuthorityR2ChunkReceipt,
): DnaPopulationEntrantAuthorityR2ChunkReceipt {
  if (value.version !== 1) {
    throw new Error("population entrant chunk receipt version is invalid");
  }
  const firstSourceRaceId = boundedText(
    value.firstSourceRaceId,
    "firstSourceRaceId",
    512,
  );
  const lastSourceRaceId = boundedText(
    value.lastSourceRaceId,
    "lastSourceRaceId",
    512,
  );
  return Object.freeze({
    version: 1 as const,
    generationId: sha256(value.generationId, "generationId"),
    chunkOrdinal: positive(value.chunkOrdinal, "chunkOrdinal", 1_000_000),
    objectKey: boundedText(value.objectKey, "objectKey", 2_048),
    bodySha256: sha256(value.bodySha256, "bodySha256"),
    byteLength: positive(
      value.byteLength,
      "byteLength",
      DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_BYTES,
    ),
    rowCount: positive(
      value.rowCount,
      "rowCount",
      DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS,
    ),
    firstSourceRaceId,
    lastSourceRaceId,
    raceSetSha256: sha256(value.raceSetSha256, "raceSetSha256"),
    recordSetSha256: sha256(value.recordSetSha256, "recordSetSha256"),
  });
}

function parseCheckpoint(
  value: unknown,
  expectedDatabaseOwnerId: string,
  expectedAuthority:
    | DnaPopulationEntrantAuthoritySuccessorCheckpointAuthority
    | Readonly<{ successorGenerationId: string }>,
): DnaPopulationEntrantAuthoritySuccessorCheckpoint {
  const row = record(
    value,
    "population entrant authority successor checkpoint",
  );
  const databaseVersion = count(row.version, "version");
  if (databaseVersion !== 1) {
    throw new Error(
      "population entrant authority successor checkpoint authority drifted",
    );
  }
  const checkpoint = Object.freeze({
    version: DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_CHECKPOINT_VERSION,
    baseGenerationId: sha256(row.base_generation_id, "baseGenerationId"),
    baseRecordSetSha256: sha256(
      row.base_record_set_sha256,
      "baseRecordSetSha256",
    ),
    successorGenerationId: sha256(row.generation_id, "successorGenerationId"),
    successorRecordSetSha256: sha256(
      row.successor_record_set_sha256,
      "successorRecordSetSha256",
    ),
    unresolvedRaceCount: positive(
      row.unresolved_race_count,
      "unresolvedRaceCount",
    ),
    unresolvedRaceSetSha256: sha256(
      row.unresolved_race_set_sha256,
      "unresolvedRaceSetSha256",
    ),
    replacementRaceCount: positive(
      row.replacement_race_count,
      "replacementRaceCount",
    ),
    replacementRaceSetSha256: sha256(
      row.replacement_race_set_sha256,
      "replacementRaceSetSha256",
    ),
    replacementRecordSetSha256: sha256(
      row.replacement_record_set_sha256,
      "replacementRecordSetSha256",
    ),
    quarantinedRaceCountBefore: positive(
      row.quarantined_race_count_before,
      "quarantinedRaceCountBefore",
    ),
    quarantinedRaceCountAfter: count(
      row.quarantined_race_count_after,
      "quarantinedRaceCountAfter",
    ),
    chunkCount: count(row.chunk_count, "chunkCount"),
    persistedRaceCount: count(row.persisted_race_count, "persistedRaceCount"),
    lastSourceRaceId:
      row.last_source_race_id === null || row.last_source_race_id === undefined
        ? null
        : boundedText(row.last_source_race_id, "lastSourceRaceId", 512),
    startedAt: timestamp(row.started_at, "startedAt"),
    updatedAt: timestamp(row.updated_at, "updatedAt"),
  });
  const databaseOwnerId = uuid(
    boundedText(row.owner_id, "owner_id", 64),
    "owner_id",
  );
  const empty =
    checkpoint.chunkCount === 0 &&
    checkpoint.persistedRaceCount === 0 &&
    checkpoint.lastSourceRaceId === null;
  const populated =
    checkpoint.chunkCount > 0 &&
    checkpoint.persistedRaceCount > 0 &&
    checkpoint.lastSourceRaceId !== null;
  if (
    databaseOwnerId !== expectedDatabaseOwnerId ||
    checkpoint.version !==
      DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_CHECKPOINT_VERSION ||
    checkpoint.baseGenerationId !== checkpoint.unresolvedRaceSetSha256 ||
    checkpoint.successorGenerationId === checkpoint.baseGenerationId ||
    checkpoint.successorGenerationId !==
      expectedAuthority.successorGenerationId ||
    ("baseGenerationId" in expectedAuthority &&
      (checkpoint.baseGenerationId !== expectedAuthority.baseGenerationId ||
        checkpoint.baseRecordSetSha256 !==
          expectedAuthority.baseRecordSetSha256 ||
        checkpoint.successorRecordSetSha256 !==
          expectedAuthority.successorRecordSetSha256 ||
        checkpoint.unresolvedRaceCount !==
          expectedAuthority.unresolvedRaceCount ||
        checkpoint.unresolvedRaceSetSha256 !==
          expectedAuthority.unresolvedRaceSetSha256 ||
        checkpoint.replacementRaceCount !==
          expectedAuthority.replacementRaceCount ||
        checkpoint.replacementRaceSetSha256 !==
          expectedAuthority.replacementRaceSetSha256 ||
        checkpoint.replacementRecordSetSha256 !==
          expectedAuthority.replacementRecordSetSha256 ||
        checkpoint.quarantinedRaceCountBefore !==
          expectedAuthority.quarantinedRaceCountBefore ||
        checkpoint.quarantinedRaceCountAfter !==
          expectedAuthority.quarantinedRaceCountAfter)) ||
    checkpoint.replacementRaceCount > checkpoint.unresolvedRaceCount ||
    checkpoint.quarantinedRaceCountBefore > checkpoint.unresolvedRaceCount ||
    checkpoint.quarantinedRaceCountAfter >=
      checkpoint.quarantinedRaceCountBefore ||
    checkpoint.quarantinedRaceCountBefore -
      checkpoint.quarantinedRaceCountAfter !==
      checkpoint.replacementRaceCount ||
    checkpoint.persistedRaceCount > checkpoint.unresolvedRaceCount ||
    (!empty && !populated) ||
    new Date(checkpoint.updatedAt).getTime() <
      new Date(checkpoint.startedAt).getTime()
  ) {
    throw new Error(
      "population entrant authority successor checkpoint authority drifted",
    );
  }
  return checkpoint;
}

function parseManifest(
  value: unknown,
  successorGenerationId: string,
): DnaPopulationEntrantAuthoritySuccessorChunkManifest {
  const row = record(
    value,
    "population entrant authority successor chunk manifest",
  );
  return Object.freeze({
    version: 1 as const,
    generationId: successorGenerationId,
    chunkOrdinal: positive(row.chunk_ordinal, "chunkOrdinal", 1_000_000),
    objectKey: boundedText(row.object_key, "objectKey", 2_048),
    bodySha256: sha256(row.body_sha256, "bodySha256"),
    byteLength: positive(
      row.byte_length,
      "byteLength",
      DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_BYTES,
    ),
    rowCount: positive(
      row.row_count,
      "rowCount",
      DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS,
    ),
    firstSourceRaceId: boundedText(
      row.first_source_race_id,
      "firstSourceRaceId",
      512,
    ),
    lastSourceRaceId: boundedText(
      row.last_source_race_id,
      "lastSourceRaceId",
      512,
    ),
    raceSetSha256: sha256(row.race_set_sha256, "raceSetSha256"),
    recordSetSha256: sha256(row.record_set_sha256, "recordSetSha256"),
    registeredAt: timestamp(row.registered_at, "registeredAt"),
  });
}

function verifyIsolation(
  result: QueryResult,
  input: Readonly<{
    databaseOwnerId: string;
    ownerId: string;
    runtimeRole: string;
  }>,
): void {
  const row = oneRow(
    result,
    "population entrant authority successor checkpoint isolation",
  );
  if (
    text(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    text(row.authenticated_owner_id, "authenticated_owner_id") !==
      input.ownerId ||
    !bool(row.all_rls_enabled, "all_rls_enabled") ||
    !bool(row.all_force_rls_enabled, "all_force_rls_enabled") ||
    bool(row.runtime_can_access_tables, "runtime_can_access_tables") ||
    !bool(row.runtime_can_begin, "runtime_can_begin") ||
    !bool(row.runtime_can_register, "runtime_can_register") ||
    !bool(row.runtime_can_read, "runtime_can_read") ||
    !bool(row.runtime_can_list_manifests, "runtime_can_list_manifests") ||
    bool(row.runtime_can_mutate_manifests, "runtime_can_mutate_manifests") ||
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
      "population entrant authority successor checkpoint requires least-privilege owner isolation",
    );
  }
}

export function createNeonDnaPopulationEntrantAuthoritySuccessorCheckpointRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    ownerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): DnaPopulationEntrantAuthoritySuccessorCheckpointRepository {
  const databaseUrl = input.databaseUrl.trim();
  if (databaseUrl.length < 1) {
    throw new Error("databaseUrl is required");
  }
  const databaseOwnerId = uuid(input.databaseOwnerId, "databaseOwnerId");
  const configuredOwnerId = ownerId(input.ownerId);
  if (!ROLE_PATTERN.test(input.runtimeRole)) {
    throw new Error("runtimeRole is invalid");
  }
  const runtimeRole = input.runtimeRole;
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  async function transaction<T>(
    request: Readonly<{
      ownerId: string;
      readOnly: boolean;
      run: (
        client: Awaited<ReturnType<typeof sessionFactory>>["client"],
      ) => Promise<T>;
    }>,
  ): Promise<T> {
    if (ownerId(request.ownerId) !== configuredOwnerId) {
      throw new Error(
        "population entrant authority successor checkpoint owner access denied",
      );
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
      if (begun) {
        await session.client.query("ROLLBACK").catch(() => undefined);
      }
      throw error;
    } finally {
      await session.close();
    }
  }

  return Object.freeze({
    async begin(requestOwnerId, request) {
      const authority = validateAuthority(request.authority);
      const startedAt = timestamp(request.startedAt, "startedAt");
      return transaction({
        ownerId: requestOwnerId,
        readOnly: false,
        async run(client) {
          return parseCheckpoint(
            oneRow(
              await client.query(
                "SELECT * FROM dna.begin_dna_population_entrant_authority_successor_generation($1::uuid,$2::jsonb,$3::timestamptz)",
                [databaseOwnerId, JSON.stringify(authority), startedAt],
              ),
              "population entrant authority successor checkpoint begin",
            ),
            databaseOwnerId,
            authority,
          );
        },
      });
    },

    async registerChunk(requestOwnerId, request) {
      const successorGenerationId = sha256(
        request.successorGenerationId,
        "successorGenerationId",
      );
      const receipt = validateReceipt(request.receipt);
      if (receipt.generationId !== successorGenerationId) {
        throw new Error(
          "population entrant authority successor checkpoint chunk generation does not match",
        );
      }
      const registeredAt = timestamp(request.registeredAt, "registeredAt");
      return transaction({
        ownerId: requestOwnerId,
        readOnly: false,
        async run(client) {
          return parseCheckpoint(
            oneRow(
              await client.query(
                "SELECT * FROM dna.register_dna_population_entrant_authority_successor_chunk($1::uuid,$2::text,$3::jsonb,$4::timestamptz)",
                [
                  databaseOwnerId,
                  successorGenerationId,
                  JSON.stringify(receipt),
                  registeredAt,
                ],
              ),
              "population entrant authority successor chunk registration",
            ),
            databaseOwnerId,
            { successorGenerationId },
          );
        },
      });
    },

    async read(requestOwnerId, request) {
      const successorGenerationId = sha256(
        request.successorGenerationId,
        "successorGenerationId",
      );
      return transaction({
        ownerId: requestOwnerId,
        readOnly: true,
        async run(client) {
          return parseCheckpoint(
            oneRow(
              await client.query(
                "SELECT * FROM dna.read_dna_population_entrant_authority_successor_generation($1::uuid,$2::text)",
                [databaseOwnerId, successorGenerationId],
              ),
              "population entrant authority successor checkpoint read",
            ),
            databaseOwnerId,
            { successorGenerationId },
          );
        },
      });
    },

    async listChunkManifests(requestOwnerId, request) {
      if (
        !Number.isSafeInteger(request.afterChunkOrdinal) ||
        request.afterChunkOrdinal < 0 ||
        !Number.isSafeInteger(request.limit) ||
        request.limit < 1 ||
        request.limit > 100
      ) {
        throw new Error(
          "population entrant authority successor manifest read bounds are invalid",
        );
      }
      const successorGenerationId = sha256(
        request.successorGenerationId,
        "successorGenerationId",
      );
      return transaction({
        ownerId: requestOwnerId,
        readOnly: true,
        async run(client) {
          const result = await client.query(
            "SELECT * FROM dna.read_dna_population_entrant_authority_successor_chunk_manifests($1::uuid,$2::text,$3::integer,$4::integer)",
            [
              databaseOwnerId,
              successorGenerationId,
              request.afterChunkOrdinal,
              request.limit,
            ],
          );
          return Object.freeze(
            result.rows.map((row) => parseManifest(row, successorGenerationId)),
          );
        },
      });
    },
  });
}
