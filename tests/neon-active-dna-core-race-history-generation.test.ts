import { describe, expect, it, vi } from "vitest";

import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";
import { dnaOpenLabRawEvidenceSha256 } from "@/lib/dna-open-lab-v1-adapters";
import { createNeonActiveDnaCoreRaceHistoryGenerationReadRepository } from "@/lib/neon-active-dna-core-race-history-generation";

const databaseOwnerId = "84000000-0000-4000-8000-000000000001";
const ownerId = "private_owner";
const runtimeRole = "dna_app_runtime";
const generationId = "a".repeat(64);

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    all_rls_enabled: true,
    all_force_rls_enabled: true,
    runtime_can_access_tables: false,
    runtime_can_read_generation: true,
    runtime_can_read_rows: true,
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

function payload() {
  return {
    sourceType: "joined_core_race_history_result",
    naturalKey: "bike:race-1:101",
    resultEvidenceSha256: "b".repeat(64),
    raceDocumentEvidenceSha256: "c".repeat(64),
    sourceCoreId: "101",
    sourceRaceId: "race-1",
    mode: "bike",
    distanceMetres: 1_200,
    distanceAuthority: "result_and_race_document",
    elapsedMilliseconds: 40_000,
    finishPosition: 1,
    eventAt: "2026-09-15T00:00:00.000Z",
    gateCount: 12,
    payoutMechanismSourceValue: "Winner Take All",
    sourceFormat: "standard",
    sourceRaceClass: null,
    goldStar: false,
    blueStar: false,
    starEvidenceStatus: "available",
    publishedCellStatus: "accepted",
    raceType: "12 gate WTA",
    mapIds: ["map-1"],
  } as const;
}

function generationRow() {
  return {
    version: 1,
    generation_id: generationId,
    materialized_at: new Date("2026-09-16T00:00:00Z"),
    cycle_set_sha256: "d".repeat(64),
    observation_set_sha256: "e".repeat(64),
    payload_sha256: "f".repeat(64),
    input_cycle_count: 1,
    input_page_count: 1,
    input_result_count: 1,
    replay_duplicate_count: 0,
    race_document_count: 1,
    entrant_authority_omission_count: 0,
    entrant_mismatch_omission_count: 0,
    exact_distance_confirmed_count: 1,
    accepted_published_cell_count: 1,
    missing_format_count: 0,
    unsupported_format_count: 0,
    unpublished_cell_count: 0,
    observation_count: 1,
    state: "published",
    published_at: new Date("2026-09-16T00:01:00Z"),
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
        normalized.startsWith("BEGIN ISOLATION LEVEL") ||
        normalized === "COMMIT" ||
        normalized === "ROLLBACK"
      ) {
        return { rows: [] };
      }
      return { rows: rows[index++] ?? [] };
    },
  );
  const client: NeonImportPersistenceClient = { query };
  const close = vi.fn(async () => undefined);
  const sessionFactory = vi.fn(async () => ({ client, close }));
  return {
    events,
    query,
    repository: createNeonActiveDnaCoreRaceHistoryGenerationReadRepository({
      databaseUrl: "postgresql://private.example/dna",
      databaseOwnerId,
      ownerId,
      runtimeRole,
      sessionFactory:
        sessionFactory as unknown as NeonImportPersistenceSessionFactory,
    }),
  };
}

describe("active DNA Core race history generation reads", () => {
  it("reads only the published owner generation in a read-only transaction", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [generationRow()],
    ]);
    await expect(
      test.repository.readActiveGeneration(ownerId),
    ).resolves.toMatchObject({ generationId, observationCount: 1 });
    expect(test.events[0]).toBe(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    expect(test.events.at(-1)).toBe("COMMIT");
  });

  it("verifies bounded row payload identity and digest", async () => {
    const value = payload();
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          generation_id: generationId,
          ordinal: 0,
          natural_key: value.naturalKey,
          row_sha256: dnaOpenLabRawEvidenceSha256(value),
          payload: value,
        },
      ],
    ]);
    await expect(
      test.repository.readActiveRows(ownerId, -1, 250),
    ).resolves.toMatchObject([
      { generationId, ordinal: 0, naturalKey: value.naturalKey },
    ]);
  });

  it("fails closed for cross-owner and privileged runtime access", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation({ runtime_can_access_tables: true })],
    ]);
    await expect(test.repository.readActiveGeneration(ownerId)).rejects.toThrow(
      "least-privilege owner isolation",
    );
    await expect(
      test.repository.readActiveGeneration("another_owner"),
    ).rejects.toThrow("owner access denied");
    expect(test.events.at(-1)).toBe("ROLLBACK");
  });
});
