import { describe, expect, it, vi } from "vitest";

import { createNeonRaceArchiveCoreLocatorRepository } from "@/lib/neon-race-archive-core-locator-repository";
import type { RaceArchiveCoreLocator } from "@/lib/race-archive-core-locator-accumulator";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "user_owner";
const datasetVersionId = "22222222-2222-4222-8222-222222222222";
const importBatchId = "33333333-3333-4333-8333-333333333333";
const runtimeRole = "dna_app_runtime";
const builtAt = "2026-08-25T00:03:00.000Z";

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    locator_rls: true,
    locator_force_rls: true,
    receipt_rls: true,
    receipt_force_rls: true,
    runtime_can_read_locator_table: false,
    runtime_can_write_locator_table: false,
    runtime_can_read_receipt_table: false,
    runtime_can_write_receipt_table: false,
    runtime_can_replace: true,
    runtime_can_list: true,
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

function locator(
  sourceCoreId: string,
  overrides: Partial<RaceArchiveCoreLocator> = {},
): RaceArchiveCoreLocator {
  return {
    datasetVersionId,
    importBatchId,
    sourceCoreId,
    partitionNumbers: [0, 2],
    readyRowCount: 3,
    firstSourceRowNumber: 1,
    lastSourceRowNumber: 5,
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
        values ? normalized + "|" + JSON.stringify(values) : normalized,
      );
      if (
        [
          "BEGIN ISOLATION LEVEL SERIALIZABLE",
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
  const repository = createNeonRaceArchiveCoreLocatorRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    runtimeRole,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  });
  return { events, query, repository };
}

describe("Neon Race archive Core locator repository", () => {
  it("atomically seals a canonical bounded locator set behind least privilege", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          status: "sealed",
          core_locator_count: 2,
          ready_row_count: "5",
          partition_reference_count: "3",
          built_at: new Date(builtAt),
        },
      ],
    ]);

    const result = await test.repository.replace({
      ownerId,
      datasetVersionId,
      importBatchId,
      locators: [
        locator("core-b", {
          partitionNumbers: [1],
          readyRowCount: 2,
          firstSourceRowNumber: 2,
          lastSourceRowNumber: 4,
        }),
        locator("core-a"),
      ],
      builtAt,
    });

    expect(result).toMatchObject({
      status: "sealed",
      datasetVersionId,
      importBatchId,
      coreLocatorCount: 2,
      readyRowCount: 5,
      partitionReferenceCount: 3,
      builtAt,
    });
    expect(result.locatorSetSha256).toMatch(/^[a-f0-9]{64}$/);

    const replaceCall = test.query.mock.calls.find((call) =>
      String(call[0]).includes("FROM dna.replace_race_archive_core_locators("),
    );
    expect(replaceCall).toBeDefined();
    expect(replaceCall?.[1]?.slice(0, 4)).toEqual([
      databaseOwnerId,
      datasetVersionId,
      importBatchId,
      result.locatorSetSha256,
    ]);
    const payload = JSON.parse(String(replaceCall?.[1]?.[4])) as Array<{
      source_core_id: string;
      partition_numbers: number[];
    }>;
    expect(payload.map((item) => item.source_core_id)).toEqual([
      "core-a",
      "core-b",
    ]);
    expect(payload[0]?.partition_numbers).toEqual([0, 2]);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("returns only ordered bounded active-history locator rows", async () => {
    const secondDatasetVersionId = "44444444-4444-4444-8444-444444444444";
    const secondImportBatchId = "55555555-5555-4555-8555-555555555555";
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          dataset_version_id: datasetVersionId,
          import_batch_id: importBatchId,
          version_number: "1",
          partition_numbers: [0, 2],
          ready_row_count: "3",
          first_source_row_number: "1",
          last_source_row_number: "5",
          built_at: new Date(builtAt),
        },
        {
          dataset_version_id: secondDatasetVersionId,
          import_batch_id: secondImportBatchId,
          version_number: "2",
          partition_numbers: [1],
          ready_row_count: "1",
          first_source_row_number: "7",
          last_source_row_number: "7",
          built_at: "2026-08-25T00:05:00Z",
        },
      ],
    ]);

    await expect(
      test.repository.listForCore({
        ownerId,
        sourceCoreId: "core-a",
        maximumVersions: 2,
      }),
    ).resolves.toEqual([
      {
        datasetVersionId,
        importBatchId,
        sourceCoreId: "core-a",
        versionNumber: 1,
        partitionNumbers: [0, 2],
        readyRowCount: 3,
        firstSourceRowNumber: 1,
        lastSourceRowNumber: 5,
        builtAt,
      },
      {
        datasetVersionId: secondDatasetVersionId,
        importBatchId: secondImportBatchId,
        sourceCoreId: "core-a",
        versionNumber: 2,
        partitionNumbers: [1],
        readyRowCount: 1,
        firstSourceRowNumber: 7,
        lastSourceRowNumber: 7,
        builtAt: "2026-08-25T00:05:00.000Z",
      },
    ]);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("fails before database access for malformed, duplicate, or unsorted locator evidence", async () => {
    const malformed = harness([]);
    await expect(
      malformed.repository.replace({
        ownerId,
        datasetVersionId: "not-a-uuid",
        importBatchId,
        locators: [locator("core-a")],
        builtAt,
      }),
    ).rejects.toThrow("datasetVersionId must be a UUID");
    expect(malformed.query).not.toHaveBeenCalled();

    const duplicate = harness([]);
    await expect(
      duplicate.repository.replace({
        ownerId,
        datasetVersionId,
        importBatchId,
        locators: [locator("core-a"), locator("core-a")],
        builtAt,
      }),
    ).rejects.toThrow("duplicate Core IDs");
    expect(duplicate.query).not.toHaveBeenCalled();

    const unsorted = harness([]);
    await expect(
      unsorted.repository.replace({
        ownerId,
        datasetVersionId,
        importBatchId,
        locators: [locator("core-a", { partitionNumbers: [2, 1] })],
        builtAt,
      }),
    ).rejects.toThrow("strictly increasing");
    expect(unsorted.query).not.toHaveBeenCalled();
  });

  it("rolls back when RLS or runtime least-privilege evidence is unsafe", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation({ runtime_can_read_locator_table: true })],
    ]);

    await expect(
      test.repository.listForCore({
        ownerId,
        sourceCoreId: "core-a",
        maximumVersions: 10,
      }),
    ).rejects.toThrow("runtime privilege is not bounded");
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });

  it("fails closed when database coverage or ordering differs from the bounded request", async () => {
    const coverage = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          status: "sealed",
          core_locator_count: 1,
          ready_row_count: "99",
          partition_reference_count: "2",
          built_at: builtAt,
        },
      ],
    ]);
    await expect(
      coverage.repository.replace({
        ownerId,
        datasetVersionId,
        importBatchId,
        locators: [locator("core-a")],
        builtAt,
      }),
    ).rejects.toThrow("coverage changed");
    expect(coverage.events.slice(-2)).toEqual(["ROLLBACK", "close"]);

    const unordered = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          dataset_version_id: "44444444-4444-4444-8444-444444444444",
          import_batch_id: "55555555-5555-4555-8555-555555555555",
          version_number: "2",
          partition_numbers: [0],
          ready_row_count: "1",
          first_source_row_number: "1",
          last_source_row_number: "1",
          built_at: builtAt,
        },
        {
          dataset_version_id: datasetVersionId,
          import_batch_id: importBatchId,
          version_number: "1",
          partition_numbers: [0],
          ready_row_count: "1",
          first_source_row_number: "1",
          last_source_row_number: "1",
          built_at: builtAt,
        },
      ],
    ]);
    await expect(
      unordered.repository.listForCore({
        ownerId,
        sourceCoreId: "core-a",
        maximumVersions: 2,
      }),
    ).rejects.toThrow("versions are not ordered");
    expect(unordered.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });
});
