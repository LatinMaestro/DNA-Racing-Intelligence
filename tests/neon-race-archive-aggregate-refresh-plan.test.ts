import { describe, expect, it, vi } from "vitest";

import {
  createNeonRaceArchiveAggregateRefreshPlanRepository,
  type ProLeagueAggregateRefreshTargetSource,
} from "../lib/neon-race-archive-aggregate-refresh-plan";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "../lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "owner-1";
const refreshId = "22222222-2222-4222-8222-222222222222";
const datasetVersionId = "33333333-3333-4333-8333-333333333333";
const importBatchId = "44444444-4444-4444-8444-444444444444";
const sourceHash = "a".repeat(64);
const runtimeRole = "dna_app_runtime";

function isolationEvidence() {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    processing_rls: true,
    processing_force_rls: true,
    runtime_can_list_versions: true,
    runtime_can_bootstrap_evidence: true,
    runtime_can_read_target_source: true,
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
  })) as NeonImportPersistenceSessionFactory;
  return { query, sessionFactory };
}

function repository(rows: readonly (readonly unknown[])[]) {
  const harness = sessionHarness(rows);
  return {
    harness,
    repository: createNeonRaceArchiveAggregateRefreshPlanRepository({
      databaseUrl: "postgresql://private.example/dna",
      databaseOwnerId,
      runtimeRole,
      sessionFactory: harness.sessionFactory,
    }),
  };
}

describe("Neon Race archive aggregate refresh plan adapter", () => {
  it.each<ProLeagueAggregateRefreshTargetSource>([
    "race_merge",
    "core_details",
    "current_arena",
  ])("returns the claimed aggregate target source %s", async (sourceType) => {
    const test = repository([
      [{ owner_scope: databaseOwnerId }],
      [isolationEvidence()],
      [{ source_type: sourceType }],
    ]);

    await expect(
      test.repository.targetSourceType({
        ownerId,
        refreshId,
        updateSessionId: datasetVersionId,
        sourceVersionSetSha256: sourceHash,
      }),
    ).resolves.toBe(sourceType);
    expect(test.harness.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "pro_league_aggregate_refresh_target_source_type",
      ),
      [databaseOwnerId, refreshId, datasetVersionId, sourceHash],
    );
  });

  it("seals registered Race evidence before returning the exact ordered plan", async () => {
    const test = repository([
      [{ owner_scope: databaseOwnerId }],
      [isolationEvidence()],
      [{ inserted_count: 1 }],
      [
        {
          dataset_version_id: datasetVersionId,
          import_batch_id: importBatchId,
          version_number: "27",
          source_row_count: "250000",
          accepted_row_count: "249999",
          evidence_partition_count: "500",
          evidence_row_count: "250000",
        },
      ],
    ]);

    await expect(
      test.repository.list({
        ownerId,
        refreshId,
        updateSessionId: datasetVersionId,
        sourceVersionSetSha256: sourceHash,
        maximumVersions: 10_000,
      }),
    ).resolves.toEqual([
      {
        datasetVersionId,
        importBatchId,
        versionNumber: 27,
        sourceRowCount: 250000,
        acceptedRowCount: 249999,
        evidencePartitionCount: 500,
        evidenceRowCount: 250000,
      },
    ]);
    const bootstrapCall = test.harness.query.mock.calls.findIndex(([sql]) =>
      String(sql).includes(
        "bootstrap_race_archive_aggregate_evidence_receipts",
      ),
    );
    const listCall = test.harness.query.mock.calls.findIndex(([sql]) =>
      String(sql).includes("list_race_archive_aggregate_refresh_versions"),
    );
    expect(bootstrapCall).toBeGreaterThanOrEqual(0);
    expect(listCall).toBeGreaterThan(bootstrapCall);
    expect(test.harness.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "bootstrap_race_archive_aggregate_evidence_receipts",
      ),
      [databaseOwnerId, refreshId, datasetVersionId, sourceHash],
    );
    expect(test.harness.query).toHaveBeenCalledWith(
      expect.stringContaining("list_race_archive_aggregate_refresh_versions"),
      [databaseOwnerId, refreshId, datasetVersionId, sourceHash, 10_000],
    );
  });

  it("fails closed when runtime function authority is incomplete", async () => {
    const test = repository([
      [{ owner_scope: databaseOwnerId }],
      [{ ...isolationEvidence(), runtime_can_bootstrap_evidence: false }],
    ]);

    await expect(
      test.repository.targetSourceType({
        ownerId,
        refreshId,
        updateSessionId: datasetVersionId,
        sourceVersionSetSha256: sourceHash,
      }),
    ).rejects.toThrow("not least privileged");
  });
});
