import { Pool } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";

import { createNeonImportPreActivationCleanupRepository } from "../lib/neon-import-pre-activation-cleanup-repository";
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

function seededCleanupRollbackOnlySessionFactory(input: {
  databaseOwnerId: string;
  seedIdempotencyKey: string;
  fingerprint: string;
  requestedAt: string;
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
        if (
          statement.includes("FROM dna.cleanup_import_before_activation(")
        ) {
          if (values === undefined) {
            throw new Error("cleanup values are required");
          }
          const seed = await client.query(
            `SELECT upload_batch_id::text AS upload_batch_id
            FROM dna.reserve_import_upload_batch(
              $1::uuid,
              $2::text,
              $3::character(64),
              $4::timestamptz,
              $5::jsonb
            )`,
            [
              input.databaseOwnerId,
              input.seedIdempotencyKey,
              input.fingerprint,
              input.requestedAt,
              JSON.stringify([
                {
                  client_file_id: "connected-cleanup-race-1",
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
            | { upload_batch_id?: unknown }
            | undefined;
          if (
            typeof seedRow?.upload_batch_id !== "string" ||
            !UUID_PATTERN.test(seedRow.upload_batch_id)
          ) {
            throw new Error(
              "synthetic cleanup reservation did not return a batch",
            );
          }

          const cleanupValues = [...values];
          cleanupValues[1] = seedRow.upload_batch_id;
          const cleaned = await client.query(statement, cleanupValues);
          const evidence = await client.query(
            `SELECT
              (
                SELECT count(*)::integer
                FROM dna.import_upload_batch
                WHERE owner_id = $1::uuid AND id = $2::uuid
              ) AS upload_batch_count,
              (
                SELECT count(*)::integer
                FROM dna.import_pre_activation_cleanup
                WHERE owner_id = $1::uuid AND upload_batch_id = $2::uuid
              ) AS cleanup_receipt_count`,
            [input.databaseOwnerId, seedRow.upload_batch_id],
          );
          const evidenceRow = evidence.rows[0] as
            | {
                upload_batch_count?: unknown;
                cleanup_receipt_count?: unknown;
              }
            | undefined;
          if (
            evidenceRow?.upload_batch_count !== 0 ||
            evidenceRow.cleanup_receipt_count !== 1
          ) {
            throw new Error(
              "transaction-local cleanup evidence is inconsistent",
            );
          }
          return cleaned;
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

describeConnected("hosted Preview pre-activation cleanup access", () => {
  it("proves least-privilege absent cleanup without creating state", async () => {
    const databaseUrl = requiredEnvironment("DATABASE_URL");
    const databaseOwnerId = requiredEnvironment("DNA_DATABASE_OWNER_ID");
    const authenticatedOwnerId = requiredEnvironment(
      "AUTHORIZED_CLERK_USER_ID",
    );
    const repository = createNeonImportPreActivationCleanupRepository({
      databaseUrl,
      databaseOwnerId,
      runtimeRole: "dna_app_runtime",
      sessionFactory: rollbackOnlySessionFactory(),
    });

    await expect(
      repository.cleanupBeforeActivation({
        ownerId: authenticatedOwnerId,
        uploadBatchId: "00000000-0000-4000-8000-000000000204",
        requestFingerprintSha256: "f".repeat(64),
        reason: "connected absent synthetic cleanup",
        cleanedAt: new Date().toISOString(),
      }),
    ).resolves.toEqual({
      status: "not_found",
      cleanupId: null,
      fileCount: 0,
      verifiedObjectCount: 0,
      stagedBatchCount: 0,
    });
  }, 120_000);

  it("cleans transaction-local upload state and rolls every row back", async () => {
    const databaseUrl = requiredEnvironment("DATABASE_URL");
    const databaseOwnerId = requiredEnvironment("DNA_DATABASE_OWNER_ID");
    const authenticatedOwnerId = requiredEnvironment(
      "AUTHORIZED_CLERK_USER_ID",
    );
    const runId = requiredEnvironment("GITHUB_RUN_ID");
    const runAttempt = requiredEnvironment("GITHUB_RUN_ATTEMPT");
    const requestedAt = new Date().toISOString();
    const fingerprint = "b".repeat(64);
    const repository = createNeonImportPreActivationCleanupRepository({
      databaseUrl,
      databaseOwnerId,
      runtimeRole: "dna_app_runtime",
      sessionFactory: seededCleanupRollbackOnlySessionFactory({
        databaseOwnerId,
        seedIdempotencyKey: `connected-cleanup-${runId}-${runAttempt}`,
        fingerprint,
        requestedAt,
      }),
    });

    const result = await repository.cleanupBeforeActivation({
      ownerId: authenticatedOwnerId,
      uploadBatchId: "00000000-0000-4000-8000-000000000205",
      requestFingerprintSha256: fingerprint,
      reason: "connected transaction-local synthetic cleanup",
      cleanedAt: requestedAt,
    });

    expect(result.status).toBe("cleaned");
    if (result.status !== "cleaned") {
      throw new Error("synthetic upload was not cleaned");
    }
    expect(result.cleanupId).toMatch(UUID_PATTERN);
    expect(result.fileCount).toBe(1);
    expect(result.verifiedObjectCount).toBe(0);
    expect(result.stagedBatchCount).toBe(0);
  }, 120_000);
});
