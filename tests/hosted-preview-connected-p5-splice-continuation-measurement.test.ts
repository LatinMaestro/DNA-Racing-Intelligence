import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createDnaOpenLabClientPool } from "@/lib/dna-open-lab-client-pool";
import { DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET } from "@/lib/dna-open-lab-p5-first-backfill-approval";
import { DNA_OPEN_LAB_P5_FIRST_BACKFILL_PROJECTION_POLICY } from "@/lib/dna-open-lab-p5-first-backfill-projection-policy";
import { measureDnaOpenLabP5SpliceContinuation } from "@/lib/dna-open-lab-p5-splice-continuation-measurement";
import { DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE } from "@/lib/dna-open-lab-request-budget";
import { dnaOpenLabRawEvidenceSha256 } from "@/lib/dna-open-lab-v1-adapters";
import { createDnaOpenLabV1Client } from "@/lib/dna-open-lab-v1-client";
import {
  createNeonDnaOpenLabP5FirstBackfillLedger,
  type DnaOpenLabP5FirstBackfillDurableReceipt,
} from "@/lib/neon-dna-open-lab-p5-first-backfill-ledger";

const connected =
  process.env.DNA_OPEN_LAB_P5_SPLICE_CONTINUATION_MEASUREMENT === "1";
const describeConnected = connected ? describe : describe.skip;
const API_KEY_PATTERN = /^dna_[A-Za-z0-9_-]{43}$/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const RUNTIME_ROLE = "dna_app_runtime";
const REPORT_FILE = "dna-open-lab-p5-splice-continuation-measurement.json";
const SOURCE_FAMILIES = Object.freeze([
  "finished_races",
  "race_activity",
  "token_prices",
  "vault_identity",
  "core_current_state",
  "splice_arena",
] as const);

type SourceFamily = (typeof SOURCE_FAMILIES)[number];

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

function approvedRequestLimit(): number {
  const bounds =
    DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET.measuredUpperBound;
  if (bounds === null) throw new Error("approved P5 bounds are unavailable");
  const limit =
    bounds.classBOperationsUpperBound /
    DNA_OPEN_LAB_P5_FIRST_BACKFILL_PROJECTION_POLICY.r2ClassBOperationsPerLogicalRequest;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("approved P5 request limit is invalid");
  }
  return limit;
}

async function loadAllReceipts(input: {
  ledger: ReturnType<typeof createNeonDnaOpenLabP5FirstBackfillLedger>;
  expectedCount: number;
}): Promise<readonly DnaOpenLabP5FirstBackfillDurableReceipt[]> {
  const receipts: DnaOpenLabP5FirstBackfillDurableReceipt[] = [];
  let afterRequestOrdinal = 0;
  while (receipts.length < input.expectedCount) {
    const page = await input.ledger.loadReceipts({
      afterRequestOrdinal,
      limit: Math.min(500, input.expectedCount - receipts.length),
    });
    if (page.length < 1)
      throw new Error("durable receipt ledger is incomplete");
    for (const receipt of page) {
      const expectedOrdinal = receipts.length + 1;
      if (receipt.requestOrdinal !== expectedOrdinal) {
        throw new Error("durable receipt ordinals are not contiguous");
      }
      receipts.push(receipt);
    }
    afterRequestOrdinal = receipts.at(-1)?.requestOrdinal ?? 0;
  }
  return Object.freeze(receipts);
}

describeConnected("hosted P5 splice continuation measurement", () => {
  it("measures the missing family read-only from the exact safe checkpoint", async () => {
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
      const authorizedOwnerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
      const databaseOwnerId = requiredEnvironment("DNA_DATABASE_OWNER_ID");
      const databaseUrl = requiredEnvironment("DATABASE_URL");
      const exactMainCommit = requiredEnvironment("GITHUB_SHA").toLowerCase();
      if (!COMMIT_PATTERN.test(exactMainCommit)) {
        throw new Error("exact main commit is invalid");
      }
      const repository = requiredEnvironment("GITHUB_REPOSITORY");
      const runId = requiredEnvironment("GITHUB_RUN_ID");
      const runAttempt = requiredEnvironment("GITHUB_RUN_ATTEMPT");
      const runnerTemp = requiredEnvironment("RUNNER_TEMP");
      const packet = DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET;
      if (
        packet.status !== "approved_for_first_private_preview_backfill" ||
        packet.measuredUpperBound === null ||
        packet.identityOmissionAuthority === null
      ) {
        throw new Error("approved P5 checkpoint authority is unavailable");
      }
      const requestLimit = approvedRequestLimit();
      const ledger = createNeonDnaOpenLabP5FirstBackfillLedger({
        databaseUrl,
        databaseOwnerId,
        ownerId: authorizedOwnerId,
        runtimeRole: RUNTIME_ROLE,
        approvalPacket: packet,
      });
      const checkpoint = await ledger.load();
      if (
        checkpoint === null ||
        checkpoint.status !== "running" ||
        checkpoint.nextRequestOrdinal !== requestLimit + 1 ||
        checkpoint.logicalRequestCount !== requestLimit ||
        checkpoint.retainedR2Bytes >
          packet.measuredUpperBound.retainedR2BytesUpperBound ||
        checkpoint.omittedIdentityObservationCount !==
          packet.identityOmissionAuthority.maximumObservationCount ||
        checkpoint.completionSha256 !== null
      ) {
        throw new Error(
          "P5 checkpoint is not the expected safe plan-drift stop",
        );
      }

      const receipts = await loadAllReceipts({
        ledger,
        expectedCount: checkpoint.logicalRequestCount,
      });
      const familyCounts = Object.fromEntries(
        SOURCE_FAMILIES.map((family) => [family, 0]),
      ) as Record<SourceFamily, number>;
      let receiptBytes = 0;
      let omissionCount = 0;
      for (const receipt of receipts) {
        if (!SOURCE_FAMILIES.includes(receipt.family as SourceFamily)) {
          throw new Error("durable receipt family is invalid");
        }
        familyCounts[receipt.family as SourceFamily] += 1;
        receiptBytes += receipt.byteLength;
        omissionCount += receipt.omittedIdentityObservationCount;
      }
      if (
        receiptBytes !== checkpoint.retainedR2Bytes ||
        omissionCount !== checkpoint.omittedIdentityObservationCount ||
        familyCounts.splice_arena !== 0
      ) {
        throw new Error("durable receipts do not reconcile to the checkpoint");
      }

      const clients = apiKeys.map((apiKey) =>
        createDnaOpenLabV1Client({ apiKey }),
      );
      const clientPool = createDnaOpenLabClientPool({
        lanes: clients.map((client, index) => ({
          id: `key-${index + 1}`,
          client,
          scopes: ["splice"],
        })),
        aggregateRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
        maximumLaneRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
        allowIndependentRateBuckets: false,
      });
      const authorityCutoffAt = new Date().toISOString();
      const measurement = await measureDnaOpenLabP5SpliceContinuation({
        clientPool,
        authorityCutoffAt,
      });
      const reportBase = Object.freeze({
        schemaVersion: 1 as const,
        evidenceKind:
          "dna_open_lab_p5_splice_continuation_checkpoint_measurement" as const,
        exactMainCommit,
        repositoryRef: "refs/heads/main" as const,
        runRef: `https://github.com/${repository}/actions/runs/${runId}/attempts/${runAttempt}`,
        originalMeasurementEvidenceSha256:
          packet.identityOmissionAuthority.measurementEvidenceSha256,
        checkpoint: Object.freeze({
          status: checkpoint.status,
          nextRequestOrdinal: checkpoint.nextRequestOrdinal,
          logicalRequestCount: checkpoint.logicalRequestCount,
          retainedR2Bytes: checkpoint.retainedR2Bytes,
          omittedIdentityObservationCount:
            checkpoint.omittedIdentityObservationCount,
          completionSha256: checkpoint.completionSha256,
          familyCounts: Object.freeze({ ...familyCounts }),
        }),
        measurement,
        persistentOwnerDataWriteCount: 0 as const,
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
        measurement.persistentOwnerDataWriteCount !== 0 ||
        measurement.effectiveAggregateRequestsPerMinute !== 30
      ) {
        throw new Error("splice continuation evidence is invalid");
      }
      await writeFile(
        join(runnerTemp, REPORT_FILE),
        `${JSON.stringify(report)}\n`,
        { encoding: "utf8", flag: "wx" },
      );
      console.log(JSON.stringify(report));

      expect(report).toMatchObject({
        exactMainCommit,
        persistentOwnerDataWriteCount: 0,
        rawPayloadIncluded: false,
        secretMaterialIncluded: false,
        lastGoodPublicationChanged: false,
        productionChangesAllowed: false,
      });
    } catch {
      throw new Error("DNA Open Lab P5 splice continuation measurement failed");
    }
  }, 300_000);
});
