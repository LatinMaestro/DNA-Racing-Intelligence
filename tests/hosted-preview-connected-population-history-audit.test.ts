import { describe, expect, it } from "vitest";

import { cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment } from "@/lib/cloudflare-neon-dna-open-lab-provider-capacity-source";
import { createCloudflareR2DatasetEvidencePort } from "@/lib/cloudflare-r2-dataset-evidence-port";
import { assessDnaOpenLabCombinedHistoryPerformanceEvidence } from "@/lib/dna-open-lab-combined-history-performance-evidence";
import { DNA_FINISHED_RACE_INCREMENTAL_BASELINE_CUTOFF_AT } from "@/lib/dna-open-lab-finished-race-incremental-cycle";
import { DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET } from "@/lib/dna-open-lab-p5-first-backfill-approval";
import { createDnaOpenLabP5FirstBackfillR2EvidenceWriter } from "@/lib/dna-open-lab-p5-first-backfill-r2-evidence";
import type { CanonicalRaceDocumentMetadata } from "@/lib/dna-open-lab-v1-adapters";
import { DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS } from "@/lib/dna-open-lab-zero-cost-refresh-policy";
import { planDnaPopulationHistoryAcquisition } from "@/lib/dna-population-history-acquisition-plan";
import { createDnaPopulationRaceIndexR2ChunkStore } from "@/lib/dna-population-race-index-r2-chunk";
import { createNeonActiveDnaCoreRaceHistoryGenerationReadRepository } from "@/lib/neon-active-dna-core-race-history-generation";
import { createNeonDnaCoreRaceHistoryAcquisitionRepository } from "@/lib/neon-dna-core-race-history-acquisition";
import { createNeonDnaOpenLabP5FirstBackfillLedger } from "@/lib/neon-dna-open-lab-p5-first-backfill-ledger";
import { createNeonDnaPopulationRaceIndexGenerationRepository } from "@/lib/neon-dna-population-race-index-generation";
import { createNeonDnaOpenLabSyncPublicationRepository } from "@/lib/neon-dna-open-lab-sync-publication";

const connected = process.env.DNA_POPULATION_HISTORY_READ_ONLY_AUDIT === "1";
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
    throw new Error("population audit budget exceeds safe capacity");
  }
  return result;
}

describeConnected("hosted Preview all-mode population history audit", () => {
  it(
    "reconciles durable Bike, Car and Horse race authority against persisted complete Core history without DNA calls or writes",
    async () => {
      const exactCodeHeadSha = requiredEnvironment("GITHUB_SHA").toLowerCase();
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
        throw new Error("population audit R2 read budget is unavailable");
      }

      const publicationRepository =
        createNeonDnaOpenLabSyncPublicationRepository({
          databaseUrl,
          databaseOwnerId,
          runtimeRole: RUNTIME_ROLE,
        });
      const [history, latestCompleteCoreHistory, activeGeneration] =
        await Promise.all([
          publicationRepository.readServingFinishedHistory({ ownerId }),
          createNeonDnaCoreRaceHistoryAcquisitionRepository({
            databaseUrl,
            databaseOwnerId,
            ownerId,
            runtimeRole: RUNTIME_ROLE,
          }).loadLatestComplete(),
          createNeonActiveDnaCoreRaceHistoryGenerationReadRepository({
            databaseUrl,
            databaseOwnerId,
            ownerId,
            runtimeRole: RUNTIME_ROLE,
          }).readActiveGeneration(ownerId),
        ]);
      if (
        latestCompleteCoreHistory === null ||
        latestCompleteCoreHistory.cycle.status !== "complete" ||
        latestCompleteCoreHistory.cycle.completion === null ||
        latestCompleteCoreHistory.cycle.completion.completedCoreCount !==
          latestCompleteCoreHistory.cycle.coreIds.length
      ) {
        throw new Error(
          "complete persisted Core-history authority is unavailable",
        );
      }
      if (activeGeneration === null || activeGeneration.state !== "published") {
        throw new Error(
          "active persisted Core-history generation is unavailable",
        );
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
      const populationIndexRepository =
        createNeonDnaPopulationRaceIndexGenerationRepository({
          databaseUrl,
          databaseOwnerId,
          ownerId,
          runtimeRole: RUNTIME_ROLE,
        });
      const populationIndex = await populationIndexRepository.load(
        ownerId,
        baselineState.completionSha256,
      );
      if (
        populationIndex === null ||
        populationIndex.state !== "published" ||
        populationIndex.lastRequestOrdinal !==
          baselineState.logicalRequestCount ||
        populationIndex.processedReceiptCount !==
          baselineState.logicalRequestCount ||
        populationIndex.processedReceiptBytes !==
          baselineState.retainedR2Bytes ||
        populationIndex.processedIdentityOmissionCount !==
          baselineState.omittedIdentityObservationCount ||
        populationIndex.storageLayout !== "r2_chunked_v1" ||
        populationIndex.r2ChunkCount < 1 ||
        populationIndex.r2IdentityChunkCount !== populationIndex.r2ChunkCount ||
        populationIndex.r2CompactedRaceCount !==
          populationIndex.uniqueRaceCount ||
        populationIndex.legacyStorageRetiredAt === null
      ) {
        throw new Error(
          "published compact P5 population authority is unavailable",
        );
      }
      const manifests = [];
      let afterChunkOrdinal = 0;
      while (manifests.length < populationIndex.r2ChunkCount) {
        const page =
          await populationIndexRepository.listPublishedR2ChunkManifests(
            ownerId,
            {
              generationId: baselineState.completionSha256,
              afterChunkOrdinal,
              limit: 100,
            },
          );
        if (page.length === 0) {
          throw new Error("published compact P5 manifests are incomplete");
        }
        manifests.push(...page);
        afterChunkOrdinal = page.at(-1)!.chunkOrdinal;
      }
      if (
        manifests.length !== populationIndex.r2ChunkCount ||
        manifests.some(
          (manifest, index) =>
            manifest.chunkOrdinal !== index + 1 ||
            manifest.identityRegisteredAt === null,
        ) ||
        manifests.reduce((sum, manifest) => sum + manifest.rowCount, 0) !==
          populationIndex.uniqueRaceCount
      ) {
        throw new Error("published compact P5 manifests do not reconcile");
      }
      const chunkStore = createDnaPopulationRaceIndexR2ChunkStore({
        ownerId,
        bucketName,
        storage,
      });
      const compactDocuments = [];
      const CHUNK_READ_CONCURRENCY = 16;
      for (
        let start = 0;
        start < manifests.length;
        start += CHUNK_READ_CONCURRENCY
      ) {
        const batch = manifests.slice(start, start + CHUNK_READ_CONCURRENCY);
        const documents = await Promise.all(
          batch.map((manifest) => chunkStore.read(manifest)),
        );
        for (const chunk of documents) compactDocuments.push(...chunk);
      }
      if (
        compactDocuments.length !== populationIndex.uniqueRaceCount ||
        new Set(compactDocuments.map(({ sourceRaceId }) => sourceRaceId))
          .size !== populationIndex.uniqueRaceCount
      ) {
        throw new Error("published compact P5 Race documents do not reconcile");
      }
      const compactBaselineClassBOperations = manifests.length * 2;
      if (
        !Number.isSafeInteger(compactBaselineClassBOperations) ||
        compactBaselineClassBOperations < 1 ||
        compactBaselineClassBOperations >
          MAXIMUM_HISTORY_AUTHORITY_CLASS_B_OPERATIONS
      ) {
        throw new Error("compact P5 read budget is invalid");
      }
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
          baselineIndex: {
            documents: Object.freeze(compactDocuments),
            baselineReceiptCount: populationIndex.processedReceiptCount,
            baselineFinishedRaceReceiptCount:
              populationIndex.finishedRaceReceiptCount,
            baselineIdentityOmissionObservationCount:
              populationIndex.processedIdentityOmissionCount,
            r2ClassBOperationsUsed: compactBaselineClassBOperations,
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

      const plan = planDnaPopulationHistoryAcquisition({
        raceDocuments,
        persistedPerformanceCoreIds: latestCompleteCoreHistory.cycle.coreIds,
      });
      const latestFinishedRaceCutoff =
        history.cycles.at(-1)?.publication.upperBoundAt ??
        DNA_FINISHED_RACE_INCREMENTAL_BASELINE_CUTOFF_AT;

      const report = Object.freeze({
        version: 1,
        exactCodeHeadSha,
        authority: Object.freeze({
          baselineReceiptCount: historyAssessment.baselineReceiptCount,
          baselineFinishedRaceReceiptCount:
            historyAssessment.baselineFinishedRaceReceiptCount,
          incrementalCycleCount: history.cycles.length,
          incrementalWindowCount: historyAssessment.incrementalWindowCount,
          latestFinishedRaceCutoff,
          uniqueRaceCount: historyAssessment.uniqueRaceCount,
          r2ClassBOperationsUsed: historyAssessment.r2ClassBOperationsUsed,
        }),
        population: Object.freeze({
          raceCountByMode: plan.raceCountByMode,
          raceWithoutEntrantAuthorityByMode:
            plan.raceWithoutEntrantAuthorityByMode,
          raceWithUnknownModeCount: plan.raceWithUnknownModeCount,
          coreCountByMode: plan.populationCoreCountByMode,
          globalCoreCount: plan.populationCoreCount,
          populationCoreSetSha256: plan.populationCoreSetSha256,
        }),
        persistedPerformance: Object.freeze({
          completedCoreHistoryCount:
            latestCompleteCoreHistory.cycle.coreIds.length,
          completedCoreHistorySetSha256:
            latestCompleteCoreHistory.cycle.coreSetSha256,
          populationCoreHistoryCount: plan.persistedPerformanceCoreCount,
          missingPopulationCoreHistoryCount: plan.missingPerformanceCoreCount,
          missingPopulationCoreSetSha256: plan.missingPerformanceCoreSetSha256,
          planStatus: plan.status,
          activeObservationCount: activeGeneration.observationCount,
          activeExactDistanceConfirmedCount:
            activeGeneration.exactDistanceConfirmedCount,
          activeEntrantAuthorityOmissionCount:
            activeGeneration.entrantAuthorityOmissionCount,
          activeEntrantMismatchOmissionCount:
            activeGeneration.entrantMismatchOmissionCount,
        }),
        safety: Object.freeze({
          dnaProviderRequestCount: 0,
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
      expect(
        report.persistedPerformance.completedCoreHistoryCount,
      ).toBeGreaterThan(0);
      expect(
        report.persistedPerformance.activeExactDistanceConfirmedCount,
      ).toBe(report.persistedPerformance.activeObservationCount);
      expect(report.safety).toEqual({
        dnaProviderRequestCount: 0,
        persistentWritePerformed: false,
        providerWritePerformed: false,
        paidUsageAllowed: false,
      });
      console.log(`DNA_POPULATION_HISTORY_AUDIT=${serialized}`);
    },
    30 * 60_000,
  );
});
