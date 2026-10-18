import { describe, expect, it, vi } from "vitest";

import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";
import {
  createNeonAcceptedHistoricalRaceContextRepository,
  prepareHistoricalRaceContextGeneration,
} from "@/lib/neon-accepted-historical-race-context-repository";

const databaseOwnerId = "a1420000-0000-4000-8000-000000000001";
const ownerId = "private-owner";
const generationId = "a".repeat(64);
const observationSetSha256 = "b".repeat(64);
const identity = "c".repeat(64);

function isolation() {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    all_rls_enabled: true,
    all_force_rls_enabled: true,
    runtime_has_direct_table_access: false,
    session_user_name: "dna_app_runtime",
    current_user_name: "dna_app_runtime",
    runtime_is_superuser: false,
    runtime_bypasses_rls: false,
    runtime_can_create_roles: false,
    runtime_can_create_databases: false,
    runtime_can_create_database_objects: false,
    runtime_can_create_schema_objects: false,
    runtime_is_neon_superuser_member: false,
    runtime_can_read_pointer: true,
    runtime_can_read_rows: true,
    runtime_can_begin: true,
    runtime_can_stage: true,
    runtime_can_publish: true,
  };
}

function pointer() {
  return {
    history_generation_version: generationId,
    observation_set_sha256: observationSetSha256,
    historical_aggregate_version: "aggregate-v8",
    context_source_identity_sha256: identity,
    evidence_cutoff: new Date("2026-10-18T00:00:00.000Z"),
    publication_state: "accepted",
    expected_row_count: 2,
    row_set_sha256: "d".repeat(64),
    published_at: new Date("2026-10-18T01:00:00.000Z"),
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
        normalized.startsWith("SET LOCAL") ||
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
    events,
    query,
    repository: createNeonAcceptedHistoricalRaceContextRepository({
      databaseUrl: "postgresql://private.example/dna",
      databaseOwnerId,
      authenticatedOwnerId: ownerId,
      runtimeRole: "dna_app_runtime",
      sessionFactory:
        sessionFactory as unknown as NeonImportPersistenceSessionFactory,
    }),
  };
}

describe("accepted historical Race context generation", () => {
  it("prepares deterministic sorted rows and aggregate-bound identities", () => {
    const prepared = prepareHistoricalRaceContextGeneration({
      historyGenerationVersion: generationId,
      observationSetSha256,
      historicalAggregateVersion: "aggregate-v8",
      evidenceCutoff: "2026-10-18T00:00:00.000Z",
      publicationState: "accepted",
      materializedAt: "2026-10-18T00:30:00.000Z",
      contexts: [
        {
          eventId: "race-2",
          competition: "esports",
          element: { status: "known", value: "Metal" },
          evidenceSha256: "e".repeat(64),
        },
        {
          eventId: "race-1",
          competition: "normal",
          element: { status: "not_applicable", value: null },
          evidenceSha256: "f".repeat(64),
        },
      ],
    });
    expect(prepared.rows.map(({ payload }) => payload.eventId)).toEqual([
      "race-1",
      "race-2",
    ]);
    expect(prepared).toMatchObject({
      expectedRowCount: 2,
      historyGenerationVersion: generationId,
      observationSetSha256,
      historicalAggregateVersion: "aggregate-v8",
    });
    expect(prepared.contextSourceIdentitySha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(prepared.rowSetSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(() =>
      prepareHistoricalRaceContextGeneration({
        historyGenerationVersion: generationId,
        observationSetSha256,
        historicalAggregateVersion: "aggregate-v8",
        evidenceCutoff: "2026-10-18T00:00:00.000Z",
        publicationState: "accepted",
        materializedAt: "2026-10-18T00:30:00.000Z",
        contexts: [],
      }),
    ).toThrow("persistence unavailable");
    expect(() =>
      prepareHistoricalRaceContextGeneration({
        historyGenerationVersion: generationId,
        observationSetSha256,
        historicalAggregateVersion: "aggregate-v8",
        evidenceCutoff: "2026-10-18T00:00:00.000Z",
        publicationState: "unknown",
        materializedAt: "2026-10-18T00:30:00.000Z",
        contexts: [
          {
            eventId: "race-1",
            competition: "normal",
            element: { status: "unknown", value: null },
            evidenceSha256: "e".repeat(64),
          },
        ],
      }),
    ).toThrow("persistence unavailable");
    expect(() =>
      prepareHistoricalRaceContextGeneration({
        historyGenerationVersion: generationId,
        observationSetSha256,
        historicalAggregateVersion: "aggregate-v8",
        evidenceCutoff: "2026-10-18T00:00:00.000Z",
        publicationState: "accepted",
        materializedAt: "2026-10-18T00:30:00.000Z",
        contexts: [
          {
            eventId: "duplicate",
            competition: "normal",
            element: { status: "unknown", value: null },
            evidenceSha256: "e".repeat(64),
          },
          {
            eventId: "duplicate",
            competition: "normal",
            element: { status: "unknown", value: null },
            evidenceSha256: "f".repeat(64),
          },
        ],
      }),
    ).toThrow("persistence unavailable");
  });

  it("reads only the active exact-bound owner contexts and verifies row digests", async () => {
    const prepared = prepareHistoricalRaceContextGeneration({
      historyGenerationVersion: generationId,
      observationSetSha256,
      historicalAggregateVersion: "aggregate-v8",
      evidenceCutoff: "2026-10-18T00:00:00.000Z",
      publicationState: "accepted",
      materializedAt: "2026-10-18T00:30:00.000Z",
      contexts: [
        {
          eventId: "race-1",
          competition: "normal",
          element: { status: "not_applicable", value: null },
          evidenceSha256: "e".repeat(64),
        },
      ],
    });
    const value = prepared.rows[0]!;
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [pointer()],
      [
        {
          ordinal: 0,
          event_id: "race-1",
          row_sha256: value.rowSha256,
          payload: value.payload,
        },
      ],
    ]);
    await expect(
      test.repository.readPublishedContextsByOwner(ownerId, {
        historyGenerationVersion: generationId,
        observationSetSha256,
        historicalAggregateVersion: "aggregate-v8",
        evidenceCutoff: "2026-10-18T00:00:00.000Z",
        requestedEventIds: ["race-1"],
        maximumRows: 1,
      }),
    ).resolves.toMatchObject({
      authenticatedOwnerId: ownerId,
      publicationState: "accepted",
      requestedEventIds: ["race-1"],
      truncated: false,
      rows: [{ eventId: "race-1" }],
    });
    expect(test.events[0]).toBe(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    expect(test.events.at(-1)).toBe("COMMIT");
  });

  it("publishes prepared rows atomically and fails before access for another owner", async () => {
    const prepared = prepareHistoricalRaceContextGeneration({
      historyGenerationVersion: generationId,
      observationSetSha256,
      historicalAggregateVersion: "aggregate-v8",
      evidenceCutoff: "2026-10-18T00:00:00.000Z",
      publicationState: "partial",
      materializedAt: "2026-10-18T00:30:00.000Z",
      contexts: Array.from({ length: 251 }, (_, index) => ({
        eventId: `race-${String(index).padStart(3, "0")}`,
        competition: "normal" as const,
        element: { status: "unknown" as const, value: null },
        evidenceSha256: "e".repeat(64),
      })),
    });
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ status: "staging" }],
      [{ staged: 250 }],
      [{ staged: 1 }],
      [{ status: "published" }],
    ]);
    await expect(
      test.repository.publishGenerationByOwner(
        ownerId,
        "context-worker",
        prepared,
        "2026-10-18T00:31:00.000Z",
      ),
    ).resolves.toEqual({ status: "published" });
    expect(
      test.events.filter((event) =>
        event.startsWith("SELECT dna.stage_open_race_history_context_rows"),
      ),
    ).toHaveLength(2);
    await expect(
      test.repository.readActivePointerByOwner("another-owner"),
    ).rejects.toThrow("persistence unavailable");
  });
});
