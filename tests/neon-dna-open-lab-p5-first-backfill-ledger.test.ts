import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET } from "@/lib/dna-open-lab-p5-first-backfill-approval";
import { createNeonDnaOpenLabP5FirstBackfillLedger } from "@/lib/neon-dna-open-lab-p5-first-backfill-ledger";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "78000000-0000-4000-8000-000000000001";
const ownerId = "private_owner";
const runtimeRole = "dna_app_runtime";
const measurementSha =
  "250984ef3371aa4f9b0b256b498b18083b1d1c2559de1882b8ee51c90dc30fe4";

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    run_rls: true,
    run_force_rls: true,
    receipt_rls: true,
    receipt_force_rls: true,
    runtime_can_access_run: false,
    runtime_can_access_receipt: false,
    runtime_can_initialize: true,
    runtime_can_record: true,
    runtime_can_complete: true,
    runtime_can_read_run: true,
    runtime_can_read_receipts: true,
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

function running(overrides: Record<string, unknown> = {}) {
  return {
    revision: "1",
    status: "running",
    next_request_ordinal: 1,
    logical_request_count: 0,
    retained_r2_bytes: "0",
    omitted_identity_observation_count: 0,
    completion_sha256: null,
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
  const close = vi.fn(async (): Promise<void> => {
    events.push("close");
  });
  const sessionFactory = vi.fn(async () => ({ client, close }));
  const ledger = createNeonDnaOpenLabP5FirstBackfillLedger({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    ownerId,
    runtimeRole,
    approvalPacket: DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  });
  return { events, ledger, query, sessionFactory };
}

describe("Neon DNA Open Lab P5 first-backfill ledger", () => {
  it("initializes the exact approved authority in a serializable transaction", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [running()],
    ]);

    await expect(test.ledger.initialize()).resolves.toEqual({
      revision: "1",
      status: "running",
      nextRequestOrdinal: 1,
      logicalRequestCount: 0,
      retainedR2Bytes: 0,
      omittedIdentityObservationCount: 0,
      completionSha256: null,
    });
    expect(test.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      measurementSha,
      createHash("sha256")
        .update("owner-written-approval:2026-09-02", "utf8")
        .digest("hex"),
      "2026-09-02T00:11:55.961Z",
    ]);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("records the request receipt and atomic omission authority", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        running({
          revision: "2",
          next_request_ordinal: 2,
          logical_request_count: 1,
          retained_r2_bytes: "250",
          omitted_identity_observation_count: 1,
        }),
      ],
    ]);

    await expect(
      test.ledger.record({
        expectedRevision: "1",
        receipt: {
          family: "finished_races",
          requestOrdinal: 1,
          observedAt: "2026-09-02T04:00:00.000Z",
          contentSha256: "a".repeat(64),
          byteLength: 250,
          evidenceObjectKey: `dna-open-lab/v1/${"b".repeat(64)}/first-private-preview-backfill/${measurementSha}/requests/000001.json`,
        },
        omittedIdentityObservationCount: 1,
      }),
    ).resolves.toMatchObject({
      revision: "2",
      logicalRequestCount: 1,
      omittedIdentityObservationCount: 1,
    });
    expect(test.query.mock.calls[3]?.[1]?.slice(-2)).toEqual([1, true]);
  });

  it("loads paginated receipts through a read-only owner scope", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          family: "race_activity",
          request_ordinal: 4,
          observed_at: new Date("2026-09-02T04:00:00Z"),
          content_sha256: "c".repeat(64),
          byte_length: 100,
          evidence_object_key: "opaque/request.json",
          omitted_identity_observation_count: 0,
          quarantine_bound: false,
        },
      ],
    ]);

    await expect(
      test.ledger.loadReceipts({ afterRequestOrdinal: 3, limit: 100 }),
    ).resolves.toEqual([
      {
        family: "race_activity",
        requestOrdinal: 4,
        observedAt: "2026-09-02T04:00:00.000Z",
        contentSha256: "c".repeat(64),
        byteLength: 100,
        evidenceObjectKey: "opaque/request.json",
        omittedIdentityObservationCount: 0,
        quarantineBound: false,
      },
    ]);
    expect(test.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY");
    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      measurementSha,
      3,
      100,
    ]);
  });

  it("completes only through the exact checksum call", async () => {
    const completion = "d".repeat(64);
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        running({
          revision: "17455",
          status: "complete",
          next_request_ordinal: 17_454,
          logical_request_count: 17_453,
          retained_r2_bytes: "1151071826",
          omitted_identity_observation_count: 1,
          completion_sha256: completion,
        }),
      ],
    ]);

    await expect(
      test.ledger.complete({
        expectedRevision: "17454",
        completionSha256: completion,
      }),
    ).resolves.toMatchObject({
      status: "complete",
      completionSha256: completion,
    });
    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      measurementSha,
      "17454",
      completion,
    ]);
  });

  it("fails closed on unsafe isolation, invalid pages and absent approval", async () => {
    const unsafe = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation({ runtime_can_access_receipt: true })],
    ]);
    await expect(unsafe.ledger.load()).rejects.toThrow(
      "table access is not bounded",
    );
    expect(unsafe.events.slice(-2)).toEqual(["ROLLBACK", "close"]);

    const invalid = harness([]);
    expect(() =>
      invalid.ledger.loadReceipts({ afterRequestOrdinal: 0, limit: 501 }),
    ).toThrow("receipt page is invalid");
    expect(invalid.sessionFactory).not.toHaveBeenCalled();

    expect(() =>
      createNeonDnaOpenLabP5FirstBackfillLedger({
        databaseUrl: "postgresql://private.example/dna",
        databaseOwnerId,
        ownerId,
        runtimeRole,
        approvalPacket: {
          ...DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET,
          status: "ready_for_owner_decision",
          ownerApprovalRecorded: false,
          firstPersistentPrivatePreviewBackfillAllowed: false,
        },
      }),
    ).toThrow("requires exact bounded Preview approval");
  });
});
