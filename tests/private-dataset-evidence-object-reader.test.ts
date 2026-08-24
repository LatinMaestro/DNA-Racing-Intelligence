import { describe, expect, it, vi } from "vitest";

import {
  createPrivateDatasetEvidenceObjectReader,
  type PrivateDatasetEvidenceObjectReadableStoragePort,
} from "@/lib/private-dataset-evidence-object-reader";
import type { DatasetEvidenceObjectRegistration } from "@/lib/neon-dataset-evidence-object-repository";

const ownerId = "owner-user";
const bucketName = "dna-private-preview";
const checksum =
  "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";
const objectKey =
  "evidence/8ba503205681bc9d82f41ec2b7e7347cce349284a36bc882c9e95fdcaf8151b1/11111111-1111-4111-8111-111111111111/race_merge/staged_rows/part-0000.ndjson.gz";

function registration(
  overrides: Partial<DatasetEvidenceObjectRegistration> = {},
): DatasetEvidenceObjectRegistration {
  return {
    ownerId,
    importBatchId: "11111111-1111-4111-8111-111111111111",
    sourceType: "race_merge",
    objectKind: "staged_rows",
    partitionNumber: 0,
    objectFormat: "ndjson_gzip",
    objectKey,
    checksumSha256: checksum,
    byteSize: 3,
    rowCount: 1,
    firstNaturalKey: "event:core",
    lastNaturalKey: "event:core",
    createdAt: "2026-08-25T00:00:00.000Z",
    ...overrides,
  };
}

async function* exactBody() {
  yield new Uint8Array([1, 2]);
  yield new Uint8Array([3]);
}

function harness(input?: {
  privacy?: Readonly<{
    publicAccessDisabled: boolean;
    r2DevDisabled: boolean;
    customDomainCount: number;
  }>;
}) {
  const readBucketPrivacy = vi.fn<
    PrivateDatasetEvidenceObjectReadableStoragePort["readBucketPrivacy"]
  >();
  readBucketPrivacy.mockResolvedValue(
    input?.privacy ?? {
      publicAccessDisabled: true,
      r2DevDisabled: true,
      customDomainCount: 0,
    },
  );
  const headObject = vi.fn<
    PrivateDatasetEvidenceObjectReadableStoragePort["headObject"]
  >();
  headObject.mockResolvedValue({
    status: "ready",
    contentType: "application/x-ndjson+gzip",
    byteLength: 3,
    checksumSha256: checksum,
    metadata: {
      rows: "1",
      source: "race_merge",
      kind: "staged_rows",
      partition: "0",
    },
  });
  const getObject = vi.fn<
    PrivateDatasetEvidenceObjectReadableStoragePort["getObject"]
  >();
  getObject.mockImplementation(async () => ({
    status: "ready",
    body: exactBody(),
  }));
  const port = { readBucketPrivacy, headObject, getObject };
  const createPort = vi.fn(() => port);
  const reader = createPrivateDatasetEvidenceObjectReader({
    ownerId,
    bucketName,
    maximumObjectBytes: 8 * 1024 * 1024,
    createPort,
  });
  return { reader, port, createPort };
}

describe("private dataset evidence object reader", () => {
  it("returns only body bytes that match the exact private manifest evidence", async () => {
    const test = harness();
    const expected = registration();
    await expect(test.reader.read(expected)).resolves.toEqual({
      registration: expected,
      body: new Uint8Array([1, 2, 3]),
    });
    expect(test.port.readBucketPrivacy).toHaveBeenCalledWith({ bucketName });
    expect(test.port.headObject).toHaveBeenCalledWith({
      bucketName,
      key: objectKey,
    });
    expect(test.port.getObject).toHaveBeenCalledWith({
      bucketName,
      key: objectKey,
    });

    await expect(test.reader.read(expected)).resolves.toMatchObject({
      registration: expected,
    });
    expect(test.createPort).toHaveBeenCalledTimes(1);
    expect(test.port.readBucketPrivacy).toHaveBeenCalledTimes(1);
  });

  it("rejects another owner or a key outside the exact manifest identity before provider access", async () => {
    const test = harness();
    await expect(
      test.reader.read(
        registration({
          ownerId: "other-owner",
          objectKey:
            "evidence/e79a507c208cde7c5a41bed2b66f845af7a6d4eacb9703441bf1721c729b1714/11111111-1111-4111-8111-111111111111/race_merge/staged_rows/part-0000.ndjson.gz",
        }),
      ),
    ).rejects.toThrow("read access denied");
    await expect(
      test.reader.read(registration({ objectKey: "private/arbitrary-object" })),
    ).rejects.toThrow("manifest identity");
    expect(test.createPort).not.toHaveBeenCalled();
  });

  it("blocks GET when HEAD metadata does not exactly match the registered evidence", async () => {
    const test = harness();
    test.port.headObject.mockResolvedValueOnce({
      status: "ready",
      contentType: "application/x-ndjson+gzip",
      byteLength: 3,
      checksumSha256: checksum,
      metadata: {
        rows: "2",
        source: "race_merge",
        kind: "staged_rows",
        partition: "0",
      },
    });
    await expect(test.reader.read(registration())).rejects.toThrow(
      "exact verification",
    );
    expect(test.port.getObject).not.toHaveBeenCalled();
  });

  it("fails closed when downloaded bytes are truncated, oversized or checksum-conflicting", async () => {
    const truncated = harness();
    truncated.port.getObject.mockResolvedValueOnce({
      status: "ready",
      body: (async function* () {
        yield new Uint8Array([1, 2]);
      })(),
    });
    await expect(truncated.reader.read(registration())).rejects.toThrow(
      "body length is invalid",
    );

    const oversized = harness();
    oversized.port.getObject.mockResolvedValueOnce({
      status: "ready",
      body: (async function* () {
        yield new Uint8Array([1, 2, 3, 4]);
      })(),
    });
    await expect(oversized.reader.read(registration())).rejects.toThrow(
      "body length is invalid",
    );

    const conflicting = harness();
    conflicting.port.getObject.mockResolvedValueOnce({
      status: "ready",
      body: (async function* () {
        yield new Uint8Array([1, 2, 4]);
      })(),
    });
    await expect(conflicting.reader.read(registration())).rejects.toThrow(
      "body checksum is invalid",
    );
  });

  it("requires a private bucket and a bounded registered object", async () => {
    const publicBucket = harness({
      privacy: {
        publicAccessDisabled: false,
        r2DevDisabled: true,
        customDomainCount: 0,
      },
    });
    await expect(publicBucket.reader.read(registration())).rejects.toThrow(
      "bucket is not private",
    );
    expect(publicBucket.port.headObject).not.toHaveBeenCalled();
    expect(publicBucket.port.getObject).not.toHaveBeenCalled();

    const bounded = createPrivateDatasetEvidenceObjectReader({
      ownerId,
      bucketName,
      maximumObjectBytes: 2,
      createPort: () => harness().port,
    });
    await expect(bounded.read(registration())).rejects.toThrow(
      "bounded read capacity",
    );
  });

  it("fails closed when verified evidence disappears between HEAD and GET", async () => {
    const test = harness();
    test.port.getObject.mockResolvedValueOnce({ status: "missing" });
    await expect(test.reader.read(registration())).rejects.toThrow(
      "became unavailable",
    );
  });
});
