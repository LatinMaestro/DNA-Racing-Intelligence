import { describe, expect, it, vi } from "vitest";

import {
  DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_CHECKPOINT_VERSION,
  type DnaPopulationEntrantAuthoritySuccessorCheckpointAuthority,
  type DnaPopulationEntrantAuthoritySuccessorCheckpointRepository,
} from "@/lib/dna-population-entrant-authority-successor-checkpoint";
import type { DnaPopulationEntrantAuthorityR2ChunkReceipt } from "@/lib/dna-population-entrant-authority-r2-store";
import { createNeonDnaPopulationEntrantAuthoritySuccessorCheckpointRepository } from "@/lib/neon-dna-population-entrant-authority-successor-checkpoint";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "91170000-0000-4000-8000-000000000001";
const ownerId = "synthetic_population_entrant_successor_checkpoint_owner";
const runtimeRole = "dna_app_runtime";
const baseGenerationId = "a".repeat(64);
const baseRecordSetSha256 = "b".repeat(64);
const successorGenerationId = "9".repeat(64);
const successorRecordSetSha256 = "c".repeat(64);
const replacementRaceSetSha256 = "d".repeat(64);
const replacementRecordSetSha256 = "e".repeat(64);

const authority: DnaPopulationEntrantAuthoritySuccessorCheckpointAuthority =
  Object.freeze({
    version: DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_CHECKPOINT_VERSION,
    baseGenerationId,
    baseRecordSetSha256,
    successorGenerationId,
    successorRecordSetSha256,
    unresolvedRaceCount: 3,
    unresolvedRaceSetSha256: baseGenerationId,
    replacementRaceCount: 2,
    replacementRaceSetSha256,
    replacementRecordSetSha256,
    quarantinedRaceCountBefore: 3,
    quarantinedRaceCountAfter: 1,
  });

const receipt: DnaPopulationEntrantAuthorityR2ChunkReceipt = Object.freeze({
  version: 1,
  generationId: successorGenerationId,
  chunkOrdinal: 1,
  objectKey:
    "dna-open-lab/v1/owner/population-entrant-authority/generations/" +
    successorGenerationId +
    "/chunks/000001-" +
    "b".repeat(64) +
    ".json",
  bodySha256: "b".repeat(64),
  byteLength: 512,
  rowCount: 2,
  firstSourceRaceId: "race-1",
  lastSourceRaceId: "race-2",
  raceSetSha256: "c".repeat(64),
  recordSetSha256: "d".repeat(64),
});

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    all_rls_enabled: true,
    all_force_rls_enabled: true,
    runtime_can_access_tables: false,
    runtime_can_begin: true,
    runtime_can_register: true,
    runtime_can_read: true,
    runtime_can_list_manifests: true,
    runtime_can_mutate_manifests: false,
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
    owner_id: databaseOwnerId,
    generation_id: successorGenerationId,
    version: 1,
    base_generation_id: baseGenerationId,
    base_record_set_sha256: baseRecordSetSha256,
    successor_record_set_sha256: successorRecordSetSha256,
    unresolved_race_count: "3",
    unresolved_race_set_sha256: baseGenerationId,
    replacement_race_count: "2",
    replacement_race_set_sha256: replacementRaceSetSha256,
    replacement_record_set_sha256: replacementRecordSetSha256,
    quarantined_race_count_before: "3",
    quarantined_race_count_after: "1",
    chunk_count: 1,
    persisted_race_count: "2",
    last_source_race_id: "race-2",
    started_at: new Date("2026-09-25T06:00:00.000Z"),
    updated_at: new Date("2026-09-25T06:01:00.000Z"),
    ...overrides,
  };
}

function manifestRow(overrides: Record<string, unknown> = {}) {
  return {
    chunk_ordinal: 1,
    object_key: receipt.objectKey,
    body_sha256: receipt.bodySha256,
    byte_length: receipt.byteLength,
    row_count: receipt.rowCount,
    first_source_race_id: receipt.firstSourceRaceId,
    last_source_race_id: receipt.lastSourceRaceId,
    race_set_sha256: receipt.raceSetSha256,
    record_set_sha256: receipt.recordSetSha256,
    registered_at: new Date("2026-09-25T06:01:00.000Z"),
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
        values ? normalized + "|" + JSON.stringify(values) : normalized,
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
  const repository: DnaPopulationEntrantAuthoritySuccessorCheckpointRepository =
    createNeonDnaPopulationEntrantAuthoritySuccessorCheckpointRepository({
      databaseUrl: "postgresql://private.example/dna",
      databaseOwnerId,
      ownerId,
      runtimeRole,
      sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
    });
  return { close, events, query, repository, sessionFactory };
}

describe("Neon DNA population entrant authority successor checkpoint", () => {
  it("begins exact authority inside a forced-owner serializable transaction", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        checkpointRow({
          chunk_count: 0,
          persisted_race_count: "0",
          last_source_race_id: null,
        }),
      ],
    ]);

    await expect(
      test.repository.begin(ownerId, {
        authority,
        startedAt: "2026-09-25T06:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      baseGenerationId,
      baseRecordSetSha256,
      successorGenerationId,
      successorRecordSetSha256,
      unresolvedRaceCount: 3,
      unresolvedRaceSetSha256: baseGenerationId,
      replacementRaceCount: 2,
      replacementRaceSetSha256,
      replacementRecordSetSha256,
      quarantinedRaceCountBefore: 3,
      quarantinedRaceCountAfter: 1,
      chunkCount: 0,
      persistedRaceCount: 0,
      lastSourceRaceId: null,
    });

    expect(test.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
    expect(
      test.events.some((event) =>
        event.includes(
          "dna.begin_dna_population_entrant_authority_successor_generation",
        ),
      ),
    ).toBe(true);
  });

  it("registers the exact R2 receipt in one serializable transaction", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [checkpointRow()],
    ]);

    await expect(
      test.repository.registerChunk(ownerId, {
        successorGenerationId,
        receipt,
        registeredAt: "2026-09-25T06:01:00.000Z",
      }),
    ).resolves.toMatchObject({
      chunkCount: 1,
      persistedRaceCount: 2,
      lastSourceRaceId: "race-2",
    });

    expect(test.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const registration = test.events.find((event) =>
      event.startsWith(
        "SELECT * FROM dna.register_dna_population_entrant_authority_successor_chunk",
      ),
    );
    expect(registration).toContain(receipt.objectKey);
    expect(registration).toContain(receipt.recordSetSha256);
  });

  it("reads the checkpoint in a repeatable-read read-only transaction", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [checkpointRow()],
    ]);

    await expect(
      test.repository.read(ownerId, { successorGenerationId }),
    ).resolves.toMatchObject({
      successorGenerationId,
      chunkCount: 1,
      persistedRaceCount: 2,
    });

    expect(test.events[0]).toBe(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
  });

  it("lists bounded typed immutable manifests in order supplied by the database function", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [manifestRow()],
    ]);

    await expect(
      test.repository.listChunkManifests(ownerId, {
        successorGenerationId,
        afterChunkOrdinal: 0,
        limit: 100,
      }),
    ).resolves.toEqual([
      {
        ...receipt,
        registeredAt: "2026-09-25T06:01:00.000Z",
      },
    ]);

    expect(test.events[0]).toBe(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
  });

  it("rejects owner mismatch before opening a database session", async () => {
    const test = harness([]);

    await expect(
      test.repository.read("another-owner", { successorGenerationId }),
    ).rejects.toThrow("owner access denied");
    expect(test.sessionFactory).not.toHaveBeenCalled();
  });

  it("fails closed if the runtime can directly access checkpoint tables", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation({ runtime_can_access_tables: true })],
    ]);

    await expect(
      test.repository.read(ownerId, { successorGenerationId }),
    ).rejects.toThrow("least-privilege owner isolation");
    expect(test.events).toContain("ROLLBACK");
    expect(test.events.at(-1)).toBe("close");
  });

  it("fails closed if the runtime can execute the immutable-manifest trigger function", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation({ runtime_can_mutate_manifests: true })],
    ]);

    await expect(
      test.repository.read(ownerId, { successorGenerationId }),
    ).rejects.toThrow("least-privilege owner isolation");
    expect(test.events).toContain("ROLLBACK");
  });

  it("rejects checkpoint authority drift and rolls back", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [checkpointRow({ base_generation_id: "f".repeat(64) })],
    ]);

    await expect(
      test.repository.read(ownerId, { successorGenerationId }),
    ).rejects.toThrow("successor checkpoint authority drifted");
    expect(test.events).toContain("ROLLBACK");
    expect(test.events.at(-1)).toBe("close");
  });

  it("rejects a checkpoint row from a different requested generation", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        checkpointRow({
          generation_id: "b".repeat(64),
        }),
      ],
    ]);

    await expect(
      test.repository.read(ownerId, { successorGenerationId }),
    ).rejects.toThrow("successor checkpoint authority drifted");
    expect(test.events).toContain("ROLLBACK");
  });

  it("rejects a begin result that drifts from the requested audited count", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        checkpointRow({
          unresolved_race_count: "4",
          chunk_count: 0,
          persisted_race_count: "0",
          last_source_race_id: null,
        }),
      ],
    ]);

    await expect(
      test.repository.begin(ownerId, {
        authority,
        startedAt: "2026-09-25T06:00:00.000Z",
      }),
    ).rejects.toThrow("successor checkpoint authority drifted");
    expect(test.events).toContain("ROLLBACK");
  });

  it("rejects structurally inconsistent checkpoint counters", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        checkpointRow({
          chunk_count: 0,
          persisted_race_count: "2",
          last_source_race_id: null,
        }),
      ],
    ]);

    await expect(
      test.repository.read(ownerId, { successorGenerationId }),
    ).rejects.toThrow("successor checkpoint authority drifted");
  });

  it("rejects a successor row with inconsistent replacement lineage", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [checkpointRow({ quarantined_race_count_after: "2" })],
    ]);

    await expect(
      test.repository.read(ownerId, { successorGenerationId }),
    ).rejects.toThrow("successor checkpoint authority drifted");
    expect(test.events).toContain("ROLLBACK");
  });

  it("rejects a receipt bound to a different generation before persistence", async () => {
    const test = harness([]);

    await expect(
      test.repository.registerChunk(ownerId, {
        successorGenerationId,
        receipt: {
          ...receipt,
          generationId: "b".repeat(64),
        },
        registeredAt: "2026-09-25T06:01:00.000Z",
      }),
    ).rejects.toThrow("chunk generation does not match");
    expect(test.sessionFactory).not.toHaveBeenCalled();
  });

  it("rejects malformed manifest rows returned by the database", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [manifestRow({ body_sha256: "not-a-sha" })],
    ]);

    await expect(
      test.repository.listChunkManifests(ownerId, {
        successorGenerationId,
        afterChunkOrdinal: 0,
        limit: 100,
      }),
    ).rejects.toThrow("bodySha256 is invalid");
    expect(test.events).toContain("ROLLBACK");
  });

  it("rejects manifest pagination outside the database contract before access", async () => {
    const test = harness([]);

    await expect(
      test.repository.listChunkManifests(ownerId, {
        successorGenerationId,
        afterChunkOrdinal: 0,
        limit: 101,
      }),
    ).rejects.toThrow("manifest read bounds are invalid");
    expect(test.sessionFactory).not.toHaveBeenCalled();
  });

  it("rejects mismatched authority before opening a database session", async () => {
    const test = harness([]);

    await expect(
      test.repository.begin(ownerId, {
        authority: {
          ...authority,
          quarantinedRaceCountAfter: 2,
        },
        startedAt: "2026-09-25T06:00:00.000Z",
      }),
    ).rejects.toThrow("successor checkpoint authority is invalid");
    expect(test.sessionFactory).not.toHaveBeenCalled();
  });
});
