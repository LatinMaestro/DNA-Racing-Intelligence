import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import { createCloudflareR2DatasetEvidencePort } from "@/lib/cloudflare-r2-dataset-evidence-port";
import { createDnaOpenLabClientPool } from "@/lib/dna-open-lab-client-pool";
import { DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET } from "@/lib/dna-open-lab-p5-first-backfill-approval";
import { createDnaOpenLabP5FirstBackfillFamilyAdapter } from "@/lib/dna-open-lab-p5-first-backfill-family-adapter";
import { createDnaOpenLabP5FirstBackfillPersistenceCoordinator } from "@/lib/dna-open-lab-p5-first-backfill-persistence-coordinator";
import {
  DNA_OPEN_LAB_P5_FIRST_BACKFILL_PROJECTION_POLICY,
  projectDnaOpenLabP5FirstBackfillFamilyUpperBounds,
} from "@/lib/dna-open-lab-p5-first-backfill-projection-policy";
import {
  DNA_OPEN_LAB_P5_PERSISTENT_COMMISSIONING_REQUESTS_PER_MINUTE,
  runDnaOpenLabP5FirstBackfillPersistentAcquisition,
  type DnaOpenLabP5PersistentCommissioningRateAuthorization,
} from "@/lib/dna-open-lab-p5-first-backfill-persistent-acquisition";
import { createDnaOpenLabV1Client } from "@/lib/dna-open-lab-v1-client";
import { createNeonDnaOpenLabP5FirstBackfillLedger } from "@/lib/neon-dna-open-lab-p5-first-backfill-ledger";
import { createNeonDnaOpenLabP5RecoverySafetyInspector } from "@/lib/neon-dna-open-lab-p5-recovery-safety-port";

const connected = process.env.DNA_OPEN_LAB_P5_PERSISTENT_FIRST_BACKFILL === "1";
const describeConnected = connected ? describe : describe.skip;
const API_KEY_PATTERN = /^dna_[A-Za-z0-9_-]{43}$/u;
const RUNTIME_ROLE = "dna_app_runtime";
const HISTORY_START_AT = "1970-01-01T00:00:00.000Z";
const BEFORE_FILE = "dna-open-lab-p5-first-backfill-before.json";
const PREFLIGHT_REPORT = "dna-open-lab-p5-first-backfill-preflight.json";
const EXECUTION_REPORT = "dna-open-lab-p5-first-backfill-execution.json";
const INSPECTION_REPORT = "dna-open-lab-p5-first-backfill-inspection.json";

type Mode = "preflight" | "execute" | "inspect";

type Configuration = Readonly<{
  accountId: string;
  apiKeys: readonly [string, string, string];
  apiToken: string;
  authorizedOwnerId: string;
  bucketName: string;
  databaseOwnerId: string;
  databaseUrl: string;
  mode: Mode;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  runnerTemp: string;
  vault: string;
}>;

type ServingSafety = Readonly<{
  ownerDataSha256: string;
  checkpointStateSha256: string;
  servingStateSha256: string;
  retainedEvidenceSha256: string;
  persistentOwnerDataRowCount: number;
}>;

type R2Inventory = Readonly<{
  objectCount: number;
  retainedBytes: number;
}>;

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (
    value === undefined ||
    value.length < 1 ||
    value.trim() !== value ||
    value.length > 4_096 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

function mode(): Mode {
  const value = requiredEnvironment(
    "DNA_OPEN_LAB_P5_PERSISTENT_FIRST_BACKFILL_MODE",
  );
  if (value !== "preflight" && value !== "execute" && value !== "inspect") {
    throw new Error("persistent first-backfill mode is invalid");
  }
  return value;
}

function configuration(): Configuration {
  const apiKeys = [
    requiredEnvironment("DNA_OPEN_LAB_API_KEY_1"),
    requiredEnvironment("DNA_OPEN_LAB_API_KEY_2"),
    requiredEnvironment("DNA_OPEN_LAB_API_KEY_3"),
  ] as const;
  if (
    apiKeys.some((key) => !API_KEY_PATTERN.test(key)) ||
    new Set(apiKeys).size !== apiKeys.length
  ) {
    throw new Error("three distinct DNA Open Lab API keys are required");
  }
  return Object.freeze({
    accountId: requiredEnvironment("CLOUDFLARE_ACCOUNT_ID"),
    apiKeys,
    apiToken: requiredEnvironment("CLOUDFLARE_API_TOKEN"),
    authorizedOwnerId: requiredEnvironment("AUTHORIZED_CLERK_USER_ID"),
    bucketName: requiredEnvironment("DNA_R2_BUCKET_NAME"),
    databaseOwnerId: requiredEnvironment("DNA_DATABASE_OWNER_ID"),
    databaseUrl: requiredEnvironment("DATABASE_URL"),
    mode: mode(),
    r2AccessKeyId: requiredEnvironment("DNA_R2_ACCESS_KEY_ID"),
    r2SecretAccessKey: requiredEnvironment("DNA_R2_SECRET_ACCESS_KEY"),
    runnerTemp: requiredEnvironment("RUNNER_TEMP"),
    vault: requiredEnvironment("DNA_OPEN_LAB_VAULT"),
  });
}

function approvalLimits(): Readonly<{
  logicalRequestLimit: number;
  measurementEvidenceSha256: string;
  maximumAuthorizedMicroUsd: number;
  retainedR2BytesLimit: number;
}> {
  const packet = DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET;
  if (
    packet.status !== "approved_for_first_private_preview_backfill" ||
    packet.measuredUpperBound === null ||
    packet.identityOmissionAuthority === null ||
    packet.ownerAuthorization === null
  ) {
    throw new Error("persistent first-backfill approval is unavailable");
  }
  const logicalRequestLimit =
    packet.measuredUpperBound.classBOperationsUpperBound /
    DNA_OPEN_LAB_P5_FIRST_BACKFILL_PROJECTION_POLICY.r2ClassBOperationsPerLogicalRequest;
  if (!Number.isSafeInteger(logicalRequestLimit)) {
    throw new Error("persistent first-backfill request limit is invalid");
  }
  return Object.freeze({
    logicalRequestLimit,
    measurementEvidenceSha256:
      packet.identityOmissionAuthority.measurementEvidenceSha256,
    maximumAuthorizedMicroUsd:
      packet.ownerAuthorization.maximumAuthorizedMicroUsd,
    retainedR2BytesLimit: packet.measuredUpperBound.retainedR2BytesUpperBound,
  });
}

function ledger(input: Configuration) {
  return createNeonDnaOpenLabP5FirstBackfillLedger({
    databaseUrl: input.databaseUrl,
    databaseOwnerId: input.databaseOwnerId,
    ownerId: input.authorizedOwnerId,
    runtimeRole: RUNTIME_ROLE,
    approvalPacket: DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET,
  });
}

function r2(input: Configuration) {
  return createCloudflareR2DatasetEvidencePort({
    accountId: input.accountId,
    apiToken: input.apiToken,
    accessKeyId: input.r2AccessKeyId,
    secretAccessKey: input.r2SecretAccessKey,
  });
}

function safetyInspector(input: Configuration): () => Promise<ServingSafety> {
  return createNeonDnaOpenLabP5RecoverySafetyInspector({
    authorizedOwnerId: input.authorizedOwnerId,
    databaseOwnerId: input.databaseOwnerId,
    databaseUrl: input.databaseUrl,
    runtimeRole: RUNTIME_ROLE,
  });
}

function ownerPrefix(ownerId: string): string {
  return createHash("sha256")
    .update(`dna-open-lab-owner\u0000${ownerId}`, "utf8")
    .digest("hex");
}

async function inspectR2(input: Configuration): Promise<R2Inventory> {
  const limits = approvalLimits();
  const prefix = [
    "dna-open-lab",
    "v1",
    ownerPrefix(input.authorizedOwnerId),
    "first-private-preview-backfill",
    limits.measurementEvidenceSha256,
    "requests",
    "",
  ].join("/");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${input.accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: input.r2AccessKeyId,
      secretAccessKey: input.r2SecretAccessKey,
    },
  });
  let continuationToken: string | undefined;
  let objectCount = 0;
  let retainedBytes = 0;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: input.bucketName,
        Prefix: prefix,
        MaxKeys: 1_000,
        ...(continuationToken === undefined
          ? {}
          : { ContinuationToken: continuationToken }),
      }),
    );
    for (const object of page.Contents ?? []) {
      objectCount += 1;
      const expectedKey = `${prefix}${String(objectCount).padStart(6, "0")}.json`;
      if (
        object.Key !== expectedKey ||
        !Number.isSafeInteger(object.Size) ||
        Number(object.Size) < 1
      ) {
        throw new Error("persistent first-backfill R2 prefix is invalid");
      }
      retainedBytes += Number(object.Size);
      if (
        !Number.isSafeInteger(retainedBytes) ||
        objectCount > limits.logicalRequestLimit + 1 ||
        retainedBytes > limits.retainedR2BytesLimit
      ) {
        throw new Error("persistent first-backfill R2 usage exceeds authority");
      }
    }
    continuationToken = page.IsTruncated
      ? page.NextContinuationToken
      : undefined;
    if (page.IsTruncated && continuationToken === undefined) {
      throw new Error("persistent first-backfill R2 pagination is invalid");
    }
  } while (continuationToken !== undefined);
  return Object.freeze({ objectCount, retainedBytes });
}

async function inspectCheckpoint(input: Configuration) {
  const [state, objects] = await Promise.all([
    ledger(input).load(),
    inspectR2(input),
  ]);
  if (state === null) {
    if (objects.objectCount !== 0 || objects.retainedBytes !== 0) {
      throw new Error("receiptless persistent first-backfill residue exists");
    }
    return Object.freeze({ state, objects });
  }
  if (
    objects.objectCount < state.logicalRequestCount ||
    objects.objectCount > state.logicalRequestCount + 1 ||
    objects.retainedBytes < state.retainedR2Bytes
  ) {
    throw new Error("persistent first-backfill checkpoint is inconsistent");
  }
  if (
    state.status === "complete" &&
    (objects.objectCount !== state.logicalRequestCount ||
      objects.retainedBytes !== state.retainedR2Bytes)
  ) {
    throw new Error(
      "completed persistent first-backfill usage is inconsistent",
    );
  }
  return Object.freeze({ state, objects });
}

function rateAuthorization(): DnaOpenLabP5PersistentCommissioningRateAuthorization {
  const limits = approvalLimits();
  if (
    requiredEnvironment(
      "DNA_OPEN_LAB_P5_PERSISTENT_FIRST_BACKFILL_REQUESTS_PER_MINUTE",
    ) !== "150" ||
    requiredEnvironment(
      "DNA_OPEN_LAB_P5_PERSISTENT_FIRST_BACKFILL_TEMPORARY_150_RPM_APPROVED",
    ) !== "true"
  ) {
    throw new Error("persistent commissioning rate is not authorized");
  }
  return Object.freeze({
    kind: "owner_approved_one_run_persistent_private_preview_backfill",
    maximumAggregateRequestsPerMinute:
      DNA_OPEN_LAB_P5_PERSISTENT_COMMISSIONING_REQUESTS_PER_MINUTE,
    maximumAuthorizedMicroUsd: limits.maximumAuthorizedMicroUsd,
    measurementEvidenceSha256: limits.measurementEvidenceSha256,
  });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

describeConnected("hosted P5 persistent private Preview first backfill", () => {
  it("preflights, executes or inspects the exact approved checkpoint", async () => {
    try {
      const input = configuration();
      const limits = approvalLimits();
      const checkpoint = await inspectCheckpoint(input);

      if (input.mode === "preflight") {
        const privacy = await r2(input).readBucketPrivacy({
          bucketName: input.bucketName,
        });
        if (
          privacy.publicAccessDisabled !== true ||
          privacy.r2DevDisabled !== true ||
          privacy.customDomainCount !== 0
        ) {
          throw new Error("persistent first-backfill bucket is not private");
        }
        const before = await safetyInspector(input)();
        await writeJson(join(input.runnerTemp, BEFORE_FILE), before);
        await writeJson(join(input.runnerTemp, PREFLIGHT_REPORT), {
          schemaVersion: 1,
          evidenceKind: "dna_open_lab_p5_persistent_first_backfill_preflight",
          providerScope: "private_preview",
          status: "ready",
          checkpointStatus: checkpoint.state?.status ?? "absent",
          logicalRequestCount: checkpoint.state?.logicalRequestCount ?? 0,
          retainedR2Bytes: checkpoint.objects.retainedBytes,
          omittedIdentityObservationCount:
            checkpoint.state?.omittedIdentityObservationCount ?? 0,
          firstPersistentPrivatePreviewBackfillAllowed: true,
          productionChangesAllowed: false,
        });
        return;
      }

      if (input.mode === "execute") {
        const clients = input.apiKeys.map((apiKey) =>
          createDnaOpenLabV1Client({ apiKey }),
        );
        const scopes = Object.freeze([
          "vault",
          "races",
          "cores",
          "tokens",
          "splice",
        ] as const);
        const clientPool = createDnaOpenLabClientPool({
          lanes: clients.map((client, index) => ({
            id: `key-${index + 1}`,
            client,
            scopes,
          })),
          aggregateRequestsPerMinute:
            DNA_OPEN_LAB_P5_PERSISTENT_COMMISSIONING_REQUESTS_PER_MINUTE,
          maximumLaneRequestsPerMinute:
            DNA_OPEN_LAB_P5_PERSISTENT_COMMISSIONING_REQUESTS_PER_MINUTE,
          allowIndependentRateBuckets: false,
        });
        const measured =
          DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET.measuredUpperBound;
        if (measured === null) throw new Error("measurement is unavailable");
        const adapter = createDnaOpenLabP5FirstBackfillFamilyAdapter({
          vault: input.vault,
          finishedRaceHistoryStartAt: HISTORY_START_AT,
          authorityCutoffAt: measured.authorityCutoffAt,
          projectUpperBounds: projectDnaOpenLabP5FirstBackfillFamilyUpperBounds,
        });
        const coordinator =
          createDnaOpenLabP5FirstBackfillPersistenceCoordinator({
            ownerId: input.authorizedOwnerId,
            bucketName: input.bucketName,
            storage: r2(input),
            approvalPacket:
              DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET,
            ledger: ledger(input),
          });
        const result = await runDnaOpenLabP5FirstBackfillPersistentAcquisition({
          clientPool,
          approvalPacket:
            DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET,
          coordinator,
          measureFamily: adapter.measureFamily,
          rateAuthorization: rateAuthorization(),
        });
        const poolSnapshot = clientPool.snapshot();
        await writeJson(join(input.runnerTemp, EXECUTION_REPORT), {
          schemaVersion: 1,
          evidenceKind: "dna_open_lab_p5_persistent_first_backfill_execution",
          providerScope: "private_preview",
          status: result.status,
          logicalRequestCount: result.persistence.logicalRequestCount,
          retainedR2Bytes: result.persistence.retainedR2Bytes,
          omittedIdentityObservationCount:
            result.persistence.omittedIdentityObservationCount,
          apiRequestAttemptCount: result.apiRequestAttemptCount,
          replayedLogicalRequestCount: result.replayedLogicalRequestCount,
          newlyPersistedLogicalRequestCount:
            result.newlyPersistedLogicalRequestCount,
          sourceFamilyCount: result.families.length,
          effectiveAggregateRequestsPerMinute:
            poolSnapshot.aggregateBudget?.effectiveRequestsPerMinute ?? null,
          rateLimitedResponseCount: poolSnapshot.lanes.reduce(
            (total, lane) => total + lane.rateLimitedCount,
            0,
          ),
          independentRateBucketsEnabled:
            poolSnapshot.independentRateBucketsEnabled,
          firstPersistentPrivatePreviewBackfillAllowed: true,
          publicationPerformed: false,
          productionChangesAllowed: false,
        });
        expect(result.persistence).toMatchObject({
          status: "complete",
          logicalRequestCount: limits.logicalRequestLimit,
          omittedIdentityObservationCount: 1,
        });
        return;
      }

      const before = JSON.parse(
        await readFile(join(input.runnerTemp, BEFORE_FILE), "utf8"),
      ) as ServingSafety;
      const after = await safetyInspector(input)();
      expect(after).toEqual(before);
      const executionOutcome = requiredEnvironment(
        "DNA_OPEN_LAB_P5_PERSISTENT_FIRST_BACKFILL_EXECUTION_OUTCOME",
      );
      if (executionOutcome === "success") {
        expect(checkpoint.state).toMatchObject({
          status: "complete",
          logicalRequestCount: limits.logicalRequestLimit,
          omittedIdentityObservationCount: 1,
        });
        expect(checkpoint.objects).toMatchObject({
          objectCount: limits.logicalRequestLimit,
          retainedBytes: checkpoint.state?.retainedR2Bytes,
        });
      } else if (executionOutcome !== "failure") {
        throw new Error("persistent first-backfill outcome is invalid");
      }
      await writeJson(join(input.runnerTemp, INSPECTION_REPORT), {
        schemaVersion: 1,
        evidenceKind: "dna_open_lab_p5_persistent_first_backfill_inspection",
        providerScope: "private_preview",
        executionOutcome,
        checkpointStatus: checkpoint.state?.status ?? "absent",
        logicalRequestCount: checkpoint.state?.logicalRequestCount ?? 0,
        retainedR2Bytes: checkpoint.objects.retainedBytes,
        omittedIdentityObservationCount:
          checkpoint.state?.omittedIdentityObservationCount ?? 0,
        pendingR2FirstObjectCount:
          checkpoint.objects.objectCount -
          (checkpoint.state?.logicalRequestCount ?? 0),
        servingStateUnchanged: true,
        commissioningGenerationCreated: false,
        temporaryProviderResidueCount: 0,
        publicationPerformed: false,
        productionChangesAllowed: false,
      });
    } catch {
      throw new Error("DNA Open Lab P5 persistent first backfill failed");
    }
  }, 19_200_000);
});
