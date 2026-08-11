import type {
  OwnerVaultMutationFailureStatus,
  OwnerVaultMutationRepository,
  OwnerVaultMutationResult,
} from "./owner-vault-action-service";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_RUNTIME_ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

const SET_OWNER_SCOPE_SQL = `
  SELECT set_config('app.owner_id', $1, true) AS owner_scope
`;

const VERIFY_OWNER_ISOLATION_SQL = `
  SELECT
    owner.id::text AS database_owner_id,
    owner.clerk_user_id AS authenticated_owner_id,
    core_table.relrowsecurity AS core_row_security_enabled,
    core_table.relforcerowsecurity AS core_force_row_security_enabled,
    vault_table.relrowsecurity AS vault_row_security_enabled,
    vault_table.relforcerowsecurity AS vault_force_row_security_enabled,
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
  JOIN pg_catalog.pg_class core_table
    ON core_table.oid = 'dna.core'::regclass
  JOIN pg_catalog.pg_class vault_table
    ON vault_table.oid = 'dna.owner_vault_core'::regclass
  JOIN pg_catalog.pg_roles runtime_role
    ON runtime_role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
`;

const RESOLVE_CORE_SQL = `
  SELECT core.id::text AS core_id, core.source_core_id
  FROM dna.core core
  WHERE core.owner_id = $1::uuid AND core.source_core_id = $2::text
  ORDER BY core.id
  LIMIT 2
`;

const SET_VAULT_STATE_SQL = `
  SELECT
    disposition,
    core_id::text AS core_id,
    in_my_vault,
    me_eligible,
    version,
    updated_at
  FROM dna.set_owner_vault_core(
    $1::uuid,
    $2::uuid,
    $3::boolean,
    $4::boolean,
    $5::bigint,
    $6::text,
    $7::character(64),
    $8::timestamptz
  )
`;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;

type Environment = Readonly<{
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

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean`);
  return value;
}

function safeInteger(value: unknown, field: string): number {
  const parsed =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) < 1) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return parsed as number;
}

function timestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(string(value, field));
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} is invalid`);
  return parsed.toISOString();
}

function requireOwnerId(value: string): string {
  const normalized = value.trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw new Error("databaseOwnerId must be a UUID");
  }
  return normalized;
}

function requireRuntimeRole(value: string): string {
  const normalized = value.trim();
  if (!SAFE_RUNTIME_ROLE_PATTERN.test(normalized)) {
    throw new Error("runtimeRole is invalid");
  }
  return normalized;
}

function normalized(value: string | undefined): string | null {
  const result = value?.trim() ?? "";
  return result === "" ? null : result;
}

function verifyOwnerIsolation(
  result: QueryResult,
  input: Readonly<{
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    runtimeRole: string;
  }>,
): void {
  if (result.rows.length !== 1) {
    throw new Error("Owner Vault repository owner scope denied.");
  }
  const row = record(result.rows[0], "owner isolation");
  if (
    string(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    string(row.authenticated_owner_id, "authenticated_owner_id") !==
      input.authenticatedOwnerId
  ) {
    throw new Error("Owner Vault repository owner scope denied.");
  }
  for (const field of [
    "core_row_security_enabled",
    "core_force_row_security_enabled",
    "vault_row_security_enabled",
    "vault_force_row_security_enabled",
  ] as const) {
    if (!boolean(row[field], field)) {
      throw new Error("Owner Vault repository requires forced owner RLS.");
    }
  }
  if (
    string(row.session_user_name, "session_user_name") !== input.runtimeRole ||
    string(row.current_user_name, "current_user_name") !== input.runtimeRole ||
    boolean(row.runtime_is_superuser, "runtime_is_superuser") ||
    boolean(row.runtime_bypasses_rls, "runtime_bypasses_rls") ||
    boolean(row.runtime_can_create_roles, "runtime_can_create_roles") ||
    boolean(row.runtime_can_create_databases, "runtime_can_create_databases") ||
    boolean(
      row.runtime_is_neon_superuser_member,
      "runtime_is_neon_superuser_member",
    )
  ) {
    throw new Error("Owner Vault runtime role is not least privileged.");
  }
}

function mappedDatabaseFailure(
  error: unknown,
): OwnerVaultMutationFailureStatus | null {
  if (!(error instanceof Error)) return null;
  if (error.message.includes("Vault state changed; refresh before retrying")) {
    return "conflict";
  }
  if (error.message.includes("Vault core is unavailable")) {
    return "core_unavailable";
  }
  if (error.message.includes("idempotency key was reused")) {
    return "idempotency_conflict";
  }
  if (error.message.includes("ME eligibility requires an active Vault core")) {
    return "invalid_state";
  }
  return null;
}

function failure(status: OwnerVaultMutationFailureStatus): OwnerVaultMutationResult {
  return { status };
}

export function createNeonOwnerVaultMutationRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): OwnerVaultMutationRepository {
  const databaseUrl = input.databaseUrl.trim();
  if (databaseUrl === "") throw new Error("databaseUrl is required");
  const databaseOwnerId = requireOwnerId(input.databaseOwnerId);
  const runtimeRole = requireRuntimeRole(input.runtimeRole);
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  return {
    status: "ready",
    async setCoreState(mutation) {
      const authenticatedOwnerId = mutation.ownerId.trim();
      if (authenticatedOwnerId === "") throw new Error("ownerId is required");
      const session = await sessionFactory(databaseUrl);
      let transactionStarted = false;
      try {
        await session.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        transactionStarted = true;
        await session.client.query(SET_OWNER_SCOPE_SQL, [databaseOwnerId]);
        verifyOwnerIsolation(
          await session.client.query(VERIFY_OWNER_ISOLATION_SQL, [
            databaseOwnerId,
            authenticatedOwnerId,
          ]),
          { databaseOwnerId, authenticatedOwnerId, runtimeRole },
        );

        const coreResult = await session.client.query(RESOLVE_CORE_SQL, [
          databaseOwnerId,
          mutation.sourceCoreId,
        ]);
        if (coreResult.rows.length === 0) {
          await session.client.query("COMMIT");
          transactionStarted = false;
          return failure("core_unavailable");
        }
        if (coreResult.rows.length !== 1) {
          throw new Error("Owner Vault durable Core ID is ambiguous.");
        }
        const core = record(coreResult.rows[0], "Vault core");
        const coreId = string(core.core_id, "core_id");
        if (
          string(core.source_core_id, "source_core_id") !==
          mutation.sourceCoreId
        ) {
          throw new Error("Owner Vault durable Core ID mismatch.");
        }

        try {
          const result = await session.client.query(SET_VAULT_STATE_SQL, [
            databaseOwnerId,
            coreId,
            mutation.inMyVault,
            mutation.meEligible,
            mutation.expectedVersion,
            mutation.idempotencyKey,
            mutation.requestFingerprintSha256,
            mutation.requestedAt,
          ]);
          if (result.rows.length !== 1) {
            throw new Error("Owner Vault mutation returned an invalid result.");
          }
          const row = record(result.rows[0], "Vault mutation");
          const disposition = string(row.disposition, "disposition");
          if (disposition !== "applied" && disposition !== "replayed") {
            throw new Error("Owner Vault mutation disposition is unsupported.");
          }
          const state: OwnerVaultMutationResult = {
            status: disposition,
            sourceCoreId: mutation.sourceCoreId,
            inMyVault: boolean(row.in_my_vault, "in_my_vault"),
            meEligible: boolean(row.me_eligible, "me_eligible"),
            version: safeInteger(row.version, "version"),
            updatedAt: timestamp(row.updated_at, "updated_at"),
          };
          await session.client.query("COMMIT");
          transactionStarted = false;
          return state;
        } catch (error) {
          const mapped = mappedDatabaseFailure(error);
          if (mapped !== null) {
            await session.client.query("ROLLBACK");
            transactionStarted = false;
            return failure(mapped);
          }
          throw error;
        }
      } catch (error) {
        if (transactionStarted) {
          await session.client.query("ROLLBACK").catch(() => undefined);
        }
        throw error;
      } finally {
        await session.close();
      }
    },
  };
}

export function neonOwnerVaultMutationRepositoryFromEnvironment(
  environment: Environment,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): OwnerVaultMutationRepository {
  const databaseUrl = normalized(environment.databaseUrl);
  const databaseOwnerId = normalized(environment.databaseOwnerId);
  const runtimeRole = normalized(environment.runtimeRole);
  if (
    databaseUrl === null ||
    databaseOwnerId === null ||
    runtimeRole === null
  ) {
    return { status: "not_configured" };
  }
  return createNeonOwnerVaultMutationRepository({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
