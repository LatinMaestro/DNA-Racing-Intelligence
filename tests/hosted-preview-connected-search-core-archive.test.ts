import { createHash } from "node:crypto";

import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Pool } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";

import { createCloudflareR2DatasetEvidencePort } from "../lib/cloudflare-r2-dataset-evidence-port";
import { createCloudflareR2ImportObjectStorageForOwner } from "../lib/cloudflare-r2-import-object-storage";
import { createCloudflareR2S3Port } from "../lib/cloudflare-r2-s3-port";
import { hostedImportActivationWorkerRuntime } from "../lib/hosted-import-activation-worker-runtime";
import { hostedImportUploadCompletionRuntime } from "../lib/hosted-import-upload-completion-runtime";
import { hostedProLeagueAggregateWorkerRuntime } from "../lib/hosted-pro-league-aggregate-worker-runtime";
import { hostedRaceArchiveCoreHistoryRuntime } from "../lib/hosted-race-archive-core-history-runtime";
import type { AggregateRetryQueue } from "../lib/import-aggregate-retry-action-service";
import { completePrivateImportUpload } from "../lib/import-upload-completion-service";
import { createNeonImportActivationRepositories } from "../lib/neon-import-activation";
import { createNeonImportConfirmationCleanupRepository } from "../lib/neon-import-confirmation-cleanup-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "../lib/neon-import-persistence-driver";
import { createNeonImportPreActivationCleanupRepository } from "../lib/neon-import-pre-activation-cleanup-repository";
import { createNeonImportPreviewProcessingRepository } from "../lib/neon-import-preview-processing-repository";
import { createNeonImportUploadIntakeRepository } from "../lib/neon-import-upload-intake-repository";
import { createNeonProLeagueAggregateRefreshCapabilities } from "../lib/neon-pro-league-aggregate-refresh";
import { createNeonRaceArchiveCoreLocatorRepository } from "../lib/neon-race-archive-core-locator-repository";
import { createNeonSealedRaceArchiveManifestRepository } from "../lib/neon-sealed-race-archive-manifest-repository";
import {
  createPrivateDatasetEvidenceObjectReader,
  type PrivateDatasetEvidenceObjectReader,
} from "../lib/private-dataset-evidence-object-reader";
import { createRaceArchiveCoreLocatorAccumulator } from "../lib/race-archive-core-locator-accumulator";
import { createRaceStagedRowRehydrator } from "../lib/race-staged-row-rehydrator";
import { createSealedRaceArchiveReader } from "../lib/sealed-race-archive-reader";

const connected = process.env.DNA_CONNECTED_PREVIEW_ACCEPTANCE === "1";
const describeConnected = connected ? describe : describe.skip;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAXIMUM_OBJECT_BYTES = 1_048_576;
const MAXIMUM_UNCOMPRESSED_BYTES_PER_PARTITION = 524_288;
const MAXIMUM_ROWS_PER_PARTITION = 500;
const MAXIMUM_PARTITIONS = 10_000;

type SourceFamily = "race_merge" | "core_details" | "current_arena";
type ConnectedFile = Readonly<{
  clientFileId: string;
  sourceFamily: SourceFamily;
  originalFileName: string;
  payload: Uint8Array;
  sha256: string;
}>;

type RollbackOnlyConnectedSession = Readonly<{
  sessionFactory: NeonImportPersistenceSessionFactory;
  rollback: () => Promise<void>;
}>;

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

function csv(value: string): Uint8Array {
  return new TextEncoder().encode(`${value}\n`);
}

function raceRows(runId: string, runAttempt: string, segment: number): string[] {
  const day = String(10 + segment - 1).padStart(2, "0");
  const payout = segment % 2 === 0 ? "Winner Take All" : "Top 3";
  const header =
    "event_id,rstart_time,rmode,rcb,token_id,rgate_count,gold_star,blue_star,pos,time,rpayout,rfee,prize,toke_curr,r_tags";
  const selected = `connected-event-${runId}-${runAttempt}-${segment}-selected,2026-08-${day}T00:00:00.000Z,Bike,1000,connected-core,8,false,false,1,61.${segment}0,${payout},0,0,DEZ,Synthetic`;
  if (segment !== 1) return [header, selected];

  const filler = Array.from({ length: 500 }, (_, index) => {
    const row = index + 1;
    return `connected-event-${runId}-${runAttempt}-1-filler-${row},2026-08-${day}T00:01:00.000Z,Bike,1000,connected-other,8,false,false,2,72.00,Top 3,0,0,DEZ,Synthetic`;
  });
  return [header, selected, ...filler];
}

function connectedFiles(runId: string, runAttempt: string): ConnectedFile[] {
  const definitions: Array<Omit<ConnectedFile, "sha256">> = [
    {
      clientFileId: `connected-archive-core-details-${runId}-${runAttempt}`,
      sourceFamily: "core_details",
      originalFileName: "Core Details.csv",
      payload: csv(
        [
          "bikeid,core_name,core_type,gender,f_no,element",
          "connected-core,Connected Core,Genesis,Female,F1,Fire",
          "connected-other,Connected Other,Morphed,Male,F2,Water",
        ].join("\n"),
      ),
    },
    ...Array.from({ length: 7 }, (_, index) => {
      const segment = index + 1;
      return {
        clientFileId: `connected-archive-race-${segment}-${runId}-${runAttempt}`,
        sourceFamily: "race_merge" as const,
        originalFileName: `Race Merge ${segment}.csv`,
        payload: csv(raceRows(runId, runAttempt, segment).join("\n")),
      };
    }),
    {
      clientFileId: `connected-archive-arena-${runId}-${runAttempt}`,
      sourceFamily: "current_arena",
      originalFileName: "Current Arena.csv",
      payload: csv(
        ["token_id,price_usd", "connected-core,125.00"].join("\n"),
      ),
    },
  ];

  return definitions.map((file) => ({
    ...file,
    sha256: createHash("sha256").update(file.payload).digest("hex"),
  }));
}

async function createRollbackOnlyConnectedSession(
  databaseUrl: string,
): Promise<RollbackOnlyConnectedSession> {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  const outerClient = await pool.connect();
  await outerClient.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  let savepointSequence = 0;
  let finished = false;

  const sessionFactory: NeonImportPersistenceSessionFactory = async (
    requestedDatabaseUrl,
  ) => {
    if (finished || requestedDatabaseUrl.trim() !== databaseUrl.trim()) {
      throw new Error("Rollback-only session database mismatch");
    }
    const savepoint = `connected_archive_${++savepointSequence}`;
    let open = false;
    const client: NeonImportPersistenceClient = {
      async query(statement, values) {
        const normalized = statement.replace(/\s+/g, " ").trim();
        if (
          normalized === "BEGIN ISOLATION LEVEL SERIALIZABLE" ||
          normalized === "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY"
        ) {
          if (open) throw new Error("Nested acceptance transaction is open");
          await outerClient.query(`SAVEPOINT ${savepoint}`);
          open = true;
          return { rows: [] };
        }
        if (normalized === "COMMIT") {
          if (!open) throw new Error("Nested acceptance transaction is closed");
          await outerClient.query(`RELEASE SAVEPOINT ${savepoint}`);
          open = false;
          return { rows: [] };
        }
        if (normalized === "ROLLBACK") {
          if (!open) return { rows: [] };
          await outerClient.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await outerClient.query(`RELEASE SAVEPOINT ${savepoint}`);
          open = false;
          return { rows: [] };
        }
        const result =
          values === undefined
            ? await outerClient.query(statement)
            : await outerClient.query(statement, [...values]);
        return { rows: result.rows };
      },
    };
    return {
      client,
      async close() {
        if (!open) return;
        await outerClient.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await outerClient.query(`RELEASE SAVEPOINT ${savepoint}`);
        open = false;
      },
    };
  };

  return {
    sessionFactory,
    async rollback() {
      if (finished) return;
      finished = true;
      try {
        await outerClient.query("ROLLBACK");
      } finally {
        outerClient.release();
        await pool.end();
      }
    },
  };
}

async function readPreviewState(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  uploadBatchId: string;
}) {
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
      `SELECT processing.state AS processing_state,
        processing.failure_reason,
        prepared.preview_id,
        prepared.preview_fingerprint_sha256,
        prepared.confirmable,
        prepared.file_count,
        prepared.source_family_count,
        prepared.blocking_issue_count
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
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return {
      processingState:
        typeof row?.processing_state === "string" ? row.processing_state : null,
      failureReason:
        typeof row?.failure_reason === "string" ? row.failure_reason : null,
      previewId: typeof row?.preview_id === "string" ? row.preview_id : null,
      previewFingerprintSha256:
        typeof row?.preview_fingerprint_sha256 === "string"
          ? row.preview_fingerprint_sha256
          : null,
      confirmable:
        typeof row?.confirmable === "boolean" ? row.confirmable : null,
      fileCount: row?.file_count == null ? null : Number(row.file_count),
      sourceFamilyCount:
        row?.source_family_count == null
          ? null
          : Number(row.source_family_count),
      blockingIssueCount:
        row?.blocking_issue_count == null
          ? null
          : Number(row.blocking_issue_count),
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
}) {
  const deadline = Date.now() + 360_000;
  let latest = await readPreviewState(input);
  while (Date.now() < deadline) {
    if (latest.processingState === "failed") {
      throw new Error(
        `Connected Preview Worker recorded a processing failure (${latest.failureReason ?? "reason unavailable"})`,
      );
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
  const deadline = Date.now() + 180_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await input.repository.cleanupBeforeActivation({
        ownerId: input.ownerId,
        uploadBatchId: input.uploadBatchId,
        requestFingerprintSha256: input.requestFingerprintSha256,
        reason: "Connected Search Core archive acceptance cleanup.",
        cleanedAt: new Date().toISOString(),
      });
    } catch (error) {
      lastError = error;
      await sleep(2_000);
    }
  }
  throw lastError ?? new Error("Connected Preview cleanup timed out");
}

function createArchiveObjectReader(input: {
  ownerId: string;
  accountId: string;
  apiToken: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}): PrivateDatasetEvidenceObjectReader {
  return createPrivateDatasetEvidenceObjectReader({
    ownerId: input.ownerId,
    bucketName: input.bucketName,
    maximumObjectBytes: MAXIMUM_OBJECT_BYTES,
    createPort: () =>
      createCloudflareR2DatasetEvidencePort({
        accountId: input.accountId,
        apiToken: input.apiToken,
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretAccessKey,
      }),
  });
}

describeConnected("connected Search Core archive acceptance", () => {
  it("reads only locator-selected immutable Preview partitions after synthetic activation", async () => {
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

    const files = connectedFiles(runId, runAttempt);
    expect(files).toHaveLength(9);
    expect(files.filter((file) => file.sourceFamily === "race_merge")).toHaveLength(
      7,
    );
    const requestFingerprint = createHash("sha256")
      .update(
        `connected-search-archive:${runId}:${runAttempt}:${files
          .map((file) => file.sha256)
          .join(":")}`,
      )
      .digest("hex");

    const intakeRepository = createNeonImportUploadIntakeRepository({
      databaseUrl,
      databaseOwnerId,
      runtimeRole: "dna_app_runtime",
    });
    const cleanupRepository = createNeonImportPreActivationCleanupRepository({
      databaseUrl,
      databaseOwnerId,
      runtimeRole: "dna_app_runtime",
    });
    const processingRepository = createNeonImportPreviewProcessingRepository({
      databaseUrl,
      databaseOwnerId,
      runtimeRole: "dna_app_runtime",
    });
    const confirmationCleanupRepository =
      createNeonImportConfirmationCleanupRepository({
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
    let previewDispatchId: string | null = null;
    const uploadFileIds: string[] = [];
    let confirmedCleanupContext: Readonly<{
      previewId: string;
      previewFingerprintSha256: string;
      updateSessionId: string;
      activationDispatchId: string;
    }> | null = null;

    try {
      const reservation = await intakeRepository.reserveUploadBatch({
        ownerId,
        idempotencyKey: `connected-search-archive-${runId}-${runAttempt}`,
        requestedAt: new Date().toISOString(),
        requestFingerprint,
        files: files.map((file) => ({
          clientFileId: file.clientFileId,
          sourceFamily: file.sourceFamily,
          originalFileName: file.originalFileName,
          contentType: "text/csv",
          byteLength: file.payload.byteLength,
          sha256: file.sha256,
        })),
      });
      expect(reservation.disposition).toBe("created");
      uploadBatchId = reservation.uploadBatchId;
      const reservedByClientId = new Map(
        reservation.files.map((file) => [file.clientFileId, file.uploadFileId]),
      );

      for (const file of files) {
        const uploadFileId = reservedByClientId.get(file.clientFileId);
        if (uploadFileId === undefined) {
          throw new Error(`Upload reservation omitted ${file.clientFileId}`);
        }
        uploadFileIds.push(uploadFileId);
        const target = await objectStorage.createDirectUploadTarget({
          ownerId,
          uploadBatchId,
          uploadFileId,
          contentType: "text/csv",
          byteLength: file.payload.byteLength,
          sha256: file.sha256,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        });
        const uploaded = await fetch(target.targetToken, {
          method: target.method,
          headers: {
            "Content-Type": "text/csv",
            "Content-Length": String(file.payload.byteLength),
          },
          body: new Uint8Array(file.payload),
        });
        expect(uploaded.status).toBeGreaterThanOrEqual(200);
        expect(uploaded.status).toBeLessThan(300);
      }

      await intakeRepository.markUploadTargetsReady({
        ownerId,
        uploadBatchId,
        uploadFileIds,
        requestFingerprint,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });
      const uploadCapabilities = hostedImportUploadCompletionRuntime({
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
      expect(uploadCapabilities.status).toBe("ready");
      const queued = await completePrivateImportUpload({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        uploadBatchId,
        idempotencyKey: `connected-search-archive-complete-${runId}-${runAttempt}`,
        uploadRequestFingerprint: requestFingerprint,
        now: new Date(),
        capabilities: uploadCapabilities,
      });
      expect(queued).toMatchObject({
        status: "queued_for_preview",
        disposition: "created",
        fileCount: 9,
      });
      if (queued.status !== "queued_for_preview") {
        throw new Error("Synthetic archive upload was not queued");
      }
      previewDispatchId = queued.previewDispatchId;

      const prepared = await waitForPreparedPreview({
        databaseUrl,
        databaseOwnerId,
        uploadBatchId,
      });
      expect(prepared).toMatchObject({
        processingState: "complete",
        confirmable: true,
        fileCount: 9,
        sourceFamilyCount: 3,
        blockingIssueCount: 0,
      });
      if (
        prepared.previewId === null ||
        prepared.previewFingerprintSha256 === null
      ) {
        throw new Error("Prepared Preview identity is unavailable");
      }

      const activationRepositories = createNeonImportActivationRepositories({
        databaseUrl,
        databaseOwnerId,
        runtimeRole: "dna_app_runtime",
      });
      await activationRepositories.readinessStore.assertPreviewUploadsReady({
        ownerId,
        previewId: prepared.previewId,
        previewFingerprintSha256: prepared.previewFingerprintSha256,
      });
      const confirmation =
        await activationRepositories.activationRepository.reserveConfirmedUpdate({
          ownerId,
          previewId: prepared.previewId,
          previewFingerprintSha256: prepared.previewFingerprintSha256,
          idempotencyKey: `connected-search-archive-confirm-${runId}-${runAttempt}`,
          confirmedAt: new Date().toISOString(),
        });
      expect(confirmation.updateSessionId).toMatch(UUID_PATTERN);
      expect(confirmation.dispatchId).toMatch(UUID_PATTERN);
      confirmedCleanupContext = {
        previewId: prepared.previewId,
        previewFingerprintSha256: prepared.previewFingerprintSha256,
        updateSessionId: confirmation.updateSessionId,
        activationDispatchId: confirmation.dispatchId,
      };

      const aggregateRefreshes: Array<{
        ownerId: string;
        refreshId: string;
        dispatchId: string;
      }> = [];
      const aggregateQueue: AggregateRetryQueue = {
        async enqueue(message) {
          aggregateRefreshes.push(message);
        },
      };
      const activationTransaction =
        await createRollbackOnlyConnectedSession(databaseUrl);
      try {
        const transactionalActivationRepositories =
          createNeonImportActivationRepositories({
            databaseUrl,
            databaseOwnerId,
            runtimeRole: "dna_app_runtime",
            sessionFactory: activationTransaction.sessionFactory,
          });
        const processingAt = new Date();
        await transactionalActivationRepositories.activationRepository.markDispatchQueued(
          {
            ownerId,
            updateSessionId: confirmation.updateSessionId,
            dispatchId: confirmation.dispatchId,
            queuedAt: processingAt.toISOString(),
          },
        );
        const activationRuntime = hostedImportActivationWorkerRuntime({
          environment: {
            workerId: "connected-search-archive-activation",
            authorizedOwnerId: ownerId,
            database: {
              databaseUrl,
              databaseOwnerId,
              runtimeRole: "dna_app_runtime",
            },
            cloudflare: {
              accountId: undefined,
              apiToken: undefined,
              queueId: undefined,
              queueName: undefined,
              deadLetterQueueName: undefined,
            },
            leaseDurationMilliseconds: "300000",
            maximumSourceVersions: "24",
            maximumQuarantinedRecords: "1000000",
          },
          dependencies: {
            neonSessionFactory: activationTransaction.sessionFactory,
            aggregateQueue,
          },
        });
        expect(activationRuntime.status).toBe("ready");
        if (activationRuntime.status !== "ready") {
          throw new Error("Activation runtime is unavailable");
        }
        await expect(
          activationRuntime.consume({
            body: {
              version: 1,
              kind: "import_activation",
              dispatchId: confirmation.dispatchId,
            },
            now: processingAt,
          }),
        ).resolves.toEqual({ disposition: "acknowledge", reason: "completed" });
        expect(aggregateRefreshes).toHaveLength(9);

        const aggregateRuntime = hostedProLeagueAggregateWorkerRuntime({
          environment: {
            workerId: "connected-search-archive-aggregate",
            database: {
              databaseUrl,
              databaseOwnerId,
              runtimeRole: "dna_app_runtime",
            },
            leaseDurationMilliseconds: "300000",
          },
          dependencies: {
            neonSessionFactory: activationTransaction.sessionFactory,
          },
        });
        expect(aggregateRuntime.status).toBe("ready");
        if (aggregateRuntime.status !== "ready") {
          throw new Error("Aggregate runtime is unavailable");
        }
        for (const refresh of aggregateRefreshes) {
          await expect(
            aggregateRuntime.consume({
              body: {
                version: 1,
                kind: "aggregate_refresh_retry",
                dispatchId: refresh.dispatchId,
                refreshId: refresh.refreshId,
              },
              now: processingAt,
            }),
          ).resolves.toEqual({ disposition: "acknowledge", reason: "completed" });
        }

        const aggregateCapabilities =
          createNeonProLeagueAggregateRefreshCapabilities({
            databaseUrl,
            databaseOwnerId,
            runtimeRole: "dna_app_runtime",
            sessionFactory: activationTransaction.sessionFactory,
          });
        expect(aggregateCapabilities.status).toBe("ready");
        if (aggregateCapabilities.status !== "ready") {
          throw new Error("Aggregate capabilities are unavailable");
        }
        const datasetVersionIds: string[] = [];
        for (const refresh of aggregateRefreshes) {
          const claimedAt = new Date(processingAt.getTime() + 1_000);
          const claim = await aggregateCapabilities.repository.claimRefresh({
            refreshId: refresh.refreshId,
            workerId: "connected-search-archive-inspector",
            claimedAt: claimedAt.toISOString(),
            leaseExpiresAt: new Date(claimedAt.getTime() + 60_000).toISOString(),
          });
          expect(claim.status).toBe("already_complete");
          if (claim.status !== "already_complete") {
            throw new Error("Completed aggregate did not expose its dataset version");
          }
          datasetVersionIds.push(claim.updateSessionId);
        }
        expect(new Set(datasetVersionIds).size).toBe(9);

        const manifestRepository =
          createNeonSealedRaceArchiveManifestRepository({
            databaseUrl,
            databaseOwnerId,
            runtimeRole: "dna_app_runtime",
            sessionFactory: activationTransaction.sessionFactory,
          });
        const locatorRepository = createNeonRaceArchiveCoreLocatorRepository({
          databaseUrl,
          databaseOwnerId,
          runtimeRole: "dna_app_runtime",
          sessionFactory: activationTransaction.sessionFactory,
        });
        const buildObjectReader = createArchiveObjectReader({
          ownerId,
          accountId,
          apiToken,
          accessKeyId,
          secretAccessKey,
          bucketName,
        });
        const buildArchiveReader = createSealedRaceArchiveReader({
          manifestRepository,
          objectReader: buildObjectReader,
          maximumUncompressedBytesPerPartition:
            MAXIMUM_UNCOMPRESSED_BYTES_PER_PARTITION,
          maximumRowsPerPartition: MAXIMUM_ROWS_PER_PARTITION,
          maximumSelectedPartitions: MAXIMUM_PARTITIONS,
        });
        const rehydrator = createRaceStagedRowRehydrator({
          archiveReader: buildArchiveReader,
        });
        let raceVersionCount = 0;
        let multiPartitionRaceVersionCount = 0;
        for (const datasetVersionId of datasetVersionIds) {
          const located = await manifestRepository.list({
            ownerId,
            datasetVersionId,
            maximumPartitions: MAXIMUM_PARTITIONS,
          });
          if (located.status === "missing") continue;
          expect(located.manifest.evidenceKind).toBe("staged_rows");
          raceVersionCount += 1;
          if (located.manifest.partitionCount > 1) {
            multiPartitionRaceVersionCount += 1;
          }
          const opened = await rehydrator.open({
            ownerId,
            datasetVersionId,
            maximumPartitions: MAXIMUM_PARTITIONS,
          });
          if (opened.status !== "ready") {
            throw new Error("Sealed Race archive disappeared during locator build");
          }
          const accumulator = createRaceArchiveCoreLocatorAccumulator({
            datasetVersionId: opened.manifest.datasetVersionId,
            importBatchId: opened.manifest.importBatchId,
            maximumCoreLocators: 50_000,
            maximumPartitionsPerCore: MAXIMUM_PARTITIONS,
          });
          for await (const row of opened.rows) {
            accumulator.append([row]);
          }
          const locators = accumulator.finish();
          await locatorRepository.replace({
            ownerId,
            datasetVersionId: opened.manifest.datasetVersionId,
            importBatchId: opened.manifest.importBatchId,
            locators,
            builtAt: new Date().toISOString(),
          });
        }
        expect(raceVersionCount).toBe(7);
        expect(multiPartitionRaceVersionCount).toBeGreaterThanOrEqual(1);

        const selectedReads: string[] = [];
        const selectedBaseReader = createArchiveObjectReader({
          ownerId,
          accountId,
          apiToken,
          accessKeyId,
          secretAccessKey,
          bucketName,
        });
        const selectedObjectReader: PrivateDatasetEvidenceObjectReader = {
          async read(registration) {
            selectedReads.push(
              `${registration.importBatchId}:${registration.partitionNumber}`,
            );
            return await selectedBaseReader.read(registration);
          },
        };
        const historyRuntime = hostedRaceArchiveCoreHistoryRuntime({
          environment: {
            authorizedOwnerId: ownerId,
            databaseUrl,
            databaseOwnerId,
            runtimeRole: "dna_app_runtime",
            cloudflareAccountId: accountId,
            cloudflareApiToken: apiToken,
            bucketName,
            r2AccessKeyId: accessKeyId,
            r2SecretAccessKey: secretAccessKey,
          },
          dependencies: {
            locatorRepository,
            manifestRepository,
            objectReader: selectedObjectReader,
          },
        });
        expect(historyRuntime.status).toBe("ready");
        if (historyRuntime.status !== "ready") {
          throw new Error("Hosted Search Core archive runtime is unavailable");
        }
        const history = await historyRuntime.service.load({
          ownerId,
          sourceCoreId: "connected-core",
        });
        expect(history.locatorVersionCount).toBe(7);
        expect(history.rows).toHaveLength(7);
        expect(history.selectedPartitionCount).toBe(7);
        expect(selectedReads).toHaveLength(7);
        expect(new Set(selectedReads).size).toBe(7);
        expect(
          history.rows.map((row) => {
            if (row.row.status !== "ready" || row.row.record === null) {
              throw new Error("Connected archive history returned a non-ready row");
            }
            return row.row.record.sourceCoreId;
          }),
        ).toEqual(Array.from({ length: 7 }, () => "connected-core"));
      } finally {
        await activationTransaction.rollback();
      }
    } finally {
      let cleanupFailure: unknown;
      if (uploadBatchId !== null) {
        try {
          if (confirmedCleanupContext === null && previewDispatchId !== null) {
            await processingRepository.recordPreviewFailure({
              ownerId,
              uploadBatchId,
              previewDispatchId,
              workerId: "dna-racing-import-preview-worker",
              uploadRequestFingerprint: requestFingerprint,
              failedAt: new Date().toISOString(),
              reason: "preview_processor_failed",
            });
          }
          if (confirmedCleanupContext === null) {
            await waitForCleanup({
              repository: cleanupRepository,
              ownerId,
              uploadBatchId,
              requestFingerprintSha256: requestFingerprint,
            });
          } else {
            await confirmationCleanupRepository.cleanupBeforeDispatch({
              ownerId,
              uploadBatchId,
              requestFingerprintSha256: requestFingerprint,
              previewId: confirmedCleanupContext.previewId,
              previewFingerprintSha256:
                confirmedCleanupContext.previewFingerprintSha256,
              updateSessionId: confirmedCleanupContext.updateSessionId,
              activationDispatchId:
                confirmedCleanupContext.activationDispatchId,
              reason: "Connected Search Core archive acceptance cleanup.",
              cleanedAt: new Date().toISOString(),
            });
          }
        } catch (error) {
          cleanupFailure = error;
        }
      }
      const ownerPrefix = createHash("sha256")
        .update(`dna-owner\u0000${ownerId}`)
        .digest("hex");
      for (const uploadFileId of uploadFileIds) {
        try {
          await cleanupClient.send(
            new DeleteObjectCommand({
              Bucket: bucketName,
              Key: `quarantine/${ownerPrefix}/${uploadFileId}.csv`,
            }),
          );
        } catch (error) {
          cleanupFailure ??= error;
        }
      }
      if (cleanupFailure !== undefined) throw cleanupFailure;
    }
  }, 600_000);
});
