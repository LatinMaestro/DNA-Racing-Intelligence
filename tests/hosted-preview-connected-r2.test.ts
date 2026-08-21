import { createHash } from "node:crypto";

import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import {
  createCloudflareR2ImportObjectStorageForOwner,
} from "../lib/cloudflare-r2-import-object-storage";
import { createCloudflareR2S3Port } from "../lib/cloudflare-r2-s3-port";

const connected = process.env.DNA_CONNECTED_PREVIEW_ACCEPTANCE === "1";
const describeConnected = connected ? describe : describe.skip;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (value === "" || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

describeConnected("hosted Preview R2 direct upload acceptance", () => {
  it(
    "uploads through the presigned application boundary, verifies the private object, and removes it",
    async () => {
      const accountId = requiredEnvironment("CLOUDFLARE_ACCOUNT_ID");
      const apiToken = requiredEnvironment("CLOUDFLARE_API_TOKEN");
      const accessKeyId = requiredEnvironment("DNA_R2_ACCESS_KEY_ID");
      const secretAccessKey = requiredEnvironment("DNA_R2_SECRET_ACCESS_KEY");
      const ownerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
      const bucketName = "dna-racing-import-preview";
      const runId = requiredEnvironment("GITHUB_RUN_ID");
      const runAttempt = requiredEnvironment("GITHUB_RUN_ATTEMPT");
      const uploadBatchId = `connected-r2-batch-${runId}-${runAttempt}`;
      const uploadFileId = `connected-r2-file-${runId}-${runAttempt}`;
      const ownerPrefix = createHash("sha256")
        .update(`dna-owner\u0000${ownerId}`)
        .digest("hex");
      const key = `quarantine/${ownerPrefix}/${uploadFileId}.csv`;
      const contentType = "text/csv";
      const payload = new TextEncoder().encode(
        [
          "event_id,rstart_time,rmode,rcb,token_id,rgate_count,gold_star,blue_star,pos,time",
          "synthetic-r2-event,2026-08-21T00:00:00.000Z,Bike,1000,synthetic-core,8,0,0,1,61.25",
          "",
        ].join("\n"),
      );
      const sha256 = createHash("sha256").update(payload).digest("hex");
      const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
      const cleanupClient = new S3Client({
        region: "auto",
        endpoint,
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
      });
      const objectStorage = createCloudflareR2ImportObjectStorageForOwner({
        ownerId,
        configuration: {
          accountId,
          bucketName,
          createPort: () =>
            createCloudflareR2S3Port({
              accountId,
              accessKeyId,
              secretAccessKey,
              apiToken,
            }),
        },
      });

      try {
        const target = await objectStorage.createDirectUploadTarget({
          ownerId,
          uploadBatchId,
          uploadFileId,
          contentType,
          byteLength: payload.byteLength,
          sha256,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        });
        expect(target.method).toBe("PUT");

        const upload = await fetch(target.targetToken, {
          method: target.method,
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(payload.byteLength),
          },
          body: payload,
        });
        expect(upload.status).toBeGreaterThanOrEqual(200);
        expect(upload.status).toBeLessThan(300);

        const inspected = await objectStorage.inspectObject({
          ownerId,
          uploadBatchId,
          uploadFileId,
          objectId: uploadFileId,
        });
        expect(inspected).toMatchObject({
          status: "ready",
          scope: "private_owner",
          ownerId,
          uploadBatchId,
          uploadFileId,
          objectId: uploadFileId,
          advertisedByteLength: payload.byteLength,
          advertisedContentType: contentType,
        });

        const opened = await objectStorage.openObject({
          ownerId,
          objectId: uploadFileId,
        });
        expect(opened.status).toBe("ready");
        if (opened.status !== "ready") {
          throw new Error("Synthetic Preview object disappeared before verification");
        }
        const streamedHash = createHash("sha256");
        let streamedBytes = 0;
        for await (const chunk of opened.body) {
          streamedHash.update(chunk);
          streamedBytes += chunk.byteLength;
        }
        expect(streamedBytes).toBe(payload.byteLength);
        expect(streamedHash.digest("hex")).toBe(sha256);
      } finally {
        await cleanupClient.send(
          new DeleteObjectCommand({
            Bucket: bucketName,
            Key: key,
          }),
        );
      }

      const remaining = await cleanupClient.send(
        new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: key,
          MaxKeys: 1,
        }),
      );
      expect(remaining.KeyCount ?? 0).toBe(0);
    },
    120_000,
  );
});
