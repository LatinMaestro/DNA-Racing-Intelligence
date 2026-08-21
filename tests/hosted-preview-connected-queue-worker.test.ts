import { createHash } from "node:crypto";

import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { Pool } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";

import { createCloudflareR2ImportObjectStorageForOwner } from "../lib/cloudflare-r2-import-object-storage";
import { createCloudflareR2S3Port } from "../lib/cloudflare-r2-s3-port";
import { hostedImportPreviewWorkerRuntime } from "../lib/hosted-import-preview-worker-runtime";
import { hostedImportUploadCompletionRuntime } from "../lib/hosted-import-upload-completion-runtime";
import { completePrivateImportUpload } from "../lib/import-upload-completion-service";
import { createDefaultNeonImportPersistenceSession } from "../lib/neon-import-persistence-driver";
import { createNeonImportPreActivationCleanupRepository } from "../lib/neon-import-pre-activation-cleanup-repository";
import { createNeonImportUploadIntakeRepository } from "../lib/neon-import-upload-intake-repository";

const connected = process.env.DNA_CONNECTED_PREVIEW_ACCEPTANCE === "1";
const describeConnected = connected ? describe : describe.skip;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (value === "" || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readPreviewState(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  uploadBatchId: string;
}): Promise<{
  processingState: string | null;
  failureReason: string | null;
  previewId: string | null;
  confirmable: boolean | null;
}> {
  const pool = new Pool({
    connectionString: input.databaseUrl,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.owner_id', $1, true)", [
      input.databaseOwnerId,
    ]);
    const result = await client.query(
      `SELECT
        processing.state AS processing_state,
        processing.failure_reason,
        prepared.preview_id,
        prepared.confirmable
      FROM dna.import_upload_batch upload
      LEFT JOIN dna.import_preview_dispatch dispatch
        ON dispatch.owner_id = upload.owner_id
        AND dispatch.upload_batch_id = upload.id
      LEFT JOIN dna.import_preview_processing processing
        ON processing.owner_id = dispatch.owner_id
        AND processing.preview_dispatch_id = dispatch.id
      LEFT JOIN dna.import_prepared_preview prepared
        ON prepared.owner_id = dispatch.owner_id
        AND prepared.preview_dispatch_id = dispatch.id
      WHERE upload.owner_id = $1::uuid AND upload.id = $2::uuid`,
      [input.databaseOwnerId, input.uploadBatchId],
    );
    await client.query("ROLLBACK");
    const row = result.rows[0] as
      | {
          processing_state?: unknown;
          failure_reason?: unknown;
          preview_id?: unknown;
          confirmable?: unknown;
        }
      | undefined;
    return {
      processingState:
        typeof row?.processing_state === "string" ? row.processing_state : null,
      failureReason:
        typeof row?.failure_reason === "string" ? row.failure_reason : null,
      previewId: typeof row?.preview_id === "string" ? row.preview_id : null,
      confirmable:
        typeof row?.confirmable === "boolean" ? row.confirmable : null,
    };
  } finally {
    client.release();
    await pool.end();
  }
}

async function waitForPreparedPreview(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  uploadBatchId: string;
}): Promise<Awaited<ReturnType<typeof readPreviewState>>> {
  const deadline = Date.now() + 120_000;
  let latest = await readPreviewState(input);
  while (Date.now() < deadline) {
    if (latest.processingState === "failed") {
      throw new Error("Connected Preview Worker recorded a processing failure");
    }
    if (latest.processingState === "complete" && latest.previewId !== null) {
      return latest;
    }
    await sleep(2_000);
    latest = await readPreviewState(input);
  }
  throw new Error(
    `Connected Preview Worker did not complete before timeout (state=${latest.processingState ?? "none"})`,
  );
}

async function waitForCleanup(input: {
  repository: ReturnType<typeof createNeonImportPreActivationCleanupRepository>;
  ownerId: string;
  uploadBatchId: string;
  requestFingerprintSha256: string;
}) {
  const deadline = Date.now() + 120_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await input.repository.cleanupBeforeActivation({
        ownerId: input.ownerId,
        uploadBatchId: input.uploadBatchId,
        requestFingerprintSha256: input.requestFingerprintSha256,
        reason: "Connected synthetic queue and Worker acceptance cleanup.",
        cleanedAt: new Date().toISOString(),
      });
    } catch (error) {
      lastError = error;
      await sleep(2_000);
    }
  }
  throw lastError ?? new Error("Connected Preview cleanup timed out");
}

async function countBatchResidue(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  uploadBatchId: string;
}): Promise<number> {
  const pool = new Pool({
    connectionString: input.databaseUrl,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.owner_id', $1, true)", [
      input.databaseOwnerId,
    ]);
    const result = await client.query(
      `SELECT (
        (SELECT count(*) FROM dna.import_upload_batch
          WHERE owner_id = $1::uuid AND id = $2::uuid) +
        (SELECT count(*) FROM dna.import_upload_file
          WHERE owner_id = $1::uuid AND upload_batch_id = $2::uuid) +
        (SELECT count(*) FROM dna.import_verified_upload_object
          WHERE owner_id = $1::uuid AND upload_batch_id = $2::uuid) +
        (SELECT count(*) FROM dna.import_preview_dispatch
          WHERE owner_id = $1::uuid AND upload_batch_id = $2::uuid) +
        (SELECT count(*) FROM dna.import_preview_processing
          WHERE owner_id = $1::uuid AND upload_batch_id = $2::uuid) +
        (SELECT count(*) FROM dna.import_prepared_preview
          WHERE owner_id = $1::uuid AND upload_batch_id = $2::uuid)
      )::integer AS residue_count`,
      [input.databaseOwnerId, input.uploadBatchId],
    );
    await client.query("ROLLBACK");
    return Number(
      (result.rows[0] as { residue_count?: unknown } | undefined)
        ?.residue_count,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

describeConnected(
  "hosted Preview synthetic queue and Worker acceptance",
  () => {
    it("commits one private synthetic dispatch, observes Worker completion, replays, and cleans up", async () => {
      const databaseUrl = requiredEnvironment("DATABASE_URL");
      const databaseOwnerId = requiredEnvironment("DNA_DATABASE_OWNER_ID");
      const ownerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
      const accountId = requiredEnvironment("CLOUDFLARE_ACCOUNT_ID");
      const apiToken = requiredEnvironment("CLOUDFLARE_API_TOKEN");
      const accessKeyId = requiredEnvironment("DNA_R2_ACCESS_KEY_ID");
      const secretAccessKey = requiredEnvironment("DNA_R2_SECRET_ACCESS_KEY");
      const bucketName = requiredEnvironment("DNA_R2_BUCKET_NAME");
      const queueId = requiredEnvironment("DNA_IMPORT_QUEUE_ID");
      const queueName = requiredEnvironment("DNA_IMPORT_QUEUE_NAME");
      const deadLetterQueueName = requiredEnvironment(
        "DNA_IMPORT_DEAD_LETTER_QUEUE_NAME",
      );
      const runId = requiredEnvironment("GITHUB_RUN_ID");
      const runAttempt = requiredEnvironment("GITHUB_RUN_ATTEMPT");
      const payload = new TextEncoder().encode(
        [
          "event_id,rstart_time,rmode,rcb,token_id,rgate_count,gold_star,blue_star,pos,time",
          `connected-worker-${runId}-${runAttempt},2026-08-21T00:00:00.000Z,Bike,1000,connected-core,8,0,0,1,61.25`,
          "",
        ].join("\n"),
      );
      const sha256 = createHash("sha256").update(payload).digest("hex");
      const requestFingerprint = createHash("sha256")
        .update(`connected-worker-request:${runId}:${runAttempt}:${sha256}`)
        .digest("hex");
      const repository = createNeonImportUploadIntakeRepository({
        databaseUrl,
        databaseOwnerId,
        runtimeRole: "dna_app_runtime",
      });
      const cleanupRepository = createNeonImportPreActivationCleanupRepository({
        databaseUrl,
        databaseOwnerId,
        runtimeRole: "dna_app_runtime",
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
      const cleanupClient = new S3Client({
        region: "auto",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
      });
      let uploadBatchId: string | null = null;
      let uploadFileId: string | null = null;
      let cleanupResult: Awaited<ReturnType<typeof waitForCleanup>> | undefined;

      try {
        const reservation = await repository.reserveUploadBatch({
          ownerId,
          idempotencyKey: `connected-worker-${runId}-${runAttempt}`,
          requestedAt: new Date().toISOString(),
          requestFingerprint,
          files: [
            {
              clientFileId: `connected-worker-file-${runId}-${runAttempt}`,
              sourceFamily: "race_merge",
              originalFileName: "connected-worker-race-merge.csv",
              contentType: "text/csv",
              byteLength: payload.byteLength,
              sha256,
            },
          ],
        });
        expect(reservation.disposition).toBe("created");
        uploadBatchId = reservation.uploadBatchId;
        uploadFileId = reservation.files[0]?.uploadFileId ?? null;
        if (uploadFileId === null) {
          throw new Error("Connected upload reservation returned no file");
        }

        const target = await objectStorage.createDirectUploadTarget({
          ownerId,
          uploadBatchId,
          uploadFileId,
          contentType: "text/csv",
          byteLength: payload.byteLength,
          sha256,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        });
        const uploaded = await fetch(target.targetToken, {
          method: target.method,
          headers: {
            "Content-Type": "text/csv",
            "Content-Length": String(payload.byteLength),
          },
          body: payload,
        });
        expect(uploaded.status).toBeGreaterThanOrEqual(200);
        expect(uploaded.status).toBeLessThan(300);

        await repository.markUploadTargetsReady({
          ownerId,
          uploadBatchId,
          uploadFileIds: [uploadFileId],
          requestFingerprint,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        });
        const capabilities = hostedImportUploadCompletionRuntime({
          environment: {
            authorizedOwnerId: ownerId,
            database: {
              databaseUrl,
              databaseOwnerId,
              runtimeRole: "dna_app_runtime",
            },
            r2: { accountId, bucketName, accessKeyId, secretAccessKey },
            cloudflareApiToken: apiToken,
            queueId,
            queueName,
            deadLetterQueueName,
          },
        });
        expect(capabilities.status).toBe("ready");
        const queued = await completePrivateImportUpload({
          authenticatedOwnerId: ownerId,
          configuredOwnerId: ownerId,
          uploadBatchId,
          idempotencyKey: `connected-worker-complete-${runId}-${runAttempt}`,
          uploadRequestFingerprint: requestFingerprint,
          now: new Date(),
          capabilities,
        });
        expect(queued).toMatchObject({
          status: "queued_for_preview",
          uploadBatchId,
          disposition: "created",
          fileCount: 1,
        });

        if (queued.status !== "queued_for_preview") {
          throw new Error("Connected upload was not queued for Preview");
        }

        let prepared: Awaited<ReturnType<typeof readPreviewState>>;
        try {
          prepared = await waitForPreparedPreview({
            databaseUrl,
            databaseOwnerId,
            uploadBatchId,
          });
        } catch (queueError) {
          const failedDatabaseOperations: string[] = [];
          const diagnosticRuntime = hostedImportPreviewWorkerRuntime({
            environment: {
              authorizedOwnerId: ownerId,
              workerId: "dna-racing-import-preview-worker-diagnostic",
              database: {
                databaseUrl,
                databaseOwnerId,
                runtimeRole: "dna_app_runtime",
              },
              r2: { accountId, bucketName, accessKeyId, secretAccessKey },
              cloudflareApiToken: apiToken,
              leaseDurationMilliseconds: "300000",
              maximumBatchBytes: "1073741824",
              maximumObjectBytes: "536870912",
              maximumChunkBytes: "1048576",
            },
            dependencies: {
              neonSessionFactory: async (connectionString) => {
                const session =
                  await createDefaultNeonImportPersistenceSession(
                    connectionString,
                  );
                return {
                  client: {
                    async query(statement, values) {
                      try {
                        return await session.client.query(statement, values);
                      } catch (error) {
                        const operation = statement
                          .trim()
                          .replace(/\s+/g, " ")
                          .split(" ")
                          .slice(0, 4)
                          .join(" ");
                        failedDatabaseOperations.push(operation);
                        throw error;
                      }
                    },
                  },
                  close: session.close,
                };
              },
            },
          });
          if (diagnosticRuntime.status !== "ready") {
            throw new Error(
              `${queueError instanceof Error ? queueError.message : "Connected Preview Worker timed out"}; direct_runtime=not_configured`,
            );
          }
          let directDecision: unknown;
          try {
            directDecision = await diagnosticRuntime.consume({
              body: {
                version: 1,
                kind: "preview",
                dispatchId: queued.previewDispatchId,
                uploadRequestFingerprint: requestFingerprint,
              },
              now: new Date(Date.now() + 10 * 60 * 1_000),
            });
          } catch {
            directDecision = { disposition: "threw_sanitized" };
          }
          const directState = await readPreviewState({
            databaseUrl,
            databaseOwnerId,
            uploadBatchId,
          });
          throw new Error(
            `${queueError instanceof Error ? queueError.message : "Connected Preview Worker timed out"}; direct_runtime=${JSON.stringify(directDecision)}; failed_database_operations=${JSON.stringify(failedDatabaseOperations)}; direct_state=${JSON.stringify(directState)}`,
          );
        }
        expect(prepared).toMatchObject({
          processingState: "complete",
          failureReason: null,
          confirmable: true,
        });
        expect(prepared.previewId).toMatch(/^preview-[a-f0-9]{32}$/);

        const replay = await completePrivateImportUpload({
          authenticatedOwnerId: ownerId,
          configuredOwnerId: ownerId,
          uploadBatchId,
          idempotencyKey: `connected-worker-replay-${runId}-${runAttempt}`,
          uploadRequestFingerprint: requestFingerprint,
          now: new Date(),
          capabilities,
        });
        expect(replay).toMatchObject({
          status: "queued_for_preview",
          uploadBatchId,
          disposition: "existing",
          fileCount: 1,
        });
      } finally {
        if (uploadBatchId !== null) {
          cleanupResult = await waitForCleanup({
            repository: cleanupRepository,
            ownerId,
            uploadBatchId,
            requestFingerprintSha256: requestFingerprint,
          });
        }
        if (uploadFileId !== null) {
          const ownerPrefix = createHash("sha256")
            .update(`dna-owner\u0000${ownerId}`)
            .digest("hex");
          await cleanupClient.send(
            new DeleteObjectCommand({
              Bucket: bucketName,
              Key: `quarantine/${ownerPrefix}/${uploadFileId}.csv`,
            }),
          );
        }
      }

      expect(cleanupResult).toMatchObject({
        status: "cleaned",
        fileCount: 1,
        verifiedObjectCount: 1,
        stagedBatchCount: 1,
      });
      if (uploadBatchId === null || uploadFileId === null) {
        throw new Error("Connected cleanup identifiers are unavailable");
      }
      expect(
        await countBatchResidue({
          databaseUrl,
          databaseOwnerId,
          uploadBatchId,
        }),
      ).toBe(0);
      const ownerPrefix = createHash("sha256")
        .update(`dna-owner\u0000${ownerId}`)
        .digest("hex");
      const remaining = await cleanupClient.send(
        new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: `quarantine/${ownerPrefix}/${uploadFileId}.csv`,
          MaxKeys: 1,
        }),
      );
      expect(remaining.KeyCount ?? 0).toBe(0);
    }, 420_000);
  },
);
