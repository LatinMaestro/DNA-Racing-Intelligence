import { describe, expect, it } from "vitest";

import { planDnaBikePopulationHistoryAcquisition } from "@/lib/dna-bike-population-history-acquisition-plan";
import { measureDnaBikePopulationHistoryReadOnly } from "@/lib/dna-bike-population-history-read-only-measurement";
import { cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment } from "@/lib/cloudflare-neon-dna-open-lab-provider-capacity-source";
import { createCloudflareR2DatasetEvidencePort } from "@/lib/cloudflare-r2-dataset-evidence-port";
import { createDnaCoreRaceHistoryClient } from "@/lib/dna-core-race-history-client";
import { assessDnaOpenLabCombinedHistoryPerformanceEvidence } from "@/lib/dna-open-lab-combined-history-performance-evidence";
import { DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET } from "@/lib/dna-open-lab-p5-first-backfill-approval";
import { createDnaOpenLabP5FirstBackfillR2EvidenceWriter } from "@/lib/dna-open-lab-p5-first-backfill-r2-evidence";
import {
  createDnaOpenLabRequestBudget,
  DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
} from "@/lib/dna-open-lab-request-budget";
import type { CanonicalRaceDocumentMetadata } from "@/lib/dna-open-lab-v1-adapters";
import { DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS } from "@/lib/dna-open-lab-zero-cost-refresh-policy";
import { createNeonDnaOpenLabP5FirstBackfillLedger } from "@/lib/neon-dna-open-lab-p5-first-backfill-ledger";
import {
  createDnaOpenLabCombinedServingReadRepository,
  createNeonDnaOpenLabSyncPublicationRepository,
} from "@/lib/neon-dna-open-lab-sync-publication";

const connected =
  process.env.DNA_BIKE_POPULATION_HISTORY_READ_ONLY_MEASUREMENT === "1";
const describeConnected = connected ? describe : describe.skip;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const MAXIMUM_HISTORY_AUTHORITY_CLASS_B_OPERATIONS = 100_000;
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

function safeAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error("population measurement budget exceeds safe capacity");
  }
  return result;
}

describeConnected(
  "hosted Preview Bike population history read-only measurement",
  () => {
    it(
      "uses complete private race authority and emits only a bounded aggregate slice",
      async () => {
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
        const r2StorageClass = requiredEnvironment("DNA_R2_STORAGE_CLASS");
        if (r2StorageClass !== "Standard") {
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
            r2StorageClass,
            neonApiKey: requiredEnvironment("NEON_API_KEY"),
            neonProjectId: requiredEnvironment("NEON_PROJECT_ID"),
          });
        if (capacitySource.status !== "ready") {
          throw new Error("provider capacity measurement is not configured");
        }
        const providerCapacity = await capacitySource.measure({ ownerId });
        if (
          providerCapacity.r2StorageClass !== "Standard" ||
          safeAdd(
            providerCapacity.currentR2Usage.classBOperations,
            MAXIMUM_HISTORY_AUTHORITY_CLASS_B_OPERATIONS,
          ) > DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.classBOperations
        ) {
          throw new Error(
            "population measurement R2 read budget is unavailable",
          );
        }

        const publicationRepository =
          createNeonDnaOpenLabSyncPublicationRepository({
            databaseUrl,
            databaseOwnerId,
            runtimeRole: RUNTIME_ROLE,
          });
        const validatedAt = new Date().toISOString();
        const servingRepository = createDnaOpenLabCombinedServingReadRepository(
          {
            repository: publicationRepository,
            validatedAt,
          },
        );
        const [ownedCores, history] = await Promise.all([
          servingRepository.readServingOwnedCores({ ownerId }),
          publicationRepository.readServingFinishedHistory({ ownerId }),
        ]);
        const ownedCoreIds = ownedCores.map(({ canonical }) =>
          Number(canonical.sourceCoreId),
        );
        if (
          ownedCoreIds.length < 1 ||
          ownedCoreIds.some(
            (coreId) => !Number.isSafeInteger(coreId) || coreId < 1,
          )
        ) {
          throw new Error("owned Core authority is unavailable");
        }

        const packet = DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET;
        const ledger = createNeonDnaOpenLabP5FirstBackfillLedger({
          databaseUrl,
          databaseOwnerId,
          ownerId,
          runtimeRole: RUNTIME_ROLE,
          approvalPacket: packet,
        });
        const baselineState = await ledger.load();
        if (
          baselineState === null ||
          baselineState.status !== "complete" ||
          baselineState.completionSha256 === null ||
          baselineState.logicalRequestCount !== 17_464 ||
          baselineState.retainedR2Bytes !== 874_370_990 ||
          baselineState.omittedIdentityObservationCount !== 1
        ) {
          throw new Error("immutable P5 baseline authority is unavailable");
        }
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
        const raceDocuments: CanonicalRaceDocumentMetadata[] = [];
        const historyAssessment =
          await assessDnaOpenLabCombinedHistoryPerformanceEvidence({
            ownerId,
            bucketName,
            baselineAuthority: {
              logicalRequestCount: baselineState.logicalRequestCount,
              retainedR2Bytes: baselineState.retainedR2Bytes,
              omittedIdentityObservationCount:
                baselineState.omittedIdentityObservationCount,
              completionSha256: baselineState.completionSha256,
            },
            baseline: {
              load: ledger.load.bind(ledger),
              loadReceipts: ledger.loadReceipts.bind(ledger),
              readEvidence: evidence.read,
            },
            history,
            storage,
            readBudget: {
              maximumClassBOperations:
                MAXIMUM_HISTORY_AUTHORITY_CLASS_B_OPERATIONS,
              paidUsageAllowed: false,
            },
            canonicalPurpose: "population_inventory",
            onCanonicalRaceDocument: (document) => {
              raceDocuments.push(document);
            },
          });
        const plan = planDnaBikePopulationHistoryAcquisition({
          raceDocuments,
          ownedCoreIds,
        });
        const requestBudget = createDnaOpenLabRequestBudget({
          initialRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
          maximumRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
        });
        const measurement = await measureDnaBikePopulationHistoryReadOnly({
          plan,
          cohortOrdinal: 0,
          maximumCoreCount: 1,
          maximumPagesPerCore: 10,
          client: createDnaCoreRaceHistoryClient(),
          requestBudget,
        });

        const report = Object.freeze({
          version: 1,
          exactCodeHeadSha,
          authority: Object.freeze({
            baselineReceiptCount: historyAssessment.baselineReceiptCount,
            incrementalWindowCount: historyAssessment.incrementalWindowCount,
            uniqueRaceCount: historyAssessment.uniqueRaceCount,
            bikeRaceCount: historyAssessment.bikeRaceCount,
            r2ClassBOperationsUsed: historyAssessment.r2ClassBOperationsUsed,
          }),
          plan: Object.freeze({
            status: plan.status,
            bikeRaceCount: plan.bikeRaceCount,
            bikeRaceWithoutEntrantAuthorityCount:
              plan.bikeRaceWithoutEntrantAuthorityCount,
            raceWithUnknownModeCount: plan.raceWithUnknownModeCount,
            populationCoreCount: plan.populationCoreCount,
            ownedPopulationCoreCount: plan.ownedPopulationCoreCount,
            acquisitionCoreCount: plan.acquisitionCoreCount,
            populationCoreSetSha256: plan.populationCoreSetSha256,
            acquisitionCoreSetSha256: plan.acquisitionCoreSetSha256,
          }),
          measurement,
          safety: Object.freeze({
            aggregateRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
            maximumMeasuredCoreCount: 1,
            maximumPagesPerCore: 10,
            persistentWritePerformed: false,
            providerWritePerformed: false,
            paidUsageAllowed: false,
          }),
        });
        const serialized = JSON.stringify(report);
        for (const secret of [
          ownerId,
          databaseUrl,
          databaseOwnerId,
          accountId,
          apiToken,
          accessKeyId,
          secretAccessKey,
          bucketName,
        ]) {
          expect(serialized).not.toContain(secret);
        }
        expect(report.authority.baselineReceiptCount).toBe(17_464);
        expect(report.measurement.selectedCoreCount).toBeLessThanOrEqual(1);
        expect(report.measurement.providerRequestCount).toBeLessThanOrEqual(10);
        expect(report.measurement.persistentWritePerformed).toBe(false);
        expect(report.measurement.providerWritePerformed).toBe(false);
        expect(report.measurement.paidUsageAllowed).toBe(false);
        console.log(`DNA_BIKE_POPULATION_HISTORY_MEASUREMENT=${serialized}`);
      },
      30 * 60_000,
    );
  },
);
