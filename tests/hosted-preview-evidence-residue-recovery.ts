import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import {
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { Pool } from "@neondatabase/serverless";

import { createCloudflareR2DatasetEvidencePort } from "../lib/cloudflare-r2-dataset-evidence-port";
import {
  createNeonDatasetEvidenceObjectRepository,
  type DatasetEvidenceObjectFormat,
  type DatasetEvidenceObjectKind,
  type DatasetEvidenceSourceType,
} from "../lib/neon-dataset-evidence-object-repository";
import {
  createPrivateDatasetEvidenceObjectRecovery,
  type StoredPrivateDatasetEvidenceObject,
} from "../lib/private-dataset-evidence-object-writer";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAXIMUM_RECOVERY_OBJECTS = 1_000;
const DEFAULT_MAXIMUM_OBJECT_BYTES = 512 * 1024 * 1024;

export type HostedPreviewEvidenceResidueRecoveryInput = Readonly<{
  ownerId: string;
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  accountId: string;
  apiToken: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  importBatchIds?: readonly string[];
  requireEmptyDurableOwnerState?: boolean;
  maximumObjectBytes?: number;
}>;

function evidenceOwnerPrefix(ownerId: string): string {
  return createHash("sha256")
    .update(`dna-evidence-owner\u0000${ownerId}`)
    .digest("hex");
}

function checksumHex(value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new Error("Preview evidence checksum is unavailable");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength !== 32) {
    throw new Error("Preview evidence checksum is invalid");
  }
  return decoded.toString("hex");
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed <= 0
  ) {
    throw new Error(`${field} is invalid`);
  }
  return parsed;
}

function parseEvidenceKey(input: {
  key: string;
  ownerPrefix: string;
}): Readonly<{
  importBatchId: string;
  sourceType: DatasetEvidenceSourceType;
  objectKind: DatasetEvidenceObjectKind;
  partitionNumber: number;
  objectFormat: DatasetEvidenceObjectFormat;
}> {
  const parts = input.key.split("/");
  if (
    parts.length !== 6 ||
    parts[0] !== "evidence" ||
    parts[1] !== input.ownerPrefix
  ) {
    throw new Error("Preview evidence object key is outside the owner prefix");
  }
  const importBatchId = parts[2] ?? "";
  const sourceType = parts[3] ?? "";
  const objectKind = parts[4] ?? "";
  const fileName = parts[5] ?? "";
  if (!UUID_PATTERN.test(importBatchId)) {
    throw new Error("Preview evidence import batch identity is invalid");
  }
  if (
    sourceType !== "race_merge" &&
    sourceType !== "core_details" &&
    sourceType !== "current_arena"
  ) {
    throw new Error("Preview evidence source type is invalid");
  }
  if (
    objectKind !== "staged_rows" &&
    objectKind !== "accepted_contributions" &&
    objectKind !== "normalized_partition"
  ) {
    throw new Error("Preview evidence object kind is invalid");
  }
  const match = /^part-([0-9]{4})\.(ndjson\.gz|parquet)$/.exec(fileName);
  if (match === null) {
    throw new Error("Preview evidence partition key is invalid");
  }
  const partitionNumber = Number(match[1]);
  if (!Number.isSafeInteger(partitionNumber)) {
    throw new Error("Preview evidence partition number is invalid");
  }
  return {
    importBatchId,
    sourceType,
    objectKind,
    partitionNumber,
    objectFormat: match[2] === "parquet" ? "parquet" : "ndjson_gzip",
  };
}

async function listKeys(input: {
  client: S3Client;
  bucketName: string;
  prefix: string;
}): Promise<readonly string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const result = await input.client.send(
      new ListObjectsV2Command({
        Bucket: input.bucketName,
        Prefix: input.prefix,
        MaxKeys: 1_000,
        ...(continuationToken === undefined
          ? {}
          : { ContinuationToken: continuationToken }),
      }),
    );
    for (const object of result.Contents ?? []) {
      if (typeof object.Key !== "string" || object.Key === "") {
        throw new Error("Preview evidence listing returned an invalid key");
      }
      keys.push(object.Key);
      if (keys.length > MAXIMUM_RECOVERY_OBJECTS) {
        throw new Error("Preview evidence recovery exceeds configured capacity");
      }
    }
    continuationToken = result.IsTruncated
      ? result.NextContinuationToken
      : undefined;
    if (result.IsTruncated && continuationToken === undefined) {
      throw new Error("Preview evidence listing pagination is incomplete");
    }
  } while (continuationToken !== undefined);
  return keys;
}

async function assertEmptyDurableOwnerState(input: {
  databaseUrl: string;
  databaseOwnerId: string;
}): Promise<void> {
  const pool = new Pool({
    connectionString: input.databaseUrl,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT set_config('app.owner_id', $1, true)", [
      input.databaseOwnerId,
    ]);
    const result = await client.query(
      `SELECT
        (SELECT count(*) FROM dna.import_upload_batch WHERE owner_id = $1::uuid) AS upload_batches,
        (SELECT count(*) FROM dna.import_batch WHERE owner_id = $1::uuid) AS import_batches,
        (SELECT count(*) FROM dna.dataset_version WHERE owner_id = $1::uuid) AS dataset_versions,
        (SELECT count(*) FROM dna.dataset_evidence_object WHERE owner_id = $1::uuid) AS evidence_objects,
        (SELECT count(*) FROM dna.import_preview_processing WHERE owner_id = $1::uuid) AS preview_processing,
        (SELECT count(*) FROM dna.import_prepared_preview WHERE owner_id = $1::uuid) AS prepared_previews,
        (SELECT count(*) FROM dna.import_activation_dispatch WHERE owner_id = $1::uuid) AS activation_dispatches`,
      [input.databaseOwnerId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      throw new Error("Preview durable owner state could not be inspected");
    }
    const counts = Object.values(row).map((value) => Number(value));
    if (
      counts.some(
        (value) => !Number.isSafeInteger(value) || value < 0 || value !== 0,
      )
    ) {
      throw new Error(
        "Preview durable owner state is not empty; evidence recovery is blocked",
      );
    }
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

export async function recoverHostedPreviewEvidenceResidue(
  input: HostedPreviewEvidenceResidueRecoveryInput,
): Promise<Readonly<{ deleted: number; retained: number; missing: number }>> {
  if (input.requireEmptyDurableOwnerState === true) {
    await assertEmptyDurableOwnerState(input);
  }
  const maximumObjectBytes =
    input.maximumObjectBytes ?? DEFAULT_MAXIMUM_OBJECT_BYTES;
  if (!Number.isSafeInteger(maximumObjectBytes) || maximumObjectBytes <= 0) {
    throw new Error("maximumObjectBytes is invalid");
  }
  const ownerPrefix = evidenceOwnerPrefix(input.ownerId);
  const listClient = new S3Client({
    region: "auto",
    endpoint: `https://${input.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    },
  });
  const requestedBatchIds =
    input.importBatchIds === undefined
      ? null
      : new Set(
          input.importBatchIds.map((value) => {
            const normalized = value.trim().toLowerCase();
            if (!UUID_PATTERN.test(normalized)) {
              throw new Error("Preview evidence cleanup batch ID is invalid");
            }
            return normalized;
          }),
        );
  const prefixes =
    requestedBatchIds === null
      ? [`evidence/${ownerPrefix}/`]
      : [...requestedBatchIds].map(
          (importBatchId) => `evidence/${ownerPrefix}/${importBatchId}/`,
        );
  const keys = [
    ...new Set(
      (
        await Promise.all(
          prefixes.map((prefix) =>
            listKeys({ client: listClient, bucketName: input.bucketName, prefix }),
          ),
        )
      ).flat(),
    ),
  ];
  const stored: StoredPrivateDatasetEvidenceObject[] = [];
  for (const key of keys) {
    const parsed = parseEvidenceKey({ key, ownerPrefix });
    if (
      requestedBatchIds !== null &&
      !requestedBatchIds.has(parsed.importBatchId.toLowerCase())
    ) {
      throw new Error("Preview evidence cleanup crossed a batch boundary");
    }
    const head = await listClient.send(
      new HeadObjectCommand({
        Bucket: input.bucketName,
        Key: key,
        ChecksumMode: "ENABLED",
      }),
    );
    const byteSize = positiveInteger(head.ContentLength, "Preview evidence size");
    if (byteSize > maximumObjectBytes) {
      throw new Error("Preview evidence object exceeds recovery capacity");
    }
    const rowCount = positiveInteger(
      head.Metadata?.rows,
      "Preview evidence row count",
    );
    const expectedContentType =
      parsed.objectFormat === "parquet"
        ? "application/vnd.apache.parquet"
        : "application/x-ndjson+gzip";
    if (
      head.ContentType?.trim().toLowerCase() !== expectedContentType ||
      head.Metadata?.source !== parsed.sourceType ||
      head.Metadata?.kind !== parsed.objectKind ||
      head.Metadata?.partition !== String(parsed.partitionNumber) ||
      !(head.LastModified instanceof Date) ||
      Number.isNaN(head.LastModified.getTime())
    ) {
      throw new Error("Preview evidence provider metadata is inconsistent");
    }
    stored.push({
      registration: {
        ownerId: input.ownerId,
        importBatchId: parsed.importBatchId,
        sourceType: parsed.sourceType,
        objectKind: parsed.objectKind,
        partitionNumber: parsed.partitionNumber,
        objectFormat: parsed.objectFormat,
        objectKey: key,
        checksumSha256: checksumHex(head.ChecksumSHA256),
        byteSize,
        rowCount,
        firstNaturalKey: null,
        lastNaturalKey: null,
        createdAt: head.LastModified.toISOString(),
      },
      storageStatus: "created",
    });
  }

  const repository = createNeonDatasetEvidenceObjectRepository({
    databaseUrl: input.databaseUrl,
    databaseOwnerId: input.databaseOwnerId,
    runtimeRole: input.runtimeRole,
  });
  if (repository.status !== "ready") {
    throw new Error("Preview evidence manifest inspection is unavailable");
  }
  const evidencePort = createCloudflareR2DatasetEvidencePort({
    accountId: input.accountId,
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
    apiToken: input.apiToken,
    maximumBufferedPutBytes: 1024 * 1024,
  });
  const recovery = createPrivateDatasetEvidenceObjectRecovery({
    ownerId: input.ownerId,
    bucketName: input.bucketName,
    maximumObjectBytes,
    maximumObjects: MAXIMUM_RECOVERY_OBJECTS,
    createPort: () => evidencePort,
    inspectionRepository: repository,
  });
  const receipts = await recovery.cleanup(stored);
  for (const prefix of prefixes) {
    const remaining = await listKeys({
      client: listClient,
      bucketName: input.bucketName,
      prefix,
    });
    if (remaining.length > 0 && requestedBatchIds !== null) {
      throw new Error("Synthetic Preview evidence residue remains after cleanup");
    }
  }
  return {
    deleted: receipts.filter(({ status }) => status === "deleted").length,
    retained: receipts.filter(({ status }) => status === "retained_registered")
      .length,
    missing: receipts.filter(({ status }) => status === "missing").length,
  };
}
