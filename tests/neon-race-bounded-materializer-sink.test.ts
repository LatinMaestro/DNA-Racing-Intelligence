import { describe, expect, it, vi } from "vitest";

import type { AdaptedRaceMergeRow } from "../domain/source-adapters";
import type { DurablePreviewStagedRow } from "../lib/durable-import-preview-staging-sink";
import {
  createNeonRaceBoundedMaterializationSink,
  type NeonRaceBoundedMaterializationClient,
} from "../lib/neon-race-bounded-materializer-sink";
import type { RaceBoundedMaterializationCommit } from "../lib/race-bounded-materializer";
import type { RacePreactivationMaterializationRecord } from "../lib/race-preactivation-materialization-spool";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const IMPORT_BATCH_ID = "22222222-2222-4222-8222-222222222222";
const DATASET_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const ACTIVATED_AT = "2026-08-27T00:00:00.000Z";
const RUNTIME_ROLE = "dna_app_runtime";

function raceRecord(): AdaptedRaceMergeRow {
  return Object.freeze({
    sourceType: "race_merge",
    sourceEventId: "event-1",
    eventAt: "2026-08-26T12:00:00.000Z",
    sourceEventDatetime: "2026-08-26T12:00:00.000Z",
    mode: "bike",
    distance: 1200,
    sourceCoreId: "core-1",
    coreNameSourceValue: "Core One",
    gate: 1,
    gateCount: 12,
    goldStar: true,
    blueStar: false,
    goldStarEligible: true,
    goldStarSourceValue: "true",
    blueStarSourceValue: "false",
    starDataStatus: "complete",
    finishPosition: 1,
    elapsedTimeSourceValue: "62.125",
    sourceRaceClass: "Open",
    sourceFormat: "Standard",
    feeSourceValue: "0.01",
    prizeSourceValue: "0.05",
    assetSourceValue: "ETH",
    payoutMechanismSourceValue: "podium",
    raceTagsSourceValue: "league",
    raceAsset: "ETH",
    entryFeeAmount: "0.01",
    grossPayoutAmount: "0.05",
    economicDataStatus: "ready",
  });
}

function materializationRecord(): RacePreactivationMaterializationRecord {
  const fingerprintSha256 = "a".repeat(64);
  const naturalKey = "event-1:core-1";
  const canonicalRow: DurablePreviewStagedRow = Object.freeze({
    sourceRowNumber: 7,
    naturalKey,
    fingerprintSha256,
    row: Object.freeze({
      status: "ready",
      sourceType: "race_merge",
      record: raceRecord(),
      provenance: Object.freeze([]),
      issues: Object.freeze([]),
    }),
  });
  return Object.freeze({ naturalKey, fingerprintSha256, canonicalRow });
}

function targetRow(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    database_owner_id: OWNER_ID,
    source_type: "race_merge",
    import_batch_status: "validating",
    dataset_version_id: DATASET_VERSION_ID,
    rolled_back_at: null,
    race_event_rls: true,
    race_event_force_rls: true,
    race_entry_rls: true,
    race_entry_force_rls: true,
    race_source_rls: true,
    race_source_force_rls: true,
    session_user_name: RUNTIME_ROLE,
    current_user_name: RUNTIME_ROLE,
    runtime_is_superuser: false,
    runtime_bypasses_rls: false,
    runtime_can_create_roles: false,
    runtime_can_create_databases: false,
    runtime_is_neon_superuser_member: false,
    ...overrides,
  };
}

function commit(): RaceBoundedMaterializationCommit {
  return Object.freeze({
    sourceRowCount: 1,
    readyRowCount: 1,
    quarantinedRowCount: 0,
    acceptedNaturalKeyCount: 1,
    duplicateReadyRowCount: 0,
    materializationBatchCount: 1,
    materializedNaturalKeyCount: 1,
  });
}

function harness(target = targetRow()) {
  const close = vi.fn(async () => undefined);
  const query = vi.fn(
    async (statement: string, values?: readonly unknown[]) => {
      if (statement.includes("set_config('app.owner_id'")) {
        return { rows: [{ owner_scope: OWNER_ID }] };
      }
      if (statement.includes("FROM dna.import_batch batch")) {
        return { rows: [target] };
      }
      if (statement.includes("dna.materialize_bounded_race_batch")) {
        const payload = JSON.parse(String(values?.[2])) as readonly unknown[];
        return { rows: [{ materialized_row_count: payload.length }] };
      }
      if (statement.includes("dna.complete_bounded_race_materialization")) {
        return {
          rows: [
            { result_status: "materialized", materialized_entry_count: 1 },
          ],
        };
      }
      return { rows: [] };
    },
  );
  const client: NeonRaceBoundedMaterializationClient = { query };
  const sessionFactory = vi.fn(async () => ({ client, close }));
  const sink = createNeonRaceBoundedMaterializationSink({
    databaseUrl: "postgresql://preview.invalid/dna",
    runtimeRole: RUNTIME_ROLE,
    ownerId: OWNER_ID,
    importBatchId: IMPORT_BATCH_ID,
    datasetVersionId: DATASET_VERSION_ID,
    activatedAt: ACTIVATED_AT,
    sessionFactory,
  });
  return { sink, query, close };
}

describe("Neon bounded Race materializer sink", () => {
  it("uses one owner-scoped serializable transaction for bounded writes", async () => {
    const target = harness();
    const session = await target.sink.begin({
      sourceRowCount: 1,
      readyRowCount: 1,
      quarantinedRowCount: 0,
      acceptedNaturalKeyCount: 1,
      duplicateReadyRowCount: 0,
    });

    await session.writeBatch({ batchNumber: 1, records: [materializationRecord()] });
    await session.commit(commit());

    expect(target.query.mock.calls[0]?.[0]).toBe(
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
    );
    const materialize = target.query.mock.calls.find(([statement]) =>
      String(statement).includes("dna.materialize_bounded_race_batch"),
    );
    expect(materialize?.[1]).toEqual([
      IMPORT_BATCH_ID,
      DATASET_VERSION_ID,
      expect.any(String),
      ACTIVATED_AT,
    ]);
    expect(JSON.parse(String(materialize?.[1]?.[2]))).toEqual([
      {
        sourceRowNumber: 7,
        naturalKey: "event-1:core-1",
        fingerprintSha256: "a".repeat(64),
        record: raceRecord(),
      },
    ]);
    expect(target.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(target.close).toHaveBeenCalledOnce();
  });

  it("rejects a privileged runtime before any bounded write", async () => {
    const target = harness(targetRow({ runtime_bypasses_rls: true }));

    await expect(
      target.sink.begin({
        sourceRowCount: 1,
        readyRowCount: 1,
        quarantinedRowCount: 0,
        acceptedNaturalKeyCount: 1,
        duplicateReadyRowCount: 0,
      }),
    ).rejects.toThrow("runtime is not least privileged");

    expect(
      target.query.mock.calls.some(([statement]) =>
        String(statement).includes("dna.materialize_bounded_race_batch"),
      ),
    ).toBe(false);
    expect(target.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(target.close).toHaveBeenCalledOnce();
  });

  it("rolls back a materialization session without committing", async () => {
    const target = harness();
    const session = await target.sink.begin({
      sourceRowCount: 1,
      readyRowCount: 1,
      quarantinedRowCount: 0,
      acceptedNaturalKeyCount: 1,
      duplicateReadyRowCount: 0,
    });

    await session.writeBatch({ batchNumber: 1, records: [materializationRecord()] });
    await session.rollback({ reason: "materialization_failed" });

    expect(target.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(
      target.query.mock.calls.some(([statement]) => statement === "COMMIT"),
    ).toBe(false);
    expect(target.close).toHaveBeenCalledOnce();
  });
});
