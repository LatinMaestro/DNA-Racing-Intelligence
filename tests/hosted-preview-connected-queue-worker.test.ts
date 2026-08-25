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
import { hostedImportActivationWorkerRuntime } from "../lib/hosted-import-activation-worker-runtime";
import { hostedImportUploadCompletionRuntime } from "../lib/hosted-import-upload-completion-runtime";
import { hostedProLeagueAggregateWorkerRuntime } from "../lib/hosted-pro-league-aggregate-worker-runtime";
import type { AggregateRetryQueue } from "../lib/import-aggregate-retry-action-service";
import { createNeonImportActivationRepositories } from "../lib/neon-import-activation";
import { createNeonImportConfirmationCleanupRepository } from "../lib/neon-import-confirmation-cleanup-repository";
import { completePrivateImportUpload } from "../lib/import-upload-completion-service";
import { createNeonImportPreActivationCleanupRepository } from "../lib/neon-import-pre-activation-cleanup-repository";
import { createNeonImportPreviewProcessingRepository } from "../lib/neon-import-preview-processing-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "../lib/neon-import-persistence-driver";
import { createNeonImportUploadIntakeRepository } from "../lib/neon-import-upload-intake-repository";

const connected = process.env.DNA_CONNECTED_PREVIEW_ACCEPTANCE === "1";
const describeConnected = connected ? describe : describe.skip;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ConnectedSourceFamily = "race_merge" | "core_details" | "current_arena";

type ConnectedFile = Readonly<{
  clientFileId: string;
  sourceFamily: ConnectedSourceFamily;
  originalFileName: string;
  payload: Uint8Array;
  sha256: string;
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

async function assertProtectedQueueConsumer(input: {
  accountId: string;
  apiToken: string;
  queueId: string;
  queueName: string;
  deadLetterQueueName: string;
}): Promise<void> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${input.accountId}/queues/${input.queueId}/consumers`,
    {
      headers: {
        Authorization: `Bearer ${input.apiToken}`,
        "Content-Type": "application/json",
      },
    },
  );
  const body = (await response.json()) as {
    success?: unknown;
    result?: unknown;
  };
  if (!response.ok || body.success !== true || !Array.isArray(body.result)) {
    throw new Error(
      "Connected Preview queue consumer inventory could not be verified",
    );
  }
  const consumers = body.result as Array<{
    type?: unknown;
    queue_name?: unknown;
    script_name?: unknown;
    dead_letter_queue?: unknown;
    dead_letter_queue_name?: unknown;
    settings?: {
      batch_size?: unknown;
      max_concurrency?: unknown;
      max_retries?: unknown;
      max_wait_time_ms?: unknown;
    };
  }>;
  if (consumers.length !== 1) {
    throw new Error(
      `Connected Preview queue requires exactly one consumer (found=${consumers.length})`,
    );
  }
  const consumer = consumers[0];
  if (consumer === undefined) {
    throw new Error("Connected Preview queue consumer is unavailable");
  }
  const settings = consumer.settings ?? {};
  const deadLetterQueue =
    consumer.dead_letter_queue ?? consumer.dead_letter_queue_name;
  if (
    consumer.type !== "worker" ||
    consumer.queue_name !== input.queueName ||
    (consumer.script_name != null &&
      consumer.script_name !== "dna-racing-import-preview") ||
    deadLetterQueue !== input.deadLetterQueueName ||
    Number(settings.batch_size) !== 1 ||
    Number(settings.max_concurrency) !== 1 ||
    Number(settings.max_retries) !== 3 ||
    Number(settings.max_wait_time_ms) !== 5_000
  ) {
    throw new Error(
      "Connected Preview queue consumer differs from the protected contract",
    );
  }
  console.log(
    "Verified the protected Preview queue consumer immediately before dispatch.",
  );
}

type RollbackOnlyConnectedSession = Readonly<{
  sessionFactory: NeonImportPersistenceSessionFactory;
  query: NeonImportPersistenceClient["query"];
  rollback: () => Promise<void>;
}>;

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

  const query: NeonImportPersistenceClient["query"] = async (
    statement,
    values,
  ) => {
    if (finished) throw new Error("Rollback-only session is closed");
    const result =
      values === undefined
        ? await outerClient.query(statement)
        : await outerClient.query(statement, [...values]);
    return { rows: result.rows };
  };

  const sessionFactory: NeonImportPersistenceSessionFactory = async (
    requestedDatabaseUrl,
  ) => {
    if (finished || requestedDatabaseUrl.trim() !== databaseUrl.trim()) {
      throw new Error("Rollback-only session database mismatch");
    }
    const savepoint = `connected_acceptance_${++savepointSequence}`;
    let open = false;
    const client: NeonImportPersistenceClient = {
      async query(statement, values) {
        const normalized = statement.replace(/\s+/g, " ").trim();
        if (normalized === "BEGIN ISOLATION LEVEL SERIALIZABLE") {
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
    query,
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

function csv(value: string): Uint8Array {
  return new TextEncoder().encode(`${value}\n`);
}

function connectedFiles(runId: string, runAttempt: string): ConnectedFile[] {
  const definitions: Array<Omit<ConnectedFile, "sha256">> = [
    {
      clientFileId: `connected-core-details-${runId}-${runAttempt}`,
      sourceFamily: "core_details",
      originalFileName: "Core Details.csv",
      payload: csv(
        [
          "bikeid,core_name,core_type,gender,f_no,element",
          "connected-core,Connected Core,Genesis,Female,F1,Fire",
        ].join("\n"),
      ),
    },
    ...Array.from({ length: 7 }, (_, index) => {
      const segment = index + 1;
      const day = String(10 + index).padStart(2, "0");
      const payout = segment % 2 === 0 ? "Winner Take All" : "Top 3";
      return {
        clientFileId: `connected-race-${segment}-${runId}-${runAttempt}`,
        sourceFamily: "race_merge" as const,
        originalFileName: `Race Merge ${segment}.csv`,
        payload: csv(
          [
            "event_id,rstart_time,rmode,rcb,token_id,rgate_count,gold_star,blue_star,pos,time,rpayout,rfee,prize,toke_curr,r_tags",
            `connected-event-${runId}-${runAttempt}-${segment},2026-08-${day}T00:00:00.000Z,Bike,1000,connected-core,8,false,false,1,61.${segment}0,${payout},0,0,DEZ,Synthetic`,
          ].join("\n"),
        ),
      };
    }),
    {
      clientFileId: `connected-arena-${runId}-${runAttempt}`,
      sourceFamily: "current_arena",
      originalFileName: "Current Arena.csv",
      payload: csv(["token_id,price_usd", "connected-core,125.00"].join("\n")),
    },
  ];

  return definitions.map((file) => ({
    ...file,
    sha256: createHash("sha256").update(file.payload).digest("hex"),
  }));
}

async function readPreviewState(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  uploadBatchId: string;
}): Promise<{
  processingState: string | null;
  failureReason: string | null;
  previewId: string | null;
  previewFingerprintSha256: string | null;
  confirmable: boolean | null;
  fileCount: number | null;
  sourceFamilyCount: number | null;
  blockingIssueCount: number | null;
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
    const row = result.rows[0] as
      | {
          processing_state?: unknown;
          failure_reason?: unknown;
          preview_id?: unknown;
          preview_fingerprint_sha256?: unknown;
          confirmable?: unknown;
          file_count?: unknown;
          source_family_count?: unknown;
          blocking_issue_count?: unknown;
        }
      | undefined;
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
}): Promise<Awaited<ReturnType<typeof readPreviewState>>> {
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
        reason: "Connected synthetic nine-file Preview acceptance cleanup.",
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

async function readConfirmationCleanupReceipt(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  activationDispatchId: string;
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
      `SELECT
        upload_batch_id::text AS upload_batch_id,
        activation_dispatch_id::text AS activation_dispatch_id,
        pre_activation_cleanup_id::text AS pre_activation_cleanup_id,
        file_count,
        verified_object_count,
        staged_batch_count
      FROM dna.import_confirmation_cleanup
      WHERE owner_id = $1::uuid AND activation_dispatch_id = $2::uuid`,
      [input.databaseOwnerId, input.activationDispatchId],
    );
    await client.query("ROLLBACK");
    const row = result.rows[0] as
      | {
          upload_batch_id?: unknown;
          activation_dispatch_id?: unknown;
          pre_activation_cleanup_id?: unknown;
          file_count?: unknown;
          verified_object_count?: unknown;
          staged_batch_count?: unknown;
        }
      | undefined;
    if (row === undefined) return null;
    return {
      uploadBatchId:
        typeof row.upload_batch_id === "string" ? row.upload_batch_id : null,
      activationDispatchId:
        typeof row.activation_dispatch_id === "string"
          ? row.activation_dispatch_id
          : null,
      preActivationCleanupId:
        typeof row.pre_activation_cleanup_id === "string"
          ? row.pre_activation_cleanup_id
          : null,
      fileCount: Number(row.file_count),
      verifiedObjectCount: Number(row.verified_object_count),
      stagedBatchCount: Number(row.staged_batch_count),
    };
  } finally {
    client.release();
    await pool.end();
  }
}

describeConnected(
  "hosted Preview synthetic queue and Worker acceptance",
  () => {
    it("processes the current nine-file source shape, replays, and cleans up", async () => {
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
      await assertProtectedQueueConsumer({
        accountId,
        apiToken,
        queueId,
        queueName,
        deadLetterQueueName,
      });
      const files = connectedFiles(runId, runAttempt);
      expect(files).toHaveLength(9);
      expect(
        files.filter((file) => file.sourceFamily === "race_merge"),
      ).toHaveLength(7);
      const requestFingerprint = createHash("sha256")
        .update(
          `connected-nine-file-request:${runId}:${runAttempt}:${files
            .map((file) => file.sha256)
            .join(":")}`,
        )
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
      let cleanupResult:
        | Readonly<{
            status: string;
            fileCount: number;
            verifiedObjectCount: number;
            stagedBatchCount: number;
          }>
        | undefined;

      try {
        const reservation = await repository.reserveUploadBatch({
          ownerId,
          idempotencyKey: `connected-nine-file-${runId}-${runAttempt}`,
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
        expect(reservation.files).toHaveLength(9);
        uploadBatchId = reservation.uploadBatchId;
        const reservedByClientId = new Map(
          reservation.files.map((file) => [
            file.clientFileId,
            file.uploadFileId,
          ]),
        );

        for (const file of files) {
          const uploadFileId = reservedByClientId.get(file.clientFileId);
          if (uploadFileId === undefined) {
            throw new Error(
              `Connected upload reservation omitted ${file.clientFileId}`,
            );
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

        await repository.markUploadTargetsReady({
          ownerId,
          uploadBatchId,
          uploadFileIds,
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
          idempotencyKey: `connected-nine-file-complete-${runId}-${runAttempt}`,
          uploadRequestFingerprint: requestFingerprint,
          now: new Date(),
          capabilities,
        });
        expect(queued).toMatchObject({
          status: "queued_for_preview",
          uploadBatchId,
          disposition: "created",
          fileCount: 9,
        });
        if (queued.status !== "queued_for_preview") {
          throw new Error(
            "Connected nine-file upload was not queued for Preview",
          );
        }
        previewDispatchId = queued.previewDispatchId;

        const prepared = await waitForPreparedPreview({
          databaseUrl,
          databaseOwnerId,
          uploadBatchId,
        });
        expect(prepared).toMatchObject({
          processingState: "complete",
          failureReason: null,
          confirmable: true,
          fileCount: 9,
          sourceFamilyCount: 3,
          blockingIssueCount: 0,
        });
        expect(prepared.previewId).toMatch(/^preview-[a-f0-9]{32}$/);
        expect(prepared.previewFingerprintSha256).toMatch(/^[a-f0-9]{64}$/);
        if (
          prepared.previewId === null ||
          prepared.previewFingerprintSha256 === null
        ) {
          throw new Error("Connected prepared Preview identity is unavailable");
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
          await activationRepositories.activationRepository.reserveConfirmedUpdate(
            {
              ownerId,
              previewId: prepared.previewId,
              previewFingerprintSha256: prepared.previewFingerprintSha256,
              idempotencyKey: `connected-confirm-${runId}-${runAttempt}`,
              confirmedAt: new Date().toISOString(),
            },
          );
        expect(confirmation).toMatchObject({
          disposition: "created",
          dispatchState: "pending",
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
              workerId: "connected-activation-worker",
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
            throw new Error("Connected activation runtime is unavailable");
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
          ).resolves.toEqual({
            disposition: "acknowledge",
            reason: "completed",
          });
          expect(aggregateRefreshes).toHaveLength(3);
          const firstRefreshIds = aggregateRefreshes.map(
            (refresh) => refresh.refreshId,
          );
          expect(new Set(firstRefreshIds).size).toBe(3);

          const aggregateRuntime = hostedProLeagueAggregateWorkerRuntime({
            environment: {
              workerId: "connected-aggregate-worker",
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
            throw new Error("Connected aggregate runtime is unavailable");
          }
          for (const refresh of aggregateRefreshes) {
            expect(refresh).toMatchObject({
              ownerId,
              dispatchId: confirmation.dispatchId,
            });
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
            ).resolves.toEqual({
              disposition: "acknowledge",
              reason: "completed",
            });
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
          ).resolves.toEqual({
            disposition: "acknowledge",
            reason: "completed",
          });
          expect(aggregateRefreshes).toHaveLength(6);
          const replayRefreshes = aggregateRefreshes.slice(3);
          expect(
            new Set(replayRefreshes.map((refresh) => refresh.refreshId)),
          ).toEqual(new Set(firstRefreshIds));

          for (const refresh of replayRefreshes) {
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
            ).resolves.toEqual({
              disposition: "acknowledge",
              reason: "completed",
            });
          }
        } finally {
          await activationTransaction.rollback();
        }

        const replay = await completePrivateImportUpload({
          authenticatedOwnerId: ownerId,
          configuredOwnerId: ownerId,
          uploadBatchId,
          idempotencyKey: `connected-nine-file-replay-${runId}-${runAttempt}`,
          uploadRequestFingerprint: requestFingerprint,
          now: new Date(),
          capabilities,
        });
        expect(replay).toMatchObject({
          status: "queued_for_preview",
          uploadBatchId,
          disposition: "existing",
          fileCount: 9,
        });
      } finally {
        let cleanupFailure: unknown;
        if (uploadBatchId !== null) {
          try {
            if (
              confirmedCleanupContext === null &&
              previewDispatchId !== null
            ) {
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
            cleanupResult =
              confirmedCleanupContext === null
                ? await waitForCleanup({
                    repository: cleanupRepository,
                    ownerId,
                    uploadBatchId,
                    requestFingerprintSha256: requestFingerprint,
                  })
                : await confirmationCleanupRepository.cleanupBeforeDispatch({
                    ownerId,
                    uploadBatchId,
                    requestFingerprintSha256: requestFingerprint,
                    previewId: confirmedCleanupContext.previewId,
                    previewFingerprintSha256:
                      confirmedCleanupContext.previewFingerprintSha256,
                    updateSessionId: confirmedCleanupContext.updateSessionId,
                    activationDispatchId:
                      confirmedCleanupContext.activationDispatchId,
                    reason:
                      "Connected persistent confirmed Preview acceptance cleanup.",
                    cleanedAt: new Date().toISOString(),
                  });
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
        if (cleanupFailure !== undefined) {
          throw cleanupFailure;
        }
      }

      expect(cleanupResult).toMatchObject({
        status: "cleaned",
        fileCount: 9,
        verifiedObjectCount: 9,
        stagedBatchCount: 9,
      });
      if (uploadBatchId === null) {
        throw new Error("Connected cleanup batch identifier is unavailable");
      }
      if (confirmedCleanupContext === null) {
        throw new Error(
          "Persistent confirmation cleanup context is unavailable",
        );
      }
      const cleanupReplay =
        await confirmationCleanupRepository.cleanupBeforeDispatch({
          ownerId,
          uploadBatchId,
          requestFingerprintSha256: requestFingerprint,
          previewId: confirmedCleanupContext.previewId,
          previewFingerprintSha256:
            confirmedCleanupContext.previewFingerprintSha256,
          updateSessionId: confirmedCleanupContext.updateSessionId,
          activationDispatchId: confirmedCleanupContext.activationDispatchId,
          reason: "Replay persistent confirmed Preview acceptance cleanup.",
          cleanedAt: new Date().toISOString(),
        });
      expect(cleanupReplay).toMatchObject({
        status: "existing",
        fileCount: 9,
        verifiedObjectCount: 9,
        stagedBatchCount: 9,
      });
      const cleanupReceipt = await readConfirmationCleanupReceipt({
        databaseUrl,
        databaseOwnerId,
        activationDispatchId: confirmedCleanupContext.activationDispatchId,
      });
      expect(cleanupReceipt).toMatchObject({
        uploadBatchId,
        activationDispatchId: confirmedCleanupContext.activationDispatchId,
        fileCount: 9,
        verifiedObjectCount: 9,
        stagedBatchCount: 9,
      });
      expect(cleanupReceipt?.preActivationCleanupId).toMatch(UUID_PATTERN);
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
      for (const uploadFileId of uploadFileIds) {
        const remaining = await cleanupClient.send(
          new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: `quarantine/${ownerPrefix}/${uploadFileId}.csv`,
            MaxKeys: 1,
          }),
        );
        expect(remaining.KeyCount ?? 0).toBe(0);
      }
    }, 600_000);
  },
);
