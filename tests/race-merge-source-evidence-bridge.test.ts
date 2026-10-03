import { createCipheriv, createHash, randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createRaceMergeSourceEvidenceUploadTarget } from "@/lib/race-merge-source-evidence-bridge";
import type { ImportUploadIntakeCapabilities } from "@/lib/import-upload-intake-service";

const OWNER = "owner-1";
const HEAD = "a".repeat(40);
const NONCE = "b".repeat(64);
const DOMAIN = "dna-race-merge-source-evidence-bridge/v1";

function encrypt(payload: unknown, nonce = NONCE): string {
  const iv = randomBytes(12);
  const key = createHash("sha256")
    .update(`${DOMAIN}\u0000${nonce}`)
    .digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString(
    "base64url",
  );
}

function capabilities(): ImportUploadIntakeCapabilities {
  return {
    status: "ready",
    repository: {
      reserveUploadBatch: vi.fn(async (input) => ({
        disposition: "created" as const,
        uploadBatchId: "upload-batch-1",
        requestFingerprint: input.requestFingerprint,
        files: [
          {
            clientFileId: input.files[0]!.clientFileId,
            uploadFileId: "upload-file-1",
          },
        ],
      })),
      markUploadTargetsReady: vi.fn(async () => undefined),
      markUploadReservationFailed: vi.fn(async () => undefined),
    },
    capacityGate: {
      assertWithinApprovedCapacity: vi.fn(async () => undefined),
    },
    privateObjectStore: {
      createDirectUploadTarget: vi.fn(async () => ({
        method: "PUT" as const,
        targetToken:
          "https://private.invalid/upload?X-Amz-Signature=" + "c".repeat(64),
      })),
    },
  };
}

describe("Race Merge source evidence bridge", () => {
  it(
    "decrypts exact-head metadata and returns one private upload target",
    async () => {
    const ready = capabilities();
    const result = await createRaceMergeSourceEvidenceUploadTarget({
      encryptedPayload: encrypt({
        head: HEAD,
        ordinal: 3,
        byteLength: 74_000_000,
        sha256: "d".repeat(64),
      }),
      bridgeNonce: NONCE,
      exactDeploymentSha: HEAD,
      ownerId: OWNER,
      now: new Date("2026-10-04T00:00:00.000Z"),
      capabilities: ready,
    });

    expect(result).toMatchObject({
      status: "ready",
      objectId: "upload-file-1",
      targetToken: expect.stringContaining("X-Amz-Signature="),
      expiresAt: "2026-10-04T00:15:00.000Z",
    });
    if (ready.status !== "ready") throw new Error("expected ready");
      expect(
        ready.capacityGate.assertWithinApprovedCapacity,
      ).toHaveBeenCalledWith({
        ownerId: OWNER,
        fileCount: 1,
        totalByteLength: 74_000_000,
        sourceFamilies: ["race_merge"],
      });
      expect(ready.repository.reserveUploadBatch).toHaveBeenCalledWith(
        expect.objectContaining({
        ownerId: OWNER,
        idempotencyKey: expect.stringMatching(
          /^race-merge-outcome-source-v1-03-[a-f0-9]{32}$/u,
        ),
        files: [
          expect.objectContaining({
            sourceFamily: "race_merge",
            originalFileName: "race-merge-source-03.csv",
            byteLength: 74_000_000,
            sha256: "d".repeat(64),
          }),
          ],
        }),
      );
    },
  );

  it(
    "fails before capacity or persistence on tampering or head drift",
    async () => {
    const ready = capabilities();
    const encrypted = encrypt({
      head: HEAD,
      ordinal: 1,
      byteLength: 1024,
      sha256: "e".repeat(64),
    });
    const tampered =
      encrypted.slice(0, -1) + (encrypted.endsWith("A") ? "B" : "A");

    await expect(
      createRaceMergeSourceEvidenceUploadTarget({
        encryptedPayload: tampered,
        bridgeNonce: NONCE,
        exactDeploymentSha: HEAD,
        ownerId: OWNER,
        now: new Date(),
        capabilities: ready,
      }),
    ).rejects.toThrow();

    await expect(
      createRaceMergeSourceEvidenceUploadTarget({
        encryptedPayload: encrypted,
        bridgeNonce: NONCE,
        exactDeploymentSha: "f".repeat(40),
        ownerId: OWNER,
        now: new Date(),
        capabilities: ready,
      }),
    ).rejects.toThrow("payload authority is invalid");

    if (ready.status !== "ready") throw new Error("expected ready");
      expect(
        ready.capacityGate.assertWithinApprovedCapacity,
      ).not.toHaveBeenCalled();
      expect(ready.repository.reserveUploadBatch).not.toHaveBeenCalled();
    },
  );

  it(
    "stays unavailable when the hosted provider composition is absent",
    async () => {
    await expect(
      createRaceMergeSourceEvidenceUploadTarget({
        encryptedPayload: encrypt({
          head: HEAD,
          ordinal: 1,
          byteLength: 1024,
          sha256: "f".repeat(64),
        }),
        bridgeNonce: NONCE,
        exactDeploymentSha: HEAD,
        ownerId: OWNER,
        now: new Date(),
        capabilities: { status: "not_configured" },
      }),
      ).resolves.toEqual({ status: "not_configured" });
    },
  );
});
