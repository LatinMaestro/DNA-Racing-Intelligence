import { describe, expect, it, vi } from "vitest";

import {
  createCloudflareDnaOpenLabP5R2S3ListBinding,
  type CloudflareDnaOpenLabP5R2S3ListDriver,
} from "@/lib/cloudflare-dna-open-lab-p5-r2-s3-list-binding";

const accountId = "a".repeat(32);
const accessKeyId = "private-access-key";
const secretAccessKey = "private-secret-key";
const bucketName = "private-preview-bucket";

function fixture() {
  const list = vi.fn<CloudflareDnaOpenLabP5R2S3ListDriver["list"]>(
    async () => ({
      objects: [
        {
          key: "dna-open-lab/v1/owner/p5-capacity/marker.json",
          etag: '"etag-1"',
          size: 123,
        },
      ],
      truncated: true,
      cursor: "next-page",
    }),
  );
  const head = vi.fn<CloudflareDnaOpenLabP5R2S3ListDriver["head"]>(
    async () => ({
      contentType: "application/json",
      cacheControl: "private, no-store",
      metadata: { evidencekind: "synthetic-capacity" },
    }),
  );
  const createDriver = vi.fn(() => ({ list, head }));
  const binding = createCloudflareDnaOpenLabP5R2S3ListBinding({
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    createDriver,
  });
  return { binding, createDriver, list, head };
}

describe("Cloudflare DNA Open Lab P5 R2 S3 list binding", () => {
  it("lists one bounded private prefix page and enriches exact metadata", async () => {
    const test = fixture();

    await expect(
      test.binding.list({
        prefix: "dna-open-lab/v1/owner/",
        cursor: "current-page",
        limit: 20,
        include: ["httpMetadata", "customMetadata"],
      }),
    ).resolves.toEqual({
      objects: [
        {
          key: "dna-open-lab/v1/owner/p5-capacity/marker.json",
          version: 'etag:"etag-1"',
          etag: '"etag-1"',
          size: 123,
          httpMetadata: {
            contentType: "application/json",
            cacheControl: "private, no-store",
          },
          customMetadata: { evidencekind: "synthetic-capacity" },
        },
      ],
      truncated: true,
      cursor: "next-page",
    });
    expect(test.createDriver).toHaveBeenCalledExactlyOnceWith({
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      accessKeyId,
      secretAccessKey,
    });
    expect(test.list).toHaveBeenCalledExactlyOnceWith({
      bucketName,
      prefix: "dna-open-lab/v1/owner/",
      cursor: "current-page",
      limit: 20,
    });
    expect(test.head).toHaveBeenCalledExactlyOnceWith({
      bucketName,
      key: "dna-open-lab/v1/owner/p5-capacity/marker.json",
    });
  });

  it("fails closed on escaped keys, pagination drift and provider details", async () => {
    const escaped = fixture();
    escaped.list.mockResolvedValueOnce({
      objects: [{ key: "wrong/key", etag: "etag", size: 1 }],
      truncated: false,
    });
    await expect(
      escaped.binding.list({
        prefix: "dna-open-lab/v1/owner/",
        limit: 20,
        include: ["httpMetadata", "customMetadata"],
      }),
    ).rejects.toThrow("object escaped the requested prefix");
    expect(escaped.head).not.toHaveBeenCalled();

    const drift = fixture();
    drift.list.mockResolvedValueOnce({ objects: [], truncated: true });
    await expect(
      drift.binding.list({
        prefix: "dna-open-lab/v1/owner/",
        limit: 20,
        include: ["httpMetadata", "customMetadata"],
      }),
    ).rejects.toThrow("provider response is invalid");

    const failed = fixture();
    failed.list.mockRejectedValueOnce(new Error(secretAccessKey));
    await expect(
      failed.binding.list({
        prefix: "dna-open-lab/v1/owner/",
        limit: 20,
        include: ["httpMetadata", "customMetadata"],
      }),
    ).rejects.toThrow("provider listing failed");
  });
});
