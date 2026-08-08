import { describe, expect, it, vi } from "vitest";

import {
  cloudflareR2ImportObjectStorageConfigurationFromEnvironment,
  createCloudflareR2ImportObjectStorageForOwner,
  type CloudflareR2ImportObjectStoragePort,
} from "../lib/cloudflare-r2-import-object-storage";

const ACCOUNT_ID = "a".repeat(32);
const BUCKET_NAME = "dna-private-imports";
const OWNER_ID = "owner-1";
const SHA = "b".repeat(64);
const EXPIRES_AT = "2026-07-26T02:00:00.000Z";

function signedUrl(input: {
  bucketName: string;
  key: string;
  signedAt?: string;
  expiresIn?: number;
}): string {
  const query = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": "synthetic-access/20260726/auto/s3/aws4_request",
    "X-Amz-Date": input.signedAt ?? "20260726T015500Z",
    "X-Amz-Expires": String(input.expiresIn ?? 300),
    "X-Amz-SignedHeaders": "content-type;host",
    "X-Amz-Signature": "c".repeat(64),
  });
  return `https://${ACCOUNT_ID}.r2.cloudflarestorage.com/${input.bucketName}/${input.key}?${query}`;
}

function readyPort() {
  const readBucketPrivacy = vi.fn(async () => ({
    publicAccessDisabled: true,
    r2DevDisabled: true,
    customDomainCount: 0,
  }));
  const createPresignedPut = vi.fn(
    async (input: {
      bucketName: string;
      key: string;
    }): Promise<{ url: string }> => ({ url: signedUrl(input) }),
  );
  const headObject = vi.fn(
    async (): Promise<
      Awaited<ReturnType<CloudflareR2ImportObjectStoragePort["headObject"]>>
    > => ({
      status: "ready",
      metadata: {
        byteLength: 1024,
        contentType: "text/csv; charset=utf-8",
        etag: '"etag-1"',
        version: null,
        sha256: null,
      },
    }),
  );
  const getObject = vi.fn(
    async (): Promise<
      Awaited<ReturnType<CloudflareR2ImportObjectStoragePort["getObject"]>>
    > => ({
      status: "ready",
      advertisedByteLength: 1024,
      body: (async function* () {
        yield new Uint8Array([1, 2]);
        yield new Uint8Array([3]);
      })(),
    }),
  );
  const port: CloudflareR2ImportObjectStoragePort = {
    readBucketPrivacy,
    createPresignedPut,
    headObject,
    getObject,
  };
  const createPort = vi.fn(async () => port);
  const storage = createCloudflareR2ImportObjectStorageForOwner({
    ownerId: OWNER_ID,
    configuration: {
      accountId: ACCOUNT_ID,
      bucketName: BUCKET_NAME,
      createPort,
    },
  });
  return {
    storage,
    createPort,
    readBucketPrivacy,
    createPresignedPut,
    headObject,
    getObject,
  };
}

const targetInput = {
  ownerId: OWNER_ID,
  uploadBatchId: "batch-1",
  uploadFileId: "file-1",
  byteLength: 1024,
  sha256: SHA,
  contentType: "text/csv",
  expiresAt: EXPIRES_AT,
} as const;

const inspectInput = {
  ownerId: OWNER_ID,
  uploadBatchId: "batch-1",
  uploadFileId: "file-1",
  objectId: "file-1",
} as const;

describe("Cloudflare R2 private import object storage", () => {
  it("initializes lazily and verifies private-bucket evidence once", async () => {
    const ready = readyPort();
    expect(ready.createPort).not.toHaveBeenCalled();

    await ready.storage.createDirectUploadTarget(targetInput);
    await ready.storage.inspectObject(inspectInput);

    expect(ready.createPort).toHaveBeenCalledOnce();
    expect(ready.readBucketPrivacy).toHaveBeenCalledOnce();
  });

  it("denies a different owner before provider initialization", async () => {
    const ready = readyPort();
    await expect(
      ready.storage.inspectObject({
        ownerId: "other-owner",
        uploadBatchId: "batch-1",
        uploadFileId: "file-1",
        objectId: "file-1",
      }),
    ).rejects.toThrow("access denied");
    expect(ready.createPort).not.toHaveBeenCalled();
  });

  it("rejects mismatched reserved object identity before provider access", async () => {
    const ready = readyPort();
    await expect(
      ready.storage.inspectObject({
        ...inspectInput,
        objectId: "different-object",
      }),
    ).rejects.toThrow("object identity is inconsistent");
    expect(ready.createPort).not.toHaveBeenCalled();
  });

  it("creates an opaque quarantine key and exact-account signed PUT", async () => {
    const ready = readyPort();
    const result = await ready.storage.createDirectUploadTarget(targetInput);

    expect(result.method).toBe("PUT");
    expect(result.targetToken).toContain(
      `${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    );
    expect(result.targetToken).not.toContain(OWNER_ID);
    expect(ready.createPresignedPut).toHaveBeenCalledWith({
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      bucketName: BUCKET_NAME,
      key: expect.stringMatching(/^quarantine\/[a-f0-9]{64}\/file-1\.csv$/),
      contentType: "text/csv",
      byteLength: 1024,
      sha256: SHA,
      expiresAt: EXPIRES_AT,
    });
  });

  it.each([
    {
      publicAccessDisabled: false,
      r2DevDisabled: true,
      customDomainCount: 0,
    },
    {
      publicAccessDisabled: true,
      r2DevDisabled: false,
      customDomainCount: 0,
    },
    {
      publicAccessDisabled: true,
      r2DevDisabled: true,
      customDomainCount: 1,
    },
  ])("blocks non-private bucket evidence %#", async (evidence) => {
    const ready = readyPort();
    ready.readBucketPrivacy.mockResolvedValueOnce(evidence);
    await expect(
      ready.storage.createDirectUploadTarget(targetInput),
    ).rejects.toThrow("private bucket verification failed");
    expect(ready.createPresignedPut).not.toHaveBeenCalled();
  });

  it.each([
    "http://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.r2.cloudflarestorage.com/dna-private-imports/quarantine/x/file-1.csv",
    "https://pub-example.r2.dev/dna-private-imports/quarantine/x/file-1.csv",
    "https://files.example.com/dna-private-imports/quarantine/x/file-1.csv",
  ])(
    "rejects a signed target outside the exact private endpoint",
    async (url) => {
      const ready = readyPort();
      ready.createPresignedPut.mockResolvedValueOnce({ url });
      await expect(
        ready.storage.createDirectUploadTarget(targetInput),
      ).rejects.toThrow();
    },
  );

  it("rejects a signature whose provider expiry outlives server approval", async () => {
    const ready = readyPort();
    ready.createPresignedPut.mockImplementationOnce(async (input) => ({
      url: signedUrl({
        bucketName: input.bucketName,
        key: input.key,
        signedAt: "20260726T015900Z",
        expiresIn: 300,
      }),
    }));
    await expect(
      ready.storage.createDirectUploadTarget(targetInput),
    ).rejects.toThrow("outside the private S3 endpoint");
  });

  it("rejects malformed signing-time evidence", async () => {
    const ready = readyPort();
    ready.createPresignedPut.mockImplementationOnce(async (input) => ({
      url: signedUrl({
        bucketName: input.bucketName,
        key: input.key,
        signedAt: "20260231T015500Z",
      }),
    }));
    await expect(
      ready.storage.createDirectUploadTarget(targetInput),
    ).rejects.toThrow("signing time is invalid");
  });

  it("normalizes HEAD metadata and leaves absent provider SHA for stream verification", async () => {
    const ready = readyPort();
    await expect(ready.storage.inspectObject(inspectInput)).resolves.toEqual({
      status: "ready",
      scope: "private_owner",
      ownerId: OWNER_ID,
      uploadBatchId: "batch-1",
      uploadFileId: "file-1",
      objectId: "file-1",
      objectVersion: "etag-1",
      advertisedByteLength: 1024,
      advertisedContentType: "text/csv",
      providerSha256: null,
    });
  });

  it("returns a bounded provider stream without buffering", async () => {
    const ready = readyPort();
    const opened = await ready.storage.openObject({
      ownerId: OWNER_ID,
      objectId: "file-1",
    });
    expect(opened.status).toBe("ready");
    if (opened.status !== "ready") throw new Error("object missing");
    const chunks: number[][] = [];
    for await (const chunk of opened.body) chunks.push([...chunk]);
    expect(chunks).toEqual([[1, 2], [3]]);
  });

  it("propagates missing HEAD and GET states without listing", async () => {
    const ready = readyPort();
    ready.headObject.mockResolvedValueOnce({ status: "missing" });
    ready.getObject.mockResolvedValueOnce({ status: "missing" });
    await expect(ready.storage.inspectObject(inspectInput)).resolves.toEqual({
      status: "missing",
    });
    await expect(
      ready.storage.openObject({
        ownerId: OWNER_ID,
        objectId: "file-1",
      }),
    ).resolves.toEqual({ status: "missing" });
  });

  it("stays unconfigured until both non-secret identifiers are present", () => {
    const createPort = vi.fn();
    expect(
      cloudflareR2ImportObjectStorageConfigurationFromEnvironment({
        accountId: undefined,
        bucketName: BUCKET_NAME,
        createPort,
      }),
    ).toBeNull();
    expect(
      cloudflareR2ImportObjectStorageConfigurationFromEnvironment({
        accountId: ACCOUNT_ID,
        bucketName: undefined,
        createPort,
      }),
    ).toBeNull();
    expect(createPort).not.toHaveBeenCalled();
  });
});
