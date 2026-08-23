import { describe, expect, it, vi } from "vitest";

import {
  createCloudflareR2DatasetEvidenceObjectPort,
  type CloudflareR2DatasetEvidenceObjectDriver,
} from "@/lib/cloudflare-r2-dataset-evidence-object-port";
import type { PrivateDatasetEvidenceObjectStoragePort } from "@/lib/private-dataset-evidence-object-writer";

const accountId = "a".repeat(32);

async function* bytes() {
  yield new Uint8Array([1, 2, 3]);
}

function harness() {
  const readBucketPrivacy = vi.fn(async () => ({
    publicAccessDisabled: true,
    r2DevDisabled: true,
    customDomainCount: 0,
  }));
  const putObjectIfAbsent =
    vi.fn<CloudflareR2DatasetEvidenceObjectDriver["putObjectIfAbsent"]>();
  putObjectIfAbsent.mockResolvedValue({ status: "created" });
  const headObject =
    vi.fn<CloudflareR2DatasetEvidenceObjectDriver["headObject"]>();
  headObject.mockResolvedValue({
    contentLength: 3,
    contentType: "application/vnd.apache.parquet",
    metadata: {
      sha256: "b".repeat(64),
      rows: "1",
      source: "race_merge",
      kind: "normalized_partition",
      partition: "0",
    },
  });
  const driver: CloudflareR2DatasetEvidenceObjectDriver = {
    putObjectIfAbsent,
    headObject,
  };
  const createDriver = vi.fn(() => driver);
  const privacyPort: Pick<
    PrivateDatasetEvidenceObjectStoragePort,
    "readBucketPrivacy"
  > = { readBucketPrivacy };
  const createPrivacyPort = vi.fn(() => privacyPort);
  const port = createCloudflareR2DatasetEvidenceObjectPort({
    accountId,
    accessKeyId: "synthetic-access-key",
    secretAccessKey: "synthetic-secret-key",
    apiToken: "synthetic-api-token",
    createDriver,
    createPrivacyPort,
  });
  return {
    port,
    createDriver,
    createPrivacyPort,
    readBucketPrivacy,
    putObjectIfAbsent,
    headObject,
  };
}

function putInput() {
  return {
    bucketName: "dna-racing-import-preview",
    key: "evidence/owner/batch/race_merge/normalized_partition/part-0000.parquet",
    body: bytes(),
    contentType: "application/vnd.apache.parquet",
    byteLength: 3,
    checksumSha256: "b".repeat(64),
    metadata: {
      rows: "1",
      source: "race_merge",
      kind: "normalized_partition",
      partition: "0",
    },
  };
}

describe("Cloudflare R2 dataset evidence object port", () => {
  it("uses the canonical account endpoint and existing private-bucket boundary", async () => {
    const test = harness();
    expect(test.createDriver).toHaveBeenCalledWith({
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      accessKeyId: "synthetic-access-key",
      secretAccessKey: "synthetic-secret-key",
    });
    expect(test.createPrivacyPort).toHaveBeenCalledOnce();
    await expect(
      test.port.readBucketPrivacy({ bucketName: "dna-racing-import-preview" }),
    ).resolves.toEqual({
      publicAccessDisabled: true,
      r2DevDisabled: true,
      customDomainCount: 0,
    });
  });

  it("passes the immutable object request through without buffering the body", async () => {
    const test = harness();
    const input = putInput();
    await expect(test.port.putObjectIfAbsent(input)).resolves.toEqual({
      status: "created",
    });
    expect(test.putObjectIfAbsent).toHaveBeenCalledWith(input);
    expect(test.putObjectIfAbsent.mock.calls[0]?.[0].body).toBe(input.body);
  });

  it("preserves the provider existing disposition for exact replay", async () => {
    const test = harness();
    test.putObjectIfAbsent.mockResolvedValueOnce({ status: "existing" });
    await expect(test.port.putObjectIfAbsent(putInput())).resolves.toEqual({
      status: "existing",
    });
  });

  it("maps exact HEAD evidence into the writer contract", async () => {
    const test = harness();
    await expect(
      test.port.headObject({
        bucketName: "dna-racing-import-preview",
        key: putInput().key,
      }),
    ).resolves.toEqual({
      status: "ready",
      contentType: "application/vnd.apache.parquet",
      byteLength: 3,
      checksumSha256: "b".repeat(64),
      metadata: {
        sha256: "b".repeat(64),
        rows: "1",
        source: "race_merge",
        kind: "normalized_partition",
        partition: "0",
      },
    });
  });

  it("maps a missing object but hides other provider errors", async () => {
    const missing = harness();
    missing.headObject.mockRejectedValueOnce({
      name: "NotFound",
      $metadata: { httpStatusCode: 404 },
    });
    await expect(
      missing.port.headObject({
        bucketName: "dna-racing-import-preview",
        key: putInput().key,
      }),
    ).resolves.toEqual({ status: "missing" });

    const failure = harness();
    failure.headObject.mockRejectedValueOnce(new Error("provider secret detail"));
    await expect(
      failure.port.headObject({
        bucketName: "dna-racing-import-preview",
        key: putInput().key,
      }),
    ).rejects.toThrow("evidence object inspection failed");
  });

  it("fails closed on malformed provider configuration", () => {
    for (const malformed of [
      { accountId: "wrong" },
      { accessKeyId: "" },
      { secretAccessKey: "bad\nsecret" },
      { apiToken: "" },
    ]) {
      expect(() =>
        createCloudflareR2DatasetEvidenceObjectPort({
          accountId,
          accessKeyId: "synthetic-access-key",
          secretAccessKey: "synthetic-secret-key",
          apiToken: "synthetic-api-token",
          createDriver: () => {
            throw new Error("provider must not initialize");
          },
          createPrivacyPort: () => {
            throw new Error("privacy port must not initialize");
          },
          ...malformed,
        }),
      ).toThrow();
    }
  });
});
