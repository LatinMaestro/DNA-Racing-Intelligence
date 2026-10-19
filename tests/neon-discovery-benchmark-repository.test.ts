import { describe, expect, it, vi } from "vitest";
import type { NeonImportPersistenceClient } from "@/lib/neon-import-persistence-driver";
import {
  createNeonDiscoveryBenchmarkRepository,
  neonDiscoveryBenchmarkRepositoryFromEnvironment,
} from "@/lib/neon-discovery-benchmark-repository";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const authenticatedOwnerId = "user_synthetic_owner";
const refreshId = "22222222-2222-4222-8222-222222222222";
const raceDatasetVersionId = "33333333-3333-4333-8333-333333333333";
const refreshedAt = "2026-10-19T00:02:00.000Z";
const publishedAt = "2026-10-19T00:03:00.000Z";

const isolation = {
  database_owner_id: databaseOwnerId,
  authenticated_owner_id: authenticatedOwnerId,
  session_user_name: "dna_app_runtime",
  current_user_name: "dna_app_runtime",
  runtime_is_superuser: false,
  runtime_bypasses_rls: false,
};

const benchmark = {
  mode: "bike",
  distance: 1400,
  data_current_through: "2026-10-18T00:00:00.000Z",
  race_entry_count: "10",
  winning_entry_count: "2",
  top_three_entry_count: "6",
  winning_p25_milliseconds: "10000",
  winning_median_milliseconds: "10100",
  winning_p75_milliseconds: "10200",
  top_three_p25_milliseconds: "10300",
  top_three_median_milliseconds: "10400",
  top_three_p75_milliseconds: "10500",
  refreshed_at: refreshedAt,
};

const publication = {
  refresh_id: refreshId,
  race_dataset_version_id: raceDatasetVersionId,
  source_version_set_sha256: "b".repeat(64),
  payload_sha256: "c".repeat(64),
  discovery_benchmark_count: "1",
  refreshed_at: refreshedAt,
  published_at: publishedAt,
};

function harness(
  overrides: {
    benchmarkRows?: unknown[];
    publicationRows?: unknown[];
    isolationRows?: unknown[];
  } = {},
) {
  const query = vi.fn<NeonImportPersistenceClient["query"]>(async (sql) => {
    if (sql.includes("FROM dna.app_owner")) {
      return { rows: overrides.isolationRows ?? [isolation] };
    }
    if (sql.includes("list_discovery_exact_distance_benchmarks")) {
      return { rows: overrides.benchmarkRows ?? [benchmark] };
    }
    if (sql.includes("read_discovery_benchmark_publication")) {
      return { rows: overrides.publicationRows ?? [publication] };
    }
    return { rows: [] };
  });
  const close = vi.fn(async () => undefined);
  const repository = createNeonDiscoveryBenchmarkRepository({
    databaseUrl: "postgresql://synthetic.invalid/dna",
    databaseOwnerId,
    runtimeRole: "dna_app_runtime",
    sessionFactory: async () => ({ client: { query }, close }),
  });
  if (repository.status !== "ready") throw new Error("repository unavailable");
  return { repository, query, close };
}

describe("Neon Discovery benchmark repository", () => {
  it("composes only when the complete server environment is configured", () => {
    expect(
      neonDiscoveryBenchmarkRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole: "dna_app_runtime",
      }),
    ).toEqual({ status: "not_configured" });
    expect(
      neonDiscoveryBenchmarkRepositoryFromEnvironment({
        databaseUrl: "postgresql://synthetic.invalid/dna",
        databaseOwnerId,
        runtimeRole: "dna_app_runtime",
      }).status,
    ).toBe("ready");
  });

  it("reads benchmark rows and their accepted publication in one snapshot", async () => {
    const test = harness();
    await expect(
      test.repository.listBenchmarksByOwner(authenticatedOwnerId),
    ).resolves.toEqual({
      benchmarks: [
        expect.objectContaining({
          mode: "bike",
          distanceMetres: 1400,
          raceEntryCount: 10,
          refreshedAt,
        }),
      ],
      publication: {
        refreshId,
        raceDatasetVersionId,
        sourceVersionSetSha256: "b".repeat(64),
        payloadSha256: "c".repeat(64),
        benchmarkCount: 1,
        refreshedAt,
        publishedAt,
      },
    });
    expect(test.query.mock.calls[0]?.[0]).toBe(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    expect(test.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(test.close).toHaveBeenCalledOnce();
  });

  it("permits an explicitly empty unpublished benchmark set", async () => {
    const test = harness({ benchmarkRows: [], publicationRows: [] });
    await expect(
      test.repository.listBenchmarksByOwner(authenticatedOwnerId),
    ).resolves.toEqual({ benchmarks: [], publication: null });
  });

  it.each([
    { publicationRows: [] },
    { publicationRows: [publication, publication] },
    { publicationRows: [{ ...publication, payload_sha256: "invalid" }] },
    { publicationRows: [{ ...publication, discovery_benchmark_count: "2" }] },
    {
      publicationRows: [
        { ...publication, refreshed_at: "2026-10-19T00:01:00.000Z" },
      ],
    },
  ])(
    "rejects unbound or inconsistent publication evidence %#",
    async (options) => {
      const test = harness(options);
      await expect(
        test.repository.listBenchmarksByOwner(authenticatedOwnerId),
      ).rejects.toThrow();
      expect(test.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
      expect(test.close).toHaveBeenCalledOnce();
    },
  );
});
