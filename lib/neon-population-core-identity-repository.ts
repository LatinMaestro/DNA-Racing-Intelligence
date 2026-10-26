import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const CORE_ID_PATTERN = /^[1-9][0-9]{0,15}$/;

export type PopulationCoreIdentity = Readonly<{
  sourceCoreId: string;
  generationId: string;
  evaluatedAt: string;
  coreSetSha256: string;
  populationCoreCount: number;
}>;

export type PopulationCoreIdentityRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      readExactIdentity: (
        authenticatedOwnerId: string,
        sourceCoreId: string,
      ) => Promise<PopulationCoreIdentity | null>;
    }>;

type Environment = Readonly<{
  databaseUrl: string | undefined;
  databaseOwnerId: string | undefined;
  runtimeRole: string | undefined;
}>;

function normalized(value: string | undefined): string | null {
  const result = value?.trim() ?? "";
  return result === "" ? null : result;
}

function timestamp(value: unknown, label: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is invalid.`);
  return parsed.toISOString();
}

function integer(value: unknown, label: string): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) < 1) {
    throw new Error(`${label} is invalid.`);
  }
  return parsed as number;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

export function createNeonPopulationCoreIdentityRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    runtimeRole: string;
    configuredOwnerId: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): PopulationCoreIdentityRepository {
  const databaseUrl = input.databaseUrl.trim();
  const databaseOwnerId = input.databaseOwnerId.trim();
  const runtimeRole = input.runtimeRole.trim();
  const configuredOwnerId = input.configuredOwnerId.trim();
  if (databaseUrl === "") throw new Error("databaseUrl is required.");
  if (!UUID_PATTERN.test(databaseOwnerId)) {
    throw new Error("databaseOwnerId must be a UUID.");
  }
  if (!ROLE_PATTERN.test(runtimeRole))
    throw new Error("runtimeRole is invalid.");
  if (configuredOwnerId === "")
    throw new Error("configuredOwnerId is required.");
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  return {
    status: "ready",
    async readExactIdentity(authenticatedOwnerId, sourceCoreId) {
      if (authenticatedOwnerId !== configuredOwnerId) {
        throw new Error("Population Core identity access denied.");
      }
      if (!CORE_ID_PATTERN.test(sourceCoreId)) return null;
      const numericCoreId = Number(sourceCoreId);
      if (!Number.isSafeInteger(numericCoreId)) return null;
      const session = await sessionFactory(databaseUrl);
      let transactionStarted = false;
      try {
        await session.client.query(
          "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
        );
        transactionStarted = true;
        await session.client.query(
          "SELECT set_config('app.owner_id', $1, true) AS owner_scope",
          [databaseOwnerId],
        );
        const role = await session.client.query(
          "SELECT session_user::text AS session_user_name, current_user::text AS current_user_name, rolsuper, rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = session_user",
        );
        const roleRow = role.rows[0] as Record<string, unknown> | undefined;
        if (
          role.rows.length !== 1 ||
          roleRow?.session_user_name !== runtimeRole ||
          roleRow.current_user_name !== runtimeRole ||
          roleRow.rolsuper !== false ||
          roleRow.rolbypassrls !== false
        ) {
          throw new Error(
            "Population Core identity runtime is not least privileged.",
          );
        }
        const result = await session.client.query(
          "SELECT * FROM dna.read_dna_population_core_identity($1::uuid,$2::bigint)",
          [databaseOwnerId, numericCoreId],
        );
        if (result.rows.length > 1) {
          throw new Error("Population Core identity read is ambiguous.");
        }
        const row = result.rows[0] as Record<string, unknown> | undefined;
        await session.client.query("COMMIT");
        transactionStarted = false;
        if (row === undefined) return null;
        return Object.freeze({
          sourceCoreId: text(row.source_core_id, "source_core_id"),
          generationId: text(row.generation_id, "generation_id"),
          evaluatedAt: timestamp(row.evaluated_at, "evaluated_at"),
          coreSetSha256: text(row.core_set_sha256, "core_set_sha256"),
          populationCoreCount: integer(row.core_count, "core_count"),
        });
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

export function neonPopulationCoreIdentityRepositoryFromEnvironment(
  environment: Environment,
  configuredOwnerId: string | undefined,
): PopulationCoreIdentityRepository {
  const databaseUrl = normalized(environment.databaseUrl);
  const databaseOwnerId = normalized(environment.databaseOwnerId);
  const runtimeRole = normalized(environment.runtimeRole);
  const ownerId = normalized(configuredOwnerId);
  if (
    databaseUrl === null ||
    databaseOwnerId === null ||
    runtimeRole === null ||
    ownerId === null
  ) {
    return { status: "not_configured" };
  }
  return createNeonPopulationCoreIdentityRepository({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    configuredOwnerId: ownerId,
  });
}
