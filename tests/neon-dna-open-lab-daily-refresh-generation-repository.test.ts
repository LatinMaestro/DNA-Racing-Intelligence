import { describe, expect, it, vi } from "vitest";

import type { DnaOpenLabDailyRefreshGeneration } from "@/lib/dna-open-lab-daily-refresh-coordinator";
import {
  createNeonDnaOpenLabDailyRefreshGenerationRepository,
  neonDnaOpenLabDailyRefreshGenerationRepositoryFromEnvironment,
} from "@/lib/neon-dna-open-lab-daily-refresh-generation-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "private-owner";
const hash = (character: string) => character.repeat(64);

function ownerEvidence() {
  return {
    owner_id: databaseOwnerId,
    clerk_user_id: ownerId,
    generation_rls: true,
    generation_force_rls: true,
    active_rls: true,
    active_force_rls: true,
    session_user_name: "dna_app_runtime",
    current_user_name: "dna_app_runtime",
    rolsuper: false,
    rolbypassrls: false,
    can_read_generation: true,
    can_read_last_good: true,
    can_publish_generation: true,
  };
}

function generationRow() {
  return {
    refresh_cycle_id: hash("a"),
    budget_window_id: hash("b"),
    budget_request_sha256: hash("c"),
    finished_history_cycle_id: hash("d"),
    current_state_generation_id: "22222222-2222-4222-8222-222222222222",
    actual_storage_bytes: "1000",
    actual_class_a_operations: "10",
    actual_class_b_operations: "20",
    published_at: "2026-09-08T00:30:00Z",
  };
}

function candidate(): DnaOpenLabDailyRefreshGeneration {
  return {
    version: 1,
    refreshCycleId: hash("a"),
    budgetWindowId: hash("b"),
    budgetRequestSha256: hash("c"),
    finishedHistoryCycleId: hash("d"),
    currentStateGenerationId: "22222222-2222-4222-8222-222222222222",
    actualR2Usage: {
      storageBytes: 1000,
      classAOperations: 10,
      classBOperations: 20,
    },
    publishedAt: "2026-09-08T00:30:00.000Z",
  };
}

function harness(sequence: readonly (readonly unknown[])[]) {
  let index = 0;
  const statements: string[] = [];
  const values: (readonly unknown[])[] = [];
  const query = vi.fn(
    async (statement: string, queryValues?: readonly unknown[]) => {
      const normalized = statement.replace(/\s+/gu, " ").trim();
      statements.push(normalized);
      values.push(queryValues ?? []);
      if (
        [
          "BEGIN ISOLATION LEVEL SERIALIZABLE",
          "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY",
          "COMMIT",
          "ROLLBACK",
        ].includes(normalized)
      ) {
        return { rows: [] };
      }
      return { rows: sequence[index++] ?? [] };
    },
  );
  const client: NeonImportPersistenceClient = { query };
  const close = vi.fn(async () => undefined);
  const sessionFactory = vi.fn(async () => ({
    client,
    close,
  })) as unknown as NeonImportPersistenceSessionFactory;
  return { statements, values, close, sessionFactory };
}

function repository(test: ReturnType<typeof harness>) {
  return createNeonDnaOpenLabDailyRefreshGenerationRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    runtimeRole: "dna_app_runtime",
    sessionFactory: test.sessionFactory,
  });
}

describe("Neon DNA Open Lab daily refresh generation repository", () => {
  it("stays unavailable unless every private runtime value exists", () => {
    expect(
      neonDnaOpenLabDailyRefreshGenerationRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole: "dna_app_runtime",
      }),
    ).toBeNull();
  });

  it("loads only after verifying both forced-RLS relations and runtime role", async () => {
    const test = harness([[{}], [ownerEvidence()], [generationRow()]]);

    await expect(repository(test).load(ownerId, hash("a"))).resolves.toEqual(
      candidate(),
    );
    expect(
      test.statements.some((entry) => entry.includes("relforcerowsecurity")),
    ).toBe(true);
    expect(test.close).toHaveBeenCalledOnce();
    expect(test.statements).toContain(
      "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY",
    );
  });

  it("loads the combined last-good pointer in a serializable read-only transaction", async () => {
    const test = harness([[{}], [ownerEvidence()], [generationRow()]]);

    await expect(repository(test).loadLastGood(ownerId)).resolves.toEqual(
      candidate(),
    );
    const index = test.statements.findIndex((entry) =>
      entry.startsWith(
        "SELECT * FROM dna.read_dna_open_lab_daily_refresh_last_good",
      ),
    );
    expect(index).toBeGreaterThan(0);
    expect(test.values[index]).toEqual([databaseOwnerId]);
    expect(test.statements[0]).toBe(
      "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY",
    );
  });

  it("returns no last-good generation until a complete refresh is active", async () => {
    const test = harness([[{}], [ownerEvidence()], []]);

    await expect(repository(test).loadLastGood(ownerId)).resolves.toBeNull();
  });

  it("fails closed when the combined last-good pointer is ambiguous", async () => {
    const test = harness([
      [{}],
      [ownerEvidence()],
      [generationRow(), generationRow()],
    ]);

    await expect(repository(test).loadLastGood(ownerId)).rejects.toThrow(
      "last-good generation is ambiguous",
    );
    expect(test.statements).toContain("ROLLBACK");
  });

  it("publishes the complete authority through the function-only boundary", async () => {
    const test = harness([[{}], [ownerEvidence()], [generationRow()]]);

    await expect(
      repository(test).publish(ownerId, candidate()),
    ).resolves.toEqual(candidate());
    const index = test.statements.findIndex((entry) =>
      entry.startsWith(
        "SELECT * FROM dna.publish_dna_open_lab_daily_refresh_generation",
      ),
    );
    expect(index).toBeGreaterThan(0);
    expect(test.statements[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(test.values[index]).toEqual([
      databaseOwnerId,
      hash("a"),
      hash("b"),
      hash("c"),
      hash("d"),
      "22222222-2222-4222-8222-222222222222",
      1000,
      10,
      20,
      "2026-09-08T00:30:00.000Z",
    ]);
  });

  it("rolls back and closes when owner isolation evidence is unsafe", async () => {
    const test = harness([[{}], [{ ...ownerEvidence(), active_rls: false }]]);

    await expect(repository(test).load(ownerId, hash("a"))).rejects.toThrow(
      "owner isolation denied",
    );
    expect(test.statements).toContain("ROLLBACK");
    expect(test.close).toHaveBeenCalledOnce();
  });

  it("rejects malformed generation identities before opening a session", async () => {
    const test = harness([]);

    expect(() =>
      repository(test).publish(ownerId, {
        ...candidate(),
        refreshCycleId: "not-a-hash",
      }),
    ).toThrow("refreshCycleId is invalid");
    expect(test.sessionFactory).not.toHaveBeenCalled();
  });
});
