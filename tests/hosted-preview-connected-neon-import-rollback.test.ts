import { Pool } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";

import {
  createNeonImportRollbackRepository,
} from "../lib/neon-import-rollback-repository";

const connected = process.env.DNA_CONNECTED_PREVIEW_ACCEPTANCE === "1";
const describeConnected = connected ? describe : describe.skip;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const priorArenaBatchId = "45100000-0000-4000-8000-000000000101";
const activeArenaBatchId = "45100000-0000-4000-8000-000000000102";
const coreOnlyBatchId = "45100000-0000-4000-8000-000000000103";
const missingBatchId = "45100000-0000-4000-8000-000000000199";
const wrongDatabaseOwnerId = "45100000-0000-4000-8000-000000000999";
const idempotencyKey = "connected-preview-import-rollback-20260823";
const reason = "Restore the prior connected synthetic Arena snapshot.";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (value === "" || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

describeConnected("connected Preview import rollback", () => {
  it(
    "restores the prior version through the real least-privilege runtime",
    async () => {
      const databaseUrl = requiredEnvironment("DATABASE_URL");
      const databaseOwnerId = requiredEnvironment("DNA_DATABASE_OWNER_ID");
      const ownerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
      const repository = createNeonImportRollbackRepository({
        databaseUrl,
        databaseOwnerId,
        runtimeRole: "dna_app_runtime",
      });

      await expect(
        repository.rollbackActiveSourceVersion({
          ownerId,
          batchId: missingBatchId,
          reason: "Connected missing rollback remains non-mutating.",
          idempotencyKey: "connected-preview-missing-rollback-20260823",
          requestedAt: "2026-08-23T06:15:00.000Z",
        }),
      ).resolves.toEqual({ status: "not_found" });

      await expect(
        repository.rollbackActiveSourceVersion({
          ownerId,
          batchId: coreOnlyBatchId,
          reason: "Connected no-prior rollback remains non-mutating.",
          idempotencyKey: "connected-preview-no-prior-rollback-20260823",
          requestedAt: "2026-08-23T06:15:00.000Z",
        }),
      ).resolves.toEqual({ status: "no_prior_version" });

      const created = await repository.rollbackActiveSourceVersion({
        ownerId,
        batchId: activeArenaBatchId,
        reason,
        idempotencyKey,
        requestedAt: "2026-08-23T06:15:00.000Z",
      });
      expect(created).toMatchObject({
        status: "restored",
        disposition: "created",
        sourceType: "current_arena",
        restoredBatchId: priorArenaBatchId,
      });
      if (created.status !== "restored") {
        throw new Error("Connected Preview rollback was not created");
      }
      expect(created.rollbackId).toMatch(UUID_PATTERN);
      expect(created.aggregateRefreshId).toMatch(UUID_PATTERN);

      await expect(
        repository.rollbackActiveSourceVersion({
          ownerId,
          batchId: activeArenaBatchId,
          reason,
          idempotencyKey,
          requestedAt: "2026-08-23T06:16:00.000Z",
        }),
      ).resolves.toEqual({
        ...created,
        disposition: "existing",
      });

      await expect(
        repository.rollbackActiveSourceVersion({
          ownerId,
          batchId: activeArenaBatchId,
          reason: "A separate connected request sees an inactive version.",
          idempotencyKey: "connected-preview-inactive-rollback-20260823",
          requestedAt: "2026-08-23T06:16:00.000Z",
        }),
      ).resolves.toEqual({ status: "not_active" });

      const pool = new Pool({
        connectionString: databaseUrl,
        max: 1,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 10_000,
      });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.owner_id', $1, true)", [
          wrongDatabaseOwnerId,
        ]);
        const isolated = await client.query(
          "SELECT count(*)::integer AS count FROM dna.import_dataset_rollback",
        );
        expect(isolated.rows).toEqual([{ count: 0 }]);

        await client.query("SELECT set_config('app.owner_id', $1, true)", [
          databaseOwnerId,
        ]);
        const receipt = await client.query(
          `SELECT
            id::text AS rollback_id,
            aggregate_refresh_id::text AS aggregate_refresh_id,
            restored_batch_id::text AS restored_batch_id,
            idempotency_key,
            source_type
          FROM dna.import_dataset_rollback
          WHERE owner_id = $1::uuid AND idempotency_key = $2`,
          [databaseOwnerId, idempotencyKey],
        );
        expect(receipt.rows).toEqual([
          {
            rollback_id: created.rollbackId,
            aggregate_refresh_id: created.aggregateRefreshId,
            restored_batch_id: priorArenaBatchId,
            idempotency_key: idempotencyKey,
            source_type: "current_arena",
          },
        ]);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
        await pool.end();
      }
    },
    120_000,
  );
});
