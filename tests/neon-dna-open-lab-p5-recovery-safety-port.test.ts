import { describe, expect, it, vi } from "vitest";

import { DNA_OPEN_LAB_P5_OWNER_RELATION_NAMES } from "@/lib/neon-dna-open-lab-p5-capacity-port";
import {
  createNeonDnaOpenLabP5RecoverySafetyInspector,
  DNA_OPEN_LAB_P5_RECOVERY_CHECKPOINT_RELATIONS,
  DNA_OPEN_LAB_P5_RECOVERY_OWNER_DATA_RELATIONS,
  DNA_OPEN_LAB_P5_RECOVERY_RETAINED_EVIDENCE_RELATIONS,
  DNA_OPEN_LAB_P5_RECOVERY_SERVING_RELATIONS,
} from "@/lib/neon-dna-open-lab-p5-recovery-safety-port";
import type { NeonImportPersistenceSessionFactory } from "@/lib/neon-import-persistence-driver";

const ownerId = "11111111-1111-4111-8111-111111111111";

function sessionFactory(input: { privileged?: boolean } = {}) {
  const statements: string[] = [];
  const query = vi.fn(async (statement: string) => {
    statements.push(statement);
    if (statement.includes("set_config")) {
      return { rows: [{ owner_scope: ownerId }] };
    }
    if (statement.includes("runtime_is_superuser")) {
      return {
        rows: [
          {
            database_owner_id: ownerId,
            authenticated_owner_id: "owner-user",
            session_user_name: "dna_app_runtime",
            current_user_name: "dna_app_runtime",
            runtime_is_superuser: input.privileged === true,
            runtime_bypasses_rls: false,
            runtime_can_create_roles: false,
            runtime_can_create_databases: false,
            runtime_can_create_in_database: false,
            runtime_can_create_in_schema: false,
            runtime_is_neon_superuser_member: false,
          },
        ],
      };
    }
    if (statement.includes("read_dna_open_lab_p5_recovery_fingerprints")) {
      return {
        rows: [
          ["checkpoint_state", "1", "checkpoint"],
          ["owner_data", "5", "owner"],
          ["retained_evidence", "1", "retained"],
          ["serving_state", "1", "serving"],
        ].map(([evidence_group, row_count, fingerprint_payload]) => ({
          evidence_group,
          row_count,
          fingerprint_payload,
        })),
      };
    }
    return { rows: [] };
  });
  const close = vi.fn(async () => undefined);
  const factory: NeonImportPersistenceSessionFactory = vi.fn(async () => ({
    client: { query },
    close,
  }));
  return { factory, query, close, statements };
}

describe("DNA Open Lab P5 Neon recovery safety port", () => {
  it("partitions the complete fixed API-only capacity relation inventory", () => {
    const partitioned = [
      ...DNA_OPEN_LAB_P5_RECOVERY_OWNER_DATA_RELATIONS,
      ...DNA_OPEN_LAB_P5_RECOVERY_CHECKPOINT_RELATIONS,
      ...DNA_OPEN_LAB_P5_RECOVERY_SERVING_RELATIONS,
      ...DNA_OPEN_LAB_P5_RECOVERY_RETAINED_EVIDENCE_RELATIONS,
    ];
    expect(new Set(partitioned).size).toBe(partitioned.length);
    expect([...partitioned].sort()).toEqual(
      [...DNA_OPEN_LAB_P5_OWNER_RELATION_NAMES].sort(),
    );
  });

  it("reads all fixed owner groups in one least-privilege read-only transaction", async () => {
    const test = sessionFactory();
    const inspect = createNeonDnaOpenLabP5RecoverySafetyInspector({
      authorizedOwnerId: "owner-user",
      databaseOwnerId: ownerId,
      databaseUrl: "postgres://preview.invalid/database",
      runtimeRole: "dna_app_runtime",
      sessionFactory: test.factory,
    });

    const first = await inspect();
    const second = await inspect();
    expect(first).toEqual(second);
    expect(first.persistentOwnerDataRowCount).toBe(5);
    expect(first.ownerDataSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.checkpointStateSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.servingStateSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.retainedEvidenceSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      test.statements.filter((statement) =>
        statement.includes("read_dna_open_lab_p5_recovery_fingerprints"),
      ),
    ).toHaveLength(2);
    expect(test.statements).toContain(
      "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY",
    );
    expect(test.statements).toContain("COMMIT");
    expect(test.close).toHaveBeenCalledTimes(2);
  });

  it("rejects privileged credentials and rolls back without exposing provider detail", async () => {
    const test = sessionFactory({ privileged: true });
    const inspect = createNeonDnaOpenLabP5RecoverySafetyInspector({
      authorizedOwnerId: "owner-user",
      databaseOwnerId: ownerId,
      databaseUrl: "postgres://preview.invalid/database",
      runtimeRole: "dna_app_runtime",
      sessionFactory: test.factory,
    });

    await expect(inspect()).rejects.toThrow("inspection failed");
    expect(test.statements).toContain("ROLLBACK");
    expect(
      test.statements.some((statement) =>
        statement.includes("read_dna_open_lab_p5_recovery_fingerprints"),
      ),
    ).toBe(false);
  });
});
