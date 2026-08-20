import { describe, expect, it, vi } from "vitest";

import type { DurablePreviewStagedRow } from "@/lib/durable-import-preview-staging-sink";
import {
  createNeonDurableImportPreviewStagingRepository,
  neonDurableImportPreviewStagingRepositoryFromEnvironment,
} from "@/lib/neon-durable-import-preview-staging-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "user_owner";
const dispatchId = "22222222-2222-4222-8222-222222222222";
const objectId = "33333333-3333-4333-8333-333333333333";
const sha256 = "a".repeat(64);
const runtimeRole = "dna_app_runtime";

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    authenticated_owner_id: ownerId,
    staging_rls: true,
    staging_force_rls: true,
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
  const query = vi.fn(async (statement: string, values?: readonly unknown[]) => {
    const normalized = statement.replace(/\s+/g, " ").trim();
    events.push(values ? `${normalized}|${JSON.stringify(values)}` : normalized);
    if (
      ["BEGIN ISOLATION LEVEL SERIALIZABLE", "COMMIT", "ROLLBACK"].includes(
        normalized,
      )
    )
      return { rows: [] };
    return { rows: rows[index++] ?? [] };
  });
  const client: NeonImportPersistenceClient = { query };
  const close = vi.fn(async () => events.push("close"));
  const sessionFactory = vi.fn(async () => ({ client, close }));
  return {
    events,
    query,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  };
}

function repository(test: ReturnType<typeof harness>) {
  return createNeonDurableImportPreviewStagingRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    runtimeRole,
    sessionFactory: test.sessionFactory,
  });
}

const schema = {
  status: "ready",
  sourceType: "core_details",
  schemaVersion: "core-details/v1",
  encoding: "utf_8",
  columns: [],
  issues: [],
} as const;

const rows = [
  {
    sourceRowNumber: 1,
    naturalKey: "core-1",
    fingerprintSha256: "b".repeat(64),
    row: {
      status: "ready",
      sourceType: "core_details",
      record: {
        sourceType: "core_details",
        sourceCoreId: "core-1",
        displayName: "Core One",
        coreClass: "Genesis",
        element: "Metal",
        fNumber: 1,
        sex: "male",
        colorSourceValue: null,
        fatherSourceCoreId: null,
        fatherNameSourceValue: null,
        motherSourceCoreId: null,
        motherNameSourceValue: null,
      },
      provenance: [],
      issues: [],
    },
  },
  {
    sourceRowNumber: 2,
    naturalKey: null,
    fingerprintSha256: null,
    row: {
      status: "quarantined",
      sourceType: "core_details",
      record: null,
      provenance: [],
      issues: [
        {
          code: "MISSING_REQUIRED_VALUE",
          severity: "error",
          canonicalColumn: "core_id",
        },
      ],
    },
  },
] as const satisfies readonly DurablePreviewStagedRow[];

describe("Neon durable Preview staging repository", () => {
  it("stays unconfigured without all server-only settings", () => {
    expect(
      neonDurableImportPreviewStagingRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole,
      }),
    ).toBeNull();
  });

  it("keeps schema, rows, and verified result in one transaction", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ import_batch_id: objectId }],
      [{ import_batch_id: objectId }],
      [],
      [],
      [],
      [],
      [{ import_batch_id: objectId }],
      [
        {
          import_batch_id: objectId,
          source_rows: "2",
          accepted_rows: "1",
          rejected_rows: "1",
          warning_rows: "1",
        },
      ],
    ]);
    const transaction = await repository(test).beginObject({
      ownerId,
      previewDispatchId: dispatchId,
      objectId,
      sourceFamily: "core_details",
      expectedByteLength: 1024,
      expectedSha256: sha256,
    });
    await transaction.stageSchema(schema);
    await transaction.stageRows(rows);
    await expect(
      transaction.commitVerified({
        byteLength: 1024,
        sha256,
        chunkCount: 2,
      }),
    ).resolves.toEqual({
      importBatchId: objectId,
      sourceRowCount: 2,
      readyRowCount: 1,
      quarantinedRowCount: 1,
      warningRowCount: 1,
      blockingIssueCount: 1,
    });
    expect(test.events[3]).toContain("import_preview_processing");
    expect(
      test.events.some((event) =>
        event.includes("normalized_core_staged_fact"),
      ),
    ).toBe(true);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("rejects changed object evidence before commit and rolls back explicitly", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ import_batch_id: objectId }],
      [{ import_batch_id: objectId }],
    ]);
    const transaction = await repository(test).beginObject({
      ownerId,
      previewDispatchId: dispatchId,
      objectId,
      sourceFamily: "core_details",
      expectedByteLength: 1024,
      expectedSha256: sha256,
    });
    await transaction.stageSchema(schema);
    await expect(
      transaction.commitVerified({
        byteLength: 1023,
        sha256,
        chunkCount: 1,
      }),
    ).rejects.toThrow("does not match reservation");
    await transaction.rollback({ reason: "checksum_mismatch" });
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });

  it("fails closed before object access for a privileged runtime identity", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation({ runtime_is_superuser: true })],
    ]);
    await expect(
      repository(test).beginObject({
        ownerId,
        previewDispatchId: dispatchId,
        objectId,
        sourceFamily: "core_details",
        expectedByteLength: 1024,
        expectedSha256: sha256,
      }),
    ).rejects.toThrow("not least privileged");
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });

  it("asserts the complete staged set and can delete only pre-activation batches", async () => {
    const assertion = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ matched_count: 1 }],
    ]);
    await expect(
      repository(assertion).assertPreviewObjects({
        ownerId,
        uploadBatchId: "44444444-4444-4444-8444-444444444444",
        previewDispatchId: dispatchId,
        uploadManifestFingerprintSha256: "c".repeat(64),
        objects: [
          {
            uploadFileId: objectId,
            objectId,
            sourceFamily: "core_details",
            byteLength: 1024,
            sha256,
            chunkCount: 2,
            stagedResult: {},
          },
        ],
      }),
    ).resolves.toBeUndefined();

    const abort = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [],
    ]);
    await repository(abort).abortPreview({
      ownerId,
      uploadBatchId: "44444444-4444-4444-8444-444444444444",
      previewDispatchId: dispatchId,
      reason: "preview_finalization_failed",
    });
    expect(abort.events[3]).toContain("DELETE FROM dna.import_batch");
    expect(abort.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });
});
