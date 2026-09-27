import { Pool } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";

import {
  assessDnaPopulationEntrantAuthorityCheckpointReadiness,
  DNA_POPULATION_ENTRANT_AUTHORITY_CHECKPOINT_FUNCTIONS,
  DNA_POPULATION_ENTRANT_AUTHORITY_CHECKPOINT_RELATIONS,
} from "@/lib/dna-population-entrant-authority-checkpoint-readiness";

const connected =
  process.env.DNA_POPULATION_ENTRANT_AUTHORITY_CHECKPOINT_READINESS === "1";
const describeConnected = connected ? describe : describe.skip;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (
    value === "" ||
    value.length > 4_096 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("probe response is invalid");
  return value;
}

function integer(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("probe response is invalid");
  }
  return parsed;
}

describeConnected("hosted Preview entrant checkpoint readiness", () => {
  it("reports the exact read-only schema and runtime boundary without persistence", async () => {
    const databaseUrl = requiredEnvironment("DATABASE_URL");
    const databaseOwnerId = requiredEnvironment("DNA_DATABASE_OWNER_ID");
    const authorizedOwnerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
    const runtimeRole = "dna_app_runtime";
    const pool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    const client = await pool.connect();
    let row: Record<string, unknown>;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const scope = await client.query(
        "SELECT set_config('app.owner_id', $1, true) AS owner_scope",
        [databaseOwnerId],
      );
      const probe = await client.query(
        `SELECT
          EXISTS (
            SELECT 1 FROM dna.app_owner
            WHERE id = $1::uuid AND clerk_user_id = $2
          ) AS owner_binding_valid,
          current_setting('app.owner_id', true) = $1::text AS owner_scope_valid,
          session_user::text = $3
            AND current_user::text = $3
            AND NOT role.rolsuper
            AND NOT role.rolbypassrls
            AND NOT role.rolcreaterole
            AND NOT role.rolcreatedb
            AND NOT has_database_privilege(session_user, current_database(), 'CREATE')
            AND NOT has_schema_privilege(session_user, 'dna', 'CREATE')
            AND NOT COALESCE(pg_has_role(session_user, (
              SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'neon_superuser'
            ), 'MEMBER'), false) AS runtime_least_privilege_valid,
          (SELECT count(*) FROM unnest($4::text[]) name
            WHERE to_regclass('dna.' || name) IS NOT NULL) AS present_relation_count,
          (SELECT count(*)
            FROM pg_catalog.pg_class relation
            JOIN pg_catalog.pg_namespace namespace
              ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = 'dna'
              AND relation.relname = ANY($4::text[])
              AND relation.relrowsecurity
              AND relation.relforcerowsecurity) AS rls_protected_relation_count,
          (SELECT count(*) FROM unnest($5::text[]) signature
            WHERE to_regprocedure(signature) IS NOT NULL) AS present_function_count,
          (SELECT count(*) FROM unnest($5::text[]) signature
            WHERE to_regprocedure(signature) IS NOT NULL
              AND has_function_privilege(
                session_user, to_regprocedure(signature), 'EXECUTE'
              )) AS executable_function_count,
          (SELECT count(*) FROM unnest($4::text[]) name
            WHERE to_regclass('dna.' || name) IS NOT NULL
              AND has_table_privilege(
                session_user, to_regclass('dna.' || name),
                'SELECT,INSERT,UPDATE,DELETE'
              )) AS runtime_direct_table_access_count
        FROM pg_catalog.pg_roles role
        WHERE role.rolname = session_user`,
        [
          databaseOwnerId,
          authorizedOwnerId,
          runtimeRole,
          DNA_POPULATION_ENTRANT_AUTHORITY_CHECKPOINT_RELATIONS,
          DNA_POPULATION_ENTRANT_AUTHORITY_CHECKPOINT_FUNCTIONS,
        ],
      );
      if (
        scope.rows.length !== 1 ||
        scope.rows[0]?.owner_scope !== databaseOwnerId ||
        probe.rows.length !== 1
      ) {
        throw new Error("probe response is invalid");
      }
      row = probe.rows[0] as Record<string, unknown>;
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
      await pool.end();
    }

    const report = assessDnaPopulationEntrantAuthorityCheckpointReadiness({
      ownerBindingValid: boolean(row.owner_binding_valid),
      ownerScopeValid: boolean(row.owner_scope_valid),
      runtimeLeastPrivilegeValid: boolean(row.runtime_least_privilege_valid),
      presentRelationCount: integer(row.present_relation_count),
      rlsProtectedRelationCount: integer(row.rls_protected_relation_count),
      presentFunctionCount: integer(row.present_function_count),
      executableFunctionCount: integer(row.executable_function_count),
      runtimeDirectTableAccessCount: integer(
        row.runtime_direct_table_access_count,
      ),
    });
    console.log(
      "DNA_POPULATION_ENTRANT_AUTHORITY_CHECKPOINT_READINESS=" +
        JSON.stringify(report),
    );
    expect(report.status).toBe("ready");
  }, 30_000);
});
