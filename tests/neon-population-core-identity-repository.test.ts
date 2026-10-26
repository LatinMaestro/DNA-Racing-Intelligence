import { describe, expect, it, vi } from "vitest";

import {
  createNeonPopulationCoreIdentityRepository,
  neonPopulationCoreIdentityRepositoryFromEnvironment,
} from "../lib/neon-population-core-identity-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "../lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";

function harness(rows: readonly (readonly unknown[])[]) {
  let index = 0;
  const calls: Array<{ statement: string; values?: readonly unknown[] }> = [];
  const query = vi.fn(
    async (statement: string, values?: readonly unknown[]) => {
      const normalized = statement.replace(/\s+/g, " ").trim();
      calls.push({ statement: normalized, ...(values ? { values } : {}) });
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(normalized)) return { rows: [] };
      return { rows: rows[index++] ?? [] };
    },
  );
  const client: NeonImportPersistenceClient = { query };
  const close = vi.fn(async () => undefined);
  const factory = vi.fn(async () => ({ client, close }));
  return {
    calls,
    close,
    factory: factory as NeonImportPersistenceSessionFactory,
  };
}

describe("Neon population Core identity repository", () => {
  it("is unavailable until every runtime setting exists", () => {
    expect(
      neonPopulationCoreIdentityRepositoryFromEnvironment(
        {
          databaseUrl: undefined,
          databaseOwnerId,
          runtimeRole: "dna_app_runtime",
        },
        "user_owner",
      ),
    ).toEqual({ status: "not_configured" });
  });

  it("reads one exact owner-scoped population identity in a read-only transaction", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [
        {
          session_user_name: "dna_app_runtime",
          current_user_name: "dna_app_runtime",
          rolsuper: false,
          rolbypassrls: false,
        },
      ],
      [
        {
          source_core_id: "9002",
          generation_id: "22222222-2222-4222-8222-222222222222",
          evaluated_at: "2026-10-06T05:02:00.000Z",
          core_set_sha256: "a".repeat(64),
          core_count: "4096",
        },
      ],
    ]);
    const repository = createNeonPopulationCoreIdentityRepository({
      databaseUrl: "postgresql://preview.example/dna",
      databaseOwnerId,
      runtimeRole: "dna_app_runtime",
      configuredOwnerId: "user_owner",
      sessionFactory: test.factory,
    });
    if (repository.status !== "ready") throw new Error("repository not ready");
    await expect(
      repository.readExactIdentity("user_owner", "9002"),
    ).resolves.toEqual({
      sourceCoreId: "9002",
      generationId: "22222222-2222-4222-8222-222222222222",
      evaluatedAt: "2026-10-06T05:02:00.000Z",
      coreSetSha256: "a".repeat(64),
      populationCoreCount: 4096,
    });
    expect(test.calls.at(-1)?.statement).toBe("COMMIT");
    expect(
      test.calls.find((call) =>
        call.statement.includes("read_dna_population_core_identity"),
      )?.values,
    ).toEqual([databaseOwnerId, 9002]);
    expect(test.close).toHaveBeenCalledOnce();
  });

  it("does not query for a non-numeric Core identity", async () => {
    const test = harness([]);
    const repository = createNeonPopulationCoreIdentityRepository({
      databaseUrl: "postgresql://preview.example/dna",
      databaseOwnerId,
      runtimeRole: "dna_app_runtime",
      configuredOwnerId: "user_owner",
      sessionFactory: test.factory,
    });
    if (repository.status !== "ready") throw new Error("repository not ready");
    await expect(
      repository.readExactIdentity("user_owner", "Seven"),
    ).resolves.toBeNull();
    expect(test.factory).not.toHaveBeenCalled();
  });
});
