import { createHash } from "node:crypto";
import { assessCoreBurnEvent } from "@/domain/core-burn-event";
import type { BurnCreditEvidence } from "@/domain/burn-credit-reconciliation";
import type {
  LifecycleEconomicAssetRegistry,
  LifecycleEconomicWriteRepository,
  StoredBurnCreditEvidence,
  StoredBurnEvidence,
  ValidatedBurnCreditRecord,
  ValidatedCoreBurnRecord,
  ValidatedCoreSaleRecord,
} from "@/lib/lifecycle-economic-write-service";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceClient,
  type NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ROLE = /^[a-z_][a-z0-9_]{0,62}$/;
const HASH = /^[a-f0-9]{64}$/;
const ERROR = "Lifecycle economic persistence unavailable.";

const VERIFY_SQL = `
  SELECT owner.id::text AS database_owner_id,
    owner.clerk_user_id AS authenticated_owner_id,
    state.relrowsecurity AS state_rls,
    state.relforcerowsecurity AS state_force_rls,
    evidence.relrowsecurity AS evidence_rls,
    evidence.relforcerowsecurity AS evidence_force_rls,
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
    has_table_privilege(session_user,evidence.oid,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AS runtime_has_direct_evidence_access
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_class state
    ON state.oid='dna.lifecycle_economic_state'::regclass
  JOIN pg_catalog.pg_class evidence
    ON evidence.oid='dna.lifecycle_economic_evidence'::regclass
  JOIN pg_catalog.pg_roles role ON role.rolname=session_user
  WHERE owner.id=$1::uuid AND owner.clerk_user_id=$2::text
`;
const CONTEXT_SQL = `
  SELECT asset_registry_version,assets_json,lifecycle_version
  FROM dna.read_lifecycle_economic_write_context($1::uuid)
`;
const WRITE_SQL = `
  SELECT disposition,fingerprint,lifecycle_version
  FROM dna.write_lifecycle_economic_evidence(
    $1::uuid,$2::text,$3::text,$4::text,$5::character(64),
    $6::character(64),$7::text,$8::text
  )
`;
const READ_SQL = `
  SELECT evidence_kind,burn_id,record_json,fingerprint,record_sha256,
    lifecycle_version
  FROM dna.read_lifecycle_economic_evidence($1::uuid,$2::text)
`;
const LIST_CREDITS_SQL = `
  SELECT record_json,fingerprint,record_sha256
  FROM dna.list_lifecycle_burn_credit_evidence($1::uuid,$2::text)
`;

export type LifecycleEconomicWriteContext = Readonly<{
  assetRegistry: Extract<LifecycleEconomicAssetRegistry, { status: "ready" }>;
  lifecycleVersion: string;
}>;

export type NeonLifecycleEconomicPersistence =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      repository: Extract<
        LifecycleEconomicWriteRepository,
        { status: "ready" }
      >;
      loadContextByOwner: (
        ownerId: string,
      ) => Promise<LifecycleEconomicWriteContext>;
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

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
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

function numericVersion(value: unknown): string {
  const result = text(value);
  if (!/^(0|[1-9][0-9]*)$/.test(result)) fail();
  return result;
}

function verifyHash(value: unknown): string {
  const result = text(value);
  if (!HASH.test(result)) fail();
  return result;
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
    ["state_rls", "state_force_rls", "evidence_rls", "evidence_force_rls"].some(
      (field) => row[field] !== true,
    ) ||
    [
      "runtime_is_superuser",
      "runtime_bypasses_rls",
      "runtime_can_create_roles",
      "runtime_can_create_databases",
      "runtime_is_neon_superuser_member",
      "runtime_has_direct_state_access",
      "runtime_has_direct_evidence_access",
    ].some((field) => row[field] !== false)
  )
    fail();
}

function persistenceResult(value: unknown) {
  const row = object(value);
  const status = text(row.disposition);
  const lifecycleVersion = numericVersion(row.lifecycle_version);
  if (status === "created") return { status, lifecycleVersion } as const;
  if (status === "already_exists" || status === "conflict") {
    return {
      status,
      fingerprint: verifyHash(row.fingerprint),
      lifecycleVersion,
    } as const;
  }
  if (status === "version_conflict")
    return { status, lifecycleVersion } as const;
  return fail();
}

function burnRecord(value: unknown): ValidatedCoreBurnRecord {
  const record = object(value) as unknown as ValidatedCoreBurnRecord;
  const expected = assessCoreBurnEvent(record.input);
  if (JSON.stringify(expected) !== JSON.stringify(record.result)) fail();
  return record;
}

function creditRecord(value: unknown): ValidatedBurnCreditRecord {
  const record = object(value) as unknown as ValidatedBurnCreditRecord;
  const credit = object(record.credit) as unknown as BurnCreditEvidence;
  const asset = object(record.asset);
  const reconciliation = object(record.reconciliation);
  if (
    text(credit.creditId).length > 128 ||
    text(credit.coreId).length > 128 ||
    nullableText(credit.burnId) === null ||
    text(credit.asset).toUpperCase() !== "BGC" ||
    asset.code !== "BGC" ||
    asset.kind !== "game_credit" ||
    reconciliation.creditPredicted !== false ||
    reconciliation.burnEventMutated !== false
  )
    fail();
  return record;
}

function checkedRecord<T>(
  row: Record<string, unknown>,
  decode: (v: unknown) => T,
) {
  const json = text(row.record_json);
  const recordHash = verifyHash(row.record_sha256);
  if (hash(json) !== recordHash) fail();
  return { record: decode(parse<unknown>(json)), recordHash };
}

export function createNeonLifecycleEconomicPersistence(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): Extract<NeonLifecycleEconomicPersistence, { status: "ready" }> {
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

  async function save(
    ownerId: string,
    kind: "core_sale" | "core_burn" | "burn_bgc_credit",
    evidenceId: string,
    burnId: string | null,
    record:
      | ValidatedCoreSaleRecord
      | ValidatedCoreBurnRecord
      | ValidatedBurnCreditRecord,
    fingerprint: string,
    expectedLifecycleVersion: string,
  ) {
    const recordJson = JSON.stringify(record);
    if (!HASH.test(fingerprint)) fail();
    return transaction(ownerId, async (client) => {
      const result = await client.query(WRITE_SQL, [
        configuration.databaseOwnerId,
        kind,
        evidenceId,
        burnId,
        fingerprint,
        hash(recordJson),
        recordJson,
        expectedLifecycleVersion,
      ]);
      if (result.rows.length !== 1) fail();
      return persistenceResult(result.rows[0]);
    });
  }

  const repository: Extract<
    LifecycleEconomicWriteRepository,
    { status: "ready" }
  > = {
    status: "ready",
    saveSaleByOwner: (ownerId, record, fingerprint, version) =>
      save(
        ownerId,
        "core_sale",
        record.input.saleId,
        null,
        record,
        fingerprint,
        version,
      ),
    saveBurnByOwner: (ownerId, record, fingerprint, version) =>
      save(
        ownerId,
        "core_burn",
        record.input.burnId,
        null,
        record,
        fingerprint,
        version,
      ),
    saveBurnCreditByOwner: (ownerId, record, fingerprint, version) =>
      save(
        ownerId,
        "burn_bgc_credit",
        record.credit.creditId,
        record.credit.burnId,
        record,
        fingerprint,
        version,
      ),
    loadBurnByOwner: (ownerId, burnId) =>
      transaction(
        ownerId,
        async (client): Promise<StoredBurnEvidence | null> => {
          const result = await client.query(READ_SQL, [
            configuration.databaseOwnerId,
            burnId,
          ]);
          if (result.rows.length === 0) return null;
          if (result.rows.length !== 1) fail();
          const row = object(result.rows[0]);
          if (row.evidence_kind !== "core_burn" || row.burn_id !== null) fail();
          const decoded = checkedRecord(row, burnRecord);
          const fingerprint = verifyHash(row.fingerprint);
          if (fingerprint !== decoded.recordHash) fail();
          return { record: decoded.record, fingerprint };
        },
      ),
    loadBurnCreditByOwner: (ownerId, creditId) =>
      transaction(
        ownerId,
        async (client): Promise<StoredBurnCreditEvidence | null> => {
          const result = await client.query(READ_SQL, [
            configuration.databaseOwnerId,
            creditId,
          ]);
          if (result.rows.length === 0) return null;
          if (result.rows.length !== 1) fail();
          const row = object(result.rows[0]);
          if (row.evidence_kind !== "burn_bgc_credit") fail();
          const decoded = checkedRecord(row, creditRecord);
          const fingerprint = verifyHash(row.fingerprint);
          if (
            fingerprint !==
            hash(
              JSON.stringify({
                credit: decoded.record.credit,
                asset: decoded.record.asset,
              }),
            )
          )
            fail();
          return {
            record: decoded.record,
            fingerprint,
            recordFingerprint: decoded.recordHash,
            lifecycleVersion: numericVersion(row.lifecycle_version),
          };
        },
      ),
    loadBurnCreditsByOwner: (ownerId, burnId) =>
      transaction(ownerId, async (client) => {
        const result = await client.query(LIST_CREDITS_SQL, [
          configuration.databaseOwnerId,
          burnId,
        ]);
        if (result.rows.length > 128) fail();
        return result.rows.map((value) => {
          const row = object(value);
          const decoded = checkedRecord(row, creditRecord);
          if (
            verifyHash(row.fingerprint) !==
            hash(
              JSON.stringify({
                credit: decoded.record.credit,
                asset: decoded.record.asset,
              }),
            )
          )
            fail();
          return decoded.record.credit;
        });
      }),
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
            LifecycleEconomicAssetRegistry,
            { status: "ready" }
          >["assets"][number]
        >(row.assets_json);
        if (assets.length === 0) fail();
        return {
          assetRegistry: { status: "ready", version, assets },
          lifecycleVersion: numericVersion(row.lifecycle_version),
        };
      }),
  };
}

export function neonLifecycleEconomicPersistenceFromEnvironment(
  environment: Readonly<{
    databaseUrl: string | undefined;
    databaseOwnerId: string | undefined;
    runtimeRole: string | undefined;
  }>,
): NeonLifecycleEconomicPersistence {
  const databaseUrl = environment.databaseUrl?.trim() ?? "";
  const databaseOwnerId = environment.databaseOwnerId?.trim() ?? "";
  const runtimeRole = environment.runtimeRole?.trim() ?? "";
  if (!databaseUrl || !databaseOwnerId || !runtimeRole)
    return { status: "not_configured" };
  return createNeonLifecycleEconomicPersistence({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
  });
}
