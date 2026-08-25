import { describe, expect, it, vi } from "vitest";

import { createNeonRaceArchiveAggregateRefreshPlanRepository } from "../lib/neon-race-archive-aggregate-refresh-plan";
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
  const close = vi.fn(async () => undefined);
  const sessionFactory = vi.fn(async () => ({
    client,
    close,
  })) as NeonImportPersistenceSessionFactory;
  return { query, close, sessionFactory };
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
  it("returns the exact ordered sealed Race-version plan through one least-privilege transaction", async () => {
    const test = repository([
      [{ owner_scope: databaseOwnerId }],
      [isolationEvidence()],
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

    expect(test.harness.query).toHaveBeenCalledWith(
      expect.stringContaining("list_race_archive_aggregate_refresh_versions"),
      [databaseOwnerId, refreshId, datasetVersionId, sourceHash, 10_000],
    );
    expect(test.harness.query).toHaveBeenCalledWith("COMMIT");
    expect(test.harness.close).toHaveBeenCalledOnce();
  });

  it("fails closed and rolls back when runtime authority is incomplete", async () => {
    const test = repository([
      [{ owner_scope: databaseOwnerId }],
      [{ ...isolationEvidence(), runtime_can_list_versions: false }],
    ]);

    await expect(
      test.repository.list({
        ownerId,
        refreshId,
        updateSessionId: datasetVersionId,
        sourceVersionSetSha256: sourceHash,
        maximumVersions: 24,
      }),
    ).rejects.toThrow("not least privileged");

    expect(test.harness.query).toHaveBeenCalledWith("ROLLBACK");
    expect(test.harness.close).toHaveBeenCalledOnce();
  });

  it("rejects invalid caller bounds before opening a database session", () => {
    const test = repository([]);

    expect(() =>
      test.repository.list({
        ownerId,
        refreshId,
        updateSessionId: datasetVersionId,
        sourceVersionSetSha256: sourceHash,
        maximumVersions: 10_001,
      }),
    ).toThrow("maximumVersions is invalid");

    expect(test.harness.sessionFactory).not.toHaveBeenCalled();
  });

  it("rolls back malformed database plan rows instead of returning partial evidence", async () => {
    const test = repository([
      [{ owner_scope: databaseOwnerId }],
      [isolationEvidence()],
      [
        {
          dataset_version_id: datasetVersionId,
          import_batch_id: importBatchId,
          version_number: "27",
          source_row_count: "250000",
          accepted_row_count: "249999",
          evidence_partition_count: "0",
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
        maximumVersions: 24,
      }),
    ).rejects.toThrow("evidence_partition_count is invalid");

    expect(test.harness.query).toHaveBeenCalledWith("ROLLBACK");
    expect(test.harness.close).toHaveBeenCalledOnce();
  });
});
