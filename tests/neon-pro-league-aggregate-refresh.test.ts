import { describe, expect, it, vi } from "vitest";

import {
  createNeonProLeagueAggregateRefreshCapabilities,
  neonProLeagueAggregateRefreshCapabilitiesFromEnvironment,
} from "../lib/neon-pro-league-aggregate-refresh";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "../lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "owner-1";
const runtimeRole = "dna_app_runtime";
const refreshId = "22222222-2222-4222-8222-222222222222";
const datasetVersionId = "33333333-3333-4333-8333-333333333333";
const sourceHash = "a".repeat(64);

function evidence(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

function harness(rows: readonly (readonly unknown[])[]) {
  const events: string[] = [];
  let index = 0;
  const query = vi.fn(
    async (statement: string, values?: readonly unknown[]) => {
      const normalized = statement.replace(/\s+/g, " ").trim();
      events.push(
        values ? `${normalized}|${JSON.stringify(values)}` : normalized,
      );
      if (
        normalized === "BEGIN ISOLATION LEVEL SERIALIZABLE" ||
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
  return {
    events,
    query,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  };
}

function capabilities(test: ReturnType<typeof harness>) {
  return createNeonProLeagueAggregateRefreshCapabilities({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    runtimeRole,
    sessionFactory: test.sessionFactory,
  });
}

describe("Neon Pro League aggregate refresh capabilities", () => {
  it("fails closed until every server-only database setting exists", () => {
    expect(
      neonProLeagueAggregateRefreshCapabilitiesFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole,
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("claims durable owner-scoped work through the least-privilege runtime", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [evidence()],
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
    ]);
    const configured = capabilities(test);
    expect(configured.status).toBe("ready");
    if (configured.status !== "ready") throw new Error("expected capabilities");

    await expect(
      configured.repository.claimRefresh({
        refreshId,
        workerId: "aggregate-worker-1",
        claimedAt: "2026-08-21T00:00:00.000Z",
        leaseExpiresAt: "2026-08-21T00:05:00.000Z",
      }),
    ).resolves.toEqual({
      status: "claimed",
      ownerId,
      updateSessionId: datasetVersionId,
      sourceVersionSetSha256: sourceHash,
    });
    expect(test.events[3]).toContain("dna.claim_pro_league_aggregate_refresh");
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("prepares the bounded wrapper and publishes the exact source binding", async () => {
    const prepared = harness([
      [{ owner_scope: databaseOwnerId }],
      [evidence()],
      [
        {
          prepared_aggregate_set_id: refreshId,
          source_version_set_sha256: sourceHash,
          aggregate_family_count: 4,
          materialized_row_count: "42",
        },
      ],
    ]);
    const configured = capabilities(prepared);
    if (configured.status !== "ready") throw new Error("expected capabilities");
    await expect(
      configured.refresher.prepare({
        ownerId,
        updateSessionId: datasetVersionId,
        refreshId,
        sourceVersionSetSha256: sourceHash,
      }),
    ).resolves.toEqual({
      preparedAggregateSetId: refreshId,
      sourceVersionSetSha256: sourceHash,
      aggregateFamilyCount: 4,
      materializedRowCount: 42,
    });

    const published = harness([
      [{ owner_scope: databaseOwnerId }],
      [evidence()],
      [{ status: "published", aggregate_set_id: refreshId }],
    ]);
    const publishing = capabilities(published);
    if (publishing.status !== "ready") throw new Error("expected capabilities");
    await expect(
      publishing.repository.publishPreparedAggregateSet({
        ownerId,
        updateSessionId: datasetVersionId,
        refreshId,
        workerId: "aggregate-worker-1",
        preparedAggregateSetId: refreshId,
        sourceVersionSetSha256: sourceHash,
        aggregateFamilyCount: 4,
        materializedRowCount: 42,
        completedAt: "2026-08-21T00:04:00.000Z",
      }),
    ).resolves.toEqual({ status: "published", aggregateSetId: refreshId });
    expect(published.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      refreshId,
      datasetVersionId,
      "aggregate-worker-1",
      refreshId,
      sourceHash,
      4,
      42,
      "2026-08-21T00:04:00.000Z",
    ]);
  });

  it("rolls back before a claim when the runtime identity is privileged", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [evidence({ runtime_bypasses_rls: true })],
    ]);
    const configured = capabilities(test);
    if (configured.status !== "ready") throw new Error("expected capabilities");
    await expect(
      configured.repository.claimRefresh({
        refreshId,
        workerId: "aggregate-worker-1",
        claimedAt: "2026-08-21T00:00:00.000Z",
        leaseExpiresAt: "2026-08-21T00:05:00.000Z",
      }),
    ).rejects.toThrow("not least privileged");
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });
});
