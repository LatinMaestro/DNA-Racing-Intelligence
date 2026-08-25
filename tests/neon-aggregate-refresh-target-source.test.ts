import { describe, expect, it, vi } from "vitest";

import {
  createNeonAggregateRefreshTargetSourceReader,
  type ProLeagueAggregateRefreshTargetSource,
} from "../lib/neon-aggregate-refresh-target-source";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "../lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "owner-1";
const refreshId = "22222222-2222-4222-8222-222222222222";
const datasetVersionId = "33333333-3333-4333-8333-333333333333";
const sourceHash = "a".repeat(64);
const runtimeRole = "dna_app_runtime";

function isolationEvidence() {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    processing_rls: true,
    processing_force_rls: true,
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
  const close = vi.fn(async () => undefined);
  const sessionFactory = vi.fn(async () => ({
    client,
    close,
  })) as NeonImportPersistenceSessionFactory;
  return { query, close, sessionFactory };
}

function reader(rows: readonly (readonly unknown[])[]) {
  const harness = sessionHarness(rows);
  return {
    harness,
    reader: createNeonAggregateRefreshTargetSourceReader({
      databaseUrl: "postgresql://private.example/dna",
      databaseOwnerId,
      runtimeRole,
      sessionFactory: harness.sessionFactory,
    }),
  };
}

describe("Neon aggregate target source adapter", () => {
  it.each<ProLeagueAggregateRefreshTargetSource>([
    "race_merge",
    "core_details",
    "current_arena",
  ])("returns the claimed source family %s", async (sourceType) => {
    const test = reader([
      [{ owner_scope: databaseOwnerId }],
      [isolationEvidence()],
      [{ source_type: sourceType }],
    ]);

    await expect(
      test.reader.targetSourceType({
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
    expect(test.harness.query).toHaveBeenCalledWith("COMMIT");
    expect(test.harness.close).toHaveBeenCalledOnce();
  });

  it("fails closed when runtime authority is incomplete", async () => {
    const test = reader([
      [{ owner_scope: databaseOwnerId }],
      [{ ...isolationEvidence(), runtime_can_read_target_source: false }],
    ]);

    await expect(
      test.reader.targetSourceType({
        ownerId,
        refreshId,
        updateSessionId: datasetVersionId,
        sourceVersionSetSha256: sourceHash,
      }),
    ).rejects.toThrow("not least privileged");

    expect(test.harness.query).toHaveBeenCalledWith("ROLLBACK");
    expect(test.harness.close).toHaveBeenCalledOnce();
  });

  it("rejects unsupported source values and rolls back", async () => {
    const test = reader([
      [{ owner_scope: databaseOwnerId }],
      [isolationEvidence()],
      [{ source_type: "current_vault" }],
    ]);

    await expect(
      test.reader.targetSourceType({
        ownerId,
        refreshId,
        updateSessionId: datasetVersionId,
        sourceVersionSetSha256: sourceHash,
      }),
    ).rejects.toThrow("unsupported");

    expect(test.harness.query).toHaveBeenCalledWith("ROLLBACK");
  });
});
