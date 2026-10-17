import { createHash } from "node:crypto";
import { classifyBreedingEconomicEvidence } from "@/domain/breeding-economic-evidence";
import { buildOffspringCostBasis } from "@/domain/offspring-cost-basis";
import type {
  BreedingEconomicAssetRegistry,
  BreedingEconomicWriteRepository,
  StoredBreedingEconomicRecord,
  ValidatedBreedingEconomicRecord,
  ValidatedOffspringCostBasisRecord,
} from "@/lib/breeding-economic-write-service";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceClient,
  type NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ROLE = /^[a-z_][a-z0-9_]{0,62}$/;
const HASH = /^[a-f0-9]{64}$/;
const ERROR = "Breeding economic persistence unavailable.";
const MAXIMUM_TRANSACTION_IDS = 128;
const MAXIMUM_EVENT_EVIDENCE_RECORDS = 128;

const VERIFY_SQL = `
  SELECT owner.id::text AS database_owner_id,
    owner.clerk_user_id AS authenticated_owner_id,
    state.relrowsecurity AS state_rls,
    state.relforcerowsecurity AS state_force_rls,
    record.relrowsecurity AS record_rls,
    record.relforcerowsecurity AS record_force_rls,
    assignment.relrowsecurity AS assignment_rls,
    assignment.relforcerowsecurity AS assignment_force_rls,
    session_user::text AS session_user_name,
    current_user::text AS current_user_name,
    role.rolsuper AS runtime_is_superuser,
    role.rolbypassrls AS runtime_bypasses_rls,
    role.rolcreaterole AS runtime_can_create_roles,
    role.rolcreatedb AS runtime_can_create_databases,
    COALESCE(pg_has_role(session_user,
      (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='neon_superuser'),
      'MEMBER'), false) AS runtime_is_neon_superuser_member,
    has_table_privilege(session_user,state.oid,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AS runtime_has_direct_state_access,
    has_table_privilege(session_user,record.oid,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AS runtime_has_direct_record_access,
    has_table_privilege(session_user,assignment.oid,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AS runtime_has_direct_assignment_access
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_class state
    ON state.oid='dna.breeding_economic_state'::regclass
  JOIN pg_catalog.pg_class record
    ON record.oid='dna.breeding_economic_record'::regclass
  JOIN pg_catalog.pg_class assignment
    ON assignment.oid='dna.breeding_cost_basis_transaction'::regclass
  JOIN pg_catalog.pg_roles role ON role.rolname=session_user
  WHERE owner.id=$1::uuid AND owner.clerk_user_id=$2::text
`;
const CONTEXT_SQL = `
  SELECT asset_registry_version,assets_json,economic_version
  FROM dna.read_breeding_economic_write_context($1::uuid)
`;
const WRITE_SQL = `
  SELECT disposition,fingerprint,economic_version
  FROM dna.write_breeding_economic_record(
    $1::uuid,$2::text,$3::text,$4::character(64),$5::character(64),
    $6::text,$7::text,$8::text[]
  )
`;
const READ_SQL = `
  SELECT record_kind,record_json,fingerprint,record_sha256,economic_version
  FROM dna.read_breeding_economic_record($1::uuid,$2::text)
`;
const READ_EVENT_EVIDENCE_SQL = `
  SELECT record_kind,record_json,fingerprint,record_sha256,economic_version
  FROM dna.list_breeding_economic_evidence_by_event(
    $1::uuid,$2::text,$3::integer
  )
`;
const ASSIGNED_SQL = `
  SELECT transaction_id
  FROM dna.list_assigned_breeding_cost_transactions($1::uuid,$2::text[])
`;

export type BreedingEconomicWriteContext = Readonly<{
  assetRegistry: Extract<BreedingEconomicAssetRegistry, { status: "ready" }>;
  economicVersion: string;
}>;

export type NeonBreedingEconomicPersistence =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      repository: Extract<BreedingEconomicWriteRepository, { status: "ready" }>;
      loadContextByOwner: (
        ownerId: string,
      ) => Promise<BreedingEconomicWriteContext>;
      loadEvidenceByBreedingEventByOwner: (
        ownerId: string,
        breedingEventId: string,
      ) => Promise<
        readonly StoredBreedingEconomicRecord<ValidatedBreedingEconomicRecord>[]
      >;
    }>;

function fail(): never {
  throw new Error(ERROR);
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail();
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") fail();
  return value;
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function verifyHash(value: unknown): string {
  const result = text(value);
  if (!HASH.test(result)) fail();
  return result;
}

function numericVersion(value: unknown): string {
  const result = text(value);
  if (!/^(0|[1-9][0-9]*)$/.test(result)) fail();
  return result;
}

function parse<T>(value: unknown): T {
  if (typeof value !== "string") fail();
  try {
    return object(JSON.parse(value) as unknown) as T;
  } catch {
    return fail();
  }
}

function parseArray<T>(value: unknown): readonly T[] {
  if (typeof value !== "string") fail();
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) fail();
    return parsed as readonly T[];
  } catch {
    return fail();
  }
}

function verifyRuntime(
  value: unknown,
  input: Readonly<{
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    runtimeRole: string;
  }>,
) {
  const row = object(value);
  if (
    row.database_owner_id !== input.databaseOwnerId ||
    row.authenticated_owner_id !== input.authenticatedOwnerId ||
    row.session_user_name !== input.runtimeRole ||
    row.current_user_name !== input.runtimeRole ||
    [
      "state_rls",
      "state_force_rls",
      "record_rls",
      "record_force_rls",
      "assignment_rls",
      "assignment_force_rls",
    ].some((field) => row[field] !== true) ||
    [
      "runtime_is_superuser",
      "runtime_bypasses_rls",
      "runtime_can_create_roles",
      "runtime_can_create_databases",
      "runtime_is_neon_superuser_member",
      "runtime_has_direct_state_access",
      "runtime_has_direct_record_access",
      "runtime_has_direct_assignment_access",
    ].some((field) => row[field] !== false)
  )
    fail();
}

function persistenceResult(value: unknown) {
  const row = object(value);
  const status = text(row.disposition);
  const economicVersion = numericVersion(row.economic_version);
  if (status === "created") return { status, economicVersion } as const;
  if (status === "already_exists" || status === "conflict") {
    return {
      status,
      fingerprint: verifyHash(row.fingerprint),
      economicVersion,
    } as const;
  }
  if (status === "version_conflict")
    return { status, economicVersion } as const;
  return fail();
}

function evidenceRecord(value: unknown): ValidatedBreedingEconomicRecord {
  const record = object(value) as unknown as ValidatedBreedingEconomicRecord;
  const expected = classifyBreedingEconomicEvidence(record.input);
  if (JSON.stringify(expected) !== JSON.stringify(record.assessment)) fail();
  return record;
}

function costBasisRecord(value: unknown): ValidatedOffspringCostBasisRecord {
  const record = object(value) as unknown as ValidatedOffspringCostBasisRecord;
  const expected = buildOffspringCostBasis({
    ...record.request,
    previouslyAssignedTransactionIds: [],
  });
  if (JSON.stringify(expected) !== JSON.stringify(record.assessment)) fail();
  return record;
}

function storedRecord<T>(
  row: Record<string, unknown>,
  decode: (value: unknown) => T,
  canonical: (record: T) => object,
): StoredBreedingEconomicRecord<T> {
  const recordJson = text(row.record_json);
  if (hash(recordJson) !== verifyHash(row.record_sha256)) fail();
  const record = decode(parse<unknown>(recordJson));
  const fingerprint = verifyHash(row.fingerprint);
  if (hash(JSON.stringify(canonical(record))) !== fingerprint) fail();
  return {
    record,
    fingerprint,
    economicVersion: numericVersion(row.economic_version),
  };
}

export function createNeonBreedingEconomicPersistence(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): Extract<NeonBreedingEconomicPersistence, { status: "ready" }> {
  if (
    !input.databaseUrl.trim() ||
    !UUID.test(input.databaseOwnerId) ||
    !ROLE.test(input.runtimeRole)
  )
    fail();
  const configuration = Object.freeze({
    databaseUrl: input.databaseUrl,
    databaseOwnerId: input.databaseOwnerId,
    runtimeRole: input.runtimeRole,
  });
  const factory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  async function transaction<T>(
    ownerId: string,
    operation: (client: NeonImportPersistenceClient) => Promise<T>,
  ): Promise<T> {
    if (!ownerId.trim()) fail();
    const session = await factory(configuration.databaseUrl).catch(() =>
      fail(),
    );
    let started = false;
    try {
      await session.client.query(
        "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE",
      );
      started = true;
      await session.client.query(
        "SELECT set_config('statement_timeout','10000',true), set_config('lock_timeout','1000',true)",
      );
      const scope = await session.client.query(
        "SELECT set_config('app.owner_id',$1,true) AS owner_scope",
        [configuration.databaseOwnerId],
      );
      if (
        scope.rows.length !== 1 ||
        object(scope.rows[0]).owner_scope !== configuration.databaseOwnerId
      )
        fail();
      const verified = await session.client.query(VERIFY_SQL, [
        configuration.databaseOwnerId,
        ownerId,
      ]);
      if (verified.rows.length !== 1) fail();
      verifyRuntime(verified.rows[0], {
        ...configuration,
        authenticatedOwnerId: ownerId,
      });
      const result = await operation(session.client);
      await session.client.query("COMMIT");
      started = false;
      return result;
    } catch {
      if (started)
        await session.client.query("ROLLBACK").catch(() => undefined);
      return fail();
    } finally {
      try {
        await session.close();
      } catch {
        fail();
      }
    }
  }

  async function load<T>(
    ownerId: string,
    recordId: string,
    kind: "evidence" | "cost_basis",
    decode: (value: unknown) => T,
    canonical: (record: T) => object,
  ): Promise<StoredBreedingEconomicRecord<T> | null> {
    return transaction(ownerId, async (client) => {
      const result = await client.query(READ_SQL, [
        configuration.databaseOwnerId,
        recordId,
      ]);
      if (result.rows.length === 0) return null;
      if (result.rows.length !== 1) fail();
      const row = object(result.rows[0]);
      if (row.record_kind !== kind) fail();
      return storedRecord(row, decode, canonical);
    });
  }

  async function save(
    ownerId: string,
    kind: "evidence" | "cost_basis",
    recordId: string,
    record: ValidatedBreedingEconomicRecord | ValidatedOffspringCostBasisRecord,
    fingerprint: string,
    expectedVersion: string,
    transactionIds: readonly string[],
  ) {
    if (!HASH.test(fingerprint)) fail();
    const recordJson = JSON.stringify(record);
    return transaction(ownerId, async (client) => {
      const result = await client.query(WRITE_SQL, [
        configuration.databaseOwnerId,
        kind,
        recordId,
        fingerprint,
        hash(recordJson),
        recordJson,
        expectedVersion,
        [...transactionIds].sort((left, right) => left.localeCompare(right)),
      ]);
      if (result.rows.length !== 1) fail();
      return persistenceResult(result.rows[0]);
    });
  }

  const repository: Extract<
    BreedingEconomicWriteRepository,
    { status: "ready" }
  > = {
    status: "ready",
    loadEvidenceByOwner: (ownerId, evidenceId) =>
      load(ownerId, evidenceId, "evidence", evidenceRecord, (record) => ({
        input: record.input,
        assets: record.assets,
      })),
    saveEvidenceByOwner: (ownerId, record, fingerprint, version) =>
      save(
        ownerId,
        "evidence",
        record.input.evidenceId,
        record,
        fingerprint,
        version,
        [],
      ),
    loadCostBasisByOwner: (ownerId, assignmentId) =>
      load(ownerId, assignmentId, "cost_basis", costBasisRecord, (record) => ({
        request: record.request,
        assets: record.assets,
      })),
    loadAssignedTransactionIdsByOwner: (ownerId, transactionIds) => {
      const normalized = [
        ...new Set(transactionIds.map((value) => value.trim())),
      ];
      if (
        normalized.length > MAXIMUM_TRANSACTION_IDS ||
        normalized.some((value) => value === "" || value.length > 128)
      )
        return Promise.reject(new Error(ERROR));
      if (normalized.length === 0) return Promise.resolve([]);
      return transaction(ownerId, async (client) => {
        const result = await client.query(ASSIGNED_SQL, [
          configuration.databaseOwnerId,
          normalized,
        ]);
        if (result.rows.length > MAXIMUM_TRANSACTION_IDS) fail();
        return result.rows.map((value) => text(object(value).transaction_id));
      });
    },
    saveCostBasisByOwner: (ownerId, record, fingerprint, version) =>
      save(
        ownerId,
        "cost_basis",
        record.request.assignmentId,
        record,
        fingerprint,
        version,
        [
          ...record.request.costs.map(({ transactionId }) => transactionId),
          ...record.request.refunds.map(({ transactionId }) => transactionId),
        ],
      ),
  };

  return {
    status: "ready",
    repository,
    loadContextByOwner: (ownerId) =>
      transaction(ownerId, async (client) => {
        const result = await client.query(CONTEXT_SQL, [
          configuration.databaseOwnerId,
        ]);
        if (result.rows.length !== 1) fail();
        const row = object(result.rows[0]);
        const version = verifyHash(row.asset_registry_version);
        const assets = parseArray<
          Extract<
            BreedingEconomicAssetRegistry,
            { status: "ready" }
          >["assets"][number]
        >(row.assets_json);
        if (assets.length === 0) fail();
        return {
          assetRegistry: { status: "ready", version, assets },
          economicVersion: numericVersion(row.economic_version),
        };
      }),
    loadEvidenceByBreedingEventByOwner: (ownerId, breedingEventId) => {
      const eventId = breedingEventId.trim();
      if (eventId === "" || eventId.length > 128) {
        return Promise.reject(new Error(ERROR));
      }
      return transaction(ownerId, async (client) => {
        const result = await client.query(READ_EVENT_EVIDENCE_SQL, [
          configuration.databaseOwnerId,
          eventId,
          MAXIMUM_EVENT_EVIDENCE_RECORDS,
        ]);
        if (result.rows.length > MAXIMUM_EVENT_EVIDENCE_RECORDS) fail();
        return result.rows.map((value) => {
          const row = object(value);
          if (row.record_kind !== "evidence") fail();
          const stored = storedRecord(
            row,
            evidenceRecord,
            (record) => ({ input: record.input, assets: record.assets }),
          );
          if (stored.record.input.breedingEventId !== eventId) fail();
          return stored;
        });
      });
    },
  };
}

export function neonBreedingEconomicPersistenceFromEnvironment(
  environment: Readonly<{
    databaseUrl: string | undefined;
    databaseOwnerId: string | undefined;
    runtimeRole: string | undefined;
  }>,
): NeonBreedingEconomicPersistence {
  const databaseUrl = environment.databaseUrl?.trim() ?? "";
  const databaseOwnerId = environment.databaseOwnerId?.trim() ?? "";
  const runtimeRole = environment.runtimeRole?.trim() ?? "";
  if (!databaseUrl || !databaseOwnerId || !runtimeRole)
    return { status: "not_configured" };
  return createNeonBreedingEconomicPersistence({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
  });
}

