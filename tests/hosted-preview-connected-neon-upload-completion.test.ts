import { Pool } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";

import { createNeonImportUploadCompletionRepository } from "../lib/neon-import-upload-completion-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "../lib/neon-import-persistence-driver";

const connected = process.env.DNA_CONNECTED_PREVIEW_ACCEPTANCE === "1";
const describeConnected = connected ? describe : describe.skip;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (value === "" || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

function rollbackOnlySessionFactory(): NeonImportPersistenceSessionFactory {
  return async (databaseUrl) => {
    const pool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    const client = await pool.connect();
    const rollbackOnlyClient: NeonImportPersistenceClient = {
      query(statement, values) {
        if (statement === "COMMIT") {
          return client.query("ROLLBACK");
        }
        return values === undefined
          ? client.query(statement)
          : client.query(statement, [...values]);
      },
    };
    return {
      client: rollbackOnlyClient,
      async close() {
        client.release();
        await pool.end();
      },
    };
  };
}

function seededClaimRollbackOnlySessionFactory(input: {
  ownerId: string;
  seedIdempotencyKey: string;
  fingerprint: string;
  requestedAt: string;
  expiresAt: string;
}): NeonImportPersistenceSessionFactory {
  return async (databaseUrl) => {
    const pool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    const client = await pool.connect();
    const rollbackOnlyClient: NeonImportPersistenceClient = {
      async query(statement, values) {
        if (statement === "COMMIT") {
          return client.query("ROLLBACK");
        }
        if (statement.includes("FROM dna.claim_import_upload_completion(")) {
          if (values === undefined) {
            throw new Error("completion claim values are required");
          }
          const seed = await client.query(
            `SELECT
              upload_batch_id::text AS upload_batch_id,
              reserved_files
            FROM dna.reserve_import_upload_batch(
              $1::uuid,
              $2::text,
              $3::character(64),
              $4::timestamptz,
              $5::jsonb
            )`,
            [
              input.ownerId,
              input.seedIdempotencyKey,
              input.fingerprint,
              input.requestedAt,
              JSON.stringify([
                {
                  client_file_id: "connected-claim-race-1",
                  source_family: "race_merge",
                  original_file_name: "synthetic-race-merge.csv",
                  content_type: "text/csv",
                  byte_length: 128,
                  sha256: input.fingerprint,
                },
              ]),
            ],
          );
          const seedRow = seed.rows[0] as
            { upload_batch_id?: unknown; reserved_files?: unknown } | undefined;
          if (
            typeof seedRow?.upload_batch_id !== "string" ||
            !UUID_PATTERN.test(seedRow.upload_batch_id)
          ) {
            throw new Error(
              "synthetic upload reservation did not return a batch",
            );
          }
          const reserved =
            typeof seedRow.reserved_files === "string"
              ? (JSON.parse(seedRow.reserved_files) as unknown)
              : seedRow.reserved_files;
          if (!Array.isArray(reserved) || reserved.length !== 1) {
            throw new Error("synthetic upload reservation files are invalid");
          }
          const reservedFile = reserved[0] as { uploadFileId?: unknown };
          if (
            typeof reservedFile.uploadFileId !== "string" ||
            !UUID_PATTERN.test(reservedFile.uploadFileId)
          ) {
            throw new Error("synthetic upload reservation file is invalid");
          }
          await client.query(
            `SELECT dna.mark_import_upload_targets_ready(
              $1::uuid,
              $2::uuid,
              $3::uuid[],
              $4::character(64),
              $5::timestamptz
            )`,
            [
              input.ownerId,
              seedRow.upload_batch_id,
              [reservedFile.uploadFileId],
              input.fingerprint,
              input.expiresAt,
            ],
          );
          const claimValues = [...values];
          claimValues[1] = seedRow.upload_batch_id;
          return client.query(statement, claimValues);
        }
        return values === undefined
          ? client.query(statement)
          : client.query(statement, [...values]);
      },
    };
    return {
      client: rollbackOnlyClient,
      async close() {
        client.release();
        await pool.end();
      },
    };
  };
}

function seededDispatchRollbackOnlySessionFactory(input: {
  ownerId: string;
  seedIdempotencyKey: string;
  claimIdempotencyKey: string;
  fingerprint: string;
  requestedAt: string;
  expiresAt: string;
}): NeonImportPersistenceSessionFactory {
  return async (databaseUrl) => {
    const pool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    const client = await pool.connect();
    const rollbackOnlyClient: NeonImportPersistenceClient = {
      async query(statement, values) {
        if (statement === "COMMIT") {
          return client.query("ROLLBACK");
        }
        if (statement.includes("FROM dna.reserve_import_preview_dispatch(")) {
          if (values === undefined) {
            throw new Error("preview dispatch values are required");
          }
          const serializedFiles = values[5];
          if (typeof serializedFiles !== "string") {
            throw new Error("serialized verified files are required");
          }
          const submittedFiles = JSON.parse(serializedFiles) as unknown;
          if (!Array.isArray(submittedFiles) || submittedFiles.length !== 1) {
            throw new Error("serialized verified files are invalid");
          }
          const submittedFile = submittedFiles[0] as {
            object_version?: unknown;
            advertised_byte_length?: unknown;
            advertised_content_type?: unknown;
            provider_sha256?: unknown;
            scope?: unknown;
            owner_id?: unknown;
          };
          if (
            submittedFile.owner_id !== input.ownerId ||
            submittedFile.scope !== "private_owner"
          ) {
            throw new Error(
              "verified object owner was not translated to the database identity",
            );
          }

          const seed = await client.query(
            `SELECT
              upload_batch_id::text AS upload_batch_id,
              reserved_files
            FROM dna.reserve_import_upload_batch(
              $1::uuid,
              $2::text,
              $3::character(64),
              $4::timestamptz,
              $5::jsonb
            )`,
            [
              input.ownerId,
              input.seedIdempotencyKey,
              input.fingerprint,
              input.requestedAt,
              JSON.stringify([
                {
                  client_file_id: "connected-dispatch-race-1",
                  source_family: "race_merge",
                  original_file_name: "synthetic-race-merge.csv",
                  content_type: "text/csv",
                  byte_length: 256,
                  sha256: input.fingerprint,
                },
              ]),
            ],
          );
          const seedRow = seed.rows[0] as
            { upload_batch_id?: unknown; reserved_files?: unknown } | undefined;
          if (
            typeof seedRow?.upload_batch_id !== "string" ||
            !UUID_PATTERN.test(seedRow.upload_batch_id)
          ) {
            throw new Error(
              "synthetic dispatch upload reservation did not return a batch",
            );
          }
          const reserved =
            typeof seedRow.reserved_files === "string"
              ? (JSON.parse(seedRow.reserved_files) as unknown)
              : seedRow.reserved_files;
          if (!Array.isArray(reserved) || reserved.length !== 1) {
            throw new Error(
              "synthetic dispatch upload reservation files are invalid",
            );
          }
          const reservedFile = reserved[0] as { uploadFileId?: unknown };
          if (
            typeof reservedFile.uploadFileId !== "string" ||
            !UUID_PATTERN.test(reservedFile.uploadFileId)
          ) {
            throw new Error(
              "synthetic dispatch upload reservation file is invalid",
            );
          }
          await client.query(
            `SELECT dna.mark_import_upload_targets_ready(
              $1::uuid,
              $2::uuid,
              $3::uuid[],
              $4::character(64),
              $5::timestamptz
            )`,
            [
              input.ownerId,
              seedRow.upload_batch_id,
              [reservedFile.uploadFileId],
              input.fingerprint,
              input.expiresAt,
            ],
          );
          const claim = await client.query(
            `SELECT completion_id::text AS completion_id
            FROM dna.claim_import_upload_completion(
              $1::uuid,
              $2::uuid,
              $3::text,
              $4::character(64),
              $5::timestamptz
            )`,
            [
              input.ownerId,
              seedRow.upload_batch_id,
              input.claimIdempotencyKey,
              input.fingerprint,
              input.requestedAt,
            ],
          );
          const claimRow = claim.rows[0] as
            { completion_id?: unknown } | undefined;
          if (
            typeof claimRow?.completion_id !== "string" ||
            !UUID_PATTERN.test(claimRow.completion_id)
          ) {
            throw new Error(
              "synthetic dispatch upload claim did not return a completion",
            );
          }

          const verifiedFiles = JSON.stringify([
            {
              upload_file_id: reservedFile.uploadFileId,
              object_id: reservedFile.uploadFileId,
              object_version: submittedFile.object_version,
              advertised_byte_length: 256,
              advertised_content_type: "text/csv",
              provider_sha256: input.fingerprint,
              scope: "private_owner",
              owner_id: input.ownerId,
              upload_batch_id: seedRow.upload_batch_id,
            },
          ]);
          const dispatchValues = [...values];
          dispatchValues[1] = seedRow.upload_batch_id;
          dispatchValues[2] = claimRow.completion_id;
          dispatchValues[5] = verifiedFiles;
          const created = await client.query(statement, dispatchValues);
          const createdRow = created.rows[0] as
            | {
                preview_dispatch_id?: unknown;
                disposition?: unknown;
                dispatch_state?: unknown;
              }
            | undefined;
          if (
            typeof createdRow?.preview_dispatch_id !== "string" ||
            !UUID_PATTERN.test(createdRow.preview_dispatch_id) ||
            createdRow.disposition !== "created" ||
            createdRow.dispatch_state !== "pending"
          ) {
            throw new Error("synthetic preview dispatch was not created");
          }
          const persisted = await client.query(
            `SELECT
              count(*)::integer AS verified_count,
              min(object_version) AS object_version,
              min(advertised_byte_length)::text AS advertised_byte_length,
              min(advertised_content_type) AS advertised_content_type,
              min(provider_sha256)::text AS provider_sha256
            FROM dna.import_verified_upload_object
            WHERE owner_id = $1::uuid
              AND preview_dispatch_id = $2::uuid`,
            [input.ownerId, createdRow.preview_dispatch_id],
          );
          const persistedRow = persisted.rows[0] as
            | {
                verified_count?: unknown;
                object_version?: unknown;
                advertised_byte_length?: unknown;
                advertised_content_type?: unknown;
                provider_sha256?: unknown;
              }
            | undefined;
          if (
            persistedRow?.verified_count !== 1 ||
            persistedRow.object_version !== submittedFile.object_version ||
            persistedRow.advertised_byte_length !== "256" ||
            persistedRow.advertised_content_type !== "text/csv" ||
            persistedRow.provider_sha256 !== input.fingerprint
          ) {
            throw new Error("verified object persistence evidence is invalid");
          }
          const replay = await client.query(statement, dispatchValues);
          const replayRow = replay.rows[0] as
            | {
                preview_dispatch_id?: unknown;
                disposition?: unknown;
                dispatch_state?: unknown;
              }
            | undefined;
          if (
            replayRow?.preview_dispatch_id !==
              createdRow.preview_dispatch_id ||
            replayRow.disposition !== "existing" ||
            replayRow.dispatch_state !== "pending"
          ) {
            throw new Error(
              "synthetic preview dispatch replay is not idempotent",
            );
          }
          return replay;
        }
        return values === undefined
          ? client.query(statement)
          : client.query(statement, [...values]);
      },
    };
    return {
      client: rollbackOnlyClient,
      async close() {
        client.release();
        await pool.end();
      },
    };
  };
}

describeConnected("hosted Preview Neon upload completion access", () => {
  it("proves least-privilege completion access without creating state", async () => {
    const databaseUrl = requiredEnvironment("DATABASE_URL");
    const databaseOwnerId = requiredEnvironment("DNA_DATABASE_OWNER_ID");
    const authenticatedOwnerId = requiredEnvironment(
      "AUTHORIZED_CLERK_USER_ID",
    );
    const runId = requiredEnvironment("GITHUB_RUN_ID");
    const runAttempt = requiredEnvironment("GITHUB_RUN_ATTEMPT");
    const repository = createNeonImportUploadCompletionRepository({
      databaseUrl,
      databaseOwnerId,
      runtimeRole: "dna_app_runtime",
      sessionFactory: rollbackOnlySessionFactory(),
    });
    const input = {
      ownerId: authenticatedOwnerId,
      uploadBatchId: "00000000-0000-4000-8000-000000000197",
      idempotencyKey: `connected-completion-${runId}-${runAttempt}`,
      uploadRequestFingerprint: "c".repeat(64),
      claimedAt: new Date().toISOString(),
    };

    expect(await repository.claimUploadCompletion(input)).toEqual({
      status: "not_found",
    });
    expect(await repository.claimUploadCompletion(input)).toEqual({
      status: "not_found",
    });
  }, 120_000);

  it("claims a transaction-local completed upload and rolls every row back", async () => {
    const databaseUrl = requiredEnvironment("DATABASE_URL");
    const databaseOwnerId = requiredEnvironment("DNA_DATABASE_OWNER_ID");
    const authenticatedOwnerId = requiredEnvironment(
      "AUTHORIZED_CLERK_USER_ID",
    );
    const runId = requiredEnvironment("GITHUB_RUN_ID");
    const runAttempt = requiredEnvironment("GITHUB_RUN_ATTEMPT");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
    const fingerprint = "d".repeat(64);
    const repository = createNeonImportUploadCompletionRepository({
      databaseUrl,
      databaseOwnerId,
      runtimeRole: "dna_app_runtime",
      sessionFactory: seededClaimRollbackOnlySessionFactory({
        ownerId: databaseOwnerId,
        seedIdempotencyKey: `connected-claim-seed-${runId}-${runAttempt}`,
        fingerprint,
        requestedAt: now.toISOString(),
        expiresAt,
      }),
    });
    const claim = await repository.claimUploadCompletion({
      ownerId: authenticatedOwnerId,
      uploadBatchId: "00000000-0000-4000-8000-000000000198",
      idempotencyKey: `connected-claim-${runId}-${runAttempt}`,
      uploadRequestFingerprint: fingerprint,
      claimedAt: now.toISOString(),
    });

    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") {
      throw new Error("synthetic upload was not claimed");
    }
    expect(claim.completionId).toMatch(UUID_PATTERN);
    expect(claim.uploadRequestFingerprint).toBe(fingerprint);
    expect(claim.uploadTargetExpiresAt).toBe(expiresAt);
    expect(claim.files).toEqual([
      expect.objectContaining({
        sourceFamily: "race_merge",
        expectedByteLength: 128,
        expectedSha256: fingerprint,
        expectedContentType: "text/csv",
      }),
    ]);
    expect(claim.files[0]?.uploadFileId).toMatch(UUID_PATTERN);
    expect(claim.files[0]?.objectId).toMatch(UUID_PATTERN);
  }, 120_000);

  it(
    "persists and replays a transaction-local verified dispatch, then rolls it back",
    async () => {
      const databaseUrl = requiredEnvironment("DATABASE_URL");
      const databaseOwnerId = requiredEnvironment("DNA_DATABASE_OWNER_ID");
      const authenticatedOwnerId = requiredEnvironment(
        "AUTHORIZED_CLERK_USER_ID",
      );
      const runId = requiredEnvironment("GITHUB_RUN_ID");
      const runAttempt = requiredEnvironment("GITHUB_RUN_ATTEMPT");
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
      const fingerprint = "e".repeat(64);
      const repository = createNeonImportUploadCompletionRepository({
        databaseUrl,
        databaseOwnerId,
        runtimeRole: "dna_app_runtime",
        sessionFactory: seededDispatchRollbackOnlySessionFactory({
          ownerId: databaseOwnerId,
          seedIdempotencyKey: `connected-dispatch-seed-${runId}-${runAttempt}`,
          claimIdempotencyKey: `connected-dispatch-claim-${runId}-${runAttempt}`,
          fingerprint,
          requestedAt: now.toISOString(),
          expiresAt,
        }),
      });
      const dispatch = await repository.reservePreviewDispatch({
        ownerId: authenticatedOwnerId,
        uploadBatchId: "00000000-0000-4000-8000-000000000200",
        completionId: "00000000-0000-4000-8000-000000000201",
        uploadRequestFingerprint: fingerprint,
        verifiedAt: now.toISOString(),
        files: [
          {
            uploadFileId: "00000000-0000-4000-8000-000000000202",
            objectId: "00000000-0000-4000-8000-000000000202",
            objectVersion: `connected-r2-version-${runId}-${runAttempt}`,
            advertisedByteLength: 256,
            advertisedContentType: "text/csv",
            providerSha256: fingerprint,
            scope: "private_owner",
            ownerId: authenticatedOwnerId,
            uploadBatchId: "00000000-0000-4000-8000-000000000200",
          },
        ],
      });
  
      expect(dispatch.previewDispatchId).toMatch(UUID_PATTERN);
      expect(dispatch.disposition).toBe("existing");
      expect(dispatch.dispatchState).toBe("pending");
      expect(dispatch.uploadRequestFingerprint).toBe(fingerprint);
    },
    120_000,
  );
});
