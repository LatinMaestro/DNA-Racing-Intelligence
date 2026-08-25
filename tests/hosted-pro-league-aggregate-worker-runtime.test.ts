import { describe, expect, it, vi } from "vitest";

import type { BoundedAggregateRefresher } from "../lib/import-aggregate-refresh-service";
import {
  HOSTED_RACE_ARCHIVE_SPILLABLE_BOUNDS,
  hostedProLeagueAggregateWorkerRuntime,
  type HostedProLeagueAggregateWorkerEnvironment,
} from "../lib/hosted-pro-league-aggregate-worker-runtime";
import type { AggregateRefreshTargetSourceReader } from "../lib/neon-aggregate-refresh-target-source";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "../lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "owner-1";
const runtimeRole = "dna_app_runtime";
const refreshId = "22222222-2222-4222-8222-222222222222";
const dispatchId = "33333333-3333-4333-8333-333333333333";
const datasetVersionId = "44444444-4444-4444-8444-444444444444";
const sourceHash = "a".repeat(64);

function environment(
  overrides: Partial<HostedProLeagueAggregateWorkerEnvironment> = {},
): HostedProLeagueAggregateWorkerEnvironment {
  return {
    workerId: "aggregate-worker-1",
    authorizedOwnerId: ownerId,
    database: {
      databaseUrl: "postgresql://private.example/dna",
      databaseOwnerId,
      runtimeRole,
    },
    leaseDurationMilliseconds: "300000",
    cloudflareAccountId: "a".repeat(32),
    cloudflareApiToken: "least-privilege-provider-token",
    bucketName: "dna-private-imports",
    r2AccessKeyId: "r2-access",
    r2SecretAccessKey: "r2-secret",
    maximumObjectBytes: "536870912",
    maximumChunkBytes: "1048576",
    ...overrides,
  };
}

function isolationEvidence() {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    job_rls: true,
    job_force_rls: true,
    processing_rls: true,
    processing_force_rls: true,
    session_user_name: runtimeRole,
    current_user_name: runtimeRole,
    runtime_is_superuser: false,
    runtime_bypasses_rls: false,
    runtime_can_create_roles: false,
    runtime_can_create_databases: false,
    runtime_is_neon_superuser_member: false,
  };
}

function sessionHarness(rows: readonly (readonly unknown[])[]) {
  let index = 0;
  const query = vi.fn(async (statement: string) => {
    const normalized = statement.replace(/\s+/g, " ").trim();
    if (
      normalized === "BEGIN ISOLATION LEVEL SERIALIZABLE" ||
      normalized === "COMMIT" ||
      normalized === "ROLLBACK"
    ) {
      return { rows: [] };
    }
    return { rows: rows[index++] ?? [] };
  });
  const client: NeonImportPersistenceClient = { query };
  const sessionFactory = vi.fn(async () => ({
    client,
    close: async () => undefined,
  }));
  return {
    query,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  };
}

function sourceReader(
  sourceType: "race_merge" | "core_details" | "current_arena",
) {
  const targetSourceType = vi.fn(async () => sourceType);
  return {
    targetSourceType,
    reader: { targetSourceType } as AggregateRefreshTargetSourceReader,
  };
}

function raceRefresher() {
  const prepare = vi.fn(async () => ({
    preparedAggregateSetId: refreshId,
    sourceVersionSetSha256: sourceHash,
    aggregateFamilyCount: 4,
    materializedRowCount: 42,
  }));
  return {
    prepare,
    refresher: { prepare } as BoundedAggregateRefresher,
  };
}

function message() {
  return {
    version: 1 as const,
    kind: "aggregate_refresh_retry" as const,
    dispatchId,
    refreshId,
  };
}

describe("hosted Pro League aggregate worker runtime", () => {
  it("fails closed when identity, lease, database, or private archive settings are incomplete", () => {
    expect(
      hostedProLeagueAggregateWorkerRuntime({
        environment: environment({ workerId: undefined }),
      }),
    ).toEqual({ status: "not_configured" });
    expect(
      hostedProLeagueAggregateWorkerRuntime({
        environment: environment({ leaseDurationMilliseconds: "999" }),
      }),
    ).toEqual({ status: "not_configured" });
    expect(
      hostedProLeagueAggregateWorkerRuntime({
        environment: environment({
          database: {
            databaseUrl: undefined,
            databaseOwnerId,
            runtimeRole,
          },
        }),
      }),
    ).toEqual({ status: "not_configured" });
    expect(
      hostedProLeagueAggregateWorkerRuntime({
        environment: environment({ r2SecretAccessKey: undefined }),
      }),
    ).toEqual({ status: "not_configured" });
    expect(
      hostedProLeagueAggregateWorkerRuntime({
        environment: environment({ maximumChunkBytes: "536870913" }),
      }),
    ).toEqual({ status: "not_configured" });
    expect(HOSTED_RACE_ARCHIVE_SPILLABLE_BOUNDS).toMatchObject({
      maximumRecordsInMemory: 5_000,
      mergeFanIn: 8,
      maximumInputObservations: 5_000_000,
    });
    expect(
      HOSTED_RACE_ARCHIVE_SPILLABLE_BOUNDS.maximumInputObservations,
    ).toBeGreaterThan(
      HOSTED_RACE_ARCHIVE_SPILLABLE_BOUNDS.maximumRecordsInMemory,
    );
  });

  it("keeps rolling current-state refreshes on the archive-preserving SQL path", async () => {
    const database = sessionHarness([
      [{ owner_scope: databaseOwnerId }],
      [isolationEvidence()],
      [
        {
          status: "claimed",
          authenticated_owner_id: ownerId,
          dataset_version_id: datasetVersionId,
          source_version_set_sha256: sourceHash,
          retry_after: null,
          aggregate_set_id: null,
        },
      ],
      [{ owner_scope: databaseOwnerId }],
      [isolationEvidence()],
      [
        {
          prepared_aggregate_set_id: refreshId,
          source_version_set_sha256: sourceHash,
          aggregate_family_count: 4,
          materialized_row_count: "42",
        },
      ],
      [{ owner_scope: databaseOwnerId }],
      [isolationEvidence()],
      [{ status: "published", aggregate_set_id: refreshId }],
    ]);
    const source = sourceReader("core_details");
    const race = raceRefresher();
    const runtime = hostedProLeagueAggregateWorkerRuntime({
      environment: environment(),
      dependencies: {
        targetSourceReader: source.reader,
        raceRefresher: race.refresher,
        neonSessionFactory: database.sessionFactory,
        now: () => new Date("2026-08-21T01:00:00.000Z"),
      },
    });
    expect(runtime.status).toBe("ready");
    if (runtime.status !== "ready") throw new Error("expected ready runtime");

    await expect(runtime.consume({ body: message() })).resolves.toEqual({
      disposition: "acknowledge",
      reason: "completed",
    });
    expect(source.targetSourceType).toHaveBeenCalledWith({
      ownerId,
      updateSessionId: datasetVersionId,
      refreshId,
      sourceVersionSetSha256: sourceHash,
    });
    expect(race.prepare).not.toHaveBeenCalled();
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("dna.prepare_pro_league_aggregate_refresh"),
      [databaseOwnerId, refreshId, datasetVersionId, sourceHash],
    );
  });

  it("routes Race refreshes through the archive refresher before durable publication", async () => {
    const database = sessionHarness([
      [{ owner_scope: databaseOwnerId }],
      [isolationEvidence()],
      [
        {
          status: "claimed",
          authenticated_owner_id: ownerId,
          dataset_version_id: datasetVersionId,
          source_version_set_sha256: sourceHash,
          retry_after: null,
          aggregate_set_id: null,
        },
      ],
      [{ owner_scope: databaseOwnerId }],
      [isolationEvidence()],
      [{ status: "published", aggregate_set_id: refreshId }],
    ]);
    const source = sourceReader("race_merge");
    const race = raceRefresher();
    const runtime = hostedProLeagueAggregateWorkerRuntime({
      environment: environment(),
      dependencies: {
        targetSourceReader: source.reader,
        raceRefresher: race.refresher,
        neonSessionFactory: database.sessionFactory,
        now: () => new Date("2026-08-21T01:00:00.000Z"),
      },
    });
    if (runtime.status !== "ready") throw new Error("expected ready runtime");

    await expect(runtime.consume({ body: message() })).resolves.toEqual({
      disposition: "acknowledge",
      reason: "completed",
    });
    expect(race.prepare).toHaveBeenCalledWith({
      ownerId,
      updateSessionId: datasetVersionId,
      refreshId,
      sourceVersionSetSha256: sourceHash,
    });
    expect(database.query).not.toHaveBeenCalledWith(
      expect.stringContaining("dna.prepare_pro_league_aggregate_refresh"),
      expect.anything(),
    );
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("dna.publish_pro_league_aggregate_refresh"),
      [
        databaseOwnerId,
        refreshId,
        datasetVersionId,
        "aggregate-worker-1",
        refreshId,
        sourceHash,
        4,
        42,
        "2026-08-21T01:00:00.000Z",
      ],
    );
  });

  it("returns retry with the durable lease time without selecting a refresh path", async () => {
    const database = sessionHarness([
      [{ owner_scope: databaseOwnerId }],
      [isolationEvidence()],
      [
        {
          status: "leased_elsewhere",
          authenticated_owner_id: null,
          dataset_version_id: datasetVersionId,
          source_version_set_sha256: null,
          retry_after: "2026-08-21T01:04:00.000Z",
          aggregate_set_id: null,
        },
      ],
    ]);
    const source = sourceReader("race_merge");
    const race = raceRefresher();
    const runtime = hostedProLeagueAggregateWorkerRuntime({
      environment: environment(),
      dependencies: {
        targetSourceReader: source.reader,
        raceRefresher: race.refresher,
        neonSessionFactory: database.sessionFactory,
      },
    });
    if (runtime.status !== "ready") throw new Error("expected ready runtime");

    await expect(
      runtime.consume({
        body: message(),
        now: new Date("2026-08-21T01:00:00.000Z"),
      }),
    ).resolves.toEqual({
      disposition: "retry",
      reason: "leased_elsewhere",
      retryAfter: "2026-08-21T01:04:00.000Z",
    });
    expect(source.targetSourceType).not.toHaveBeenCalled();
    expect(race.prepare).not.toHaveBeenCalled();
    expect(database.query).toHaveBeenCalledTimes(5);
  });

  it("rejects non-aggregate queue deliveries before database or archive work", async () => {
    const database = sessionHarness([]);
    const source = sourceReader("race_merge");
    const race = raceRefresher();
    const runtime = hostedProLeagueAggregateWorkerRuntime({
      environment: environment(),
      dependencies: {
        targetSourceReader: source.reader,
        raceRefresher: race.refresher,
        neonSessionFactory: database.sessionFactory,
      },
    });
    if (runtime.status !== "ready") throw new Error("expected ready runtime");

    await expect(
      runtime.consume({
        body: {
          version: 1,
          kind: "import_activation",
          dispatchId,
        },
      }),
    ).rejects.toThrow("not available in this worker");
    expect(source.targetSourceType).not.toHaveBeenCalled();
    expect(race.prepare).not.toHaveBeenCalled();
    expect(database.query).not.toHaveBeenCalled();
  });
});
