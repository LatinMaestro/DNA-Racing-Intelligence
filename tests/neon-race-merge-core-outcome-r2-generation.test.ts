import { describe, expect, it, vi } from "vitest";

import {
  RACE_MERGE_CORE_OUTCOME_R2_GENERATION_VERSION,
  raceMergeCoreOutcomeR2ReceiptSetSha256,
  type RaceMergeCoreOutcomeR2GenerationAuthority,
} from "@/lib/race-merge-core-outcome-r2-generation";
import type { RaceMergeCoreOutcomeR2Receipt } from "@/lib/race-merge-core-outcome-r2-store";
import { createNeonRaceMergeCoreOutcomeR2GenerationRepository } from "@/lib/neon-race-merge-core-outcome-r2-generation";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "91230000-0000-4000-8000-000000000001";
const ownerId = "synthetic_race_merge_core_outcome_owner";
const runtimeRole = "dna_app_runtime";
const receipt: RaceMergeCoreOutcomeR2Receipt = Object.freeze({
  version: 1,
  generationId: "race-merge-r2-generation",
  sourceCoreId: 41,
  objectKey: "private/race-merge/core-41.json",
  bodySha256: "b".repeat(64),
  byteLength: 512,
  uniqueOutcomeCount: 2,
  sourceObservationCount: 3,
  firstSourceRaceId: "race-1",
  lastSourceRaceId: "race-2",
});
const digest = raceMergeCoreOutcomeR2ReceiptSetSha256([receipt]);
const authority: RaceMergeCoreOutcomeR2GenerationAuthority = Object.freeze({
  version: RACE_MERGE_CORE_OUTCOME_R2_GENERATION_VERSION,
  generationId: receipt.generationId,
  cohortOrdinal: 1,
  firstSourceCoreId: 41,
  lastSourceCoreId: 41,
  coreCount: 1,
  uniqueOutcomeCount: 2,
  sourceObservationCount: 3,
  retainedR2Bytes: 512,
  receiptSetSha256: digest,
});

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    all_rls_enabled: true,
    all_force_rls_enabled: true,
    runtime_can_access_tables: false,
    runtime_can_begin: true,
    runtime_can_register: true,
    runtime_can_finalize: true,
    runtime_can_list: true,
    runtime_can_mutate: false,
    session_user_name: runtimeRole,
    current_user_name: runtimeRole,
    runtime_is_superuser: false,
    runtime_bypasses_rls: false,
    runtime_can_create_roles: false,
    runtime_can_create_databases: false,
    runtime_can_create_in_database: false,
    runtime_can_create_in_schema: false,
    runtime_is_neon_superuser_member: false,
    ...overrides,
  };
}
function checkpoint(overrides: Record<string, unknown> = {}) {
  return {
    owner_id: databaseOwnerId,
    generation_id: authority.generationId,
    cohort_ordinal: 1,
    version: 1,
    first_source_core_id: "41",
    last_source_core_id: "41",
    core_count: 1,
    unique_outcome_count: "2",
    source_observation_count: "3",
    retained_r2_bytes: "512",
    receipt_set_sha256: digest,
    state: "writing",
    registered_core_count: 0,
    registered_unique_outcome_count: "0",
    registered_source_observation_count: "0",
    registered_r2_bytes: "0",
    last_registered_source_core_id: null,
    completed_receipt_set_sha256: null,
    started_at: new Date("2026-10-03T10:00:00.000Z"),
    updated_at: new Date("2026-10-03T10:00:00.000Z"),
    ...overrides,
  };
}
function harness(rows: readonly (readonly unknown[])[]) {
  const events: string[] = [];
  let index = 0;
  const query = vi.fn(
    async (statement: string, values?: readonly unknown[]) => {
      const normalized = statement.replace(/\s+/gu, " ").trim();
      events.push(
        values ? `${normalized}|${JSON.stringify(values)}` : normalized,
      );
      if (
        normalized.startsWith("BEGIN ") ||
        normalized === "COMMIT" ||
        normalized === "ROLLBACK"
      )
        return { rows: [] };
      return { rows: rows[index++] ?? [] };
    },
  );
  const client: NeonImportPersistenceClient = { query };
  const close = vi.fn(async () => undefined);
  const sessionFactory = vi.fn(async () => ({ client, close }));
  return {
    close,
    events,
    repository: createNeonRaceMergeCoreOutcomeR2GenerationRepository({
      databaseUrl: "postgresql://private.example/dna",
      databaseOwnerId,
      ownerId,
      runtimeRole,
      sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
    }),
  };
}

describe("Neon Race Merge Core outcome R2 generation repository", () => {
  it("uses a SQL-reproducible length-prefixed UTF-8 receipt digest", () => {
    expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(digest).not.toBe(
      raceMergeCoreOutcomeR2ReceiptSetSha256([
        { ...receipt, lastSourceRaceId: "race-3" },
      ]),
    );
  });

  it("begins, registers, finalizes, and lists manifests with owner isolation", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [checkpoint()],
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        checkpoint({
          registered_core_count: 1,
          registered_unique_outcome_count: "2",
          registered_source_observation_count: "3",
          registered_r2_bytes: "512",
          last_registered_source_core_id: "41",
        }),
      ],
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        checkpoint({
          state: "complete",
          registered_core_count: 1,
          registered_unique_outcome_count: "2",
          registered_source_observation_count: "3",
          registered_r2_bytes: "512",
          last_registered_source_core_id: "41",
          completed_receipt_set_sha256: digest,
        }),
      ],
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          source_core_id: "41",
          object_key: receipt.objectKey,
          body_sha256: receipt.bodySha256,
          byte_length: 512,
          unique_outcome_count: 2,
          source_observation_count: 3,
          first_source_race_id: "race-1",
          last_source_race_id: "race-2",
          registered_at: new Date("2026-10-03T10:01:00.000Z"),
        },
      ],
    ]);
    await expect(
      test.repository.begin(ownerId, {
        authority,
        startedAt: "2026-10-03T10:00:00.000Z",
      }),
    ).resolves.toMatchObject({ registeredCoreCount: 0 });
    await expect(
      test.repository.registerCore(ownerId, {
        generationId: authority.generationId,
        cohortOrdinal: 1,
        receipt,
        registeredAt: "2026-10-03T10:01:00.000Z",
      }),
    ).resolves.toMatchObject({ registeredCoreCount: 1 });
    await expect(
      test.repository.finalize(ownerId, {
        generationId: authority.generationId,
        cohortOrdinal: 1,
        receiptSetSha256: digest,
        completedAt: "2026-10-03T10:02:00.000Z",
      }),
    ).resolves.toMatchObject({ status: "complete" });
    await expect(
      test.repository.listManifests(ownerId, {
        generationId: authority.generationId,
        cohortOrdinal: 1,
        afterSourceCoreId: 0,
        limit: 100,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        sourceCoreId: 41,
        registeredAt: "2026-10-03T10:01:00.000Z",
      }),
    ]);
    expect(
      test.events.filter((event) =>
        event.startsWith("BEGIN ISOLATION LEVEL SERIALIZABLE"),
      ),
    ).toHaveLength(3);
    expect(test.events).toContain(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
  });

  it("rolls back if the runtime can mutate manifest tables", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation({ runtime_can_access_tables: true })],
    ]);
    await expect(
      test.repository.begin(ownerId, {
        authority,
        startedAt: "2026-10-03T10:00:00.000Z",
      }),
    ).rejects.toThrow("least-privilege owner isolation");
    expect(test.events).toContain("ROLLBACK");
    expect(test.close).toHaveBeenCalledOnce();
  });

  it("rejects a different logical owner before opening a session", async () => {
    const test = harness([]);
    await expect(
      test.repository.begin("other_owner", {
        authority,
        startedAt: "2026-10-03T10:00:00.000Z",
      }),
    ).rejects.toThrow("owner access denied");
    expect(test.events).toEqual([]);
  });
});
