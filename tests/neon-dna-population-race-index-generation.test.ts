import { describe, expect, it, vi } from "vitest";

import type {
  DnaPopulationRaceIndexAuthority,
  DnaPopulationRaceIndexWriteBatch,
} from "@/lib/dna-population-race-index-generation";
import { createNeonDnaPopulationRaceIndexGenerationRepository } from "@/lib/neon-dna-population-race-index-generation";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "a1120000-0000-4000-8000-000000000001";
const ownerId = "private_owner";
const runtimeRole = "dna_app_runtime";
const workerId = "population-index-worker";
const generationId = "1".repeat(64);

const authority: DnaPopulationRaceIndexAuthority = Object.freeze({
  version: 1,
  generationId,
  baselineCompletionSha256: generationId,
  baselineLogicalRequestCount: 2,
  baselineRetainedR2Bytes: 30,
  baselineOmittedIdentityObservationCount: 0,
});

const batch: DnaPopulationRaceIndexWriteBatch = Object.freeze({
  version: 1,
  generationId,
  batchSha256: "2".repeat(64),
  afterRequestOrdinal: 0,
  nextRequestOrdinal: 2,
  processedReceiptCount: 1,
  processedReceiptBytes: 10,
  processedIdentityOmissionCount: 0,
  finishedRaceReceiptCount: 1,
  canonicalDocumentObservationCount: 1,
  documents: Object.freeze([
    Object.freeze({
      requestOrdinal: 1,
      endpoint: "races.finished" as const,
      observedAt: "2026-09-02T00:00:00.000Z",
      sourceRaceId: "race-1",
      rawEvidenceSha256: "3".repeat(64),
      canonical: Object.freeze({
        sourceType: "race_document" as const,
        sourceRaceId: "race-1",
        mode: "bike" as const,
        entrantCoreIds: Object.freeze(["core-1"]),
      }),
    }),
  ]),
  complete: false,
});

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    all_rls_enabled: true,
    all_force_rls_enabled: true,
    runtime_can_access_tables: false,
    runtime_can_begin: true,
    runtime_can_legacy_append: false,
    runtime_can_read_legacy: true,
    runtime_can_register_compaction: true,
    runtime_can_finalize_compaction: true,
    runtime_can_read_r2_manifests: true,
    runtime_can_register_identities: true,
    runtime_can_lookup_identities: true,
    runtime_can_append: true,
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

function checkpointRow(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    generation_id: generationId,
    baseline_completion_sha256: generationId,
    baseline_logical_request_count: 2,
    baseline_retained_r2_bytes: "30",
    baseline_omitted_identity_observation_count: 0,
    state: "staging",
    last_request_ordinal: 0,
    processed_receipt_count: 0,
    processed_receipt_bytes: "0",
    processed_identity_omission_count: 0,
    finished_race_receipt_count: 0,
    canonical_document_observation_count: "0",
    unique_race_count: 0,
    unique_entrant_core_count: 0,
    storage_layout: "r2_chunked_v1",
    r2_chunk_count: 0,
    r2_identity_chunk_count: 0,
    r2_compacted_race_count: 0,
    r2_last_source_race_id: null,
    compacted_at: new Date("2026-09-24T02:59:00.000Z"),
    legacy_storage_retired_at: new Date("2026-09-24T02:59:30.000Z"),
    updated_at: new Date("2026-09-24T03:00:00.000Z"),
    completed_at: null,
    published_at: null,
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
  const repository = createNeonDnaPopulationRaceIndexGenerationRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    ownerId,
    runtimeRole,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  });
  return { events, query, repository };
}

describe("Neon DNA population race index generation", () => {
  it("begins a generation inside a forced-owner serializable transaction", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [checkpointRow()],
    ]);
    await expect(
      test.repository.begin(ownerId, {
        workerId,
        authority,
        startedAt: "2026-09-24T03:00:00.000Z",
      }),
    ).resolves.toMatchObject({ state: "staging", lastRequestOrdinal: 0 });
    expect(test.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("appends the evidence and ordinal checkpoint in one transaction", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        checkpointRow({
          last_request_ordinal: 1,
          processed_receipt_count: 1,
          processed_receipt_bytes: "10",
          finished_race_receipt_count: 1,
          canonical_document_observation_count: "1",
          unique_race_count: 1,
          unique_entrant_core_count: 1,
          updated_at: new Date("2026-09-24T03:01:00.000Z"),
        }),
      ],
    ]);
    await expect(
      test.repository.appendR2Batch(ownerId, {
        workerId,
        batch,
        newIdentities: [
          {
            sourceRaceId: "race-1",
            rawEvidenceSha256: "3".repeat(64),
          },
        ],
        chunk: {
          version: 1,
          generationId,
          chunkOrdinal: 1,
          objectKey: "private/population/1.json",
          bodySha256: "4".repeat(64),
          byteLength: 256,
          rowCount: 1,
          firstSourceRaceId: "race-1",
          lastSourceRaceId: "race-1",
        },
        writtenAt: "2026-09-24T03:01:00.000Z",
      }),
    ).resolves.toMatchObject({
      lastRequestOrdinal: 1,
      processedReceiptCount: 1,
      uniqueRaceCount: 1,
    });
    expect(test.query.mock.calls[3]?.[1]?.[2]).toBe(JSON.stringify(batch));
    expect(test.query.mock.calls[3]?.[1]?.[3]).toBe(
      JSON.stringify([
        {
          sourceRaceId: "race-1",
          rawEvidenceSha256: "3".repeat(64),
        },
      ]),
    );
  });

  it("publishes only through the owner-scoped function and reads repeatably", async () => {
    const published = checkpointRow({
      state: "published",
      last_request_ordinal: 2,
      processed_receipt_count: 2,
      processed_receipt_bytes: "30",
      completed_at: new Date("2026-09-24T03:02:00.000Z"),
      published_at: new Date("2026-09-24T03:03:00.000Z"),
      updated_at: new Date("2026-09-24T03:03:00.000Z"),
    });
    const publish = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [published],
    ]);
    await expect(
      publish.repository.publish(ownerId, {
        workerId,
        generationId,
        publishedAt: "2026-09-24T03:03:00.000Z",
      }),
    ).resolves.toMatchObject({ state: "published" });

    const load = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [published],
    ]);
    await expect(
      load.repository.load(ownerId, generationId),
    ).resolves.toMatchObject({
      state: "published",
      publishedAt: "2026-09-24T03:03:00.000Z",
    });
    expect(load.events[0]).toBe(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
  });

  it("fails closed before repository access on cross-owner or isolation drift", async () => {
    const wrongOwner = harness([]);
    await expect(
      wrongOwner.repository.load("other_owner", generationId),
    ).rejects.toThrow("owner access denied");
    expect(wrongOwner.query).not.toHaveBeenCalled();

    const drift = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation({ runtime_can_access_tables: true })],
    ]);
    await expect(drift.repository.load(ownerId, generationId)).rejects.toThrow(
      "least-privilege owner isolation",
    );
    expect(drift.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });
});
