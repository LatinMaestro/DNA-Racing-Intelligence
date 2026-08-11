import type {
  OwnerVaultCatalogueCore,
  OwnerVaultCatalogueFilters,
  OwnerVaultCatalogueRepository,
  OwnerVaultClass,
  OwnerVaultElement,
  OwnerVaultSex,
} from "./owner-vault-catalogue-service";
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

const LIST_CORES_SQL = `
  SELECT
    source_core_id,
    display_name,
    core_class,
    element,
    f_number,
    sex,
    in_my_vault,
    me_eligible,
    version,
    updated_at
  FROM dna.search_owner_vault_catalogue(
    $1::uuid,
    $2::text,
    $3::text,
    $4::text,
    $5::text,
    $6::integer,
    $7::text,
    $8::integer
  )
`;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;

type Environment = Readonly<{
  databaseUrl: string | undefined;
  databaseOwnerId: string | undefined;
  runtimeRole: string | undefined;
}>;

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a database row.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean.`);
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return parsed as number;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const parsed =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return parsed as number;
}

function optionalTimestamp(value: unknown): string | null {
  if (value === null) return null;
  const parsed =
    value instanceof Date ? value : new Date(text(value, "updated_at"));
  if (Number.isNaN(parsed.getTime())) throw new Error("updated_at is invalid.");
  return parsed.toISOString();
}

function databaseOwnerId(value: string): string {
  const normalized = value.trim();
  if (!UUID_PATTERN.test(normalized))
    throw new Error("databaseOwnerId must be a UUID.");
  return normalized;
}

function runtimeRole(value: string): string {
  const normalized = value.trim();
  if (!SAFE_RUNTIME_ROLE_PATTERN.test(normalized))
    throw new Error("runtimeRole is invalid.");
  return normalized;
}

function normalized(value: string | undefined): string | null {
  const result = value?.trim() ?? "";
  return result === "" ? null : result;
}

function verifyOwnerIsolation(
  result: QueryResult,
  expected: Readonly<{
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    runtimeRole: string;
  }>,
): void {
  if (result.rows.length !== 1)
    throw new Error("Vault catalogue owner scope denied.");
  const row = object(result.rows[0], "Owner evidence");
  if (
    text(row.database_owner_id, "database_owner_id") !==
      expected.databaseOwnerId ||
    text(row.authenticated_owner_id, "authenticated_owner_id") !==
      expected.authenticatedOwnerId ||
    !boolean(row.core_row_security_enabled, "core_row_security_enabled") ||
    !boolean(
      row.core_force_row_security_enabled,
      "core_force_row_security_enabled",
    ) ||
    !boolean(row.vault_row_security_enabled, "vault_row_security_enabled") ||
    !boolean(
      row.vault_force_row_security_enabled,
      "vault_force_row_security_enabled",
    )
  ) {
    throw new Error("Vault catalogue requires forced owner isolation.");
  }
  if (
    text(row.session_user_name, "session_user_name") !== expected.runtimeRole ||
    text(row.current_user_name, "current_user_name") !== expected.runtimeRole ||
    boolean(row.runtime_is_superuser, "runtime_is_superuser") ||
    boolean(row.runtime_bypasses_rls, "runtime_bypasses_rls") ||
    boolean(row.runtime_can_create_roles, "runtime_can_create_roles") ||
    boolean(row.runtime_can_create_databases, "runtime_can_create_databases") ||
    boolean(
      row.runtime_is_neon_superuser_member,
      "runtime_is_neon_superuser_member",
    )
  ) {
    throw new Error("Vault catalogue runtime role is not least privileged.");
  }
}

function core(rowValue: unknown): OwnerVaultCatalogueCore {
  const row = object(rowValue, "Vault catalogue core");
  const coreClass = text(row.core_class, "core_class") as OwnerVaultClass;
  const element = text(row.element, "element") as OwnerVaultElement;
  const sex = text(row.sex, "sex") as OwnerVaultSex;
  const version = nonNegativeInteger(row.version, "version");
  const updatedAt = optionalTimestamp(row.updated_at);
  return {
    sourceCoreId: text(row.source_core_id, "source_core_id"),
    displayName: text(row.display_name, "display_name"),
    coreClass,
    element,
    fNumber: positiveInteger(row.f_number, "f_number"),
    sex,
    inMyVault: boolean(row.in_my_vault, "in_my_vault"),
    meEligible: boolean(row.me_eligible, "me_eligible"),
    version,
    updatedAt,
  };
}

export function createNeonOwnerVaultCatalogueRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): OwnerVaultCatalogueRepository {
  const url = input.databaseUrl.trim();
  if (url === "") throw new Error("databaseUrl is required.");
  const owner = databaseOwnerId(input.databaseOwnerId);
  const role = runtimeRole(input.runtimeRole);
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  return {
    status: "ready",
    async listCoresByOwner(authenticatedOwnerId, filters) {
      const clerkOwner = authenticatedOwnerId.trim();
      if (clerkOwner === "")
        throw new Error("authenticated owner is required.");
      const session = await sessionFactory(url);
      let transactionStarted = false;
      try {
        await session.client.query(
          "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
        );
        transactionStarted = true;
        await session.client.query(SET_OWNER_SCOPE_SQL, [owner]);
        verifyOwnerIsolation(
          await session.client.query(VERIFY_OWNER_ISOLATION_SQL, [
            owner,
            clerkOwner,
          ]),
          {
            databaseOwnerId: owner,
            authenticatedOwnerId: clerkOwner,
            runtimeRole: role,
          },
        );
        const limit = filters.scope === "vault" ? 500 : 50;
        const result = await session.client.query(LIST_CORES_SQL, [
          owner,
          filters.query,
          filters.element,
          filters.coreClass,
          filters.sex,
          filters.fNumber,
          filters.scope,
          limit,
        ]);
        const cores = result.rows.map(core);
        await session.client.query("COMMIT");
        transactionStarted = false;
        return cores;
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

export function neonOwnerVaultCatalogueRepositoryFromEnvironment(
  environment: Environment,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): OwnerVaultCatalogueRepository {
  const url = normalized(environment.databaseUrl);
  const owner = normalized(environment.databaseOwnerId);
  const role = normalized(environment.runtimeRole);
  if (url === null || owner === null || role === null)
    return { status: "not_configured" };
  return createNeonOwnerVaultCatalogueRepository({
    databaseUrl: url,
    databaseOwnerId: owner,
    runtimeRole: role,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
