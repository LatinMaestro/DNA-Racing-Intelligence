import { describe, expect, it, vi } from "vitest";

import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";
import { createNeonProLeagueEvidenceGenerationRepository } from "@/lib/neon-pro-league-evidence-generation-repository";

const databaseOwnerId = "84000000-0000-4000-8000-000000000001";
const generationId = "84000000-0000-4000-8000-000000000301";
const raceDatasetVersionId = "84000000-0000-4000-8000-000000000201";
const ownerId = "private_owner";
const runtimeRole = "dna_app_runtime";

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    authenticated_owner_id: ownerId,
    all_rls_enabled: true,
    all_force_rls_enabled: true,
    runtime_can_access_tables: false,
    runtime_can_begin: true,
    runtime_can_stage: true,
    runtime_can_publish: true,
    runtime_can_read_generation: true,
    runtime_can_read_rows: true,
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
  const repository = createNeonProLeagueEvidenceGenerationRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    ownerId,
    runtimeRole,
    sessionFactory:
      sessionFactory as unknown as NeonImportPersistenceSessionFactory,
  });
  return { close, events, query, repository };
}

const metadata = {
  generationId,
  raceDatasetVersionId,
  workerId: "evidence-worker",
  sourceVersionSetSha256: "a".repeat(64),
  evidenceCutoffAt: "2026-09-07T01:00:00.000Z",
  inputObservationCount: 10,
  acceptedEntryCount: 6,
  nonBikeEntryCount: 1,
  missingFormatEntryCount: 1,
  unsupportedFormatEntryCount: 1,
  unpublishedCellEntryCount: 1,
};

describe("Neon Pro League evidence generation repository", () => {
  it("begins a resumable owner-scoped generation in a serializable transaction", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ disposition: "staging" }],
    ]);
    await expect(test.repository.begin(ownerId, metadata)).resolves.toBe(
      "staging",
    );
    expect(test.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      generationId,
      raceDatasetVersionId,
      "evidence-worker",
      "a".repeat(64),
      "2026-09-07T01:00:00.000Z",
      10,
      6,
      1,
      1,
      1,
      1,
    ]);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("stages bounded rows and requires exact ordered database hashes", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          hashes: [
            { ordinal: 4, sha256: "b".repeat(64) },
            { ordinal: 5, sha256: "c".repeat(64) },
          ],
        },
      ],
    ]);
    await expect(
      test.repository.stageRows(ownerId, {
        generationId,
        workerId: "evidence-worker",
        family: "profile",
        startOrdinal: 4,
        rows: [
          { naturalKey: "core-1", payload: { sourceCoreId: "core-1" } },
          { naturalKey: "core-2", payload: { sourceCoreId: "core-2" } },
        ],
      }),
    ).resolves.toEqual([
      { ordinal: 4, sha256: "b".repeat(64) },
      { ordinal: 5, sha256: "c".repeat(64) },
    ]);
  });

  it("publishes only the exact counted and digested generation", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ disposition: "published", benchmark_count: 2, profile_count: 8 }],
    ]);
    await expect(
      test.repository.publish(ownerId, {
        generationId,
        workerId: "evidence-worker",
        expectedBenchmarkCount: 2,
        expectedProfileCount: 8,
        unbenchmarkedEntryCount: 0,
        payloadSha256: "d".repeat(64),
        publishedAt: "2026-09-07T01:01:00Z",
      }),
    ).resolves.toEqual({
      disposition: "published",
      benchmarkCount: 2,
      profileCount: 8,
    });
  });

  it("reads only the active generation and bounded ordered private rows", async () => {
    const generation = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          generation_id: generationId,
          race_dataset_version_id: raceDatasetVersionId,
          source_version_set_sha256: "a".repeat(64),
          evidence_cutoff_at: new Date("2026-09-07T01:00:00Z"),
          input_observation_count: "10",
          accepted_entry_count: "6",
          non_bike_entry_count: "1",
          missing_format_entry_count: "1",
          unsupported_format_entry_count: "1",
          unpublished_cell_entry_count: "1",
          unbenchmarked_entry_count: "0",
          benchmark_count: 2,
          profile_count: 8,
          payload_sha256: "d".repeat(64),
          state: "published",
          published_at: new Date("2026-09-07T01:01:00Z"),
        },
      ],
    ]);
    await expect(
      generation.repository.readActiveGeneration(ownerId),
    ).resolves.toMatchObject({
      generationId,
      benchmarkCount: 2,
      profileCount: 8,
    });
    expect(generation.events[0]).toBe(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );

    const rows = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          generation_id: generationId,
          family: "benchmark",
          ordinal: 2,
          natural_key: '["1v1",1000]',
          row_sha256: "e".repeat(64),
          payload: { raceType: "1v1", distanceMetres: 1000 },
        },
      ],
    ]);
    await expect(
      rows.repository.listActiveRows(ownerId, "benchmark", 1, 100),
    ).resolves.toMatchObject([
      { generationId, family: "benchmark", ordinal: 2 },
    ]);
  });

  it("rolls back when the runtime boundary is privileged", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation({ runtime_can_access_tables: true })],
    ]);
    await expect(test.repository.begin(ownerId, metadata)).rejects.toThrow(
      "least-privilege owner isolation",
    );
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });
});
