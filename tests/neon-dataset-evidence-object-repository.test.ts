import { describe, expect, it, vi } from "vitest";

import {
  createNeonDatasetEvidenceObjectRepository,
  neonDatasetEvidenceObjectRepositoryFromEnvironment,
} from "@/lib/neon-dataset-evidence-object-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "user_owner";
const importBatchId = "22222222-2222-4222-8222-222222222222";
const evidenceObjectId = "33333333-3333-3333-3333-333333333333";
const runtimeRole = "dna_app_runtime";

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    evidence_rls: true,
    evidence_force_rls: true,
    runtime_can_read_evidence: true,
    runtime_can_register_evidence: true,
    session_user_name: runtimeRole,
    current_user_name: runtimeRole,
    runtime_is_superuser: false,
    runtime_bypasses_rls: false,
    runtime_can_create_roles: false,
    runtime_can_create_databases: false,
    runtime_is_neon_superuser_member: false,
    ...overrides,
  };
}

function harness(rows: readonly (readonly unknown[])[]) {
  const events: string[] = [];
  let index = 0;
  const query = vi.fn(
    async (statement: string, values?: readonly unknown[]) => {
      const normalized = statement.replace(/\s+/g, " ").trim();
      events.push(
        values ? normalized + "|" + JSON.stringify(values) : normalized,
      );
      if (
        ["BEGIN ISOLATION LEVEL SERIALIZABLE", "COMMIT", "ROLLBACK"].includes(
          normalized,
        )
      ) {
        return { rows: [] };
      }
      return { rows: rows[index++] ?? [] };
    },
  );
  const client: NeonImportPersistenceClient = { query };
  const close = vi.fn(async () => {
    events.push("close");
  });
  const sessionFactory = vi.fn(async () => ({ client, close }));
  return {
    events,
    query,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  };
}

function repository(test: ReturnType<typeof harness>) {
  return createNeonDatasetEvidenceObjectRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    runtimeRole,
    sessionFactory: test.sessionFactory,
  });
}

function registration() {
  return {
    ownerId,
    importBatchId,
    sourceType: "race_merge" as const,
    objectKind: "staged_rows" as const,
    partitionNumber: 0,
    objectFormat: "parquet" as const,
    objectKey: "evidence/private/part-0000.parquet",
    checksumSha256: "a".repeat(64),
    byteSize: 65536,
    rowCount: 1000,
    firstNaturalKey: "event-0001",
    lastNaturalKey: "event-1000",
    createdAt: "2026-08-23T07:00:00.000Z",
  };
}

describe("Neon dataset evidence object repository", () => {
  it("stays fail-closed until every server-only setting exists", () => {
    expect(
      neonDatasetEvidenceObjectRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole,
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("registers immutable evidence through forced owner RLS", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ status: "created", evidence_object_id: evidenceObjectId }],
    ]);

    await expect(repository(test).register(registration())).resolves.toEqual({
      status: "created",
      evidenceObjectId,
    });
    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      importBatchId,
      "race_merge",
      "staged_rows",
      0,
      "parquet",
      "evidence/private/part-0000.parquet",
      "a".repeat(64),
      65536,
      1000,
      "event-0001",
      "event-1000",
      "2026-08-23T07:00:00.000Z",
    ]);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("maps an exact replay without widening the contract", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ status: "existing", evidence_object_id: evidenceObjectId }],
    ]);
    await expect(repository(test).register(registration())).resolves.toEqual({
      status: "existing",
      evidenceObjectId,
    });
  });

  it("rejects malformed object authority before connecting", () => {
    const test = harness([]);
    const configured = repository(test);
    for (const malformed of [
      { importBatchId: "not-a-uuid" },
      { partitionNumber: 10000 },
      { objectKey: "../outside" },
      { checksumSha256: "not-a-checksum" },
      { byteSize: 0 },
      { rowCount: 0 },
      { firstNaturalKey: "event-0001", lastNaturalKey: null },
      { createdAt: "not-a-timestamp" },
    ]) {
      expect(() =>
        configured.register({ ...registration(), ...malformed }),
      ).toThrow();
    }
    expect(test.query).not.toHaveBeenCalled();
  });

  it("rolls back when runtime privilege or RLS evidence is unsafe", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation({ runtime_can_register_evidence: false })],
    ]);
    await expect(repository(test).register(registration())).rejects.toThrow(
      "runtime privileges are incomplete",
    );
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
    expect(
      test.events.some(
        (event) =>
          event.includes("register_dataset_evidence_object(") &&
          event.includes("SELECT status"),
      ),
    ).toBe(false);
  });

  it("rejects malformed durable registration evidence and rolls back", async () => {
    for (const malformed of [
      { status: "invented", evidence_object_id: evidenceObjectId },
      { status: "created", evidence_object_id: "not-a-uuid" },
      { status: "existing", evidence_object_id: null },
    ]) {
      const test = harness([
        [{ owner_scope: databaseOwnerId }],
        [isolation()],
        [malformed],
      ]);
      await expect(repository(test).register(registration())).rejects.toThrow();
      expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
    }
  });

  it("inspects the exact owner-scoped manifest identity without mutation", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ status: "exact" }],
    ]);

    await expect(repository(test).inspect(registration())).resolves.toEqual({
      status: "exact",
    });
    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      importBatchId,
      "race_merge",
      "staged_rows",
      0,
      "parquet",
      "evidence/private/part-0000.parquet",
      "a".repeat(64),
      65536,
      1000,
      "event-0001",
      "event-1000",
      "2026-08-23T07:00:00.000Z",
    ]);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("distinguishes missing and conflicting manifest identities", async () => {
    for (const status of ["missing", "conflict"] as const) {
      const test = harness([
        [{ owner_scope: databaseOwnerId }],
        [isolation()],
        [{ status }],
      ]);
      await expect(repository(test).inspect(registration())).resolves.toEqual({
        status,
      });
    }
  });

  it("rolls back malformed manifest inspection evidence", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ status: "invented" }],
    ]);
    await expect(repository(test).inspect(registration())).rejects.toThrow(
      "inspection status is unsupported",
    );
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });
});
