import { describe, expect, it, vi } from "vitest";

import type { DnaCurrentStateAcquisitionCycleCheckpoint } from "@/lib/dna-open-lab-current-state-acquisition-runner";
import { createNeonDnaCurrentStateAcquisitionCycleCheckpointRepository } from "@/lib/neon-dna-open-lab-current-state-acquisition-cycle";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "75000000-0000-4000-8000-000000000001";
const cycleId = "75000000-0000-4000-8000-000000000010";
const ownerId = "private_owner";
const runtimeRole = "dna_app_runtime";
const now = new Date("2026-08-28T00:01:00.000Z");

function checkpoint(
  overrides: Partial<DnaCurrentStateAcquisitionCycleCheckpoint> = {},
): DnaCurrentStateAcquisitionCycleCheckpoint {
  return Object.freeze({
    version: 1 as const,
    cycleId,
    evaluatedAt: "2026-08-28T00:00:00.000Z",
    scheduleSha256: "a".repeat(64),
    status: "running" as const,
    scheduledRequestKeys: Object.freeze(["1".repeat(64)]),
    receipts: Object.freeze([]),
    completedGroups: Object.freeze([]),
    pauseReason: null,
    retryNotBefore: null,
    ...overrides,
  });
}

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    cycle_rls: true,
    cycle_force_rls: true,
    runtime_can_access_cycle: false,
    runtime_can_save: true,
    runtime_can_read: true,
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
  const repository =
    createNeonDnaCurrentStateAcquisitionCycleCheckpointRepository({
      databaseUrl: "postgresql://private.example/dna",
      databaseOwnerId,
      ownerId,
      runtimeRole,
      clock: () => now,
      sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
    });
  return { events, query, repository, sessionFactory };
}

describe("Neon DNA Open Lab current-state acquisition cycle", () => {
  it("creates a cycle in a serializable owner-scoped transaction", async () => {
    const expected = checkpoint();
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ revision: "1", checkpoint: expected }],
    ]);

    await expect(
      test.repository.save({ expectedRevision: null, checkpoint: expected }),
    ).resolves.toEqual({ revision: "1", checkpoint: expected });

    expect(test.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      cycleId,
      null,
      JSON.stringify(expected),
    ]);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("loads the exact cycle through a read-only owner scope", async () => {
    const expected = checkpoint();
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ revision: "4", checkpoint: expected }],
    ]);

    await expect(test.repository.load(cycleId)).resolves.toEqual({
      revision: "4",
      checkpoint: expected,
    });
    expect(test.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY");
    expect(test.query.mock.calls[3]?.[1]).toEqual([databaseOwnerId, cycleId]);
  });

  it("returns null when the requested cycle does not exist", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [],
    ]);
    await expect(test.repository.load(cycleId)).resolves.toBeNull();
  });

  it("rejects unsafe isolation and malformed durable documents", async () => {
    const unsafe = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation({ runtime_can_access_cycle: true })],
    ]);
    await expect(unsafe.repository.load(cycleId)).rejects.toThrow(
      "table access is not bounded",
    );
    expect(unsafe.events.slice(-2)).toEqual(["ROLLBACK", "close"]);

    const malformed = harness([]);
    await expect(
      malformed.repository.save({
        expectedRevision: null,
        checkpoint: checkpoint({ scheduleSha256: "not-a-checksum" }),
      }),
    ).rejects.toThrow("schedule evidence is invalid");
    expect(malformed.sessionFactory).not.toHaveBeenCalled();
  });
});
