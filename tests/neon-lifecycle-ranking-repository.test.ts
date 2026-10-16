import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { NeonImportPersistenceClient } from "@/lib/neon-import-persistence-driver";
import {
  createNeonLifecycleRankingRepository,
  neonLifecycleRankingRepositoryFromEnvironment,
} from "@/lib/neon-lifecycle-ranking-repository";
import { loadLifecycleWorkspacePageState } from "@/lib/lifecycle-workspace-service";
import { ranking } from "./lifecycle-fixture";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const authenticatedOwnerId = "user_synthetic_owner";
const now = new Date("2026-07-30T00:00:00.000Z");
const evidence = ranking();
const publishedAt = "2026-07-28T01:00:00.000Z";

function row(overrides: Record<string, unknown> = {}) {
  const snapshot = JSON.stringify({
    version: 1,
    databaseOwnerId,
    publishedAt,
    latestAcceptedImportAt: evidence.lastImported,
    ranking: evidence,
  });
  return {
    ranking_id: evidence.rankingId,
    configuration_version: evidence.configurationVersion,
    candidate_snapshot_version: evidence.candidateSnapshotVersion,
    racing_snapshot_version: evidence.racingSnapshotVersion,
    discovery_snapshot_version: evidence.discoverySnapshotVersion,
    maiden_snapshot_version: evidence.maidenSnapshotVersion,
    breeding_snapshot_version: evidence.breedingSnapshotVersion,
    lineage_snapshot_version: evidence.lineageSnapshotVersion,
    market_snapshot_version: evidence.marketSnapshotVersion,
    data_current_through: evidence.dataCurrentThrough,
    latest_accepted_import_at: evidence.lastImported,
    evaluated_at: evidence.evaluatedAt,
    published_at: publishedAt,
    snapshot_sha256: createHash("sha256").update(snapshot).digest("hex"),
    snapshot_json: snapshot,
    ...overrides,
  };
}

const isolation = {
  database_owner_id: databaseOwnerId,
  authenticated_owner_id: authenticatedOwnerId,
  row_security_enabled: true,
  force_row_security_enabled: true,
  session_user_name: "dna_app_runtime",
  current_user_name: "dna_app_runtime",
  runtime_is_superuser: false,
  runtime_bypasses_rls: false,
  runtime_can_create_roles: false,
  runtime_can_create_databases: false,
  runtime_is_neon_superuser_member: false,
  runtime_has_direct_table_access: false,
  runtime_can_read_ranking: true,
};

function harness(
  options: {
    rows?: unknown[];
    isolation?: unknown[];
    failOn?: string;
    closeFails?: boolean;
    rollbackFails?: boolean;
  } = {},
) {
  const query = vi.fn<NeonImportPersistenceClient["query"]>(async (sql) => {
    if (options.failOn && sql.includes(options.failOn))
      throw new Error("private provider detail");
    if (sql === "ROLLBACK" && options.rollbackFails)
      throw new Error("private rollback detail");
    if (sql.includes("AS owner_scope"))
      return { rows: [{ owner_scope: databaseOwnerId }] };
    if (sql.includes("FROM dna.app_owner"))
      return { rows: options.isolation ?? [isolation] };
    if (sql.includes("FROM dna.read_lifecycle_ranking"))
      return { rows: options.rows ?? [row()] };
    return { rows: [] };
  });
  const close = vi.fn(async () => {
    if (options.closeFails) throw new Error("private close detail");
  });
  const factory = vi.fn(async () => ({ client: { query }, close }));
  const repository = createNeonLifecycleRankingRepository({
    databaseUrl: "postgresql://synthetic.invalid/dna",
    databaseOwnerId,
    authenticatedOwnerId,
    runtimeRole: "dna_app_runtime",
    sessionFactory: factory,
    now: () => now,
  });
  if (repository.status !== "ready") throw new Error("repository not ready");
  return { repository, query, close, factory };
}

const unavailable = "Lifecycle ranking evidence read unavailable.";

describe("compact Neon Lifecycle ranking dependency", () => {
  it("composes only a complete server-side owner environment", () => {
    expect(
      neonLifecycleRankingRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole: "dna_app_runtime",
        authenticatedOwnerId,
      }),
    ).toEqual({ status: "not_configured" });
    expect(
      neonLifecycleRankingRepositoryFromEnvironment(
        {
          databaseUrl: "postgresql://synthetic.invalid/dna",
          databaseOwnerId,
          runtimeRole: "dna_app_runtime",
          authenticatedOwnerId,
        },
        async () => {
          throw new Error("must not connect while composing");
        },
      ).status,
    ).toBe("ready");
  });

  it("loads one accepted ranking through a bounded owner-scoped read", async () => {
    const test = harness();
    await expect(
      loadLifecycleWorkspacePageState({
        authenticatedOwnerId,
        configuredOwnerId: authenticatedOwnerId,
        repository: test.repository,
        now,
      }),
    ).resolves.toMatchObject({
      connectionStatus: "read_model_connected",
      ranking: {
        rankingId: evidence.rankingId,
        cores: [{ coreId: "synthetic-core", leadingAction: "race" }],
      },
    });
    expect(test.query.mock.calls[0]?.[0]).toBe(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    const reads = test.query.mock.calls.filter(([sql]) =>
      sql.includes("FROM dna.read_lifecycle_ranking"),
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]?.[1]).toEqual([databaseOwnerId]);
    expect(test.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(test.close).toHaveBeenCalledOnce();
  });

  it("keeps an unmaterialized read model explicitly empty", async () => {
    const test = harness({ rows: [] });
    await expect(
      test.repository.loadRankingEvidenceByOwner(authenticatedOwnerId),
    ).resolves.toEqual({ ranking: null, latestAcceptedImportAt: null });
    expect(test.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("denies another owner before opening persistence", async () => {
    const test = harness();
    await expect(
      test.repository.loadRankingEvidenceByOwner("user_other"),
    ).rejects.toThrow(unavailable);
    expect(test.factory).not.toHaveBeenCalled();
  });

  it.each([
    { snapshot_sha256: "b".repeat(64) },
    { ranking_id: "ranking-v2" },
    { configuration_version: "config-v2" },
    { latest_accepted_import_at: "2026-07-29T00:00:00.000Z" },
    { data_current_through: "2026-07-29T00:00:00.000Z" },
    { snapshot_json: 1 },
  ])("rejects corrupt or source-mismatched snapshots %#", async (overrides) => {
    const test = harness({ rows: [row(overrides)] });
    await expect(
      test.repository.loadRankingEvidenceByOwner(authenticatedOwnerId),
    ).rejects.toThrow(unavailable);
    expect(test.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(test.close).toHaveBeenCalledOnce();
  });

  it("rejects unknown fields in the compact evidence envelope", async () => {
    const altered = {
      version: 1,
      databaseOwnerId,
      publishedAt,
      latestAcceptedImportAt: evidence.lastImported,
      ranking: { ...evidence, privatePayload: "must not pass" },
    };
    const snapshot = JSON.stringify(altered);
    const test = harness({
      rows: [
        row({
          snapshot_json: snapshot,
          snapshot_sha256: createHash("sha256").update(snapshot).digest("hex"),
        }),
      ],
    });
    await expect(
      test.repository.loadRankingEvidenceByOwner(authenticatedOwnerId),
    ).rejects.toThrow(unavailable);
  });

  it.each([
    { row_security_enabled: false },
    { force_row_security_enabled: false },
    { runtime_is_superuser: true },
    { runtime_bypasses_rls: true },
    { runtime_can_create_roles: true },
    { runtime_can_create_databases: true },
    { runtime_is_neon_superuser_member: true },
    { runtime_has_direct_table_access: true },
    { runtime_can_read_ranking: false },
    { database_owner_id: "22222222-2222-4222-8222-222222222222" },
    { authenticated_owner_id: "user_other" },
  ])("denies invalid owner isolation before reading %#", async (changes) => {
    const test = harness({ isolation: [{ ...isolation, ...changes }] });
    await expect(
      test.repository.loadRankingEvidenceByOwner(authenticatedOwnerId),
    ).rejects.toThrow(unavailable);
    expect(
      test.query.mock.calls.some(([sql]) =>
        sql.includes("FROM dna.read_lifecycle_ranking"),
      ),
    ).toBe(false);
  });

  it.each([
    "BEGIN TRANSACTION",
    "statement_timeout",
    "AS owner_scope",
    "FROM dna.app_owner",
    "FROM dna.read_lifecycle_ranking",
  ])("sanitizes provider failure at %s", async (failOn) => {
    const test = harness({ failOn });
    await expect(
      test.repository.loadRankingEvidenceByOwner(authenticatedOwnerId),
    ).rejects.toThrow(unavailable);
  });
});
