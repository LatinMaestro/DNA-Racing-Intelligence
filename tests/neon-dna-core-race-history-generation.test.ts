import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { DnaCoreRaceHistoryGenerationMetadata } from "@/lib/dna-core-race-history-generation";
import { createNeonDnaCoreRaceHistoryGenerationRepository } from "@/lib/neon-dna-core-race-history-generation";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "a1010000-0000-4000-8000-000000000001";
const ownerId = "private_owner";
const runtimeRole = "dna_app_runtime";
const workerId = "core-generation-worker";
const generationId = "1".repeat(64);

const generation: DnaCoreRaceHistoryGenerationMetadata = Object.freeze({
  version: 1,
  generationId,
  materializedAt: "2026-09-15T08:00:00.000Z",
  cycleSetSha256: "2".repeat(64),
  observationSetSha256: "3".repeat(64),
  payloadSha256: "4".repeat(64),
  inputCycleCount: 1,
  inputPageCount: 4,
  inputResultCount: 3,
  replayDuplicateCount: 1,
  raceDocumentCount: 2,
  entrantAuthorityOmissionCount: 0,
  entrantMismatchOmissionCount: 0,
  exactDistanceConfirmedCount: 2,
  acceptedPublishedCellCount: 1,
  missingFormatCount: 1,
  unsupportedFormatCount: 0,
  unpublishedCellCount: 0,
  observationCount: 2,
});

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    all_rls_enabled: true,
    all_force_rls_enabled: true,
    runtime_can_access_tables: false,
    runtime_can_begin: true,
    runtime_can_stage: true,
    runtime_can_publish: true,
    runtime_can_read: true,
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
  const close = vi.fn(async () => {
    events.push("close");
  });
  const sessionFactory = vi.fn(async () => ({ client, close }));
  const repository = createNeonDnaCoreRaceHistoryGenerationRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    ownerId,
    runtimeRole,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  });
  return { events, query, repository };
}

function publishedRow(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    generation_id: generationId,
    materialized_at: new Date(generation.materializedAt),
    cycle_set_sha256: generation.cycleSetSha256,
    observation_set_sha256: generation.observationSetSha256,
    payload_sha256: generation.payloadSha256,
    input_cycle_count: 1,
    input_page_count: 4,
    input_result_count: 3,
    replay_duplicate_count: 1,
    race_document_count: 2,
    entrant_authority_omission_count: 0,
    entrant_mismatch_omission_count: 0,
    exact_distance_confirmed_count: 2,
    accepted_published_cell_count: 1,
    missing_format_count: 1,
    unsupported_format_count: 0,
    unpublished_cell_count: 0,
    observation_count: 2,
    state: "published",
    published_at: new Date("2026-09-15T08:01:00.000Z"),
    ...overrides,
  };
}

describe("Neon DNA Core race history generation", () => {
  it("begins an exact owner-scoped generation in a serializable transaction", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ disposition: "staging" }],
    ]);
    await expect(
      test.repository.begin(ownerId, { workerId, generation }),
    ).resolves.toBe("staging");
    expect(test.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      workerId,
      JSON.stringify(generation),
    ]);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("stages only bounded consecutive rows and verifies every database echo", async () => {
    const firstCanonical =
      '{"naturalKey":"core-result:42:bike:race-1","sourceType":"joined_core_race_history_result"}';
    const secondCanonical =
      '{"naturalKey":"core-result:43:bike:race-2","sourceType":"joined_core_race_history_result"}';
    const firstSha = createHash("sha256").update(firstCanonical).digest("hex");
    const secondSha = createHash("sha256")
      .update(secondCanonical)
      .digest("hex");
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          accepted: [
            { ordinal: 4, rowSha256: firstSha },
            { ordinal: 5, rowSha256: secondSha },
          ],
        },
      ],
    ]);
    await expect(
      test.repository.stageRows(ownerId, {
        workerId,
        generationId,
        startOrdinal: 4,
        rows: [
          {
            ordinal: 4,
            naturalKey: "core-result:42:bike:race-1",
            rowSha256: firstSha,
            canonicalPayload: firstCanonical,
            payload: {
              sourceType: "joined_core_race_history_result",
              naturalKey: "core-result:42:bike:race-1",
            } as never,
          },
          {
            ordinal: 5,
            naturalKey: "core-result:43:bike:race-2",
            rowSha256: secondSha,
            canonicalPayload: secondCanonical,
            payload: {
              sourceType: "joined_core_race_history_result",
              naturalKey: "core-result:43:bike:race-2",
            } as never,
          },
        ],
      }),
    ).resolves.toEqual([
      { ordinal: 4, rowSha256: firstSha },
      { ordinal: 5, rowSha256: secondSha },
    ]);
  });

  it("publishes and loads only a complete normalized generation", async () => {
    const publish = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [publishedRow()],
    ]);
    await expect(
      publish.repository.publish(ownerId, {
        workerId,
        generationId,
        expectedObservationCount: 2,
        payloadSha256: generation.payloadSha256,
        publishedAt: "2026-09-15T08:01:00.000Z",
      }),
    ).resolves.toMatchObject({
      state: "published",
      generationId,
      observationCount: 2,
    });

    const load = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [publishedRow()],
    ]);
    await expect(load.repository.load(ownerId, generationId)).resolves.toEqual({
      ...generation,
      state: "published",
      publishedAt: "2026-09-15T08:01:00.000Z",
    });
    expect(load.events[0]).toBe(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
  });

  it("rejects a canonical payload checksum conflict before opening a session", async () => {
    const test = harness([]);
    await expect(
      test.repository.stageRows(ownerId, {
        workerId,
        generationId,
        startOrdinal: 0,
        rows: [
          {
            ordinal: 0,
            naturalKey: "core-result:42:bike:race-1",
            rowSha256: "a".repeat(64),
            canonicalPayload: '{"naturalKey":"core-result:42:bike:race-1"}',
            payload: {
              sourceType: "joined_core_race_history_result",
              naturalKey: "core-result:42:bike:race-1",
            } as never,
          },
        ],
      }),
    ).rejects.toThrow("canonicalPayload integrity is invalid");
    expect(test.query).not.toHaveBeenCalled();
  });

  it("rolls back before repository access when isolation drifts", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation({ runtime_can_access_tables: true })],
    ]);
    await expect(test.repository.load(ownerId, generationId)).rejects.toThrow(
      "least-privilege owner isolation",
    );
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
    expect(test.query).toHaveBeenCalledTimes(4);
  });

  it("rejects cross-owner access before opening a database session", async () => {
    const test = harness([]);
    await expect(
      test.repository.begin("other-owner", { workerId, generation }),
    ).rejects.toThrow("owner access denied");
    expect(test.query).not.toHaveBeenCalled();
  });
});
