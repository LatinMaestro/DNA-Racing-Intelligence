import { describe, expect, it, vi } from "vitest";

import type { DnaFinishedRaceIncrementalPublicationCandidate } from "@/lib/dna-open-lab-finished-race-incremental-publication";
import { createNeonDnaFinishedRaceIncrementalPublicationRepository } from "@/lib/neon-dna-open-lab-finished-race-incremental-publication";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "91000000-0000-4000-8000-000000000001";
const ownerId = "private_owner";
const runtimeRole = "dna_app_runtime";
const cycleId = "a".repeat(64);

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    publication_rls: true,
    publication_force_rls: true,
    active_rls: true,
    active_force_rls: true,
    runtime_can_access_publication: false,
    runtime_can_access_active: false,
    runtime_can_read_receipts: true,
    runtime_can_publish: true,
    runtime_can_read_last_good: true,
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
  let index = 0;
  const events: string[] = [];
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
    repository: createNeonDnaFinishedRaceIncrementalPublicationRepository({
      databaseUrl: "postgresql://private.example/dna",
      databaseOwnerId,
      ownerId,
      runtimeRole,
      sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
    }),
  };
}

function candidate(): DnaFinishedRaceIncrementalPublicationCandidate {
  return Object.freeze({
    version: 1,
    cycleId,
    previousPublishedCycleId: null,
    attemptNumber: 1,
    lowerBoundAt: "2026-09-02T00:11:55.961Z",
    upperBoundAt: "2026-09-03T00:11:55.961Z",
    receiptCount: 1,
    documentCount: 2,
    manifestByteLength: 256,
    receiptSetSha256: "b".repeat(64),
    validatedAt: "2026-09-03T00:13:00.000Z",
  });
}

describe("Neon DNA finished-race incremental publication", () => {
  it("loads the complete receipt set through a read-only owner transaction", async () => {
    const row = {
      cycle_id: cycleId,
      first_attempt_number: 1,
      window_start_at: "2026-09-02T00:11:55.961Z",
      window_end_at: "2026-09-03T00:11:55.961Z",
      window_key: "c".repeat(64),
      content_sha256: "d".repeat(64),
      document_count: 2,
      manifest_object_key: `dna-open-lab/v1/${"e".repeat(64)}/races/finished-windows/${"c".repeat(64)}.json`,
      manifest_body_sha256: "f".repeat(64),
      manifest_byte_length: "256",
    };
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [row],
    ]);
    await expect(
      test.repository.loadReceiptSet({ cycleId, attemptNumber: 1 }),
    ).resolves.toEqual([
      expect.objectContaining({
        cycleId,
        documentCount: 2,
        manifestByteLength: 256,
      }),
    ]);
    expect(test.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY");
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("publishes the exact candidate in one serializable transaction", async () => {
    const expected = candidate();
    const publishedAt = "2026-09-03T00:14:00.000Z";
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          version: 1,
          cycle_id: expected.cycleId,
          previous_published_cycle_id: null,
          attempt_number: 1,
          lower_bound_at: expected.lowerBoundAt,
          upper_bound_at: expected.upperBoundAt,
          receipt_count: 1,
          document_count: "2",
          manifest_byte_length: "256",
          receipt_set_sha256: expected.receiptSetSha256,
          validated_at: expected.validatedAt,
          published_at: publishedAt,
        },
      ],
    ]);
    await expect(
      test.repository.publish({ candidate: expected, publishedAt }),
    ).resolves.toEqual({ ...expected, publishedAt });
    expect(test.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      expected.cycleId,
      1,
      1,
      2,
      256,
      expected.receiptSetSha256,
      expected.validatedAt,
      publishedAt,
    ]);
  });

  it("rolls back if the runtime has direct table access", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation({ runtime_can_access_active: true })],
    ]);
    await expect(
      test.repository.loadReceiptSet({ cycleId, attemptNumber: 1 }),
    ).rejects.toThrow("runtime role is unsafe");
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });
});
