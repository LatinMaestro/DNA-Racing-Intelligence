import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createCloudflareR2DatasetEvidencePort } from "@/lib/cloudflare-r2-dataset-evidence-port";
import { createDnaOpenLabClientPool } from "@/lib/dna-open-lab-client-pool";
import { DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET } from "@/lib/dna-open-lab-p5-first-backfill-approval";
import { createDnaOpenLabP5FirstBackfillR2EvidenceWriter } from "@/lib/dna-open-lab-p5-first-backfill-r2-evidence";
import {
  buildDnaOpenLabP5CoreRequestPlan,
  measureDnaOpenLabP5TerminalResidual,
} from "@/lib/dna-open-lab-p5-terminal-residual-measurement";
import { DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE } from "@/lib/dna-open-lab-request-budget";
import { dnaOpenLabRawEvidenceSha256 } from "@/lib/dna-open-lab-v1-adapters";
import { createDnaOpenLabV1Client } from "@/lib/dna-open-lab-v1-client";
import {
  createNeonDnaOpenLabP5FirstBackfillLedger,
  type DnaOpenLabP5FirstBackfillDurableReceipt,
} from "@/lib/neon-dna-open-lab-p5-first-backfill-ledger";
import { createNeonDnaOpenLabP5RecoverySafetyInspector } from "@/lib/neon-dna-open-lab-p5-recovery-safety-port";

const connected =
  process.env.DNA_OPEN_LAB_P5_TERMINAL_RESIDUAL_MEASUREMENT === "1";
const describeConnected = connected ? describe : describe.skip;
const API_KEY_PATTERN = /^dna_[A-Za-z0-9_-]{43}$/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const RUNTIME_ROLE = "dna_app_runtime";
const REPORT_FILE = "dna-open-lab-p5-terminal-residual-measurement.json";
const VAULT_CORES_RECEIPT_ORDINAL = 17_379;
const ORIGINAL_CORE_REQUEST_COUNT = 72;
const CHECKPOINT_CORE_REQUEST_COUNT = 75;
const LATE_CORE_RECEIPT_ORDINALS = Object.freeze([17_454, 17_455, 17_456]);
const R2_BYTES_PER_BILLABLE_GB = 1_000_000_000;
const R2_STORAGE_MICRO_USD_PER_GB_MONTH = 15_000;
const R2_CLASS_A_MICRO_USD_PER_MILLION = 4_500_000;
const R2_CLASS_B_MICRO_USD_PER_MILLION = 360_000;
const EXPECTED_FAMILY_COUNTS = Object.freeze({
  finished_races: 17_369,
  race_activity: 7,
  token_prices: 1,
  vault_identity: 4,
  core_current_state: CHECKPOINT_CORE_REQUEST_COUNT,
  splice_arena: 0,
});

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

function ceilScaledCost(
  units: number,
  microUsdPerScale: number,
  scale: number,
): number {
  const numerator = BigInt(units) * BigInt(microUsdPerScale);
  return Number((numerator + BigInt(scale) - 1n) / BigInt(scale));
}

function projectedR2CostMicroUsd(input: {
  retainedR2BytesUpperBound: number;
  classAOperationsUpperBound: number;
  classBOperationsUpperBound: number;
}): number {
  return (
    ceilScaledCost(
      input.retainedR2BytesUpperBound,
      R2_STORAGE_MICRO_USD_PER_GB_MONTH,
      R2_BYTES_PER_BILLABLE_GB,
    ) +
    ceilScaledCost(
      input.classAOperationsUpperBound,
      R2_CLASS_A_MICRO_USD_PER_MILLION,
      1_000_000,
    ) +
    ceilScaledCost(
      input.classBOperationsUpperBound,
      R2_CLASS_B_MICRO_USD_PER_MILLION,
      1_000_000,
    )
  );
}

async function loadAllReceipts(input: {
  ledger: ReturnType<typeof createNeonDnaOpenLabP5FirstBackfillLedger>;
  expectedCount: number;
}): Promise<readonly DnaOpenLabP5FirstBackfillDurableReceipt[]> {
  const receipts: DnaOpenLabP5FirstBackfillDurableReceipt[] = [];
  while (receipts.length < input.expectedCount) {
    const page = await input.ledger.loadReceipts({
      afterRequestOrdinal: receipts.length,
      limit: Math.min(500, input.expectedCount - receipts.length),
    });
    if (page.length < 1)
      throw new Error("durable receipt ledger is incomplete");
    for (const receipt of page) {
      if (receipt.requestOrdinal !== receipts.length + 1) {
        throw new Error("durable receipt ordinals are not contiguous");
      }
      receipts.push(receipt);
    }
  }
  return Object.freeze(receipts);
}

describeConnected("hosted P5 terminal residual measurement", () => {
  it("proves the incomplete Core tail before measuring the full residual read-only", async () => {
    try {
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
      const exactMainCommit = requiredEnvironment("GITHUB_SHA").toLowerCase();
      if (!COMMIT_PATTERN.test(exactMainCommit)) {
        throw new Error("exact main commit is invalid");
      }
      const repository = requiredEnvironment("GITHUB_REPOSITORY");
      const runId = requiredEnvironment("GITHUB_RUN_ID");
      const runAttempt = requiredEnvironment("GITHUB_RUN_ATTEMPT");
      const runnerTemp = requiredEnvironment("RUNNER_TEMP");
      const authorizedOwnerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
      const databaseOwnerId = requiredEnvironment("DNA_DATABASE_OWNER_ID");
      const databaseUrl = requiredEnvironment("DATABASE_URL");
      const bucketName = requiredEnvironment("DNA_R2_BUCKET_NAME");
      const vault = requiredEnvironment("DNA_OPEN_LAB_VAULT");
      const packet = DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET;
      if (
        packet.status !== "approved_for_first_private_preview_backfill" ||
        packet.measuredUpperBound === null
      ) {
        throw new Error("approved P5 checkpoint authority is unavailable");
      }
      const ledger = createNeonDnaOpenLabP5FirstBackfillLedger({
        databaseUrl,
        databaseOwnerId,
        ownerId: authorizedOwnerId,
        runtimeRole: RUNTIME_ROLE,
        approvalPacket: packet,
      });
      const checkpointBefore = await ledger.load();
      if (
        checkpointBefore === null ||
        checkpointBefore.status !== "running" ||
        checkpointBefore.logicalRequestCount !== 17_456 ||
        checkpointBefore.nextRequestOrdinal !== 17_457 ||
        checkpointBefore.omittedIdentityObservationCount !== 1 ||
        checkpointBefore.completionSha256 !== null
      ) {
        throw new Error("P5 checkpoint is not the expected safe terminal stop");
      }
      const receipts = await loadAllReceipts({
        ledger,
        expectedCount: checkpointBefore.logicalRequestCount,
      });
      const familyCounts = Object.fromEntries(
        Object.keys(EXPECTED_FAMILY_COUNTS).map((family) => [family, 0]),
      ) as Record<keyof typeof EXPECTED_FAMILY_COUNTS, number>;
      let retainedBytes = 0;
      for (const receipt of receipts) {
        if (!(receipt.family in familyCounts)) {
          throw new Error("durable receipt family is invalid");
        }
        familyCounts[receipt.family as keyof typeof familyCounts] += 1;
        retainedBytes += receipt.byteLength;
      }
      if (
        JSON.stringify(familyCounts) !==
          JSON.stringify(EXPECTED_FAMILY_COUNTS) ||
        retainedBytes !== checkpointBefore.retainedR2Bytes
      ) {
        throw new Error("durable family receipt counts do not reconcile");
      }

      const storage = createCloudflareR2DatasetEvidencePort({
        accountId: requiredEnvironment("CLOUDFLARE_ACCOUNT_ID"),
        apiToken: requiredEnvironment("CLOUDFLARE_API_TOKEN"),
        accessKeyId: requiredEnvironment("DNA_R2_ACCESS_KEY_ID"),
        secretAccessKey: requiredEnvironment("DNA_R2_SECRET_ACCESS_KEY"),
      });
      const evidence = createDnaOpenLabP5FirstBackfillR2EvidenceWriter({
        ownerId: authorizedOwnerId,
        bucketName,
        storage,
        approvalPacket: packet,
        priorReceipts: receipts,
      });
      const vaultCoresDocument = await evidence.read(
        VAULT_CORES_RECEIPT_ORDINAL,
      );
      if (
        vaultCoresDocument === null ||
        vaultCoresDocument.family !== "vault_identity" ||
        vaultCoresDocument.endpoint !== "vault.cores_full" ||
        dnaOpenLabRawEvidenceSha256(vaultCoresDocument.request) !==
          dnaOpenLabRawEvidenceSha256({ vault })
      ) {
        throw new Error("immutable vault Core authority is invalid");
      }
      const corePlan = buildDnaOpenLabP5CoreRequestPlan(
        vaultCoresDocument.response.result,
      );
      if (
        corePlan.length <= CHECKPOINT_CORE_REQUEST_COUNT ||
        corePlan.length > CHECKPOINT_CORE_REQUEST_COUNT + 29
      ) {
        throw new Error(
          "immutable Core residual exceeds its bounded measurement",
        );
      }
      for (
        let index = 0;
        index < LATE_CORE_RECEIPT_ORDINALS.length;
        index += 1
      ) {
        const ordinal = LATE_CORE_RECEIPT_ORDINALS[index];
        if (ordinal === undefined) {
          throw new Error("late Core receipt ordinal is unavailable");
        }
        const document = await evidence.read(ordinal);
        const planned = corePlan[ORIGINAL_CORE_REQUEST_COUNT + index];
        if (
          document === null ||
          planned === undefined ||
          document.family !== "core_current_state" ||
          document.endpoint !== planned.endpoint ||
          dnaOpenLabRawEvidenceSha256(document.request) !==
            dnaOpenLabRawEvidenceSha256({ hids: planned.hids })
        ) {
          throw new Error(
            "late Core receipt disagrees with immutable Core plan",
          );
        }
      }

      const safetyInspector = createNeonDnaOpenLabP5RecoverySafetyInspector({
        authorizedOwnerId,
        databaseOwnerId,
        databaseUrl,
        runtimeRole: RUNTIME_ROLE,
      });
      const servingBefore = await safetyInspector();
      const clients = apiKeys.map((apiKey) =>
        createDnaOpenLabV1Client({ apiKey }),
      );
      const clientPool = createDnaOpenLabClientPool({
        lanes: clients.map((client, index) => ({
          id: `key-${index + 1}`,
          client,
          scopes: ["cores", "splice"],
        })),
        aggregateRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
        maximumLaneRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
        allowIndependentRateBuckets: false,
      });
      const authorityCutoffAt = new Date().toISOString();
      const measurement = await measureDnaOpenLabP5TerminalResidual({
        clientPool,
        vaultCores: vaultCoresDocument.response.result,
        completedCoreRequestCount: CHECKPOINT_CORE_REQUEST_COUNT,
        authorityCutoffAt,
      });
      const [checkpointAfter, servingAfter] = await Promise.all([
        ledger.load(),
        safetyInspector(),
      ]);
      if (
        JSON.stringify(checkpointAfter) !== JSON.stringify(checkpointBefore) ||
        JSON.stringify(servingAfter) !== JSON.stringify(servingBefore)
      ) {
        throw new Error(
          "read-only residual measurement changed provider state",
        );
      }

      const proposedUpperBoundsWithoutCost = Object.freeze({
        logicalRequestLimit:
          checkpointBefore.logicalRequestCount +
          measurement.logicalRequestCount,
        sourceRecordUpperBound:
          packet.measuredUpperBound.sourceRecordUpperBound +
          measurement.projectedUpperBounds.sourceRecordUpperBound,
        apiRequestUpperBound:
          packet.measuredUpperBound.apiRequestUpperBound +
          measurement.projectedUpperBounds.apiRequestUpperBound,
        retainedR2BytesUpperBound:
          packet.measuredUpperBound.retainedR2BytesUpperBound +
          measurement.projectedUpperBounds.retainedR2BytesUpperBound,
        classAOperationsUpperBound:
          packet.measuredUpperBound.classAOperationsUpperBound +
          measurement.projectedUpperBounds.classAOperationsUpperBound,
        classBOperationsUpperBound:
          packet.measuredUpperBound.classBOperationsUpperBound +
          measurement.projectedUpperBounds.classBOperationsUpperBound,
        neonPeakBytesUpperBound:
          packet.measuredUpperBound.neonPeakBytesUpperBound +
          measurement.projectedUpperBounds.neonIncrementalBytesUpperBound,
      });
      const proposedPacketUpperBounds = Object.freeze({
        ...proposedUpperBoundsWithoutCost,
        projectedCostMicroUsd: projectedR2CostMicroUsd(
          proposedUpperBoundsWithoutCost,
        ),
      });
      const reportBase = Object.freeze({
        schemaVersion: 1 as const,
        evidenceKind:
          "dna_open_lab_p5_terminal_residual_checkpoint_measurement" as const,
        exactMainCommit,
        repositoryRef: "refs/heads/main" as const,
        runRef: `https://github.com/${repository}/actions/runs/${runId}/attempts/${runAttempt}`,
        failedContinuationRunRef:
          "https://github.com/LatinMaestro/DNA-Racing-Intelligence/actions/runs/33688023472",
        checkpoint: Object.freeze({
          status: checkpointBefore.status,
          nextRequestOrdinal: checkpointBefore.nextRequestOrdinal,
          logicalRequestCount: checkpointBefore.logicalRequestCount,
          retainedR2Bytes: checkpointBefore.retainedR2Bytes,
          omittedIdentityObservationCount:
            checkpointBefore.omittedIdentityObservationCount,
          completionSha256: checkpointBefore.completionSha256,
          familyCounts: Object.freeze({ ...familyCounts }),
        }),
        immutablePlanProof: Object.freeze({
          vaultCoresReceiptOrdinal: VAULT_CORES_RECEIPT_ORDINAL,
          lateCoreReceiptOrdinals: LATE_CORE_RECEIPT_ORDINALS,
          verifiedR2ReadCount: 4,
          expectedCoreRequestCount: corePlan.length,
          completedCoreRequestCount: CHECKPOINT_CORE_REQUEST_COUNT,
        }),
        measurement,
        proposedUpperBounds: proposedPacketUpperBounds,
        persistentOwnerDataWriteCount: 0 as const,
        r2WriteCount: 0 as const,
        rawPayloadIncluded: false as const,
        secretMaterialIncluded: false as const,
        lastGoodPublicationChanged: false as const,
        productionChangesAllowed: false as const,
      });
      const report = Object.freeze({
        ...reportBase,
        evidenceSha256: dnaOpenLabRawEvidenceSha256(reportBase),
      });
      if (
        !SHA_256_PATTERN.test(report.evidenceSha256) ||
        proposedPacketUpperBounds.neonPeakBytesUpperBound >
          packet.measuredUpperBound.neonCapacityLimitBytes
      ) {
        throw new Error("terminal residual evidence exceeds safe bounds");
      }
      await writeFile(
        join(runnerTemp, REPORT_FILE),
        `${JSON.stringify(report)}\n`,
        {
          encoding: "utf8",
          flag: "wx",
        },
      );
      console.log(JSON.stringify(report));
      expect(report).toMatchObject({
        exactMainCommit,
        persistentOwnerDataWriteCount: 0,
        r2WriteCount: 0,
        rawPayloadIncluded: false,
        secretMaterialIncluded: false,
        lastGoodPublicationChanged: false,
        productionChangesAllowed: false,
      });
    } catch {
      throw new Error("DNA Open Lab P5 terminal residual measurement failed");
    }
  }, 600_000);
});
