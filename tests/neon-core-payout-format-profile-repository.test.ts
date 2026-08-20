import { describe, expect, it, vi } from "vitest";

import {
  createNeonCorePayoutFormatProfileRepository,
  neonCorePayoutFormatProfileRepositoryFromEnvironment,
} from "@/lib/neon-core-payout-format-profile-repository";
import type { NeonImportPersistenceSessionFactory } from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "user_owner";
const runtimeRole = "dna_app_runtime";
const now = new Date("2026-08-20T00:00:00.000Z");

function isolationRow(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
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

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    core_id: "bike-1",
    mode: "bike",
    payout_format_key: "top 3",
    payout_format_label: "Top 3",
    data_current_through: "2026-08-19T00:00:00.000Z",
    first_event_at: "2026-08-01T00:00:00.000Z",
    race_count: "12",
    win_count: "2",
    top_three_count: "7",
    exact_distance_count: 3,
    timed_race_count: "11",
    refreshed_at: "2026-08-20T00:00:00.000Z",
    last_imported_at: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

function harness(rows: readonly (readonly unknown[])[]): Readonly<{
  sessionFactory: NeonImportPersistenceSessionFactory;
  query: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}> {
  let index = 0;
  const query = vi.fn(async () => ({ rows: rows[index++] ?? [] }));
  const close = vi.fn(async () => undefined);
  return {
    sessionFactory: vi.fn(async () => ({
      client: { query },
      close,
    })),
    query,
    close,
  };
}

describe("Neon payout-format profile repository", () => {
  it("is not configured until all runtime settings are present", () => {
    expect(
      neonCorePayoutFormatProfileRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole,
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("returns bounded, typed and freshness-derived descriptive evidence", async () => {
    const store = harness([[], [], [isolationRow()], [profileRow()], []]);
    const repository = createNeonCorePayoutFormatProfileRepository({
      databaseUrl: "postgres://preview",
      databaseOwnerId,
      runtimeRole,
      now,
      sessionFactory: store.sessionFactory,
    });
    if (repository.status !== "ready")
      throw new Error("repository unavailable");

    await expect(repository.listProfilesByOwner(ownerId)).resolves.toEqual({
      lastImportedAt: "2026-08-20T00:00:00.000Z",
      profiles: [
        {
          coreId: "bike-1",
          mode: "bike",
          payoutFormatKey: "top 3",
          payoutFormatLabel: "Top 3",
          dataCurrentThrough: "2026-08-19T00:00:00.000Z",
          firstEventAt: "2026-08-01T00:00:00.000Z",
          raceCount: 12,
          winCount: 2,
          topThreeCount: 7,
          exactDistanceCount: 3,
          timedRaceCount: 11,
          refreshedAt: "2026-08-20T00:00:00.000Z",
          sampleStatus: "minimally_supported",
          freshness: "current",
        },
      ],
    });
    expect(store.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("list_core_payout_format_profiles"),
      [databaseOwnerId, null, 5_000],
    );
    expect(store.close).toHaveBeenCalledOnce();
  });

  it("bounds an exact Core lookup separately", async () => {
    const store = harness([[], [], [isolationRow()], [], []]);
    const repository = createNeonCorePayoutFormatProfileRepository({
      databaseUrl: "postgres://preview",
      databaseOwnerId,
      runtimeRole,
      now,
      sessionFactory: store.sessionFactory,
    });
    if (repository.status !== "ready")
      throw new Error("repository unavailable");

    await repository.listProfilesByOwner(ownerId, "bike-1");
    expect(store.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("list_core_payout_format_profiles"),
      [databaseOwnerId, "bike-1", 250],
    );
  });

  it("fails closed when forced RLS or least privilege is absent", async () => {
    const store = harness([
      [],
      [],
      [isolationRow({ profile_force_row_security_enabled: false })],
      [],
    ]);
    const repository = createNeonCorePayoutFormatProfileRepository({
      databaseUrl: "postgres://preview",
      databaseOwnerId,
      runtimeRole,
      now,
      sessionFactory: store.sessionFactory,
    });
    if (repository.status !== "ready")
      throw new Error("repository unavailable");

    await expect(repository.listProfilesByOwner(ownerId)).rejects.toThrow(
      "forced owner isolation",
    );
    expect(store.query).toHaveBeenCalledWith("ROLLBACK");
    expect(store.close).toHaveBeenCalledOnce();
  });

  it("rejects inconsistent aggregate counts and rolls back", async () => {
    const store = harness([
      [],
      [],
      [isolationRow()],
      [profileRow({ top_three_count: 13 })],
      [],
    ]);
    const repository = createNeonCorePayoutFormatProfileRepository({
      databaseUrl: "postgres://preview",
      databaseOwnerId,
      runtimeRole,
      now,
      sessionFactory: store.sessionFactory,
    });
    if (repository.status !== "ready")
      throw new Error("repository unavailable");

    await expect(repository.listProfilesByOwner(ownerId)).rejects.toThrow(
      "counts are inconsistent",
    );
    expect(store.query).toHaveBeenCalledWith("ROLLBACK");
    expect(store.close).toHaveBeenCalledOnce();
  });
});
