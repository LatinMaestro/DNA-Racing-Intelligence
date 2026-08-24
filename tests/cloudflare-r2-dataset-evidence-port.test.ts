import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import {
  createCloudflareR2DatasetEvidencePort,
  type CloudflareR2DatasetEvidenceDriver,
} from "@/lib/cloudflare-r2-dataset-evidence-port";

const accountId = "a".repeat(32);
const checksum = "b".repeat(64);
const checksumBase64 = Buffer.from(checksum, "hex").toString("base64");

async function* body() {
  yield new Uint8Array([1, 2]);
  yield new Uint8Array([3]);
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function harness(maximumBufferedPutBytes = 8 * 1024 * 1024) {
  const putObjectIfAbsent =
    vi.fn<CloudflareR2DatasetEvidenceDriver["putObjectIfAbsent"]>();
  putObjectIfAbsent.mockResolvedValue(undefined);
  const headObject = vi.fn<CloudflareR2DatasetEvidenceDriver["headObject"]>();
  headObject.mockResolvedValue({
    contentLength: 3,
    contentType: "application/vnd.apache.parquet",
    checksumSha256: checksumBase64,
    metadata: {
      rows: "1",
      source: "race_merge",
      kind: "normalized_partition",
      partition: "0",
    },
  });
  const getObject = vi.fn<CloudflareR2DatasetEvidenceDriver["getObject"]>();
  getObject.mockImplementation(async () => ({ body: body() }));
  const deleteObject =
    vi.fn<CloudflareR2DatasetEvidenceDriver["deleteObject"]>();
  deleteObject.mockResolvedValue(undefined);
  const driver = { putObjectIfAbsent, headObject, getObject, deleteObject };
  const createDriver = vi.fn(() => driver);
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(json({ success: true, result: { enabled: false } }))
    .mockResolvedValueOnce(json({ success: true, result: { domains: [] } }));
  const port = createCloudflareR2DatasetEvidencePort({
    accountId,
    accessKeyId: "access-key",
    secretAccessKey: "secret-key",
    apiToken: "privacy-read-token",
    maximumBufferedPutBytes,
    fetch: fetcher,
    createDriver,
  });
  return { port, driver, createDriver, fetcher };
}

function putInput() {
  return {
    bucketName: "dna-private-preview",
    key: "evidence/opaque/part-0000.parquet",
    body: body(),
    contentType: "application/vnd.apache.parquet",
    byteLength: 3,
    checksumSha256: checksum,
    metadata: {
      rows: "1",
      source: "race_merge",
      kind: "normalized_partition",
      partition: "0",
    },
  };
}

describe("Cloudflare R2 dataset evidence port", () => {
  it("maps a bounded create-only PUT with provider checksum validation", async () => {
    const test = harness();
    const input = putInput();
    await expect(test.port.putObjectIfAbsent(input)).resolves.toEqual({
      status: "created",
    });
    expect(test.driver.putObjectIfAbsent).toHaveBeenCalledWith({
      bucketName: input.bucketName,
      key: input.key,
      body: new Uint8Array([1, 2, 3]),
      contentType: input.contentType,
      byteLength: input.byteLength,
      checksumSha256Base64: checksumBase64,
      metadata: input.metadata,
    });
    expect(test.createDriver).toHaveBeenCalledWith({
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
    });
  });

  it("rejects evidence outside the Worker buffer bound or exact body length", async () => {
    const bounded = harness(2);
    await expect(bounded.port.putObjectIfAbsent(putInput())).rejects.toThrow(
      "bounded memory capacity",
    );
    expect(bounded.driver.putObjectIfAbsent).not.toHaveBeenCalled();

    const truncated = harness();
    await expect(
      truncated.port.putObjectIfAbsent({
        ...putInput(),
        body: (async function* () {
          yield new Uint8Array([1, 2]);
        })(),
      }),
    ).rejects.toThrow("body length is invalid");
    expect(truncated.driver.putObjectIfAbsent).not.toHaveBeenCalled();

    const oversized = harness();
    await expect(
      oversized.port.putObjectIfAbsent({
        ...putInput(),
        body: (async function* () {
          yield new Uint8Array([1, 2, 3, 4]);
        })(),
      }),
    ).rejects.toThrow("body length is invalid");
    expect(oversized.driver.putObjectIfAbsent).not.toHaveBeenCalled();
  });

  it("maps only a provider precondition failure to immutable replay", async () => {
    const test = harness();
    test.driver.putObjectIfAbsent.mockRejectedValueOnce({
      name: "PreconditionFailed",
      $metadata: { httpStatusCode: 412 },
    });
    await expect(test.port.putObjectIfAbsent(putInput())).resolves.toEqual({
      status: "existing",
    });
    test.driver.putObjectIfAbsent.mockRejectedValueOnce(
      new Error("private detail"),
    );
    await expect(test.port.putObjectIfAbsent(putInput())).rejects.toThrow(
      "evidence write failed",
    );
  });

  it("normalizes provider-validated HEAD evidence", async () => {
    const test = harness();
    await expect(
      test.port.headObject({
        bucketName: "dna-private-preview",
        key: "evidence/opaque/part-0000.parquet",
      }),
    ).resolves.toEqual({
      status: "ready",
      contentType: "application/vnd.apache.parquet",
      byteLength: 3,
      checksumSha256: checksum,
      metadata: {
        rows: "1",
        source: "race_merge",
        kind: "normalized_partition",
        partition: "0",
      },
    });
  });

  it("maps private object reads without buffering provider data", async () => {
    const test = harness();
    const input = {
      bucketName: "dna-private-preview",
      key: "evidence/opaque/part-0000.parquet",
    };
    const result = await test.port.getObject(input);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected ready object");
    const chunks: number[] = [];
    for await (const chunk of result.body) chunks.push(...chunk);
    expect(chunks).toEqual([1, 2, 3]);
    expect(test.driver.getObject).toHaveBeenCalledWith(input);

    test.driver.getObject.mockRejectedValueOnce({
      name: "NoSuchKey",
      $metadata: { httpStatusCode: 404 },
    });
    await expect(test.port.getObject(input)).resolves.toEqual({
      status: "missing",
    });

    test.driver.getObject.mockRejectedValueOnce(new Error("private detail"));
    await expect(test.port.getObject(input)).rejects.toThrow(
      "evidence read failed",
    );

    test.driver.getObject.mockResolvedValueOnce({
      body: (async function* () {
        yield new Uint8Array([1]);
        throw new Error("private stream detail");
      })(),
    });
    const streaming = await test.port.getObject(input);
    await expect(
      (async () => {
        if (streaming.status !== "ready") throw new Error("expected ready object");
        for await (const chunk of streaming.body) void chunk;
      })(),
    ).rejects.toThrow("evidence read failed");
  });

  it("returns missing and rejects absent or malformed checksum evidence", async () => {
    const test = harness();
    test.driver.headObject.mockRejectedValueOnce({
      name: "NotFound",
      $metadata: { httpStatusCode: 404 },
    });
    await expect(
      test.port.headObject({ bucketName: "bucket", key: "missing" }),
    ).resolves.toEqual({ status: "missing" });
    for (const checksumSha256 of [undefined, "not-base64", "YQ=="]) {
      test.driver.headObject.mockResolvedValueOnce({
        contentLength: 3,
        contentType: "application/vnd.apache.parquet",
        checksumSha256,
        metadata: {},
      });
      await expect(
        test.port.headObject({ bucketName: "bucket", key: "bad" }),
      ).rejects.toThrow("evidence checksum");
    }
  });

  it("reuses the existing exact private-bucket verifier", async () => {
    const test = harness();
    await expect(
      test.port.readBucketPrivacy({ bucketName: "dna-private-preview" }),
    ).resolves.toEqual({
      publicAccessDisabled: true,
      r2DevDisabled: true,
      customDomainCount: 0,
    });
    expect(test.fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects unsafe configuration before constructing a driver", () => {
    const createDriver = vi.fn(() => harness().driver);
    expect(() =>
      createCloudflareR2DatasetEvidencePort({
        accountId: "invalid",
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
        apiToken: "privacy-read-token",
        createDriver,
      }),
    ).toThrow("accountId is invalid");
    expect(() =>
      createCloudflareR2DatasetEvidencePort({
        accountId,
        accessKeyId: "access-key",
        secretAccessKey: " ",
        apiToken: "privacy-read-token",
        createDriver,
      }),
    ).toThrow("secretAccessKey is invalid");
    expect(() =>
      createCloudflareR2DatasetEvidencePort({
        accountId,
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
        apiToken: "privacy-read-token",
        maximumBufferedPutBytes: 0,
        createDriver,
      }),
    ).toThrow("maximumBufferedPutBytes is invalid");
    expect(createDriver).not.toHaveBeenCalled();
  });

  it("maps bounded deletion and idempotent missing evidence", async () => {
    const test = harness();
    const input = {
      bucketName: "dna-private-preview",
      key: "evidence/opaque/part-0000.parquet",
    };
    await expect(test.port.deleteObject(input)).resolves.toEqual({
      status: "deleted",
    });
    expect(test.driver.deleteObject).toHaveBeenCalledWith(input);

    test.driver.deleteObject.mockRejectedValueOnce({
      name: "NoSuchKey",
      $metadata: { httpStatusCode: 404 },
    });
    await expect(test.port.deleteObject(input)).resolves.toEqual({
      status: "missing",
    });

    test.driver.deleteObject.mockRejectedValueOnce(new Error("private detail"));
    await expect(test.port.deleteObject(input)).rejects.toThrow(
      "evidence deletion failed",
    );
  });
});
