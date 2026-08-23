import { describe, expect, it, vi } from "vitest";

import {
  createNeonImportRollbackRepository,
  neonImportRollbackRepositoryFromEnvironment,
} from "@/lib/neon-import-rollback-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "user_owner";
const batchId = "22222222-2222-4222-8222-222222222222";
const rollbackId = "33333333-3333-3333-3333-333333333333";
const restoredBatchId = "44444444-4444-4444-4444-444444444444";
const aggregateRefreshId = "55555555-5555-5555-5555-555555555555";
const runtimeRole = "dna_app_runtime";
const requestedAt = "2026-08-23T06:00:00.000Z";

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    rollback_rls: true,
    rollback_force_rls: true,
    runtime_can_read_rollback_receipts: true,
    runtime_can_rollback: true,
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
  return createNeonImportRollbackRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    runtimeRole,
    sessionFactory: test.sessionFactory,
  });
}

function rollbackInput() {
  return {
    ownerId,
    batchId,
    reason: "Restore the prior accepted source version.",
    idempotencyKey: "synthetic-dataset-rollback",
    requestedAt,
  };
}

describe("Neon import rollback repository", () => {
  it("stays fail-closed until every server-only setting exists", () => {
    expect(
      neonImportRollbackRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole,
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("restores a prior source version through forced owner RLS", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          status: "restored",
          disposition: "created",
          rollback_id: rollbackId,
          source_type: "current_arena",
          restored_batch_id: restoredBatchId,
          aggregate_refresh_id: aggregateRefreshId,
        },
      ],
    ]);

    await expect(
      repository(test).rollbackActiveSourceVersion(rollbackInput()),
    ).resolves.toEqual({
      status: "restored",
      disposition: "created",
      rollbackId,
      sourceType: "current_arena",
      restoredBatchId,
      aggregateRefreshId,
    });
    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      batchId,
      "Restore the prior accepted source version.",
      "synthetic-dataset-rollback",
      requestedAt,
    ]);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("maps non-mutating outcomes and exact replay", async () => {
    for (const status of [
      "not_found",
      "not_active",
      "no_prior_version",
    ] as const) {
      const test = harness([
        [{ owner_scope: databaseOwnerId }],
        [isolation()],
        [{ status }],
      ]);
      await expect(
        repository(test).rollbackActiveSourceVersion(rollbackInput()),
      ).resolves.toEqual({ status });
    }

    const replay = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          status: "restored",
          disposition: "existing",
          rollback_id: rollbackId,
          source_type: "race_merge",
          restored_batch_id: restoredBatchId,
          aggregate_refresh_id: aggregateRefreshId,
        },
      ],
    ]);
    await expect(
      repository(replay).rollbackActiveSourceVersion(rollbackInput()),
    ).resolves.toMatchObject({
      status: "restored",
      disposition: "existing",
      rollbackId,
      aggregateRefreshId,
    });
  });

  it("rejects malformed authority before opening a connection", () => {
    const test = harness([]);
    const configured = repository(test);
    expect(() =>
      configured.rollbackActiveSourceVersion({
        ...rollbackInput(),
        batchId: "not-a-uuid",
      }),
    ).toThrow("batchId must be a UUID");
    expect(() =>
      configured.rollbackActiveSourceVersion({
        ...rollbackInput(),
        idempotencyKey: "../unsafe",
      }),
    ).toThrow("idempotencyKey is invalid");
    expect(test.query).not.toHaveBeenCalled();
  });

  it("rolls back when runtime privilege or RLS evidence is unsafe", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation({ runtime_can_rollback: false })],
    ]);
    await expect(
      repository(test).rollbackActiveSourceVersion(rollbackInput()),
    ).rejects.toThrow("runtime privileges are incomplete");
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
    expect(
      test.events.some(
        (event) =>
          event.includes("rollback_active_source_version(") &&
          event.includes("SELECT status"),
      ),
    ).toBe(false);
  });

  it("rejects malformed durable rollback evidence and rolls back", async () => {
    for (const malformed of [
      { disposition: "invented" },
      { source_type: "manual_economic" },
      { rollback_id: "not-a-uuid" },
      { restored_batch_id: null },
      { aggregate_refresh_id: 17 },
    ]) {
      const test = harness([
        [{ owner_scope: databaseOwnerId }],
        [isolation()],
        [
          {
            status: "restored",
            disposition: "created",
            rollback_id: rollbackId,
            source_type: "current_arena",
            restored_batch_id: restoredBatchId,
            aggregate_refresh_id: aggregateRefreshId,
            ...malformed,
          },
        ],
      ]);
      await expect(
        repository(test).rollbackActiveSourceVersion(rollbackInput()),
      ).rejects.toThrow();
      expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
    }
  });
});
