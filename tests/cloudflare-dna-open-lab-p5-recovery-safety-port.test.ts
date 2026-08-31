import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createCloudflareDnaOpenLabP5RecoverySafetyPort,
  type CloudflareDnaOpenLabP5RecoveryDriver,
} from "@/lib/cloudflare-dna-open-lab-p5-recovery-safety-port";

const ownerId = "owner-user";
const ownerPrefix = `dna-open-lab/v1/${createHash("sha256")
  .update(`dna-open-lab-owner\u0000${ownerId}`)
  .digest("hex")}/`;

function driver() {
  let objects = [
    { key: `${ownerPrefix}evidence/retained.json`, etag: "retained", size: 10 },
    { key: `${ownerPrefix}p5-recovery/case-a.json`, etag: "case-a", size: 20 },
    { key: `${ownerPrefix}p5-recovery/case-b.json`, etag: "case-b", size: 30 },
  ];
  const deleted: string[] = [];
  const list = vi.fn<CloudflareDnaOpenLabP5RecoveryDriver["list"]>(
    async ({ prefix }) => ({
      objects: objects.filter((object) => object.key.startsWith(prefix)),
      truncated: false,
    }),
  );
  const deleteMany = vi.fn<CloudflareDnaOpenLabP5RecoveryDriver["deleteMany"]>(
    async ({ keys }) => {
      deleted.push(...keys);
      objects = objects.filter((object) => !keys.includes(object.key));
    },
  );
  return { port: { list, deleteMany }, list, deleteMany, deleted };
}

function configuration(test: ReturnType<typeof driver>) {
  return {
    ownerId,
    accountId: "a".repeat(32),
    accessKeyId: "access",
    secretAccessKey: "secret",
    bucketName: "private-preview",
    createDriver: () => test.port,
  };
}

describe("DNA Open Lab P5 Cloudflare R2 recovery safety port", () => {
  it("fingerprints retained objects separately and removes only bounded recovery residue", async () => {
    const test = driver();
    const port = createCloudflareDnaOpenLabP5RecoverySafetyPort(
      configuration(test),
    );

    const before = await port.inspect();
    expect(before.syntheticResidueObjectCount).toBe(2);
    expect(before.retainedEvidenceSha256).toMatch(/^[0-9a-f]{64}$/u);

    await port.cleanupSyntheticCase();
    expect(test.deleted).toEqual([
      `${ownerPrefix}p5-recovery/case-a.json`,
      `${ownerPrefix}p5-recovery/case-b.json`,
    ]);
    expect(test.deleted.some((key) => key.includes("evidence/retained"))).toBe(
      false,
    );
    const after = await port.inspect();
    expect(after.syntheticResidueObjectCount).toBe(0);
    expect(after.retainedEvidenceSha256).toBe(before.retainedEvidenceSha256);
  });

  it("rejects escaped objects and residue that remains after cleanup", async () => {
    const escaped = driver();
    escaped.list.mockResolvedValueOnce({
      objects: [{ key: "outside/object", etag: "etag", size: 1 }],
      truncated: false,
    });
    const escapedPort = createCloudflareDnaOpenLabP5RecoverySafetyPort(
      configuration(escaped),
    );
    await expect(escapedPort.inspect()).rejects.toThrow(
      "object escaped the requested prefix",
    );

    const residue = driver();
    residue.deleteMany.mockImplementationOnce(async () => undefined);
    const residuePort = createCloudflareDnaOpenLabP5RecoverySafetyPort(
      configuration(residue),
    );
    await expect(residuePort.cleanupSyntheticCase()).rejects.toThrow(
      "cleanup left residue",
    );
  });

  it("rejects repeated pagination cursors and duplicate object identities", async () => {
    const repeatedCursor = driver();
    repeatedCursor.list.mockResolvedValue({
      objects: [],
      truncated: true,
      cursor: "repeated",
    });
    const repeatedCursorPort = createCloudflareDnaOpenLabP5RecoverySafetyPort(
      configuration(repeatedCursor),
    );
    await expect(repeatedCursorPort.inspect()).rejects.toThrow(
      "provider response is invalid",
    );

    const duplicate = driver();
    const retained = {
      key: `${ownerPrefix}evidence/duplicate.json`,
      etag: "duplicate",
      size: 1,
    };
    duplicate.list.mockResolvedValueOnce({
      objects: [retained, retained],
      truncated: false,
    });
    const duplicatePort = createCloudflareDnaOpenLabP5RecoverySafetyPort(
      configuration(duplicate),
    );
    await expect(duplicatePort.inspect()).rejects.toThrow(
      "provider response is invalid",
    );
  });
});
