import { createHash } from "node:crypto";

import type { RaceArchiveCoreLocator } from "./race-archive-core-locator-accumulator";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const MAXIMUM_LOCATORS = 50_000;
const MAXIMUM_PARTITIONS_PER_CORE = 10_000;
const MAXIMUM_VERSION_BOUND = 10_000;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;

export type RaceArchiveCoreLocatorReceipt = Readonly<{
  status: "sealed" | "existing";
  datasetVersionId: string;
  importBatchId: string;
  locatorSetSha256: string;
  coreLocatorCount: number;
  readyRowCount: number;
  partitionReferenceCount: number;
  builtAt: string;
}>;

export type PersistedRaceArchiveCoreLocator = RaceArchiveCoreLocator &
  Readonly<{
    versionNumber: number;
    builtAt: string;
  }>;

export type NeonRaceArchiveCoreLocatorRepository = Readonly<{
  replace: (input: {
    ownerId: string;
    datasetVersionId: string;
    importBatchId: string;
    locators: readonly RaceArchiveCoreLocator[];
    builtAt: string;
  }) => Promise<RaceArchiveCoreLocatorReceipt>;
  listForCore: (input: {
    ownerId: string;
    sourceCoreId: string;
    maximumVersions: number;
  }) => Promise<readonly PersistedRaceArchiveCoreLocator[]>;
}>;

const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";

const VERIFY_ISOLATION_SQL = [
  "SELECT",
  "  owner.id::text AS database_owner_id,",
  "  owner.clerk_user_id AS authenticated_owner_id,",
  "  locator.relrowsecurity AS locator_rls,",
  "  locator.relforcerowsecurity AS locator_force_rls,",
  "  receipt.relrowsecurity AS receipt_rls,",
  "  receipt.relforcerowsecurity AS receipt_force_rls,",
  "  has_table_privilege(session_user, 'dna.race_archive_core_locator', 'SELECT')",
  "    AS runtime_can_read_locator_table,",
  "  has_table_privilege(session_user, 'dna.race_archive_core_locator', 'INSERT,UPDATE,DELETE')",
  "    AS runtime_can_write_locator_table,",
  "  has_table_privilege(session_user, 'dna.race_archive_core_locator_receipt', 'SELECT')",
  "    AS runtime_can_read_receipt_table,",
  "  has_table_privilege(session_user, 'dna.race_archive_core_locator_receipt', 'INSERT,UPDATE,DELETE')",
  "    AS runtime_can_write_receipt_table,",
  "  has_function_privilege(session_user,",
  "    'dna.replace_race_archive_core_locators(uuid,uuid,uuid,character,jsonb,timestamp with time zone)',",
  "    'EXECUTE') AS runtime_can_replace,",
  "  has_function_privilege(session_user,",
  "    'dna.list_race_archive_core_locators(uuid,text,integer)',",
  "    'EXECUTE') AS runtime_can_list,",
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
  "JOIN pg_catalog.pg_class locator",
  "  ON locator.oid = 'dna.race_archive_core_locator'::regclass",
  "JOIN pg_catalog.pg_class receipt",
  "  ON receipt.oid = 'dna.race_archive_core_locator_receipt'::regclass",
  "JOIN pg_catalog.pg_roles role ON role.rolname = session_user",
  "WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2",
].join("\n");

const REPLACE_SQL = [
  "SELECT",
  "  status,",
  "  core_locator_count,",
  "  ready_row_count::text AS ready_row_count,",
  "  partition_reference_count::text AS partition_reference_count,",
  "  built_at",
  "FROM dna.replace_race_archive_core_locators(",
  "  $1::uuid, $2::uuid, $3::uuid, $4::character(64), $5::jsonb, $6::timestamptz",
  ")",
].join("\n");

const LIST_SQL = [
  "SELECT",
  "  dataset_version_id::text AS dataset_version_id,",
  "  import_batch_id::text AS import_batch_id,",
  "  version_number::text AS version_number,",
  "  partition_numbers,",
  "  ready_row_count::text AS ready_row_count,",
  "  first_source_row_number::text AS first_source_row_number,",
  "  last_source_row_number::text AS last_source_row_number,",
  "  built_at",
  "FROM dna.list_race_archive_core_locators($1::uuid, $2::text, $3::integer)",
].join("\n");

function databaseRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be a database record`);
  }
  return value as Record<string, unknown>;
}

function oneRow(result: QueryResult, field: string): Record<string, unknown> {
  if (result.rows.length !== 1) {
    throw new Error(`${field} must return exactly one row`);
  }
  return databaseRecord(result.rows[0], field);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean`);
  return value;
}

function uuid(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new Error(`${field} must be a UUID`);
  }
  return normalized;
}

function owner(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 512 ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new Error("ownerId is invalid");
  }
  return normalized;
}

function coreId(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 512 ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new Error("sourceCoreId is invalid");
  }
  return normalized;
}

function safeInteger(value: unknown, field: string, minimum = 0): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${field} must be a safe integer`);
  }
  return parsed;
}

function positiveBound(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} is outside its bound`);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  const raw = value instanceof Date ? value.toISOString() : value;
  if (typeof raw !== "string") throw new Error(`${field} must be a timestamp`);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} must be a timestamp`);
  }
  return parsed.toISOString();
}

function partitionNumbers(value: unknown): readonly number[] {
  if (!Array.isArray(value)) {
    throw new Error("partition_numbers must be an array");
  }
  positiveBound(
    value.length,
    "partition_numbers length",
    MAXIMUM_PARTITIONS_PER_CORE,
  );
  const parsed = value.map((item, index) =>
    safeInteger(item, `partition_numbers[${index}]`),
  );
  for (let index = 1; index < parsed.length; index += 1) {
    if (parsed[index] <= parsed[index - 1]) {
      throw new Error("partition_numbers must be strictly increasing");
    }
  }
  return Object.freeze(parsed);
}

function canonicalizeLocators(input: {
  datasetVersionId: string;
  importBatchId: string;
  locators: readonly RaceArchiveCoreLocator[];
}) {
  positiveBound(input.locators.length, "locators length", MAXIMUM_LOCATORS);
  const seen = new Set<string>();
  let readyRowCount = 0;
  let partitionReferenceCount = 0;
  const payload = input.locators.map((locator) => {
    if (
      uuid(locator.datasetVersionId, "locator.datasetVersionId") !==
        input.datasetVersionId ||
      uuid(locator.importBatchId, "locator.importBatchId") !== input.importBatchId
    ) {
      throw new Error("Race archive Core locator identity conflicts with its build.");
    }
    const sourceCoreId = coreId(locator.sourceCoreId);
    if (seen.has(sourceCoreId)) {
      throw new Error("Race archive Core locators contain duplicate Core IDs.");
    }
    seen.add(sourceCoreId);
    const partitions = partitionNumbers(locator.partitionNumbers);
    const locatorReadyRowCount = safeInteger(
      locator.readyRowCount,
      "locator.readyRowCount",
      1,
    );
    const firstSourceRowNumber = safeInteger(
      locator.firstSourceRowNumber,
      "locator.firstSourceRowNumber",
      1,
    );
    const lastSourceRowNumber = safeInteger(
      locator.lastSourceRowNumber,
      "locator.lastSourceRowNumber",
      firstSourceRowNumber,
    );
    readyRowCount += locatorReadyRowCount;
    partitionReferenceCount += partitions.length;
    if (
      !Number.isSafeInteger(readyRowCount) ||
      !Number.isSafeInteger(partitionReferenceCount)
    ) {
      throw new Error("Race archive Core locator coverage exceeds safe integer bounds.");
    }
    return {
      source_core_id: sourceCoreId,
      partition_numbers: partitions,
      ready_row_count: locatorReadyRowCount,
      first_source_row_number: firstSourceRowNumber,
      last_source_row_number: lastSourceRowNumber,
    };
  });
  payload.sort((left, right) =>
    left.source_core_id.localeCompare(right.source_core_id),
  );
  const serialized = JSON.stringify(payload);
  return {
    payload: Object.freeze(payload),
    serialized,
    sha256: createHash("sha256").update(serialized, "utf8").digest("hex"),
    readyRowCount,
    partitionReferenceCount,
  };
}

function configuration(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
}) {
  const databaseUrl = input.databaseUrl.trim();
  const databaseOwnerId = uuid(input.databaseOwnerId, "databaseOwnerId");
  const runtimeRole = input.runtimeRole.trim();
  if (databaseUrl === "") throw new Error("databaseUrl is required");
  if (!ROLE_PATTERN.test(runtimeRole)) throw new Error("runtimeRole is invalid");
  return { databaseUrl, databaseOwnerId, runtimeRole };
}

function verifyIsolation(
  result: QueryResult,
  input: { databaseOwnerId: string; ownerId: string; runtimeRole: string },
): void {
  const row = oneRow(result, "Race archive Core locator isolation");
  if (
    text(row.database_owner_id, "database_owner_id") !== input.databaseOwnerId ||
    text(row.authenticated_owner_id, "authenticated_owner_id") !== input.ownerId
  ) {
    throw new Error("Race archive Core locator owner scope denied.");
  }
  if (
    !bool(row.locator_rls, "locator_rls") ||
    !bool(row.locator_force_rls, "locator_force_rls") ||
    !bool(row.receipt_rls, "receipt_rls") ||
    !bool(row.receipt_force_rls, "receipt_force_rls")
  ) {
    throw new Error("Race archive Core locators require forced owner RLS.");
  }
  if (
    bool(row.runtime_can_read_locator_table, "runtime_can_read_locator_table") ||
    bool(row.runtime_can_write_locator_table, "runtime_can_write_locator_table") ||
    bool(row.runtime_can_read_receipt_table, "runtime_can_read_receipt_table") ||
    bool(row.runtime_can_write_receipt_table, "runtime_can_write_receipt_table") ||
    !bool(row.runtime_can_replace, "runtime_can_replace") ||
    !bool(row.runtime_can_list, "runtime_can_list")
  ) {
    throw new Error("Race archive Core locator runtime privilege is not bounded.");
  }
  if (
    text(row.session_user_name, "session_user_name") !== input.runtimeRole ||
    text(row.current_user_name, "current_user_name") !== input.runtimeRole ||
    bool(row.runtime_is_superuser, "runtime_is_superuser") ||
    bool(row.runtime_bypasses_rls, "runtime_bypasses_rls") ||
    bool(row.runtime_can_create_roles, "runtime_can_create_roles") ||
    bool(row.runtime_can_create_databases, "runtime_can_create_databases") ||
    bool(row.runtime_is_neon_superuser_member, "runtime_is_neon_superuser_member")
  ) {
    throw new Error("Race archive Core locator runtime role is not least privileged.");
  }
}

function parseReplaceReceipt(
  result: QueryResult,
  input: {
    datasetVersionId: string;
    importBatchId: string;
    locatorSetSha256: string;
    expectedLocatorCount: number;
    expectedReadyRowCount: number;
    expectedPartitionReferenceCount: number;
  },
): RaceArchiveCoreLocatorReceipt {
  const row = oneRow(result, "Race archive Core locator replacement");
  const status = text(row.status, "status");
  if (status !== "sealed" && status !== "existing") {
    throw new Error("Race archive Core locator replacement status is invalid.");
  }
  const coreLocatorCount = safeInteger(
    row.core_locator_count,
    "core_locator_count",
    1,
  );
  const readyRowCount = safeInteger(row.ready_row_count, "ready_row_count", 1);
  const partitionReferenceCount = safeInteger(
    row.partition_reference_count,
    "partition_reference_count",
    1,
  );
  if (
    coreLocatorCount !== input.expectedLocatorCount ||
    readyRowCount !== input.expectedReadyRowCount ||
    partitionReferenceCount !== input.expectedPartitionReferenceCount
  ) {
    throw new Error("Race archive Core locator replacement coverage changed.");
  }
  return Object.freeze({
    status,
    datasetVersionId: input.datasetVersionId,
    importBatchId: input.importBatchId,
    locatorSetSha256: input.locatorSetSha256,
    coreLocatorCount,
    readyRowCount,
    partitionReferenceCount,
    builtAt: timestamp(row.built_at, "built_at"),
  });
}

function parseLocatorRow(
  value: unknown,
  input: { sourceCoreId: string },
): PersistedRaceArchiveCoreLocator {
  const row = databaseRecord(value, "Race archive Core locator row");
  const datasetVersionId = uuid(
    text(row.dataset_version_id, "dataset_version_id"),
    "dataset_version_id",
  );
  const importBatchId = uuid(
    text(row.import_batch_id, "import_batch_id"),
    "import_batch_id",
  );
  const firstSourceRowNumber = safeInteger(
    row.first_source_row_number,
    "first_source_row_number",
    1,
  );
  return Object.freeze({
    datasetVersionId,
    importBatchId,
    sourceCoreId: input.sourceCoreId,
    versionNumber: safeInteger(row.version_number, "version_number", 1),
    partitionNumbers: partitionNumbers(row.partition_numbers),
    readyRowCount: safeInteger(row.ready_row_count, "ready_row_count", 1),
    firstSourceRowNumber,
    lastSourceRowNumber: safeInteger(
      row.last_source_row_number,
      "last_source_row_number",
      firstSourceRowNumber,
    ),
    builtAt: timestamp(row.built_at, "built_at"),
  });
}

export function createNeonRaceArchiveCoreLocatorRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): NeonRaceArchiveCoreLocatorRepository {
  const config = configuration(input);
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  async function withSession<Result>(
    mode: "write" | "read",
    authenticatedOwnerId: string,
    operation: (client: {
      query: (
        statement: string,
        values?: readonly unknown[],
      ) => Promise<QueryResult>;
    }) => Promise<Result>,
  ): Promise<Result> {
    const session = await sessionFactory(config.databaseUrl);
    let transactionStarted = false;
    try {
      await session.client.query(
        mode === "read"
          ? "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY"
          : "BEGIN ISOLATION LEVEL SERIALIZABLE",
      );
      transactionStarted = true;
      const scope = oneRow(
        await session.client.query(SET_OWNER_SCOPE_SQL, [config.databaseOwnerId]),
        "Race archive Core locator owner scope",
      );
      if (text(scope.owner_scope, "owner_scope") !== config.databaseOwnerId) {
        throw new Error("Race archive Core locator owner scope was not applied.");
      }
      verifyIsolation(
        await session.client.query(VERIFY_ISOLATION_SQL, [
          config.databaseOwnerId,
          authenticatedOwnerId,
        ]),
        {
          databaseOwnerId: config.databaseOwnerId,
          ownerId: authenticatedOwnerId,
          runtimeRole: config.runtimeRole,
        },
      );
      const result = await operation(session.client);
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

  return Object.freeze({
    async replace(request) {
      const authenticatedOwnerId = owner(request.ownerId);
      const datasetVersionId = uuid(
        request.datasetVersionId,
        "datasetVersionId",
      );
      const importBatchId = uuid(request.importBatchId, "importBatchId");
      const builtAt = timestamp(request.builtAt, "builtAt");
      const canonical = canonicalizeLocators({
        datasetVersionId,
        importBatchId,
        locators: request.locators,
      });
      return await withSession("write", authenticatedOwnerId, async (client) =>
        parseReplaceReceipt(
          await client.query(REPLACE_SQL, [
            config.databaseOwnerId,
            datasetVersionId,
            importBatchId,
            canonical.sha256,
            canonical.serialized,
            builtAt,
          ]),
          {
            datasetVersionId,
            importBatchId,
            locatorSetSha256: canonical.sha256,
            expectedLocatorCount: canonical.payload.length,
            expectedReadyRowCount: canonical.readyRowCount,
            expectedPartitionReferenceCount: canonical.partitionReferenceCount,
          },
        ),
      );
    },

    async listForCore(request) {
      const authenticatedOwnerId = owner(request.ownerId);
      const sourceCoreId = coreId(request.sourceCoreId);
      const maximumVersions = positiveBound(
        request.maximumVersions,
        "maximumVersions",
        MAXIMUM_VERSION_BOUND,
      );
      return await withSession("read", authenticatedOwnerId, async (client) => {
        const result = await client.query(LIST_SQL, [
          config.databaseOwnerId,
          sourceCoreId,
          maximumVersions,
        ]);
        if (result.rows.length > maximumVersions) {
          throw new Error("Race archive Core locator history exceeds the read bound.");
        }
        const parsed = result.rows.map((row) =>
          parseLocatorRow(row, { sourceCoreId }),
        );
        for (let index = 1; index < parsed.length; index += 1) {
          if (parsed[index].versionNumber <= parsed[index - 1].versionNumber) {
            throw new Error("Race archive Core locator versions are not ordered.");
          }
        }
        return Object.freeze(parsed);
      });
    },
  });
}