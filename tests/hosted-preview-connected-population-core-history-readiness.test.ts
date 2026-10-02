import { describe, expect, it } from "vitest";

import { cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment } from "@/lib/cloudflare-neon-dna-open-lab-provider-capacity-source";
import { createCloudflareDnaOpenLabP5R2S3ListBinding } from "@/lib/cloudflare-dna-open-lab-p5-r2-s3-list-binding";
import { createCloudflareR2DatasetEvidencePort } from "@/lib/cloudflare-r2-dataset-evidence-port";
import { createDnaCoreRaceHistoryClient } from "@/lib/dna-core-race-history-client";
import { DNA_CORE_RACE_HISTORY_MAXIMUM_EVIDENCE_OBJECT_BYTES } from "@/lib/dna-core-race-history-r2-evidence";
import { completeDnaPopulationCoreHistoryAuthority } from "@/lib/dna-population-core-history-authority";
import { loadDnaPopulationCoreHistoryEntrantAuthority } from "@/lib/dna-population-core-history-entrant-source";
import { measureDnaPopulationCoreHistoryReadOnly } from "@/lib/dna-population-core-history-read-only-measurement";
import { createDnaPopulationEntrantAuthorityLiveAuditSource } from "@/lib/dna-population-entrant-authority-live-audit-source";
import { createDnaPopulationEntrantAuthorityR2ChunkStore } from "@/lib/dna-population-entrant-authority-r2-store";
import { createDnaOpenLabP5FirstBackfillR2EvidenceWriter } from "@/lib/dna-open-lab-p5-first-backfill-r2-evidence";
import { DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET } from "@/lib/dna-open-lab-p5-first-backfill-approval";
import {
  createDnaOpenLabProviderCapacityPreflight,
  DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT,
  DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION,
} from "@/lib/dna-open-lab-provider-capacity-preflight";
import { DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_PLANNED_NEON_USAGE } from "@/lib/dna-open-lab-private-daily-refresh-command";
import {
  createDnaOpenLabRequestBudget,
  DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
} from "@/lib/dna-open-lab-request-budget";
import { dnaOpenLabRawEvidenceSha256 } from "@/lib/dna-open-lab-v1-adapters";
import { createDnaPopulationRaceIndexR2ChunkStore } from "@/lib/dna-population-race-index-r2-chunk";
import { createNeonDnaOpenLabP5FirstBackfillLedger } from "@/lib/neon-dna-open-lab-p5-first-backfill-ledger";
import { createNeonDnaCoreRaceHistoryAcquisitionRepository } from "@/lib/neon-dna-core-race-history-acquisition";
import { createNeonDnaPopulationEntrantAuthorityCheckpointRepository } from "@/lib/neon-dna-population-entrant-authority-checkpoint";
import { createNeonDnaPopulationRaceIndexGenerationRepository } from "@/lib/neon-dna-population-race-index-generation";
import { createNeonDnaOpenLabSyncPublicationRepository } from "@/lib/neon-dna-open-lab-sync-publication";

const connected = process.env.DNA_POPULATION_CORE_HISTORY_READINESS === "1";
const describeConnected = connected ? describe : describe.skip;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const RUNTIME_ROLE = "dna_app_runtime";
const FIRST_PROOF_CORE_COUNT = 1;
const MAXIMUM_PAGES_PER_CORE = 100;

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (
    value === undefined ||
    value.length < 1 ||
    value.trim() !== value ||
    value.length > 4_096 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new Error("required private configuration is unavailable");
  }
  return value;
}

function addUsage(
  left: Readonly<{
    storageBytes: number;
    classAOperations: number;
    classBOperations: number;
  }>,
  right: Readonly<{
    storageBytes: number;
    classAOperations: number;
    classBOperations: number;
  }>,
) {
  const value = {
    storageBytes: left.storageBytes + right.storageBytes,
    classAOperations: left.classAOperations + right.classAOperations,
    classBOperations: left.classBOperations + right.classBOperations,
  };
  if (
    Object.values(value).some(
      (entry) => !Number.isSafeInteger(entry) || entry < 0,
    )
  ) {
    throw new Error("readiness usage projection is invalid");
  }
  return Object.freeze(value);
}

describeConnected("hosted Preview population Core-history readiness", () => {
  it(
    "proves complete all-mode authority and zero-cost capacity for one deterministic first cohort",
    async () => {
      const exactCodeHeadSha = requiredEnvironment("GITHUB_SHA").toLowerCase();
      if (!COMMIT_PATTERN.test(exactCodeHeadSha)) {
        throw new Error("exact main commit is unavailable");
      }

      const ownerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
      const databaseUrl = requiredEnvironment("DATABASE_URL");
      const databaseOwnerId = requiredEnvironment("DNA_DATABASE_OWNER_ID");
      const accountId = requiredEnvironment("CLOUDFLARE_ACCOUNT_ID");
      const apiToken = requiredEnvironment("CLOUDFLARE_API_TOKEN");
      const analyticsApiToken = requiredEnvironment(
        "CLOUDFLARE_ANALYTICS_API_TOKEN",
      );
      const bucketName = requiredEnvironment("DNA_R2_BUCKET_NAME");
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
          cloudflareAnalyticsApiToken: analyticsApiToken,
          r2BucketName: bucketName,
          r2StorageClass,
          neonApiKey: requiredEnvironment("NEON_API_KEY"),
          neonProjectId: requiredEnvironment("NEON_PROJECT_ID"),
        });
      if (capacitySource.status !== "ready") {
        throw new Error("provider capacity source is unavailable");
      }

      const storage = createCloudflareR2DatasetEvidencePort({
        accountId,
        apiToken,
        accessKeyId,
        secretAccessKey,
      });
      const listBinding = createCloudflareDnaOpenLabP5R2S3ListBinding({
        accountId,
        accessKeyId,
        secretAccessKey,
        bucketName,
      });
      const baseline = createNeonDnaOpenLabP5FirstBackfillLedger({
        databaseUrl,
        databaseOwnerId,
        ownerId,
        runtimeRole: RUNTIME_ROLE,
        approvalPacket: DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET,
      });
      const populationIndex =
        createNeonDnaPopulationRaceIndexGenerationRepository({
          databaseUrl,
          databaseOwnerId,
          ownerId,
          runtimeRole: RUNTIME_ROLE,
        });
      const publicationRepository =
        createNeonDnaOpenLabSyncPublicationRepository({
          databaseUrl,
          databaseOwnerId,
          runtimeRole: RUNTIME_ROLE,
        });
      const baselineEvidence = createDnaOpenLabP5FirstBackfillR2EvidenceWriter({
        ownerId,
        bucketName,
        storage,
        approvalPacket: DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET,
      });
      const populationChunkStore = createDnaPopulationRaceIndexR2ChunkStore({
        ownerId,
        bucketName,
        storage,
      });
      const authoritySource =
        createDnaPopulationEntrantAuthorityLiveAuditSource({
          configuredOwnerId: ownerId,
          exactCodeHeadSha,
          bucketName,
          baseline: Object.freeze({
            load: baseline.load,
            loadReceipts: baseline.loadReceipts,
            readEvidence: baselineEvidence.read,
          }),
          historySource: publicationRepository,
          populationIndex,
          chunkStore: populationChunkStore,
          storage,
          capacitySource,
        });
      const audit = await authoritySource.load({
        ownerId,
        exactCodeHeadSha,
      });

      const checkpointRepository =
        createNeonDnaPopulationEntrantAuthorityCheckpointRepository({
          databaseUrl,
          databaseOwnerId,
          ownerId,
          runtimeRole: RUNTIME_ROLE,
        });
      const entrantStorage = Object.freeze({
        readBucketPrivacy: storage.readBucketPrivacy,
        putObjectIfAbsent: storage.putObjectIfAbsent,
        headObject: storage.headObject,
        getObject: storage.getObject,
        async listObjects(request: {
          bucketName: string;
          prefix: string;
          limit: 2;
        }) {
          if (request.bucketName !== bucketName) {
            throw new Error("entrant R2 bucket scope denied");
          }
          const page = await listBinding.list({
            prefix: request.prefix,
            limit: request.limit,
            include: ["httpMetadata", "customMetadata"] as const,
          });
          return Object.freeze({
            objects: Object.freeze(
              page.objects.map((entry) => Object.freeze({ key: entry.key })),
            ),
            truncated: page.truncated,
          });
        },
      });
      const entrantR2Store = createDnaPopulationEntrantAuthorityR2ChunkStore({
        ownerId,
        bucketName,
        storage: entrantStorage,
      });
      const entrant = await loadDnaPopulationCoreHistoryEntrantAuthority({
        ownerId,
        authority: audit.authority,
        checkpointRepository,
        r2Store: entrantR2Store,
      });
      const latestCompleteCoreHistory =
        await createNeonDnaCoreRaceHistoryAcquisitionRepository({
          databaseUrl,
          databaseOwnerId,
          ownerId,
          runtimeRole: RUNTIME_ROLE,
        }).loadLatestComplete();
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
      const population = completeDnaPopulationCoreHistoryAuthority({
        baseRaceDocuments: audit.raceDocuments,
        entrantRecords: entrant.records,
        expectedUnresolvedRaceCount: audit.authority.unresolvedRaceCount,
        expectedUnresolvedRaceSetSha256:
          audit.authority.unresolvedRaceSetSha256,
        persistedPerformanceCoreIds: latestCompleteCoreHistory.cycle.coreIds,
      });
      if (entrant.recoveredRaceCount !== audit.authority.unresolvedRaceCount) {
        throw new Error(
          "population Core-history entrant recovery count disagrees with authority",
        );
      }
      if (population.plan.status !== "ready_for_budget_measurement") {
        throw new Error(
          "population Core-history plan is held: " +
            JSON.stringify({
              status: population.plan.status,
              unresolvedRaceCount: population.plan.unresolvedRaceCount,
              raceWithUnknownModeCount:
                population.plan.raceWithUnknownModeCount,
              raceWithoutEntrantAuthorityByMode:
                population.plan.raceWithoutEntrantAuthorityByMode,
            }),
        );
      }
      if (population.plan.missingPerformanceCoreCount < 1) {
        throw new Error(
          "population Core-history enrichment is already complete",
        );
      }

      const requestBudget = createDnaOpenLabRequestBudget({
        initialRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
        maximumRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
      });
      const measurement = await measureDnaPopulationCoreHistoryReadOnly({
        plan: population.plan,
        cohortOrdinal: 0,
        maximumCoreCount: FIRST_PROOF_CORE_COUNT,
        maximumPagesPerCore: MAXIMUM_PAGES_PER_CORE,
        client: createDnaCoreRaceHistoryClient(),
        requestBudget,
      });
      if (
        measurement.status !== "complete" ||
        !measurement.selectedCohortFullyMeasured ||
        measurement.selectedCoreCount !== FIRST_PROOF_CORE_COUNT
      ) {
        throw new Error(
          "first population Core-history cohort is not measurable",
        );
      }

      const plannedR2Usage = addUsage(
        measurement.projectedPersistentR2Usage,
        Object.freeze({
          storageBytes: DNA_CORE_RACE_HISTORY_MAXIMUM_EVIDENCE_OBJECT_BYTES,
          classAOperations: 2,
          classBOperations: 7,
        }),
      );
      const refreshCycleId = dnaOpenLabRawEvidenceSha256({
        domain: "population-core-history-first-cohort-readiness/v1",
        exactCodeHeadSha,
        acquisitionCoreSetSha256: measurement.acquisitionCoreSetSha256,
        selectedCoreSetSha256: measurement.selectedCoreSetSha256,
        measurementSliceSha256: measurement.measurementSliceSha256,
      });
      const budgetWindowId = dnaOpenLabRawEvidenceSha256({
        domain: "population-core-history-first-cohort-budget/v1",
        exactCodeHeadSha,
        refreshCycleId,
      });
      const preflight = await createDnaOpenLabProviderCapacityPreflight({
        configuredOwnerId: ownerId,
        measurementSource: capacitySource,
      }).inspect({
        preflightVersion: DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION,
        intent: DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT,
        authenticatedOwnerId: ownerId,
        exactCodeHeadSha,
        refreshCycleId,
        budgetWindowId,
        projectionHorizon: "billing_window",
        plannedR2UsagePerRefresh: plannedR2Usage,
        plannedNeonUsagePerRefresh:
          DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_PLANNED_NEON_USAGE,
      });
      if (preflight.status !== "ready") {
        throw new Error(
          `first population Core-history capacity is unavailable: ${preflight.reason}:${
            preflight.measurementFailureId ?? "none"
          }:${preflight.blockerIds.join(",")}`,
        );
      }

      const report = Object.freeze({
        version: 1,
        status: "ready_for_first_persistent_cohort" as const,
        exactCodeHeadSha,
        entrantAuthority: Object.freeze({
          recoveredChunkCount: entrant.recoveredChunkCount,
          recoveredRaceCount: entrant.recoveredRaceCount,
          unresolvedRaceCount: audit.authority.unresolvedRaceCount,
          unresolvedRaceSetSha256: audit.authority.unresolvedRaceSetSha256,
          checkpointUpdatedAt: entrant.checkpointUpdatedAt,
        }),
        populationPlan: Object.freeze({
          raceDocumentCount: population.plan.raceDocumentCount,
          raceCountByMode: population.plan.raceCountByMode,
          populationCoreCountByMode: population.plan.populationCoreCountByMode,
          populationCoreCount: population.plan.populationCoreCount,
          populationUniverseCompleteness:
            population.plan.populationUniverseCompleteness,
          unresolvedRaceCount: population.plan.unresolvedRaceCount,
          unresolvedRaceSetSha256: population.plan.unresolvedRaceSetSha256,
          quarantinedRaceCount: population.entrantReplay.quarantinedRaceCount,
          quarantinedRaceCountByReason:
            population.entrantReplay.quarantinedRaceCountByReason,
          persistedPerformanceCoreCount:
            population.plan.persistedPerformanceCoreCount,
          missingPerformanceCoreCount:
            population.plan.missingPerformanceCoreCount,
          populationCoreSetSha256: population.plan.populationCoreSetSha256,
          persistedPerformanceCoreSetSha256:
            population.plan.persistedPerformanceCoreSetSha256,
          missingPerformanceCoreSetSha256:
            population.plan.missingPerformanceCoreSetSha256,
        }),
        measurement,
        capacity: Object.freeze({
          checkedAt: preflight.checkedAt,
          validUntil: preflight.validUntil,
          preflightSha256: preflight.preflightSha256,
          plannedR2Usage,
          paidUsageAllowed: preflight.paidUsageAllowed,
        }),
        safety: Object.freeze({
          firstProofCoreCount: FIRST_PROOF_CORE_COUNT,
          maximumPagesPerCore: MAXIMUM_PAGES_PER_CORE,
          aggregateRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
          providerWritePerformed: false,
          persistentWritePerformed: false,
          paidUsageAllowed: false,
          previewOnly: true,
        }),
      });

      const serialized = JSON.stringify(report);
      for (const secret of [
        ownerId,
        databaseUrl,
        databaseOwnerId,
        accountId,
        apiToken,
        analyticsApiToken,
        bucketName,
        accessKeyId,
        secretAccessKey,
      ]) {
        expect(serialized).not.toContain(secret);
      }
      expect(report.measurement.providerReadPerformed).toBe(true);
      expect(report.measurement.persistentWritePerformed).toBe(false);
      expect(report.capacity.paidUsageAllowed).toBe(false);
      console.log("DNA_POPULATION_CORE_HISTORY_READINESS=" + serialized);
    },
    40 * 60_000,
  );
});
