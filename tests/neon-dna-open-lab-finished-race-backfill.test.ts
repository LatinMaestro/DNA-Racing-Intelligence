import { describe, expect, it, vi } from "vitest";

import type {
  DnaFinishedRaceBackfillCheckpoint,
  DnaFinishedRaceWindowPublicationReceipt,
} from "@/lib/dna-open-lab-finished-race-backfill";
import { createNeonDnaFinishedRaceBackfillCheckpointRepository } from "@/lib/neon-dna-open-lab-finished-race-backfill";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "70000000-0000-4000-8000-000000000001";
const ownerId = "private_owner";
const runtimeRole = "dna_app_runtime";
const windowKey = "1".repeat(64);

function checkpoint(
  overrides: Partial<DnaFinishedRaceBackfillCheckpoint> = {},
): DnaFinishedRaceBackfillCheckpoint {
  const rootWindow = Object.freeze({
    startTime: "2026-08-01T00:00:00.000Z",
    endTime: "2026-08-01T00:00:10.000Z",
  });
  return Object.freeze({
    version: 1 as const,
    rootWindow,
    pendingWindows: Object.freeze([rootWindow]),
    minimumWindowMilliseconds: 1,
    completedWindowCount: 0,
    splitCount: 0,
    successfulFinishedRaceRequestCount: 0,
    raceDocumentRequestCount: 0,
    publishedWindowDocumentCount: 0,
    ...overrides,
  });
}

function publicationReceipt(): DnaFinishedRaceWindowPublicationReceipt {
  return Object.freeze({
    windowKey,
    contentSha256: "2".repeat(64),
    documentCount: 1,
    manifestObjectKey: `dna-open-lab/v1/${"a".repeat(64)}/races/finished-windows/${windowKey}.json`,
    manifestBodySha256: "3".repeat(64),
    manifestByteLength: 256,
  });
}

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    checkpoint_rls: true,
    checkpoint_force_rls: true,
    receipt_rls: true,
    receipt_force_rls: true,
    runtime_can_access_checkpoint: false,
    runtime_can_access_receipt: false,
    runtime_can_save: true,
    runtime_can_read_checkpoint: true,
    runtime_can_read_receipt: true,
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
  const repository = createNeonDnaFinishedRaceBackfillCheckpointRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    ownerId,
    runtimeRole,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  });
  return { events, query, repository, sessionFactory };
}

describe("Neon DNA Open Lab finished-race backfill", () => {
  it("creates the durable checkpoint in a serializable owner-scoped transaction", async () => {
    const expected = checkpoint();
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ revision: "1", checkpoint: expected }],
    ]);

    await expect(
      test.repository.save({
        expectedRevision: null,
        checkpoint: expected,
      }),
    ).resolves.toEqual({ revision: "1", checkpoint: expected });

    expect(test.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      null,
      JSON.stringify(expected),
      null,
    ]);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("binds a verified R2 receipt to the checkpoint advancement", async () => {
    const window = checkpoint().rootWindow;
    const next = checkpoint({
      pendingWindows: Object.freeze([]),
      completedWindowCount: 1,
      successfulFinishedRaceRequestCount: 1,
      raceDocumentRequestCount: 1,
      publishedWindowDocumentCount: 1,
    });
    const receipt = publicationReceipt();
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ revision: "2", checkpoint: next }],
    ]);

    await expect(
      test.repository.save({
        expectedRevision: "1",
        checkpoint: next,
        publication: { window, receipt },
      }),
    ).resolves.toEqual({ revision: "2", checkpoint: next });

    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      "1",
      JSON.stringify(next),
      JSON.stringify({ window, receipt }),
    ]);
  });

  it("loads null deterministically before a checkpoint exists", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [],
    ]);
    await expect(test.repository.load()).resolves.toBeNull();
    expect(test.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY");
  });

  it("reads the immutable receipt needed for replay verification", async () => {
    const expected = publicationReceipt();
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          window_key: expected.windowKey,
          content_sha256: expected.contentSha256,
          document_count: String(expected.documentCount),
          manifest_object_key: expected.manifestObjectKey,
          manifest_body_sha256: expected.manifestBodySha256,
          manifest_byte_length: String(expected.manifestByteLength),
          window_start_at: new Date("2026-08-01T00:00:00.000Z"),
          window_end_at: new Date("2026-08-01T00:00:10.000Z"),
          recorded_at: new Date("2026-08-27T12:00:00.000Z"),
        },
      ],
    ]);

    await expect(test.repository.readReceipt(windowKey)).resolves.toEqual({
      window: {
        startTime: "2026-08-01T00:00:00.000Z",
        endTime: "2026-08-01T00:00:10.000Z",
      },
      receipt: expected,
      recordedAt: "2026-08-27T12:00:00.000Z",
    });
  });

  it("rejects unsafe isolation and malformed revisions before state can advance", async () => {
    const unsafe = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation({ runtime_can_access_receipt: true })],
    ]);
    await expect(unsafe.repository.load()).rejects.toThrow(
      "table access is not bounded",
    );
    expect(unsafe.events.slice(-2)).toEqual(["ROLLBACK", "close"]);

    const malformed = harness([]);
    await expect(
      malformed.repository.save({
        expectedRevision: "r1",
        checkpoint: checkpoint(),
      }),
    ).rejects.toThrow("expectedRevision is invalid");
    expect(malformed.sessionFactory).not.toHaveBeenCalled();
  });
});
