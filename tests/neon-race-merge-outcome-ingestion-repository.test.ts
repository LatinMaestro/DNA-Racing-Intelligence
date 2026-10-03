import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createNeonRaceMergeOutcomeIngestionRepository } from "@/lib/neon-race-merge-outcome-ingestion-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "a1220000-0000-4000-8000-000000000001";
const ownerId = "private_owner";
const runtimeRole = "dna_app_runtime";
const generationId = "generation-1";
const objectId = "object-1";
const objectSha = "a".repeat(64);
const manifestSha = "b".repeat(64);
const outcomeSha = "c".repeat(64);

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    all_rls_enabled: true,
    all_force_rls_enabled: true,
    runtime_can_access_tables: false,
    runtime_can_begin: true,
    runtime_can_append: true,
    runtime_can_commit: true,
    runtime_can_resume: true,
    runtime_can_inspect: true,
    runtime_can_digest: true,
    runtime_can_complete: true,
    runtime_can_abort: true,
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
  return {
    events,
    query,
    repository: createNeonRaceMergeOutcomeIngestionRepository({
      databaseUrl: "postgresql://private.example/dna",
      databaseOwnerId,
      ownerId,
      runtimeRole,
      sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
    }),
  };
}

function receiptRow() {
  return {
    object_id: objectId,
    byte_length: "1000",
    sha256: objectSha,
    row_count: "1",
    ordered_outcome_digest_sha256: outcomeSha,
  };
}

describe("Neon Race Merge outcome ingestion repository", () => {
  it("keeps one source object atomic and verifies append coverage", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ state: "staging" }],
      [{ accepted_count: 1, exact_replay_count: 0 }],
      [receiptRow()],
    ]);
    const transaction = await test.repository.beginObject({
      ownerId,
      generationId,
      manifestDigestSha256: manifestSha,
      objectId,
      expectedByteLength: 1000,
      expectedSha256: objectSha,
    });
    await transaction.appendOutcomes([
      {
        sourceRaceId: "race-1",
        sourceCoreId: 101,
        finishPosition: 2,
        elapsedMilliseconds: 12_345,
        source: "race_merge",
        sourceObjectSha256: objectSha,
        sourceRowNumber: 1,
      },
    ]);
    await expect(
      transaction.commitVerified({
        byteLength: 1000,
        sha256: objectSha,
        chunkCount: 1,
        rowCount: 1,
        orderedOutcomeDigestSha256: outcomeSha,
      }),
    ).resolves.toEqual({
      objectId,
      byteLength: 1000,
      sha256: objectSha,
      rowCount: 1,
      orderedOutcomeDigestSha256: outcomeSha,
    });
    expect(test.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("resumes a checksum-bound completed object without a write transaction", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [receiptRow()],
    ]);
    await expect(
      test.repository.resumeObject({
        ownerId,
        generationId,
        objectId,
        expectedByteLength: 1000,
        expectedSha256: objectSha,
      }),
    ).resolves.toMatchObject({ objectId, rowCount: 1 });
    expect(test.events[0]).toBe(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
  });

  it("returns an idempotent completed generation receipt", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          state: "complete",
          source_row_count: "3",
          unique_outcome_count: "2",
          exact_replay_count: "1",
          object_count: 1,
          outcome_set_digest_sha256: outcomeSha,
        },
      ],
    ]);
    await expect(
      test.repository.finalizeGeneration({
        ownerId,
        generationId,
        manifestDigestSha256: manifestSha,
        objects: [
          {
            objectId,
            byteLength: 1000,
            sha256: objectSha,
            rowCount: 3,
            orderedOutcomeDigestSha256: outcomeSha,
          },
        ],
      }),
    ).resolves.toEqual({
      status: "complete",
      generationId,
      objectCount: 1,
      sourceRowCount: 3,
      uniqueOutcomeCount: 2,
      exactReplayCount: 1,
      manifestDigestSha256: manifestSha,
      outcomeSetDigestSha256: outcomeSha,
      dnaProviderRequestCount: 0,
    });
  });

  it("seals a staging generation with a deterministic ordered outcome digest", async () => {
    const expectedDigest = createHash("sha256")
      .update("101\u0000race-1\u00002\u000012345\n")
      .update("202\u0000race-2\u00001\u00009500\n")
      .digest("hex");
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          state: "staging",
          source_row_count: "2",
          unique_outcome_count: "2",
          exact_replay_count: "0",
          object_count: 1,
          outcome_set_digest_sha256: null,
        },
      ],
      [
        {
          source_core_id: "101",
          source_race_id: "race-1",
          finish_position: 2,
          elapsed_milliseconds: "12345",
        },
        {
          source_core_id: "202",
          source_race_id: "race-2",
          finish_position: 1,
          elapsed_milliseconds: "9500",
        },
      ],
      [
        {
          state: "complete",
          object_count: 1,
          unique_outcome_count: "2",
          outcome_set_digest_sha256: expectedDigest,
        },
      ],
    ]);
    await expect(
      test.repository.finalizeGeneration({
        ownerId,
        generationId,
        manifestDigestSha256: manifestSha,
        objects: [
          {
            objectId,
            byteLength: 1000,
            sha256: objectSha,
            rowCount: 2,
            orderedOutcomeDigestSha256: outcomeSha,
          },
        ],
      }),
    ).resolves.toMatchObject({ outcomeSetDigestSha256: expectedDigest });
    expect(
      test.query.mock.calls.some(
        ([statement, values]) =>
          statement.includes("complete_race_merge_outcome_generation") &&
          values?.[5] === expectedDigest,
      ),
    ).toBe(true);
  });

  it("loads only completed compact outcomes with private provenance", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          source_race_id: "race-1",
          source_core_id: "101",
          finish_position: 2,
          elapsed_milliseconds: "12345",
          source_object_sha256: objectSha,
          source_row_number: 7,
        },
      ],
    ]);
    await expect(
      test.repository.loadCoreOutcomes({
        ownerId,
        generationId,
        sourceCoreId: 101,
      }),
    ).resolves.toEqual([
      {
        sourceRaceId: "race-1",
        sourceCoreId: 101,
        finishPosition: 2,
        elapsedMilliseconds: 12_345,
        source: "race_merge",
        sourceObjectSha256: objectSha,
        sourceRowNumber: 7,
      },
    ]);
  });

  it("fails closed before repository access when runtime isolation drifts", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation({ runtime_can_access_tables: true })],
    ]);
    await expect(
      test.repository.resumeObject({
        ownerId,
        generationId,
        objectId,
        expectedByteLength: 1000,
        expectedSha256: objectSha,
      }),
    ).rejects.toThrow("least-privilege owner isolation");
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });
});
