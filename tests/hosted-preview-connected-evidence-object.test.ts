import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import { Pool } from "@neondatabase/serverless";
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import { createCloudflareR2DatasetEvidencePort } from "../lib/cloudflare-r2-dataset-evidence-port";
import { createNeonDatasetEvidenceObjectRepository } from "../lib/neon-dataset-evidence-object-repository";
import { createPrivateDatasetEvidenceObjectWriter } from "../lib/private-dataset-evidence-object-writer";

const connected = process.env.DNA_CONNECTED_PREVIEW_ACCEPTANCE === "1";
const describeConnected = connected ? describe : describe.skip;
const importBatchId = "45200000-0000-4000-8000-000000000101";
const wrongDatabaseOwnerId = "45200000-0000-4000-8000-000000000999";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (value === "" || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

function stream(payload: Uint8Array): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield payload;
  })();
}

describeConnected("connected Preview immutable evidence object", () => {
  it("streams to private R2, verifies provider checksum, registers once, replays, and cleans storage", async () => {
    const accountId = requiredEnvironment("CLOUDFLARE_ACCOUNT_ID");
    const apiToken = requiredEnvironment("CLOUDFLARE_API_TOKEN");
    const accessKeyId = requiredEnvironment("DNA_R2_ACCESS_KEY_ID");
    const secretAccessKey = requiredEnvironment("DNA_R2_SECRET_ACCESS_KEY");
    const databaseUrl = requiredEnvironment("DATABASE_URL");
    const databaseOwnerId = requiredEnvironment("DNA_DATABASE_OWNER_ID");
    const ownerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
    const bucketName = "dna-racing-import-preview";
    const createdAt = "2026-08-23T07:30:00.000Z";
    const fixtureChecksum = createHash("sha256")
      .update(`connected-evidence-fixture:${importBatchId}`)
      .digest("hex");
    const payload = gzipSync(
      Buffer.from(
        JSON.stringify({
          event_id: "synthetic-evidence-event",
          core_id: "synthetic-evidence-core",
          source_row: 1,
        }) + "\n",
        "utf8",
      ),
    );
    const checksumSha256 = createHash("sha256").update(payload).digest("hex");
    const ownerPrefix = createHash("sha256")
      .update("dna-evidence-owner\u0000" + ownerId)
      .digest("hex");
    const objectKey = [
      "evidence",
      ownerPrefix,
      importBatchId,
      "race_merge",
      "normalized_partition",
      "part-0000.ndjson.gz",
    ].join("/");
    const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    const cleanupClient = new S3Client({
      region: "auto",
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
    const pool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    const repository = createNeonDatasetEvidenceObjectRepository({
      databaseUrl,
      databaseOwnerId,
      runtimeRole: "dna_app_runtime",
    });
    const writer = createPrivateDatasetEvidenceObjectWriter({
      ownerId,
      bucketName,
      maximumObjectBytes: 1024 * 1024,
      createPort: () =>
        createCloudflareR2DatasetEvidencePort({
          accountId,
          accessKeyId,
          secretAccessKey,
          apiToken,
        }),
      repository,
    });

    const setup = await pool.connect();
    try {
      await setup.query("BEGIN");
      await setup.query("SELECT set_config('app.owner_id', $1, true)", [
        databaseOwnerId,
      ]);
      const priorCleanup = await setup.query(
        `SELECT status, deleted_manifest_count
         FROM dna.cleanup_unlinked_dataset_evidence_batch(
           $1::uuid, $2::uuid, $3::character(64)
         )`,
        [databaseOwnerId, importBatchId, fixtureChecksum],
      );
      expect(["cleaned", "not_found"]).toContain(
        priorCleanup.rows[0]?.status,
      );
      const stale = await setup.query(
        `SELECT
           (SELECT count(*)::integer FROM dna.import_batch
             WHERE owner_id = $1::uuid AND id = $2::uuid) AS batches,
           (SELECT count(*)::integer FROM dna.dataset_evidence_object
             WHERE owner_id = $1::uuid AND import_batch_id = $2::uuid) AS manifests`,
        [databaseOwnerId, importBatchId],
      );
      expect(stale.rows).toEqual([{ batches: 0, manifests: 0 }]);
      await setup.query(
        `INSERT INTO dna.import_batch (
           id, owner_id, source_type, source_filename, checksum_sha256,
           detected_encoding, schema_version, status, uploaded_at,
           source_rows, accepted_rows, rejected_rows, warning_rows
         ) VALUES (
           $1::uuid, $2::uuid, 'race_merge', 'synthetic-evidence-connected.csv',
           $3::character(64), 'utf_8', 'race-merge/v1', 'validating',
           $4::timestamptz, 1, 0, 1, 0
         )`,
        [importBatchId, databaseOwnerId, fixtureChecksum, createdAt],
      );
      await setup.query("COMMIT");
    } catch (error) {
      await setup.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      setup.release();
    }

    const writeInput = () => ({
      ownerId,
      importBatchId,
      sourceType: "race_merge" as const,
      objectKind: "normalized_partition" as const,
      partitionNumber: 0,
      objectFormat: "ndjson_gzip" as const,
      body: stream(payload),
      byteSize: payload.byteLength,
      rowCount: 1,
      checksumSha256,
      firstNaturalKey: "synthetic-evidence-event:synthetic-evidence-core",
      lastNaturalKey: "synthetic-evidence-event:synthetic-evidence-core",
      createdAt,
    });

    let createdId: string | null = null;
    try {
      const created = await writer.write(writeInput());
      expect(created).toMatchObject({
        status: "created",
        storageStatus: "created",
        objectKey,
      });
      createdId = created.evidenceObjectId;

      await expect(writer.write(writeInput())).resolves.toEqual({
        ...created,
        status: "existing",
        storageStatus: "existing",
      });

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.owner_id', $1, true)", [
          wrongDatabaseOwnerId,
        ]);
        const isolated = await client.query(
          "SELECT count(*)::integer AS count FROM dna.dataset_evidence_object",
        );
        expect(isolated.rows).toEqual([{ count: 0 }]);

        await client.query("SELECT set_config('app.owner_id', $1, true)", [
          databaseOwnerId,
        ]);
        const manifest = await client.query(
          `SELECT
             id::text AS evidence_object_id,
             source_type,
             object_kind,
             partition_number,
             object_format,
             object_key,
             checksum_sha256::text AS checksum_sha256,
             byte_size::integer AS byte_size,
             row_count::integer AS row_count
           FROM dna.dataset_evidence_object
           WHERE owner_id = $1::uuid AND import_batch_id = $2::uuid`,
          [databaseOwnerId, importBatchId],
        );
        expect(manifest.rows).toEqual([
          {
            evidence_object_id: createdId,
            source_type: "race_merge",
            object_kind: "normalized_partition",
            partition_number: 0,
            object_format: "ndjson_gzip",
            object_key: objectKey,
            checksum_sha256: checksumSha256,
            byte_size: payload.byteLength,
            row_count: 1,
          },
        ]);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
    } finally {
      try {
        await cleanupClient.send(
          new DeleteObjectCommand({ Bucket: bucketName, Key: objectKey }),
        );
      } finally {
        const cleanup = await pool.connect();
        try {
          await cleanup.query("BEGIN");
          await cleanup.query("SELECT set_config('app.owner_id', $1, true)", [
            databaseOwnerId,
          ]);
          const cleaned = await cleanup.query(
            `SELECT status, deleted_manifest_count
             FROM dna.cleanup_unlinked_dataset_evidence_batch(
               $1::uuid, $2::uuid, $3::character(64)
             )`,
            [databaseOwnerId, importBatchId, fixtureChecksum],
          );
          expect(cleaned.rows).toEqual([
            { status: "cleaned", deleted_manifest_count: 1 },
          ]);
          const residue = await cleanup.query(
            `SELECT
               (SELECT count(*)::integer FROM dna.import_batch
                 WHERE owner_id = $1::uuid AND id = $2::uuid) AS batches,
               (SELECT count(*)::integer FROM dna.dataset_evidence_object
                 WHERE owner_id = $1::uuid AND import_batch_id = $2::uuid) AS manifests`,
            [databaseOwnerId, importBatchId],
          );
          expect(residue.rows).toEqual([{ batches: 0, manifests: 0 }]);
          await cleanup.query("COMMIT");
        } catch (error) {
          await cleanup.query("ROLLBACK").catch(() => undefined);
          throw error;
        } finally {
          cleanup.release();
          await pool.end();
        }
      }
    }

    expect(createdId).not.toBeNull();
    const remaining = await cleanupClient.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: objectKey,
        MaxKeys: 1,
      }),
    );
    expect(remaining.KeyCount ?? 0).toBe(0);
  }, 120_000);
});
