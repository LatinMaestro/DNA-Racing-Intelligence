import { describe, expect, it, vi } from "vitest";

import {
  applyDnaCoreRaceHistoryPageReceipt,
  createDnaCoreRaceHistoryAcquisitionCycle,
  createDnaCoreRaceHistoryCoreCheckpoint,
  createDnaCoreRaceHistoryPageReceipt,
} from "@/lib/dna-core-race-history-acquisition-cycle";
import { createNeonDnaCoreRaceHistoryAcquisitionRepository } from "@/lib/neon-dna-core-race-history-acquisition";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "a1000000-0000-4000-8000-000000000001";
const ownerId = "private_owner";
const runtimeRole = "dna_app_runtime";

const cycle = createDnaCoreRaceHistoryAcquisitionCycle({
  previousCompletedCycleId: null,
  currentStateGenerationId: "a1000000-0000-4000-8000-000000000011",
  evaluatedAt: "2026-09-15T06:00:00.000Z",
  coreIds: [42],
});

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    cycle_rls: true,
    cycle_force_rls: true,
    attempt_rls: true,
    attempt_force_rls: true,
    checkpoint_rls: true,
    checkpoint_force_rls: true,
    receipt_rls: true,
    receipt_force_rls: true,
    runtime_can_read_tables: false,
    runtime_can_write_tables: false,
    runtime_can_save_attempt: true,
    runtime_can_save_page: true,
    runtime_can_read_attempt: true,
    runtime_can_read_latest: true,
    runtime_can_read_next: true,
    runtime_can_read_cores: true,
    session_user_name: runtimeRole,
    current_user_name: runtimeRole,
    runtime_is_superuser: false,
    runtime_bypasses_rls: false,
    runtime_can_create_roles: false,
    runtime_can_create_databases: false,
    runtime_can_create_in_database: false,
    runtime_can_create_in_schema: false,
    runtime_is_neon_superuser_member: false,
    ...overrides,
  };
}

function harness(rows: readonly (readonly unknown[])[]) {
  const events: string[] = [];
  let index = 0;
  const query = vi.fn(
    async (statement: string, values?: readonly unknown[]) => {
      const normalized = statement.replace(/\s+/gu, " ").trim();
      events.push(
        values ? `${normalized}|${JSON.stringify(values)}` : normalized,
      );
      if (
        normalized.startsWith("BEGIN ISOLATION LEVEL") ||
        normalized === "COMMIT" ||
        normalized === "ROLLBACK"
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
  const repository = createNeonDnaCoreRaceHistoryAcquisitionRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    ownerId,
    runtimeRole,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  });
  return { events, query, repository };
}

describe("Neon DNA Core race history acquisition", () => {
  it("saves an owner-scoped attempt with optimistic concurrency", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ revision: "1", cycle }],
    ]);

    await expect(
      test.repository.saveAttempt({ expectedRevision: null, cycle }),
    ).resolves.toEqual({ revision: "1", cycle });
    expect(test.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      null,
      JSON.stringify(cycle),
    ]);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("loads the next durable Core cursor and atomically binds its page receipt", async () => {
    const initial = createDnaCoreRaceHistoryCoreCheckpoint({
      cycle,
      coreId: 42,
    });
    const load = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ revision: 1n, checkpoint: JSON.stringify(initial) }],
    ]);
    await expect(
      load.repository.loadNextCore({
        cycleId: cycle.cycleId,
        attemptNumber: 1,
      }),
    ).resolves.toEqual({ revision: "1", checkpoint: initial });
    expect(load.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY");

    const receipt = createDnaCoreRaceHistoryPageReceipt({
      cycleId: cycle.cycleId,
      attemptNumber: 1,
      coreId: 42,
      pageNumber: 1,
      observedAt: "2026-09-15T06:01:00.000Z",
      sourceRowCount: 0,
      acceptedResultCount: 0,
      quarantineCount: 0,
      replayDuplicateCount: 0,
      pageObjectKey:
        `dna-open-lab/v1/${"a".repeat(64)}/core-race-history/cycles/` +
        `${cycle.cycleId}/attempts/1/cores/${"b".repeat(64)}/pages/1.json`,
      pageBodySha256: "c".repeat(64),
      pageByteLength: 256,
      quarantineObjectKey: null,
      quarantineBodySha256: null,
      quarantineByteLength: null,
    });
    const complete = applyDnaCoreRaceHistoryPageReceipt({
      checkpoint: initial,
      receipt,
    });
    const save = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ revision: "2", checkpoint: complete }],
    ]);
    await expect(
      save.repository.savePage({
        expectedCoreRevision: "1",
        checkpoint: complete,
        receipt,
      }),
    ).resolves.toEqual({ revision: "2", checkpoint: complete });
    expect(save.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      "1",
      JSON.stringify(complete),
      JSON.stringify(receipt),
    ]);
  });

  it("rolls back before data access when least-privilege isolation drifts", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation({ checkpoint_force_rls: false })],
    ]);

    await expect(test.repository.loadLatestComplete()).rejects.toThrow(
      "requires forced owner RLS",
    );
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
    expect(test.query).toHaveBeenCalledTimes(4);
  });

  it("rejects a runtime role that can create objects in the DNA schema", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation({ runtime_can_create_in_schema: true })],
    ]);

    await expect(test.repository.loadLatestComplete()).rejects.toThrow(
      "runtime role is unsafe",
    );
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
    expect(test.query).toHaveBeenCalledTimes(4);
  });
});
