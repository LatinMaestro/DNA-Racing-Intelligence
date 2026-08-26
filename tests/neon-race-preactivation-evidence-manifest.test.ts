import { describe, expect, it, vi } from "vitest";

import { createNeonRacePreactivationEvidenceManifestRepository } from "@/lib/neon-race-preactivation-evidence-manifest";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "user_owner";
const importBatchId = "22222222-2222-4222-8222-222222222222";
const runtimeRole = "dna_app_runtime";

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    evidence_rls: true,
    evidence_force_rls: true,
    receipt_rls: true,
    receipt_force_rls: true,
    runtime_can_read_evidence: true,
    runtime_can_read_receipts: true,
    runtime_can_read_manifest: true,
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

function partition(
  partitionNumber: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    import_batch_id: importBatchId,
    source_row_count: "3",
    accepted_row_count: "2",
    rejected_row_count: "1",
    warning_row_count: "1",
    partition_count: 2,
    evidence_byte_size: "30",
    partition_number: partitionNumber,
    object_format: "ndjson_gzip",
    object_key:
      "evidence/private/" +
      importBatchId +
      "/race_merge/staged_rows/part-" +
      String(partitionNumber).padStart(4, "0") +
      ".ndjson.gz",
    checksum_sha256: partitionNumber === 0 ? "a".repeat(64) : "b".repeat(64),
    byte_size: partitionNumber === 0 ? "10" : "20",
    row_count: partitionNumber === 0 ? "2" : "1",
    first_natural_key:
      partitionNumber === 0 ? "event-1:core-1" : "event-3:core-3",
    last_natural_key:
      partitionNumber === 0 ? "event-2:core-2" : "event-3:core-3",
    created_at: new Date("2026-08-26T00:00:00.000Z"),
    ...overrides,
  };
}

function harness(rows: readonly (readonly unknown[])[]) {
  const events: string[] = [];
  let index = 0;
  const query = vi.fn(
    async (statement: string, values?: readonly unknown[]) => {
      const normalized = statement.replace(/\s+/g, " ").trim();
      events.push(
        values ? `${normalized}|${JSON.stringify(values)}` : normalized,
      );
      if (
        [
          "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY",
          "COMMIT",
          "ROLLBACK",
        ].includes(normalized)
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
  const repository = createNeonRacePreactivationEvidenceManifestRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    runtimeRole,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  });
  return { events, query, repository };
}

describe("Neon Race preactivation evidence manifest", () => {
  it("returns exact finalized Race preview evidence under a read-only owner scope", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [partition(0), partition(1)],
    ]);

    await expect(
      test.repository.list({
        ownerId,
        importBatchId,
        maximumPartitions: 10,
      }),
    ).resolves.toEqual({
      status: "ready",
      manifest: {
        importBatchId,
        sourceRowCount: 3,
        acceptedRowCount: 2,
        rejectedRowCount: 1,
        warningRowCount: 1,
        partitionCount: 2,
        byteSize: 30,
        objects: [
          expect.objectContaining({
            ownerId,
            importBatchId,
            sourceType: "race_merge",
            objectKind: "staged_rows",
            partitionNumber: 0,
            byteSize: 10,
            rowCount: 2,
            createdAt: "2026-08-26T00:00:00.000Z",
          }),
          expect.objectContaining({
            partitionNumber: 1,
            byteSize: 20,
            rowCount: 1,
          }),
        ],
      },
    });
    expect(test.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY");
    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      importBatchId,
      10,
    ]);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("reports missing evidence without inventing a manifest", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [],
    ]);
    await expect(
      test.repository.list({ ownerId, importBatchId, maximumPartitions: 10 }),
    ).resolves.toEqual({ status: "missing" });
  });

  it("fails closed on over-bound, non-contiguous, or inconsistent manifest rows", async () => {
    const overBound = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [partition(0), partition(1)],
    ]);
    await expect(
      overBound.repository.list({
        ownerId,
        importBatchId,
        maximumPartitions: 1,
      }),
    ).rejects.toThrow("exceeds the read bound");
    expect(overBound.events.slice(-2)).toEqual(["ROLLBACK", "close"]);

    const nonContiguous = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [partition(0), partition(2)],
    ]);
    await expect(
      nonContiguous.repository.list({
        ownerId,
        importBatchId,
        maximumPartitions: 10,
      }),
    ).rejects.toThrow("not contiguous");

    const inconsistent = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [partition(0), partition(1, { accepted_row_count: "3" })],
    ]);
    await expect(
      inconsistent.repository.list({
        ownerId,
        importBatchId,
        maximumPartitions: 10,
      }),
    ).rejects.toThrow("manifest rows are inconsistent");
  });

  it("fails closed when partition totals drift from the manifest", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [partition(0), partition(1, { byte_size: "21" })],
    ]);
    await expect(
      test.repository.list({ ownerId, importBatchId, maximumPartitions: 10 }),
    ).rejects.toThrow("coverage conflicts");
  });

  it("rejects unsafe identity, RLS, or runtime evidence before returning authority", async () => {
    const malformed = harness([]);
    await expect(
      malformed.repository.list({
        ownerId,
        importBatchId: "not-a-uuid",
        maximumPartitions: 10,
      }),
    ).rejects.toThrow("importBatchId must be a UUID");
    expect(malformed.query).not.toHaveBeenCalled();

    const unsafe = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation({ runtime_can_read_manifest: false })],
    ]);
    await expect(
      unsafe.repository.list({ ownerId, importBatchId, maximumPartitions: 10 }),
    ).rejects.toThrow("runtime privilege is incomplete");
    expect(unsafe.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });
});
