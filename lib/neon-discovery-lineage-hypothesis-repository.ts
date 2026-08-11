import type {
  ProbeLineageRelationship,
  ProbeMode,
} from "@/domain/discovery-probe-plan";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

type SupportedDiscoveryLineageRelationship = Extract<
  ProbeLineageRelationship,
  | "parent"
  | "grandparent"
  | "full_sibling"
  | "half_sibling"
  | "offspring"
  | "wider_lineage"
>;

export type DiscoveryLineageHypothesis = Readonly<{
  coreId: string;
  coreName: string;
  meEligible: boolean;
  mode: ProbeMode;
  distanceMetres: number;
  lineageRelationship: SupportedDiscoveryLineageRelationship;
  lineageRaceCount: number;
  dataCurrentThrough: string;
  lastImportedAt: string | null;
}>;

export type DiscoveryLineageHypothesisRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      listHypothesesByOwner: (
        ownerId: string,
      ) => Promise<readonly DiscoveryLineageHypothesis[]>;
    }>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_RUNTIME_ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const SUPPORTED_RELATIONSHIPS = [
  "parent",
  "grandparent",
  "full_sibling",
  "half_sibling",
  "offspring",
  "wider_lineage",
] as const satisfies readonly SupportedDiscoveryLineageRelationship[];
const SET_OWNER_SCOPE_SQL = `SELECT set_config('app.owner_id', $1, true) AS owner_scope`;
const VERIFY_OWNER_SQL = `
  SELECT
    owner.id::text AS database_owner_id,
    owner.clerk_user_id AS authenticated_owner_id,
    session_user::text AS session_user_name,
    current_user::text AS current_user_name,
    runtime_role.rolsuper AS runtime_is_superuser,
    runtime_role.rolbypassrls AS runtime_bypasses_rls
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_roles runtime_role ON runtime_role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
`;
const LIST_SQL = `SELECT * FROM dna.list_discovery_lineage_hypotheses($1::uuid, $2::integer)`;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;

function row(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Discovery lineage evidence must be a database row.");
  }
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${label} is invalid.`);
  return value;
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} is invalid.`);
  return value;
}
function integer(value: unknown, label: string): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) <= 0)
    throw new Error(`${label} is invalid.`);
  return parsed as number;
}
function timestamp(value: unknown, label: string): string {
  const parsed = value instanceof Date ? value : new Date(text(value, label));
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is invalid.`);
  return parsed.toISOString();
}
function optionalTimestamp(value: unknown): string | null {
  return value === null ? null : timestamp(value, "last_imported_at");
}
function normalized(value: string | undefined): string | null {
  const result = value?.trim() ?? "";
  return result === "" ? null : result;
}
function supportedRelationship(
  value: string,
): SupportedDiscoveryLineageRelationship {
  if (!(SUPPORTED_RELATIONSHIPS as readonly string[]).includes(value)) {
    throw new Error("Discovery lineage evidence enum is invalid.");
  }
  return value as SupportedDiscoveryLineageRelationship;
}

export function createNeonDiscoveryLineageHypothesisRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): DiscoveryLineageHypothesisRepository {
  const url = input.databaseUrl.trim();
  const owner = input.databaseOwnerId.trim();
  const role = input.runtimeRole.trim();
  if (
    url === "" ||
    !UUID_PATTERN.test(owner) ||
    !SAFE_RUNTIME_ROLE_PATTERN.test(role)
  ) {
    throw new Error("Discovery lineage repository configuration is invalid.");
  }
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;
  return {
    status: "ready",
    async listHypothesesByOwner(authenticatedOwnerId) {
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
        const ownerResult = (await session.client.query(VERIFY_OWNER_SQL, [
          owner,
          clerkOwner,
        ])) as QueryResult;
        if (ownerResult.rows.length !== 1)
          throw new Error("Discovery lineage owner scope denied.");
        const ownerRow = row(ownerResult.rows[0]);
        if (
          text(ownerRow.database_owner_id, "database_owner_id") !== owner ||
          text(ownerRow.authenticated_owner_id, "authenticated_owner_id") !==
            clerkOwner ||
          text(ownerRow.session_user_name, "session_user_name") !== role ||
          text(ownerRow.current_user_name, "current_user_name") !== role ||
          bool(ownerRow.runtime_is_superuser, "runtime_is_superuser") ||
          bool(ownerRow.runtime_bypasses_rls, "runtime_bypasses_rls")
        ) {
          throw new Error("Discovery lineage runtime owner isolation failed.");
        }
        const result = (await session.client.query(LIST_SQL, [
          owner,
          500,
        ])) as QueryResult;
        const hypotheses = result.rows.map(
          (value): DiscoveryLineageHypothesis => {
            const record = row(value);
            const mode = text(record.mode, "mode");
            const relationship = supportedRelationship(
              text(record.lineage_relationship, "lineage_relationship"),
            );
            if (!["bike", "car", "horse"].includes(mode)) {
              throw new Error("Discovery lineage evidence enum is invalid.");
            }
            return {
              coreId: text(record.core_id, "core_id"),
              coreName: text(record.core_name, "core_name"),
              meEligible: bool(record.me_eligible, "me_eligible"),
              mode: mode as ProbeMode,
              distanceMetres: integer(record.distance, "distance"),
              lineageRelationship: relationship,
              lineageRaceCount: integer(
                record.lineage_race_count,
                "lineage_race_count",
              ),
              dataCurrentThrough: timestamp(
                record.data_current_through,
                "data_current_through",
              ),
              lastImportedAt: optionalTimestamp(record.last_imported_at),
            };
          },
        );
        await session.client.query("COMMIT");
        transactionStarted = false;
        return hypotheses;
      } catch (error) {
        if (transactionStarted)
          await session.client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        await session.close();
      }
    },
  };
}

export function neonDiscoveryLineageHypothesisRepositoryFromEnvironment(
  environment: Readonly<{
    databaseUrl: string | undefined;
    databaseOwnerId: string | undefined;
    runtimeRole: string | undefined;
  }>,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): DiscoveryLineageHypothesisRepository {
  const url = normalized(environment.databaseUrl);
  const owner = normalized(environment.databaseOwnerId);
  const role = normalized(environment.runtimeRole);
  if (url === null || owner === null || role === null)
    return { status: "not_configured" };
  return createNeonDiscoveryLineageHypothesisRepository({
    databaseUrl: url,
    databaseOwnerId: owner,
    runtimeRole: role,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
