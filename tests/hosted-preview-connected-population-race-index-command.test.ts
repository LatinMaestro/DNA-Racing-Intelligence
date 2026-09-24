import { describe, expect, it } from "vitest";

import { cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment } from "@/lib/cloudflare-neon-dna-open-lab-provider-capacity-source";
import { createCloudflareR2DatasetEvidencePort } from "@/lib/cloudflare-r2-dataset-evidence-port";
import { DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET } from "@/lib/dna-open-lab-p5-first-backfill-approval";
import { createDnaOpenLabP5FirstBackfillR2EvidenceWriter } from "@/lib/dna-open-lab-p5-first-backfill-r2-evidence";
import { createDnaOpenLabProviderCapacityPreflight } from "@/lib/dna-open-lab-provider-capacity-preflight";
import {
  createDnaPopulationRaceIndexPrivatePreviewOperator,
  DNA_POPULATION_RACE_INDEX_PRIVATE_PREVIEW_INTENT,
  DNA_POPULATION_RACE_INDEX_PRIVATE_PREVIEW_OPERATOR_VERSION,
  DNA_POPULATION_RACE_INDEX_PRIVATE_PREVIEW_WORKER_ID,
} from "@/lib/dna-population-race-index-private-preview-operator";
import { createDnaPopulationRaceIndexR2ChunkStore } from "@/lib/dna-population-race-index-r2-chunk";
import { createNeonDnaOpenLabP5FirstBackfillLedger } from "@/lib/neon-dna-open-lab-p5-first-backfill-ledger";
import { createNeonDnaPopulationRaceIndexGenerationRepository } from "@/lib/neon-dna-population-race-index-generation";

const connected =
  process.env.DNA_POPULATION_RACE_INDEX_PRIVATE_PREVIEW_COMMAND === "1";
const describeConnected = connected ? describe : describe.skip;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const RUNTIME_ROLE = "dna_app_runtime";

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

function receiptBound(): number {
  const raw = requiredEnvironment("DNA_POPULATION_RACE_INDEX_MAXIMUM_RECEIPTS");
  if (!/^(?:25|50|100)$/u.test(raw)) {
    throw new Error("receipt bound is invalid");
  }
  return Number(raw);
}

describeConnected("hosted Preview population race index command", () => {
  it(
    "advances one zero-cost, owner-isolated immutable P5 slice without DNA requests",
    async () => {
      try {
        const exactCodeHeadSha =
          requiredEnvironment("GITHUB_SHA").toLowerCase();
        if (!COMMIT_PATTERN.test(exactCodeHeadSha)) {
          throw new Error("exact main commit is invalid");
        }
        const ownerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
        const databaseUrl = requiredEnvironment("DATABASE_URL");
        const databaseOwnerId = requiredEnvironment("DNA_DATABASE_OWNER_ID");
        const bucketName = requiredEnvironment("DNA_R2_BUCKET_NAME");
        const accountId = requiredEnvironment("CLOUDFLARE_ACCOUNT_ID");
        const apiToken = requiredEnvironment("CLOUDFLARE_API_TOKEN");
        const accessKeyId = requiredEnvironment("DNA_R2_ACCESS_KEY_ID");
        const secretAccessKey = requiredEnvironment("DNA_R2_SECRET_ACCESS_KEY");
        const storageClass = requiredEnvironment("DNA_R2_STORAGE_CLASS");
        if (storageClass !== "Standard") {
          throw new Error("only R2 Standard storage is allowed");
        }

        const capacitySource =
          cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment({
            authorizedOwnerId: ownerId,
            cloudflareAccountId: accountId,
            cloudflareAnalyticsApiToken: requiredEnvironment(
              "CLOUDFLARE_ANALYTICS_API_TOKEN",
            ),
            r2BucketName: bucketName,
            r2StorageClass: storageClass,
            neonApiKey: requiredEnvironment("NEON_API_KEY"),
            neonProjectId: requiredEnvironment("NEON_PROJECT_ID"),
          });
        if (capacitySource.status !== "ready") {
          throw new Error("provider capacity measurement is unavailable");
        }

        const packet = DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET;
        const ledger = createNeonDnaOpenLabP5FirstBackfillLedger({
          databaseUrl,
          databaseOwnerId,
          ownerId,
          runtimeRole: RUNTIME_ROLE,
          approvalPacket: packet,
        });
        const storage = createCloudflareR2DatasetEvidencePort({
          accountId,
          apiToken,
          accessKeyId,
          secretAccessKey,
        });
        const evidence = createDnaOpenLabP5FirstBackfillR2EvidenceWriter({
          ownerId,
          bucketName,
          storage,
          approvalPacket: packet,
        });
        const repository = createNeonDnaPopulationRaceIndexGenerationRepository(
          {
            databaseUrl,
            databaseOwnerId,
            ownerId,
            runtimeRole: RUNTIME_ROLE,
          },
        );
        const operator = createDnaPopulationRaceIndexPrivatePreviewOperator({
          configuredOwnerId: ownerId,
          baseline: {
            load: ledger.load.bind(ledger),
            loadReceipts: ledger.loadReceipts.bind(ledger),
            readEvidence: evidence.read,
          },
          repository,
          chunkStore: createDnaPopulationRaceIndexR2ChunkStore({
            ownerId,
            bucketName,
            storage,
          }),
          capacityPreflight: createDnaOpenLabProviderCapacityPreflight({
            configuredOwnerId: ownerId,
            measurementSource: capacitySource,
          }),
        });
        const receipt = await operator.execute({
          operatorVersion:
            DNA_POPULATION_RACE_INDEX_PRIVATE_PREVIEW_OPERATOR_VERSION,
          intent: DNA_POPULATION_RACE_INDEX_PRIVATE_PREVIEW_INTENT,
          allowPersistentWrite: true,
          authenticatedOwnerId: ownerId,
          exactCodeHeadSha,
          workerId: DNA_POPULATION_RACE_INDEX_PRIVATE_PREVIEW_WORKER_ID,
          attemptedAt: requiredEnvironment(
            "DNA_POPULATION_RACE_INDEX_ATTEMPTED_AT",
          ),
          maximumReceiptCount: receiptBound(),
        });
        const report = Object.freeze({
          version: DNA_POPULATION_RACE_INDEX_PRIVATE_PREVIEW_OPERATOR_VERSION,
          status: receipt.status,
          reason: receipt.reason,
          exactCodeHeadSha: receipt.exactCodeHeadSha,
          beforeRequestOrdinal: receipt.beforeRequestOrdinal,
          afterRequestOrdinal: receipt.afterRequestOrdinal,
          processedReceiptCount: receipt.processedReceiptCount,
          uniqueRaceCount: receipt.uniqueRaceCount,
          uniqueEntrantCoreCount: receipt.uniqueEntrantCoreCount,
          persistentWriteArmed: receipt.persistentWriteArmed,
          previewOnly: receipt.previewOnly,
          dnaProviderRequestCount: receipt.dnaProviderRequestCount,
          providerWritePerformed: receipt.providerWritePerformed,
          paidUsageAllowed: receipt.paidUsageAllowed,
          preserveLastGood: receipt.preserveLastGood,
        });
        expect(report).toMatchObject({
          exactCodeHeadSha,
          persistentWriteArmed: true,
          previewOnly: true,
          dnaProviderRequestCount: 0,
          providerWritePerformed: false,
          paidUsageAllowed: false,
          preserveLastGood: true,
        });
        if (report.status === "advanced") {
          expect(report.processedReceiptCount).toBeGreaterThan(0);
          expect(report.afterRequestOrdinal).toBeGreaterThan(
            report.beforeRequestOrdinal,
          );
        }
        if (report.status === "held") {
          expect(report.reason).toMatch(/^provider_capacity_[a-z0-9_]+$/u);
          expect(report.processedReceiptCount).toBe(0);
          expect(report.afterRequestOrdinal).toBe(report.beforeRequestOrdinal);
        }
        console.log(
          `DNA_POPULATION_RACE_INDEX_PROGRESS=${JSON.stringify(report)}`,
        );
      } catch {
        throw new Error("DNA population race index private Preview failed");
      }
    },
    30 * 60_000,
  );
});
