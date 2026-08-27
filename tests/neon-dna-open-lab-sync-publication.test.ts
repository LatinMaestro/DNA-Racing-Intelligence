import { describe, expect, it, vi } from "vitest";

import type { DnaCurrentStateCandidate } from "@/lib/dna-open-lab-last-good-publication";
import { createNeonDnaOpenLabSyncPublicationRepository } from "@/lib/neon-dna-open-lab-sync-publication";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const generationId = "22222222-2222-4222-8222-222222222222";
const ownerId = "private_owner";
const runtimeRole = "dna_app_runtime";

function candidate(
  activeRaceStatus: "complete" | "partial" = "complete",
): DnaCurrentStateCandidate {
  return {
    generationId,
    observedAt: "2026-08-27T12:00:00.000Z",
    families: {
      vault: { status: "complete", itemCount: 2 },
      cores: { status: "complete", itemCount: 2 },
      active_races: { status: activeRaceStatus, itemCount: 1 },
      race_fills: { status: "complete", itemCount: 1 },
      tokens: { status: "complete", itemCount: 2 },
      splice_arena: { status: "complete", itemCount: 3 },
    },
  };
}

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    generation_rls: true,
    generation_force_rls: true,
    family_rls: true,
    family_force_rls: true,
    state_rls: true,
    state_force_rls: true,
    runtime_can_access_generation: false,
    runtime_can_access_family: false,
    runtime_can_access_state: false,
    runtime_can_stage: true,
    runtime_can_publish: true,
    runtime_can_pause: true,
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

function currentState(overrides: Record<string, unknown> = {}) {
  return {
    accepted_generation_id: generationId,
    accepted_observed_at: new Date("2026-08-27T12:00:00.000Z"),
    accepted_at: new Date("2026-08-27T12:02:00.000Z"),
    serving_generation_id: generationId,
    sync_status: "current",
    catch_up_required: false,
    last_attempt_at: new Date("2026-08-27T12:02:00.000Z"),
    last_interruption_reason: null,
    last_interruption_at: null,
    retry_after_seconds: null,
    last_catch_up_completed_at: null,
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
  const repository = createNeonDnaOpenLabSyncPublicationRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    runtimeRole,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  });
  return { events, query, repository, sessionFactory };
}

describe("Neon DNA Open Lab sync publication", () => {
  it("stages and atomically publishes a complete owner-scoped generation", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ status: "staged" }],
      [{ status: "published" }],
      [currentState()],
    ]);

    await expect(
      test.repository.publishCandidate({
        ownerId,
        candidate: candidate(),
        recordedAt: "2026-08-27T12:01:00.000Z",
        acceptedAt: "2026-08-27T12:02:00.000Z",
      }),
    ).resolves.toMatchObject({
      acceptedGenerationId: generationId,
      servingGenerationId: generationId,
      syncStatus: "current",
      catchUpRequired: false,
    });

    expect(test.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      generationId,
      "2026-08-27T12:00:00.000Z",
      "2026-08-27T12:01:00.000Z",
      JSON.stringify(candidate().families),
    ]);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("rejects a partial candidate before opening a database session", async () => {
    const test = harness([]);
    await expect(
      test.repository.publishCandidate({
        ownerId,
        candidate: candidate("partial"),
        recordedAt: "2026-08-27T12:01:00.000Z",
        acceptedAt: "2026-08-27T12:02:00.000Z",
      }),
    ).rejects.toThrow("active_races");
    expect(test.sessionFactory).not.toHaveBeenCalled();
  });

  it("persists a rate pause without replacing the last-good generation", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ status: "paused" }],
      [
        currentState({
          sync_status: "paused",
          catch_up_required: true,
          last_attempt_at: new Date("2026-08-27T12:03:00.000Z"),
          last_interruption_reason: "rate_limited",
          last_interruption_at: new Date("2026-08-27T12:03:00.000Z"),
          retry_after_seconds: 60,
        }),
      ],
    ]);

    await expect(
      test.repository.pause({
        ownerId,
        reason: "rate_limited",
        attemptedAt: "2026-08-27T12:03:00.000Z",
        retryAfterSeconds: 60,
      }),
    ).resolves.toMatchObject({
      servingGenerationId: generationId,
      syncStatus: "paused",
      catchUpRequired: true,
      lastInterruption: { reason: "rate_limited", retryAfterSeconds: 60 },
    });
  });

  it("returns the deterministic never-synced state when no pointer exists", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [],
    ]);
    await expect(test.repository.read({ ownerId })).resolves.toEqual({
      acceptedGenerationId: null,
      acceptedObservedAt: null,
      acceptedAt: null,
      servingGenerationId: null,
      syncStatus: "never_synced",
      catchUpRequired: false,
      lastAttemptAt: null,
      lastInterruption: null,
      lastCatchUpCompletedAt: null,
    });
    expect(test.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY");
  });

  it("rolls back when forced-RLS or least-privilege evidence is unsafe", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation({ runtime_can_access_state: true })],
    ]);
    await expect(test.repository.read({ ownerId })).rejects.toThrow(
      "table access is not bounded",
    );
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });
});
