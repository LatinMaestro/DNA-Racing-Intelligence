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
            | { upload_batch_id?: unknown; reserved_files?: unknown }
            | undefined;
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
});
