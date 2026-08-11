import { describe, expect, it, vi } from "vitest";

import {
  createNeonCorePerformanceProfileRepository,
  neonCorePerformanceProfileRepositoryFromEnvironment,
} from "../lib/neon-core-performance-profile-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "../lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const runtimeRole = "dna_app_runtime";
const clerkOwnerId = "user_owner";

function ownerEvidence(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: clerkOwnerId,
    profile_row_security_enabled: true,
    profile_force_row_security_enabled: true,
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

function harness(sequence: readonly (readonly unknown[] | Error)[]) {
  let index = 0;
  const calls: { statement: string; values: readonly unknown[] | undefined }[] =
    [];
  const query = vi.fn(
    async (statement: string, values?: readonly unknown[]) => {
      const normalized = statement.replace(/\s+/g, " ").trim();
      calls.push({ statement: normalized, values });
      if (
        normalized ===
          "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY" ||
        normalized === "COMMIT" ||
        normalized === "ROLLBACK"
      ) {
        return { rows: [] };
      }
      const next = sequence[index++] ?? [];
      if (next instanceof Error) throw next;
      return { rows: next };
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

function ready(test: ReturnType<typeof harness>) {
  const repository = createNeonCorePerformanceProfileRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    runtimeRole,
    sessionFactory: test.factory,
  });
  if (repository.status !== "ready") throw new Error("repository not ready");
  return repository;
}

const profileRow = {
  core_id: "core-7",
  mode: "bike",
  distance: 1050,
  data_current_through: "2026-08-11T01:00:00.000Z",
  race_count: "2",
  best_milliseconds: "50000",
  median_milliseconds: "51250",
  mean_milliseconds: "51250",
  trimmed_mean_milliseconds: "51250",
  standard_deviation_milliseconds: "1250",
  interquartile_range_milliseconds: "1250",
  best_metres_per_second: "21",
  median_metres_per_second: "20.487804878",
  star_profile: null,
  last_imported_at: "2026-08-11T02:00:00.000Z",
};

describe("Neon Core Intelligence profile repository", () => {
  it("is unavailable until every database runtime setting exists", () => {
    expect(
      neonCorePerformanceProfileRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole,
      }),
    ).toEqual({ status: "not_configured" });
  });

  it(\n    "reads bounded compact owner-Vault profiles with normalized units",\n    async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [profileRow],
    ]);
    await expect(
      ready(test).listProfilesByOwner(clerkOwnerId),
    ).resolves.toEqual({
      profiles: [
        expect.objectContaining({
          coreId: "core-7",
          mode: "bike",
          distance: 1050,
          raceCount: 2,
          sampleStatus: "hypothesis_only",
          elapsedTime: expect.objectContaining({
            bestMilliseconds: 50000,
            medianMilliseconds: 51250,
          }),
          speed: {
            bestMetresPerSecond: 21,
            medianMetresPerSecond: 20.488,
          },
          starProfile: null,
          analyticalStatus: "experimental",
        }),
      ],
      lastImportedAt: "2026-08-11T02:00:00.000Z",
    });
    const readCall = test.calls.find((call) =>
      call.statement.includes("dna.list_core_performance_profiles"),
    );
    expect(readCall?.values).toEqual([databaseOwnerId, 5000]);
    expect(readCall?.statement).toContain("NULL::text");
    expect(test.close).toHaveBeenCalledOnce();
  });

  it("fails closed before profile access for unsafe isolation or privileges", async () => {
    for (const evidence of [
      ownerEvidence({ profile_force_row_security_enabled: false }),
      ownerEvidence({ runtime_bypasses_rls: true }),
    ]) {
      const test = harness([[{ owner_scope: databaseOwnerId }], [evidence]]);
      await expect(
        ready(test).listProfilesByOwner(clerkOwnerId),
      ).rejects.toThrow(/forced owner isolation|least privileged/);
      expect(
        test.calls.some((call) =>
          call.statement.includes("dna.list_core_performance_profiles"),
        ),
      ).toBe(false);
    }
  });

  it("rolls back and closes when the compact read fails", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      new Error("synthetic read failure"),
    ]);
    await expect(
      ready(test).listProfilesByOwner(clerkOwnerId),
    ).rejects.toThrow("synthetic read failure");
    expect(test.calls.at(-1)?.statement).toBe("ROLLBACK");
    expect(test.close).toHaveBeenCalledOnce();
  });
});
