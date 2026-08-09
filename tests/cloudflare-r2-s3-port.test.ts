import { describe, expect, it, vi } from "vitest";

import {
  createCloudflareR2S3Port,
  type CloudflareR2S3Driver,
} from "../lib/cloudflare-r2-s3-port";
import { createCloudflareR2ImportObjectStorageForOwner } from "../lib/cloudflare-r2-import-object-storage";

const accountId = "a".repeat(32);
const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;

function driver(): CloudflareR2S3Driver {
  return {
    createPresignedPut: vi.fn(async () => "https://signed.example/upload"),
    headObject: vi.fn(async () => ({
      contentLength: 1024,
      contentType: "text/csv",
      etag: '"etag-1"',
      versionId: undefined,
      metadata: { sha256: "b".repeat(64) },
    })),
    getObject: vi.fn(async () => ({
      contentLength: 1024,
      contentType: "text/csv",
      etag: '"etag-1"',
      versionId: undefined,
      metadata: undefined,
      body: (async function* () {
        yield new Uint8Array([1, 2, 3]);
      })(),
    })),
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function port(input: {
  driver?: CloudflareR2S3Driver;
  fetch?: typeof globalThis.fetch;
}) {
  const created = input.driver ?? driver();
  const createDriver = vi.fn(() => created);
  const result = createCloudflareR2S3Port({
    accountId,
    accessKeyId: "access-key",
    secretAccessKey: "secret-key",
    apiToken: "privacy-read-token",
    now: () => new Date("2026-08-10T00:00:00.000Z"),
    fetch: input.fetch ?? vi.fn(),
    createDriver,
  });
  return { result, created, createDriver };
}

describe("Cloudflare R2 server-side S3 port", () => {
  it("rejects malformed credentials before constructing the S3 driver", () => {
    const createDriver = vi.fn(() => driver());
    expect(() =>
      createCloudflareR2S3Port({
        accountId: "invalid",
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
        apiToken: "privacy-read-token",
        createDriver,
      }),
    ).toThrow("accountId is invalid");
    expect(() =>
      createCloudflareR2S3Port({
        accountId,
        accessKeyId: "access-key",
        secretAccessKey: " ",
        apiToken: "privacy-read-token",
        createDriver,
      }),
    ).toThrow("secretAccessKey is invalid");
    expect(createDriver).not.toHaveBeenCalled();
  });

  it("verifies that managed and custom public access are both absent", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({ success: true, result: { enabled: false } }),
      )
      .mockResolvedValueOnce(json({ success: true, result: { domains: [] } }));
    const { result } = port({ fetch: fetcher });

    await expect(
      result.readBucketPrivacy({ bucketName: "dna-private-imports" }),
    ).resolves.toEqual({
      publicAccessDisabled: true,
      r2DevDisabled: true,
      customDomainCount: 0,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const call of fetcher.mock.calls) {
      expect(call[0]).toMatch(
        new RegExp(
          `^https://api\\.cloudflare\\.com/client/v4/accounts/${accountId}/r2/buckets/dna-private-imports/domains/(managed|custom)$`,
        ),
      );
      expect(call[1]).toMatchObject({
        method: "GET",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer privacy-read-token",
        },
      });
    }
  });

  it.each([
    [true, []],
    [false, [{ domain: "public.example", enabled: true }]],
    [false, [{ domain: "disabled.example", enabled: false }]],
  ])(
    "reports public or connected-domain drift without weakening the outer fail-closed gate",
    async (managedEnabled, domains) => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(
          json({ success: true, result: { enabled: managedEnabled } }),
        )
        .mockResolvedValueOnce(json({ success: true, result: { domains } }));
      const { result } = port({ fetch: fetcher });
      const privacy = await result.readBucketPrivacy({
        bucketName: "dna-private-imports",
      });
      expect(privacy.r2DevDisabled).toBe(!managedEnabled);
      expect(privacy.customDomainCount).toBe(domains.length);
      expect(privacy.publicAccessDisabled).toBe(
        !managedEnabled && !domains.some((domain) => domain.enabled),
      );
    },
  );

  it("fails closed on Cloudflare API and response-shape errors", async () => {
    for (const fetcher of [
      vi.fn(async () => json({ success: false, result: null })),
      vi.fn(async () => json({ success: true, result: null })),
      vi.fn(async () => json({}, 403)),
    ]) {
      const { result } = port({ fetch: fetcher });
      await expect(
        result.readBucketPrivacy({ bucketName: "dna-private-imports" }),
      ).rejects.toThrow(/privacy verification|response is invalid/);
    }
  });

  it("maps a bounded PUT request into a short-lived signed URL", async () => {
    const created = driver();
    const { result } = port({ driver: created });
    await expect(
      result.createPresignedPut({
        endpoint,
        bucketName: "dna-private-imports",
        key: "quarantine/owner/file.csv",
        contentType: "text/csv",
        byteLength: 2048,
        sha256: "b".repeat(64),
        expiresAt: "2026-08-10T00:15:00.000Z",
      }),
    ).resolves.toEqual({ url: "https://signed.example/upload" });
    expect(created.createPresignedPut).toHaveBeenCalledExactlyOnceWith({
      bucketName: "dna-private-imports",
      key: "quarantine/owner/file.csv",
      contentType: "text/csv",
      byteLength: 2048,
      expiresInSeconds: 900,
      signingDate: new Date("2026-08-10T00:00:00.000Z"),
    });
  });

  it("generates an R2-only PUT target accepted by the private storage boundary", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({ success: true, result: { enabled: false } }),
      )
      .mockResolvedValueOnce(json({ success: true, result: { domains: [] } }));
    const providerPort = createCloudflareR2S3Port({
      accountId,
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      apiToken: "privacy-read-token",
      now: () => new Date("2026-08-10T00:00:00.000Z"),
      fetch: fetcher,
    });
    const storage = createCloudflareR2ImportObjectStorageForOwner({
      ownerId: "owner-1",
      configuration: {
        accountId,
        bucketName: "dna-private-imports",
        createPort: () => providerPort,
      },
    });

    const target = await storage.createDirectUploadTarget({
      ownerId: "owner-1",
      uploadBatchId: "batch-1",
      uploadFileId: "file-1",
      byteLength: 2048,
      sha256: "b".repeat(64),
      contentType: "text/csv",
      expiresAt: "2026-08-10T00:15:00.000Z",
    });

    expect(target.method).toBe("PUT");
    const url = new URL(target.targetToken);
    expect(url.hostname).toBe(`${accountId}.r2.cloudflarestorage.com`);
    expect(decodeURIComponent(url.pathname)).toBe(
      "/dna-private-imports/quarantine/" +
        "1f53bc3d65e1c27289e40da5883588e03ea53a4ac28e023c581cb7c3bbd3400e/" +
        "file-1.csv",
    );
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual(
      expect.arrayContaining(["content-type", "host"]),
    );
  });

  it("rejects endpoint substitution and expired or excessive lifetimes", async () => {
    const { result, created } = port({});
    const base = {
      endpoint,
      bucketName: "dna-private-imports",
      key: "quarantine/owner/file.csv",
      contentType: "text/csv",
      byteLength: 2048,
      sha256: "b".repeat(64),
      expiresAt: "2026-08-10T00:15:00.000Z",
    };
    await expect(
      result.createPresignedPut({
        ...base,
        endpoint: "https://attacker.example",
      }),
    ).rejects.toThrow("endpoint is inconsistent");
    await expect(
      result.createPresignedPut({
        ...base,
        expiresAt: "2026-08-09T23:59:59.000Z",
      }),
    ).rejects.toThrow("lifetime is invalid");
    await expect(
      result.createPresignedPut({
        ...base,
        expiresAt: "2026-08-10T02:00:00.000Z",
      }),
    ).rejects.toThrow("lifetime is invalid");
    expect(created.createPresignedPut).not.toHaveBeenCalled();
  });

  it("maps object metadata, private streams, and missing objects", async () => {
    const created = driver();
    const { result } = port({ driver: created });
    await expect(
      result.headObject({
        bucketName: "dna-private-imports",
        key: "quarantine/owner/file.csv",
      }),
    ).resolves.toEqual({
      status: "ready",
      metadata: {
        byteLength: 1024,
        contentType: "text/csv",
        etag: '"etag-1"',
        version: null,
        sha256: "b".repeat(64),
      },
    });
    const object = await result.getObject({
      bucketName: "dna-private-imports",
      key: "quarantine/owner/file.csv",
    });
    expect(object.status).toBe("ready");
    if (object.status !== "ready") throw new Error("expected ready object");
    const chunks: Uint8Array[] = [];
    for await (const chunk of object.body) chunks.push(chunk);
    expect(chunks).toEqual([new Uint8Array([1, 2, 3])]);

    const missing = driver();
    vi.mocked(missing.headObject).mockRejectedValueOnce({
      name: "NotFound",
      $metadata: { httpStatusCode: 404 },
    });
    vi.mocked(missing.getObject).mockRejectedValueOnce({ name: "NoSuchKey" });
    const missingPort = port({ driver: missing }).result;
    await expect(
      missingPort.headObject({ bucketName: "bucket", key: "missing" }),
    ).resolves.toEqual({ status: "missing" });
    await expect(
      missingPort.getObject({ bucketName: "bucket", key: "missing" }),
    ).resolves.toEqual({ status: "missing" });
  });

  it("uses privacy-safe errors for unexpected provider failures", async () => {
    const created = driver();
    vi.mocked(created.headObject).mockRejectedValueOnce(
      new Error("private provider detail"),
    );
    vi.mocked(created.getObject).mockRejectedValueOnce(
      new Error("private provider detail"),
    );
    const { result } = port({ driver: created });
    await expect(
      result.headObject({ bucketName: "bucket", key: "file" }),
    ).rejects.toThrow("object inspection failed");
    await expect(
      result.getObject({ bucketName: "bucket", key: "file" }),
    ).rejects.toThrow("object read failed");
  });
});
