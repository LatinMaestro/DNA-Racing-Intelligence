import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  createDurableImportPreviewStagingSink,
  type DurableImportPreviewStagingRepository,
  type DurablePreviewObjectTransaction,
  type DurablePreviewStagedRow,
} from "../lib/durable-import-preview-staging-sink";

const encoder = new TextEncoder();
const sha = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

function harness() {
  const stageSchema = vi.fn(async () => undefined);
  const stageRows = vi.fn(async (rows: readonly DurablePreviewStagedRow[]) => {
    void rows;
  });
  const commitVerified = vi.fn(async () => ({
    importBatchId: "import-batch-1",
    sourceRowCount: 2,
    readyRowCount: 1,
    quarantinedRowCount: 1,
    warningRowCount: 1,
    blockingIssueCount: 1,
  }));
  const rollback = vi.fn(async () => undefined);
  const transaction: DurablePreviewObjectTransaction = {
    stageSchema,
    stageRows,
    commitVerified,
    rollback,
  };
  const beginObject = vi.fn(async () => transaction);
  const assertPreviewObjects = vi.fn(async () => undefined);
  const abortPreview = vi.fn(async () => undefined);
  const repository: DurableImportPreviewStagingRepository = {
    beginObject,
    assertPreviewObjects,
    abortPreview,
  };
  const sink = createDurableImportPreviewStagingSink({
    repository,
    rowsPerWrite: 1,
    maximumHeaderBytes: 2048,
  });
  return {
    sink,
    beginObject,
    stageSchema,
    stageRows,
    commitVerified,
    rollback,
    assertPreviewObjects,
    abortPreview,
  };
}

async function begin(
  test: ReturnType<typeof harness>,
  sourceFamily: "race_merge" | "core_details" | "current_arena",
  bytes: Uint8Array,
) {
  return test.sink.beginObject({
    ownerId: "owner-1",
    updateSessionId: "dispatch-1",
    objectId: "object-1",
    sourceFamily,
    expectedByteLength: bytes.byteLength,
    expectedSha256: sha(bytes),
  });
}

describe("durable import Preview staging sink", () => {
  it("streams quoted CSV rows through schema detection and bounded durable writes", async () => {
    const test = harness();
    const csv = encoder.encode(
      'token_id,price_usd\r\ncore-1,12.50\r\n"core,2",invalid\r\n',
    );
    const active = await begin(test, "current_arena", csv);
    await active.write(csv.slice(0, 18));
    await active.write(csv.slice(18, 39));
    await active.write(csv.slice(39));
    await expect(
      active.commitVerified({
        byteLength: csv.byteLength,
        sha256: sha(csv),
        chunkCount: 3,
      }),
    ).resolves.toEqual(expect.objectContaining({ sourceRowCount: 2 }));

    expect(test.stageSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ready",
        sourceType: "current_arena",
        schemaVersion: "current-arena/v1",
      }),
    );
    expect(test.stageRows).toHaveBeenCalledTimes(2);
    expect(test.stageRows.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        sourceRowNumber: 1,
        naturalKey: "core-1",
        fingerprintSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        row: expect.objectContaining({ status: "ready" }),
      }),
    ]);
    expect(test.stageRows.mock.calls[1]?.[0]).toEqual([
      expect.objectContaining({
        sourceRowNumber: 2,
        naturalKey: null,
        fingerprintSha256: null,
        row: expect.objectContaining({ status: "quarantined" }),
      }),
    ]);
  });

  it("preserves embedded newlines and escaped quotes without buffering the object", async () => {
    const test = harness();
    const csv = encoder.encode(
      'token_id,price_usd\n\"core\n\"\"two\"\"\",12.50\n',
    );
    const active = await begin(test, "current_arena", csv);
    for (const byte of csv) await active.write(Uint8Array.of(byte));
    await active.commitVerified({
      byteLength: csv.byteLength,
      sha256: sha(csv),
      chunkCount: csv.byteLength,
    });
    expect(test.stageRows).toHaveBeenCalledWith([
      expect.objectContaining({
        naturalKey: 'core\n"two"',
        row: expect.objectContaining({ status: "ready" }),
      }),
    ]);
  });

  it("rolls back the durable object transaction on integrity abort", async () => {
    const test = harness();
    const csv = encoder.encode("token_id,price_usd\ncore-1,12.50\n");
    const active = await begin(test, "current_arena", csv);
    await active.write(csv);
    await active.abort({ reason: "checksum_mismatch" });
    expect(test.rollback).toHaveBeenCalledWith({ reason: "checksum_mismatch" });
    expect(test.commitVerified).not.toHaveBeenCalled();
  });

  it("fails closed for retired Current Vault input and malformed schemas", async () => {
    const test = harness();
    const csv = encoder.encode("name,value\nSynthetic,1\n");
    await expect(
      test.sink.beginObject({
        ownerId: "owner-1",
        updateSessionId: "dispatch-1",
        objectId: "object-1",
        sourceFamily: "current_vault",
        expectedByteLength: csv.byteLength,
        expectedSha256: sha(csv),
      }),
    ).rejects.toThrow("not imported");

    const active = await begin(test, "current_arena", csv);
    await expect(active.write(csv)).rejects.toThrow("schema is not ready");
  });

  it("derives a stable non-confirmable Preview summary from durable results", async () => {
    const test = harness();
    const stagedResult = await test.sink.beginObject({
      ownerId: "owner-1",
      updateSessionId: "dispatch-1",
      objectId: "object-1",
      sourceFamily: "current_arena",
      expectedByteLength: 1,
      expectedSha256: "a".repeat(64),
    });
    expect(stagedResult).toBeDefined();
    const objects = [
      {
        uploadFileId: "file-1",
        objectId: "object-1",
        sourceFamily: "current_arena" as const,
        byteLength: 100,
        sha256: "a".repeat(64),
        chunkCount: 2,
        stagedResult: {
          importBatchId: "import-batch-1",
          sourceRowCount: 2,
          readyRowCount: 1,
          quarantinedRowCount: 1,
          warningRowCount: 1,
          blockingIssueCount: 1,
        },
      },
    ];
    const input = {
      ownerId: "owner-1",
      uploadBatchId: "upload-batch-1",
      previewDispatchId: "dispatch-1",
      uploadRequestFingerprint: "b".repeat(64),
      uploadManifestFingerprintSha256: "c".repeat(64),
      objects,
    };
    const first = await test.sink.completePreview(input);
    const second = await test.sink.completePreview(input);
    expect(first).toEqual(second);
    expect(first).toEqual(
      expect.objectContaining({
        fileCount: 1,
        sourceFamilyCount: 1,
        blockingIssueCount: 1,
        confirmable: false,
        previewFingerprintSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(test.assertPreviewObjects).toHaveBeenCalledTimes(2);
  });

  it("delegates whole-Preview cleanup to the durable repository", async () => {
    const test = harness();
    await test.sink.abortPreview({
      ownerId: "owner-1",
      uploadBatchId: "upload-batch-1",
      previewDispatchId: "dispatch-1",
      reason: "preview_finalization_failed",
    });
    expect(test.abortPreview).toHaveBeenCalledWith({
      ownerId: "owner-1",
      uploadBatchId: "upload-batch-1",
      previewDispatchId: "dispatch-1",
      reason: "preview_finalization_failed",
    });
  });
});
