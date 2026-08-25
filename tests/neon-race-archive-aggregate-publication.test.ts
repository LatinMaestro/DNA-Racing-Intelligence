import { describe, expect, it, vi } from "vitest";

import { createNeonRaceArchiveAggregatePublicationRepository } from "../lib/neon-race-archive-aggregate-publication";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "../lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "owner-1";
const runtimeRole = "dna_app_runtime";
const refreshId = "22222222-2222-4222-8222-222222222222";
const raceDatasetVersionId = "33333333-3333-4333-8333-333333333333";
const sourceHash = "a".repeat(64);
const payloadHash = "b".repeat(64);

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    stage_rls: true,
    stage_force_rls: true,
    stage_row_rls: true,
    stage_row_force_rls: true,
    receipt_rls: true,
    receipt_force_rls: true,
    runtime_can_access_stage_table: false,
    runtime_can_access_stage_row_table: false,
    runtime_can_access_receipt_table: false,
    runtime_can_begin: true,
    runtime_can_stage: true,
    runtime_can_publish: true,
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
      events.push(values ? `${normalized}|${JSON.stringify(values)}` : normalized);
      if (
        normalized === "BEGIN ISOLATION LEVEL SERIALIZABLE" ||
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
  return {
    events,
    query,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  };
}

function repository(test: ReturnType<typeof harness>) {
  return createNeonRaceArchiveAggregatePublicationRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    runtimeRole,
    sessionFactory: test.sessionFactory,
  });
}

describe("Neon Race archive aggregate publication repository", () => {
  it("begins exact owner-scoped staging through the narrow SQL function", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ status: "staging" }],
    ]);

    await expect(
      repository(test).begin({
        ownerId,
        refreshId,
        raceDatasetVersionId,
        workerId: "aggregate-worker-1",
        sourceVersionSetSha256: sourceHash,
        refreshedAt: "2026-08-25T00:00:00.000Z",
      }),
    ).resolves.toBe("staging");

    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      refreshId,
      raceDatasetVersionId,
      "aggregate-worker-1",
      sourceHash,
      "2026-08-25T00:00:00.000Z",
    ]);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("stages bounded read-model rows without direct table access", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ staged_row_count: 2 }],
    ]);
    const rows = [
      { source_core_id: "core-1", mode: "bike", distance_m: 1000 },
      { source_core_id: "core-2", mode: "car", distance_m: 1500 },
    ] as const;

    await expect(
      repository(test).stageRows({
        ownerId,
        refreshId,
        workerId: "aggregate-worker-1",
        family: "core_performance",
        startOrdinal: 0,
        rows,
      }),
    ).resolves.toBe(2);

    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      refreshId,
      "aggregate-worker-1",
      "core_performance",
      0,
      JSON.stringify(rows),
    ]);
  });

  it("publishes exact bounded counts and returns durable materialized evidence", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ status: "published", materialized_row_count: "125" }],
    ]);

    await expect(
      repository(test).publish({
        ownerId,
        refreshId,
        workerId: "aggregate-worker-1",
        payloadSha256: payloadHash,
        validatedEventCount: 70,
        acceptedFormatEntryCount: 80,
        corePerformanceProfileCount: 20,
        discoveryBenchmarkCount: 10,
        payoutFormatProfileCount: 15,
        coreStarProfileCount: 10,
        completedAt: "2026-08-25T00:04:00.000Z",
      }),
    ).resolves.toEqual({ status: "published", materializedRowCount: 125 });

    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      refreshId,
      "aggregate-worker-1",
      payloadHash,
      70,
      80,
      20,
      10,
      15,
      10,
      "2026-08-25T00:04:00.000Z",
    ]);
  });

  it("fails closed before mutation when runtime privilege evidence is unsafe", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation({ runtime_can_access_receipt_table: true })],
    ]);

    await expect(
      repository(test).begin({
        ownerId,
        refreshId,
        raceDatasetVersionId,
        workerId: "aggregate-worker-1",
        sourceVersionSetSha256: sourceHash,
        refreshedAt: "2026-08-25T00:00:00.000Z",
      }),
    ).rejects.toThrow("table access is not bounded");
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });

  it("rejects oversized staging chunks before opening a database session", async () => {
    const test = harness([]);
    const rows = Array.from({ length: 2_001 }, (_, index) => ({ index }));

    await expect(
      repository(test).stageRows({
        ownerId,
        refreshId,
        workerId: "aggregate-worker-1",
        family: "core_performance",
        startOrdinal: 0,
        rows,
      }),
    ).rejects.toThrow("outside its bound");
    expect(test.sessionFactory).not.toHaveBeenCalled();
  });
});
