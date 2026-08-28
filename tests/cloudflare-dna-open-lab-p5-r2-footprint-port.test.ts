import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createCloudflareDnaOpenLabP5R2FootprintPort,
  type DnaOpenLabP5R2ListBinding,
} from "@/lib/cloudflare-dna-open-lab-p5-r2-footprint-port";

const ownerId = "owner-1";
const bucketName = "dna-private-preview";
const prefix = `dna-open-lab/v1/${createHash("sha256")
  .update(`dna-open-lab-owner\u0000${ownerId}`, "utf8")
  .digest("hex")}/`;

function fixture(
  result: Awaited<ReturnType<DnaOpenLabP5R2ListBinding["list"]>> = {
    objects: [
      {
        key: `${prefix}current-state/cycles/cycle-1/request.json`,
        version: "version-1",
        etag: "etag-1",
        size: 1024,
        httpMetadata: { contentType: "application/json" },
        customMetadata: { checksum: "a".repeat(64), family: "vault" },
      },
    ],
    truncated: true,
    cursor: "page-2",
  },
) {
  const list = vi.fn(async () => result);
  const readBucketPrivacy = vi.fn(async () => ({
    publicAccessDisabled: true,
    r2DevDisabled: true,
    customDomainCount: 0,
  }));
  const port = createCloudflareDnaOpenLabP5R2FootprintPort({
    ownerId,
    bucketName,
    bucket: { list },
    readBucketPrivacy,
  });
  return { port, list, readBucketPrivacy };
}

describe("DNA Open Lab P5 Cloudflare R2 footprint port", () => {
  it("lists only the hashed owner prefix and returns redacted identities and bytes", async () => {
    const { port, list } = fixture();

    await expect(
      port.listRetainedObjects({ cursor: null, limit: 100 }),
    ).resolves.toEqual({
      objects: [
        {
          objectIdentitySha256: createHash("sha256")
            .update(
              `dna-open-lab-p5-r2-object\u0000${prefix}current-state/cycles/cycle-1/request.json\u0000version-1\u0000etag-1`,
              "utf8",
            )
            .digest("hex"),
          payloadBytes: 1024,
          metadataBytes:
            Buffer.byteLength("contentTypeapplication/json", "utf8") +
            Buffer.byteLength(`checksum${"a".repeat(64)}familyvault`, "utf8"),
        },
      ],
      nextCursor: "page-2",
    });
    expect(list).toHaveBeenCalledExactlyOnceWith({
      prefix,
      limit: 100,
      include: ["httpMetadata", "customMetadata"],
    });
    expect(
      JSON.stringify(
        await port.listRetainedObjects({ cursor: "page-2", limit: 100 }),
      ),
    ).not.toContain("request.json");
    expect(list).toHaveBeenLastCalledWith({
      prefix,
      cursor: "page-2",
      limit: 100,
      include: ["httpMetadata", "customMetadata"],
    });
  });

  it("delegates private-bucket evidence without weakening the runner gate", async () => {
    const { port, readBucketPrivacy } = fixture();
    await expect(port.readBucketPrivacy()).resolves.toEqual({
      publicAccessDisabled: true,
      r2DevDisabled: true,
      customDomainCount: 0,
    });
    expect(readBucketPrivacy).toHaveBeenCalledExactlyOnceWith({ bucketName });
  });

  it("sanitizes private-bucket verification failures", async () => {
    const port = createCloudflareDnaOpenLabP5R2FootprintPort({
      ownerId,
      bucketName,
      bucket: { list: vi.fn() },
      readBucketPrivacy: async () => {
        throw new Error("private account detail");
      },
    });
    await expect(port.readBucketPrivacy()).rejects.not.toThrow(
      /private account detail/u,
    );
  });

  it("rejects objects outside the exact owner prefix", async () => {
    const { port } = fixture({
      objects: [
        {
          key: "dna-open-lab/v1/another-owner/evidence.json",
          version: "version-1",
          etag: "etag-1",
          size: 1,
        },
      ],
      truncated: false,
    });
    await expect(
      port.listRetainedObjects({ cursor: null, limit: 100 }),
    ).rejects.toThrow("escaped the owner prefix");
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid provider object size %j",
    async (size) => {
      const { port } = fixture({
        objects: [
          {
            key: `${prefix}evidence.json`,
            version: "version-1",
            etag: "etag-1",
            size,
          },
        ],
        truncated: false,
      });
      await expect(
        port.listRetainedObjects({ cursor: null, limit: 100 }),
      ).rejects.toThrow("object size is invalid");
    },
  );

  it("rejects invalid application metadata without emitting its value", async () => {
    const { port } = fixture({
      objects: [
        {
          key: `${prefix}evidence.json`,
          version: "version-1",
          etag: "etag-1",
          size: 1,
          httpMetadata: { cacheExpiry: new Date(Number.NaN) },
        },
      ],
      truncated: false,
    });
    await expect(
      port.listRetainedObjects({ cursor: null, limit: 100 }),
    ).rejects.toThrow("object metadata is invalid");
  });

  it("rejects malformed pagination and sanitizes binding failures", async () => {
    const completeWithCursor = fixture({
      objects: [],
      truncated: false,
      cursor: "extra",
    });
    await expect(
      completeWithCursor.port.listRetainedObjects({ cursor: null, limit: 100 }),
    ).rejects.toThrow("cursor for a complete page");

    const list = vi.fn(async () => {
      throw new Error("private object key");
    });
    const port = createCloudflareDnaOpenLabP5R2FootprintPort({
      ownerId,
      bucketName,
      bucket: { list },
      readBucketPrivacy: async () => ({
        publicAccessDisabled: true,
        r2DevDisabled: true,
        customDomainCount: 0,
      }),
    });
    await expect(
      port.listRetainedObjects({ cursor: null, limit: 100 }),
    ).rejects.not.toThrow(/private object key/u);
  });

  it.each([0, 1001, 1.5])(
    "rejects an unsafe page limit %j before provider access",
    async (limit) => {
      const { port, list } = fixture();
      await expect(
        port.listRetainedObjects({ cursor: null, limit }),
      ).rejects.toThrow("page limit is invalid");
      expect(list).not.toHaveBeenCalled();
    },
  );
});
