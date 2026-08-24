import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { DurableImportPreviewEvidenceSession } from "../lib/durable-import-preview-evidence-lifecycle";
import {
  createDurableImportPreviewStagingSink,
  type DurableImportPreviewStagingRepository,
  type DurablePreviewObjectTransaction,
  type DurablePreviewStagedRow,
} from "../lib/durable-import-preview-staging-sink";

const encoder = new TextEncoder();
const sha = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

function evidenceHarness() {
  const append = vi.fn(async () => undefined);
  const stored = [
    {
      registration: {
        ownerId: "owner-1",
        importBatchId: "11111111-1111-4111-8111-111111111111",
        sourceType: "current_arena" as const,
        objectKind: "staged_rows" as const,
        partitionNumber: 0,
        objectFormat: "ndjson_gzip" as const,
        objectKey:
          "evidence/owner/import/current_arena/staged_rows/part-0000.ndjson.gz",
        checksumSha256: "a".repeat(64),
        byteSize: 100,
        rowCount: 1,
        firstNaturalKey: "core-1",
        lastNaturalKey: "core-1",
        createdAt: "2026-08-23T10:00:00.000Z",
      },
      storageStatus: "created" as const,
    },
  ];
  const commitWithEvidenceReceiptsMock = vi.fn((_commit: unknown) => undefined);
  const commitWithEvidenceReceipts: DurableImportPreviewEvidenceSession["commitWithEvidenceReceipts"] =
    async <Committed>(commit): Promise<Committed> => {
      commitWithEvidenceReceiptsMock(commit);
      return commit(stored);
    };
  const abort = vi.fn(async () => undefined);
  const session: DurableImportPreviewEvidenceSession = {
    append,
    commitWithEvidenceReceipts,
    abort,
  };
  return {
    session,
    append,
    commitWithEvidenceReceipts: commitWithEvidenceReceiptsMock,
    abort,
  };
}

function harness(evidenceSession?: DurableImportPreviewEvidenceSession) {
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
    importBatchId: "11111111-1111-4111-8111-111111111111",
    stageSchema,
    stageRows,
    commitVerified,
    rollback,
  };
  const resumeObject = vi.fn(async () => null);
  const beginObject = vi.fn(async () => transaction);
  const finalizePreviewEvidence = vi.fn(async () => undefined);
  const assertPreviewObjects = vi.fn(async () => undefined);
  const abortPreview = vi.fn(async () => undefined);
  const repository: DurableImportPreviewStagingRepository = {
    resumeObject,
    beginObject,
    finalizePreviewEvidence,
    assertPreviewObjects,
    abortPreview,
  };
  const beginEvidence = vi.fn(() => {
    if (evidenceSession === undefined) {
      throw new Error("evidence session is unavailable");
    }
    return evidenceSession;
  });
  const sink = createDurableImportPreviewStagingSink({
    repository,
    ...(evidenceSession === undefined
      ? {}
      : { evidenceLifecycle: { beginObject: beginEvidence } }),
    rowsPerWrite: 1,
    maximumHeaderBytes: 2048,
  });
  return {
    sink,
    resumeObject,
    beginObject,
    beginEvidence,
    stageSchema,
    stageRows,
    commitVerified,
    rollback,
    finalizePreviewEvidence,
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
    expect(test.finalizePreviewEvidence).toHaveBeenCalledTimes(2);
    expect(test.finalizePreviewEvidence).toHaveBeenCalledWith({
      ownerId: "owner-1",
      importBatchIds: ["import-batch-1"],
    });
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

  it("rolls back the opened transaction when evidence initialization fails", async () => {
    const evidence = evidenceHarness();
    const test = harness(evidence.session);
    const initializationError = new Error("Evidence initialization failed");
    test.beginEvidence.mockImplementationOnce(() => {
      throw initializationError;
    });
    const csv = encoder.encode("token_id,price_usd\ncore-1,12.50\n");

    await expect(begin(test, "current_arena", csv)).rejects.toBe(
      initializationError,
    );
    expect(test.rollback).toHaveBeenCalledWith({ reason: "sink_failed" });
    expect(test.stageRows).not.toHaveBeenCalled();
  });

  it("mirrors staged rows and wraps commit with the evidence lifecycle", async () => {
    const evidence = evidenceHarness();
    const test = harness(evidence.session);
    const csv = encoder.encode("token_id,price_usd\ncore-1,12.50\n");
    const active = await begin(test, "current_arena", csv);
    await active.write(csv);

    await expect(
      active.commitVerified({
        byteLength: csv.byteLength,
        sha256: sha(csv),
        chunkCount: 1,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ importBatchId: "import-batch-1" }),
    );

    expect(test.beginEvidence).toHaveBeenCalledWith({
      ownerId: "owner-1",
      importBatchId: "11111111-1111-4111-8111-111111111111",
      sourceFamily: "current_arena",
    });
    expect(evidence.append).toHaveBeenCalledWith([
      expect.objectContaining({
        naturalKey: "core-1",
        row: expect.objectContaining({ status: "ready" }),
      }),
    ]);
    expect(evidence.commitWithEvidenceReceipts).toHaveBeenCalledOnce();
    expect(test.commitVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        evidenceRegistrations: [
          expect.objectContaining({
            importBatchId: "11111111-1111-4111-8111-111111111111",
            sourceType: "current_arena",
            objectKind: "staged_rows",
            partitionNumber: 0,
          }),
        ],
      }),
    );
    expect(evidence.abort).not.toHaveBeenCalled();
  });

  it("attempts evidence cleanup even when transaction rollback fails", async () => {
    const evidence = evidenceHarness();
    const test = harness(evidence.session);
    test.rollback.mockRejectedValueOnce(new Error("Neon rollback failed"));
    const csv = encoder.encode("token_id,price_usd\ncore-1,12.50\n");
    const active = await begin(test, "current_arena", csv);
    await active.write(csv);

    await expect(active.abort({ reason: "checksum_mismatch" })).rejects.toThrow(
      "Neon rollback failed",
    );
    expect(evidence.abort).toHaveBeenCalledOnce();
  });

  it("surfaces both rollback and evidence cleanup failures", async () => {
    const evidence = evidenceHarness();
    const test = harness(evidence.session);
    const rollbackError = new Error("Neon rollback failed");
    const cleanupError = new Error("R2 cleanup failed");
    test.rollback.mockRejectedValueOnce(rollbackError);
    evidence.abort.mockRejectedValueOnce(cleanupError);
    const csv = encoder.encode("token_id,price_usd\ncore-1,12.50\n");
    const active = await begin(test, "current_arena", csv);
    await active.write(csv);

    await expect(
      active.abort({ reason: "checksum_mismatch" }),
    ).rejects.toMatchObject({
      message: "Durable Preview staging and evidence abort both failed.",
      errors: [rollbackError, cleanupError],
    });
  });
});
