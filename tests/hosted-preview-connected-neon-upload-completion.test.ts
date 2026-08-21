import { Pool } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";

import { createNeonImportUploadCompletionRepository } from "../lib/neon-import-upload-completion-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "../lib/neon-import-persistence-driver";

const connected = process.env.DNA_CONNECTED_PREVIEW_ACCEPTANCE === "1";
const describeConnected = connected ? describe : describe.skip;

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
});
