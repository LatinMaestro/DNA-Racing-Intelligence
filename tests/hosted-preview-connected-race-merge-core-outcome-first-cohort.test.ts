import { describe, expect, it } from "vitest";

import { createDefaultNeonImportPersistenceSession } from "@/lib/neon-import-persistence-driver";
import { raceMergeCoreOutcomeConnectedRuntimeFromEnvironment } from "@/lib/race-merge-core-outcome-connected-runtime";
import type { RaceMergeOutcomeImportReference } from "@/lib/race-merge-outcome-ingestion-service";

const connected =
  process.env.DNA_RACE_MERGE_CORE_OUTCOME_FIRST_COHORT === "1";
const describeConnected = connected ? describe : describe.skip;
const SOURCE_CLIENT_PATTERN =
  /^race-merge-outcome-source-v1-(\d{2})-[a-f0-9]{16}$/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;

function required(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (
    value === "" ||
    value.length > 4096 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Race Merge source reservation row is invalid");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() !== value || value === "") {
    throw new Error("Race Merge source reservation text is invalid");
  }
  return value;
}

function positiveInteger(value: unknown): number {
  const parsed =
    typeof value === "string" && /^[1-9]\d*$/u.test(value)
      ? Number(value)
      : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) < 1) {
    throw new Error("Race Merge source reservation count is invalid");
  }
  return parsed as number;
}

async function sourceReferences(): Promise<readonly RaceMergeOutcomeImportReference[]> {
  const databaseUrl = required("DATABASE_URL");
  const databaseOwnerId = required("DNA_DATABASE_OWNER_ID");
  const session = await createDefaultNeonImportPersistenceSession(databaseUrl);
  try {
    await session.client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await session.client.query("SELECT set_config('app.owner_id',$1,true)", [
      databaseOwnerId,
    ]);
    const schema = await session.client.query(
      "SELECT to_regclass('dna.race_merge_core_outcome_r2_generation')::text AS generation, to_regclass('dna.race_merge_core_outcome_r2_manifest')::text AS manifest",
    );
    const schemaRow = record(schema.rows[0]);
    if (
      schema.rows.length !== 1 ||
      schemaRow.generation !== "dna.race_merge_core_outcome_r2_generation" ||
      schemaRow.manifest !== "dna.race_merge_core_outcome_r2_manifest"
    ) {
      throw new Error("Race Merge R2 manifest schema is unavailable");
    }
    const result = await session.client.query(
      `SELECT file.id::text AS object_id,
              file.client_file_id,
              file.byte_length::text AS byte_length,
              file.sha256::text AS sha256
         FROM dna.import_upload_file file
         JOIN dna.import_upload_batch batch
           ON batch.owner_id = file.owner_id
          AND batch.id = file.upload_batch_id
        WHERE batch.owner_id = $1::uuid
          AND batch.state = 'targets_ready'
          AND file.source_family = 'race_merge'
          AND file.client_file_id LIKE 'race-merge-outcome-source-v1-%'
        ORDER BY file.client_file_id COLLATE "C"`,
      [databaseOwnerId],
    );
    if (result.rows.length !== 8) {
      throw new Error("Accepted Race Merge source reservation set is incomplete");
    }
    const observedOrdinals = new Set<number>();
    let totalBytes = 0;
    const references = result.rows.map((raw) => {
      const row = record(raw);
      const objectId = text(row.object_id);
      const clientFileId = text(row.client_file_id);
      const match = SOURCE_CLIENT_PATTERN.exec(clientFileId);
      const ordinal = match === null ? Number.NaN : Number(match[1]);
      const expectedByteLength = positiveInteger(row.byte_length);
      const expectedSha256 = text(row.sha256).toLowerCase();
      if (
        !Number.isInteger(ordinal) ||
        ordinal < 1 ||
        ordinal > 8 ||
        observedOrdinals.has(ordinal) ||
        !SHA_256_PATTERN.test(expectedSha256) ||
        expectedByteLength > 100_000_000
      ) {
        throw new Error("Accepted Race Merge source reservation authority drifted");
      }
      observedOrdinals.add(ordinal);
      totalBytes += expectedByteLength;
      return Object.freeze({
        objectId,
        sourceFamily: "race_merge" as const,
        expectedByteLength,
        expectedSha256,
      });
    });
    if (
      observedOrdinals.size !== 8 ||
      totalBytes < 1 ||
      totalBytes > 600_000_000
    ) {
      throw new Error("Accepted Race Merge source reservation bounds drifted");
    }
    await session.client.query("COMMIT");
    return Object.freeze(references);
  } catch (error) {
    await session.client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await session.close();
  }
}

describeConnected("hosted Preview Race Merge first Core-outcome cohort", () => {
  it(
    "reuses all accepted local source evidence before any DNA request",
    async () => {
      const references = await sourceReferences();
      const exactCodeHeadSha = required("GITHUB_SHA").toLowerCase();
      const runtime = raceMergeCoreOutcomeConnectedRuntimeFromEnvironment({
        authorizedOwnerId: required("AUTHORIZED_CLERK_USER_ID"),
        exactCodeHeadSha,
        cloudflareAccountId: required("CLOUDFLARE_ACCOUNT_ID"),
        cloudflareApiToken: required("CLOUDFLARE_API_TOKEN"),
        cloudflareAnalyticsApiToken: required(
          "CLOUDFLARE_ANALYTICS_API_TOKEN",
        ),
        r2BucketName: required("DNA_R2_BUCKET_NAME"),
        r2StorageClass: required("DNA_R2_STORAGE_CLASS"),
        r2AccessKeyId: required("DNA_R2_ACCESS_KEY_ID"),
        r2SecretAccessKey: required("DNA_R2_SECRET_ACCESS_KEY"),
        neonApiKey: required("NEON_API_KEY"),
        neonProjectId: required("NEON_PROJECT_ID"),
        databaseUrl: required("DATABASE_URL"),
        databaseOwnerId: required("DNA_DATABASE_OWNER_ID"),
        runtimeRole: "dna_app_runtime",
      });
      expect(runtime.status).toBe("ready");
      if (runtime.status !== "ready") {
        throw new Error("Race Merge connected runtime is unavailable");
      }

      const result = await runtime.execute({
        generationId: "owner-race-merge-outcomes-v1",
        cohortOrdinal: 1,
        afterSourceCoreId: 0,
        maximumCores: 100,
        references,
        bounds: {
          maximumFiles: 8,
          maximumTotalBytes: 600_000_000,
          maximumObjectBytes: 100_000_000,
          maximumChunkBytes: 8 * 1024 * 1024,
          maximumRowsPerObject: 2_000_000,
          maximumRowsPerGeneration: 5_000_000,
          maximumHeaderColumns: 100,
          maximumFieldCharacters: 10_000,
          maximumRowCharacters: 100_000,
          maximumSelectedObservations: 2_000_000,
        },
      });

      expect(result).toMatchObject({
        dnaProviderRequestCount: 0,
        persistentWritePerformed: true,
        paidUsageAllowed: false,
        source: {
          sourceObjectCount: 8,
          selectedCoreCount: 100,
          dnaProviderRequestCount: 0,
          persistentWritePerformed: false,
          paidUsageAllowed: false,
        },
        generation: {
          checkpointAfter: { status: "complete" },
          dnaApiRequestPerformed: false,
          persistentWritePerformed: true,
          paidUsageAllowed: false,
        },
      });
      console.log(
        JSON.stringify({
          status: "complete",
          exactCodeHeadSha,
          sourceObjectCount: result.source.sourceObjectCount,
          sourceByteLength: result.source.sourceByteLength,
          sourceRowCount: result.source.sourceRowCount,
          selectedCoreCount: result.source.selectedCoreCount,
          selectedObservationCount: result.source.selectedObservationCount,
          selectedUniqueOutcomeCount: result.source.selectedUniqueOutcomeCount,
          selectedExactReplayCount: result.selectedExactReplayCount,
          retainedR2Bytes: result.generation.authority.retainedR2Bytes,
          sourceManifestSha256: result.sourceManifestSha256,
          receiptSetSha256: result.generation.authority.receiptSetSha256,
          dnaProviderRequestCount: result.dnaProviderRequestCount,
          paidUsageAllowed: result.paidUsageAllowed,
        }),
      );
    },
    10 * 60 * 1000,
  );
});
