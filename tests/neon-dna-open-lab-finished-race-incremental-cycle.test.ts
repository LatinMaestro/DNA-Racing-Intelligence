import { describe, expect, it, vi } from "vitest";

import type { DnaFinishedRaceBackfillCheckpoint } from "@/lib/dna-open-lab-finished-race-backfill";
import { createDnaFinishedRaceIncrementalCycle } from "@/lib/dna-open-lab-finished-race-incremental-cycle";
import { createNeonDnaFinishedRaceIncrementalCycleRepository } from "@/lib/neon-dna-open-lab-finished-race-incremental-cycle";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "89000000-0000-4000-8000-000000000001";
const ownerId = "private_owner";
const runtimeRole = "dna_app_runtime";

function checkpoint(): DnaFinishedRaceBackfillCheckpoint {
  const rootWindow = Object.freeze({
    startTime: "2026-09-02T00:11:55.961Z",
    endTime: "2026-09-03T00:11:55.961Z",
  });
  return Object.freeze({
    version: 1 as const,
    rootWindow,
    pendingWindows: Object.freeze([rootWindow]),
    minimumWindowMilliseconds: 1,
    completedWindowCount: 0,
    splitCount: 0,
    successfulFinishedRaceRequestCount: 0,
    raceDocumentRequestCount: 0,
    publishedWindowDocumentCount: 0,
    identityOmissionAuthority: null,
    omittedIdentityObservationCount: 0,
  });
}

function cycle() {
  return createDnaFinishedRaceIncrementalCycle({
    lowerBoundAt: "2026-09-02T00:11:55.961Z",
    upperBoundAt: "2026-09-03T00:11:55.961Z",
    previousCompletedCycleId: null,
    checkpoint: checkpoint(),
  });
}

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    cycle_rls: true,
    cycle_force_rls: true,
    attempt_rls: true,
    attempt_force_rls: true,
    receipt_rls: true,
    receipt_force_rls: true,
    runtime_can_access_cycle: false,
    runtime_can_access_attempt: false,
    runtime_can_access_receipt: false,
    runtime_can_save: true,
    runtime_can_save_progress: true,
    runtime_can_read: true,
    runtime_can_read_latest: true,
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
  const repository = createNeonDnaFinishedRaceIncrementalCycleRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    ownerId,
    runtimeRole,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  });
  return { events, query, repository, sessionFactory };
}

describe("Neon DNA finished-race incremental cycle", () => {
  it("creates an owner-scoped cycle in a serializable transaction", async () => {
    const expected = cycle();
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ revision: "1", cycle: expected }],
    ]);

    await expect(
      test.repository.save({ expectedRevision: null, cycle: expected }),
    ).resolves.toEqual({ revision: "1", cycle: expected });

    expect(test.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      null,
      JSON.stringify(expected),
    ]);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("loads exact and latest-complete attempts read-only", async () => {
    const expected = cycle();
    const exact = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ revision: 2n, cycle: JSON.stringify(expected) }],
    ]);
    await expect(
      exact.repository.load({
        cycleId: expected.cycleId,
        attemptNumber: 1,
      }),
    ).resolves.toEqual({ revision: "2", cycle: expected });
    expect(exact.events[0]).toBe(
      "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY",
    );

    const latest = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [],
    ]);
    await expect(latest.repository.loadLatestComplete()).resolves.toBeNull();
  });

  it("atomically saves crawler progress and its immutable publication binding", async () => {
    const initial = cycle();
    const next = {
      ...initial,
      checkpoint: {
        ...initial.checkpoint,
        pendingWindows: Object.freeze([]),
        completedWindowCount: 1,
        successfulFinishedRaceRequestCount: 1,
        raceDocumentRequestCount: 1,
        publishedWindowDocumentCount: 1,
      },
    };
    const publication = {
      window: initial.checkpoint.rootWindow,
      receipt: {
        windowKey: "c".repeat(64),
        contentSha256: "d".repeat(64),
        documentCount: 1,
        manifestObjectKey: `dna-open-lab/v1/${"e".repeat(64)}/races/finished-windows/${"c".repeat(64)}.json`,
        manifestBodySha256: "f".repeat(64),
        manifestByteLength: 256,
      },
    } as const;
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ revision: "2", cycle: next }],
    ]);

    await expect(
      test.repository.saveProgress({
        expectedRevision: "1",
        cycle: next,
        publication,
      }),
    ).resolves.toEqual({ revision: "2", cycle: next });
    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      "1",
      JSON.stringify(next),
      JSON.stringify(publication),
    ]);
  });

  it("fails closed on unsafe isolation and invalid request authority", async () => {
    const unsafe = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation({ runtime_can_access_cycle: true })],
    ]);
    await expect(unsafe.repository.loadLatestComplete()).rejects.toThrow(
      "table access is not bounded",
    );
    expect(unsafe.events.slice(-2)).toEqual(["ROLLBACK", "close"]);

    const malformed = harness([]);
    await expect(
      malformed.repository.load({ cycleId: "not-a-cycle", attemptNumber: 1 }),
    ).rejects.toThrow("cycleId is invalid");
    expect(malformed.sessionFactory).not.toHaveBeenCalled();
  });

  it("rolls back when a stored response does not match the requested cycle", async () => {
    const expected = cycle();
    const drifted = { ...expected, status: "paused" };
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ revision: "1", cycle: drifted }],
    ]);

    await expect(
      test.repository.save({ expectedRevision: null, cycle: expected }),
    ).rejects.toThrow();
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });
});
