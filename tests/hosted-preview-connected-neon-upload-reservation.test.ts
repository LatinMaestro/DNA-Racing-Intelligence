import { Pool } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";

import { createNeonImportUploadIntakeRepository } from "../lib/neon-import-upload-intake-repository";
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

describeConnected("hosted Preview Neon upload reservation acceptance", () => {
  it("proves owner-scoped least-privilege reservation and rolls the synthetic transaction back", async () => {
    const databaseUrl = requiredEnvironment("DATABASE_URL");
    const databaseOwnerId = requiredEnvironment("DNA_DATABASE_OWNER_ID");
    const authenticatedOwnerId = requiredEnvironment(
      "AUTHORIZED_CLERK_USER_ID",
    );
    const runId = requiredEnvironment("GITHUB_RUN_ID");
    const runAttempt = requiredEnvironment("GITHUB_RUN_ATTEMPT");
    const repository = createNeonImportUploadIntakeRepository({
      databaseUrl,
      databaseOwnerId,
      runtimeRole: "dna_app_runtime",
      sessionFactory: rollbackOnlySessionFactory(),
    });
    const requestFingerprint = "a".repeat(64);
    const reservation = await repository.reserveUploadBatch({
      ownerId: authenticatedOwnerId,
      idempotencyKey: `connected-neon-${runId}-${runAttempt}`,
      requestedAt: new Date().toISOString(),
      requestFingerprint,
      files: [
        {
          clientFileId: "connected-neon-race-1",
          sourceFamily: "race_merge",
          originalFileName: "synthetic-race-merge.csv",
          contentType: "text/csv",
          byteLength: 128,
          sha256: "b".repeat(64),
        },
      ],
    });

    expect(reservation).toMatchObject({
      disposition: "created",
      requestFingerprint,
      files: [{ clientFileId: "connected-neon-race-1" }],
    });
    expect(reservation.uploadBatchId).toMatch(UUID_PATTERN);
    expect(reservation.files[0]?.uploadFileId).toMatch(UUID_PATTERN);

    const replayAfterRollback = await repository.reserveUploadBatch({
      ownerId: authenticatedOwnerId,
      idempotencyKey: `connected-neon-${runId}-${runAttempt}`,
      requestedAt: new Date().toISOString(),
      requestFingerprint,
      files: [
        {
          clientFileId: "connected-neon-race-1",
          sourceFamily: "race_merge",
          originalFileName: "synthetic-race-merge.csv",
          contentType: "text/csv",
          byteLength: 128,
          sha256: "b".repeat(64),
        },
      ],
    });
    expect(replayAfterRollback.disposition).toBe("created");
  }, 120_000);
});
