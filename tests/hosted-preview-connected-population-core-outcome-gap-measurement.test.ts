import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment } from "@/lib/cloudflare-neon-dna-open-lab-provider-capacity-source";
import { createCloudflareDnaOpenLabP5R2S3ListBinding } from "@/lib/cloudflare-dna-open-lab-p5-r2-s3-list-binding";
import { createCloudflareR2DatasetEvidencePort } from "@/lib/cloudflare-r2-dataset-evidence-port";
import {
  createDnaCoreRaceHistoryAcquisitionCycle,
  dnaCoreRaceHistoryCoreSetSha256,
} from "@/lib/dna-core-race-history-acquisition-cycle";
import { DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE } from "@/lib/dna-core-race-history-acquisition-runner";
import { createDnaCoreRaceHistoryClient } from "@/lib/dna-core-race-history-client";
import { runDnaCoreRaceHistoryPrivateCollectorStep } from "@/lib/dna-core-race-history-private-collector";
import { createDnaCoreRaceHistoryR2EvidenceStore } from "@/lib/dna-core-race-history-r2-evidence";
import { completeDnaPopulationCoreHistoryAuthority } from "@/lib/dna-population-core-history-authority";
import { loadDnaPopulationCoreHistoryEntrantAuthority } from "@/lib/dna-population-core-history-entrant-source";
import {
  readDnaPersistedApiOutcomeDurableSource,
  readDnaRaceMergeOutcomeDurableSource,
} from "@/lib/dna-population-core-outcome-durable-sources";
import {
  createDnaPopulationCoreOutcomeGapAcquisitionAuthority,
  selectDnaPopulationCoreOutcomeGapAcquisitionCohort,
} from "@/lib/dna-population-core-outcome-gap-acquisition-authority";
import { reconcileDnaPopulationCoreOutcomeGap } from "@/lib/dna-population-core-outcome-gap-reconciliation";
import type { DnaPopulationCoreRaceLink } from "@/lib/dna-population-core-race-link-index";
import { createDnaPopulationEntrantAuthorityLiveAuditSource } from "@/lib/dna-population-entrant-authority-live-audit-source";
import { projectDnaPopulationEntrantAuthorityR2Cost } from "@/lib/dna-population-entrant-authority-r2-cost-policy";
import { createDnaPopulationEntrantAuthorityR2ChunkStore } from "@/lib/dna-population-entrant-authority-r2-store";
import { createDnaOpenLabP5FirstBackfillR2EvidenceWriter } from "@/lib/dna-open-lab-p5-first-backfill-r2-evidence";
import { DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET } from "@/lib/dna-open-lab-p5-first-backfill-approval";
import {
  createDnaOpenLabRequestBudget,
  DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
} from "@/lib/dna-open-lab-request-budget";
import { dnaOpenLabRawEvidenceSha256 } from "@/lib/dna-open-lab-v1-adapters";
import { DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS } from "@/lib/dna-open-lab-zero-cost-provider-capacity";
import { createDnaPopulationRaceIndexR2ChunkStore } from "@/lib/dna-population-race-index-r2-chunk";
import { createEphemeralJsonlExternalSortedRunStore } from "@/lib/ephemeral-jsonl-external-sorted-run-store";
import { createNeonActiveDnaCoreRaceHistoryGenerationReadRepository } from "@/lib/neon-active-dna-core-race-history-generation";
import { createNeonDnaCoreRaceHistoryAcquisitionRepository } from "@/lib/neon-dna-core-race-history-acquisition";
import { createNeonDnaOpenLabP5FirstBackfillLedger } from "@/lib/neon-dna-open-lab-p5-first-backfill-ledger";
import { createNeonDnaPopulationEntrantAuthorityCheckpointRepository } from "@/lib/neon-dna-population-entrant-authority-checkpoint";
import { createNeonDnaPopulationRaceIndexGenerationRepository } from "@/lib/neon-dna-population-race-index-generation";
import { createNeonDnaOpenLabSyncPublicationRepository } from "@/lib/neon-dna-open-lab-sync-publication";
import { neonDnaOpenLabR2BudgetRepositoryFromEnvironment } from "@/lib/neon-dna-open-lab-r2-budget-repository";
import { createNeonRaceMergeCoreOutcomeR2GenerationRepository } from "@/lib/neon-race-merge-core-outcome-r2-generation";
import { createRaceMergeCoreOutcomeR2Store } from "@/lib/race-merge-core-outcome-r2-store";

const connected =
  process.env.DNA_POPULATION_CORE_OUTCOME_GAP_MEASUREMENT === "1";
const describeConnected = connected ? describe : describe.skip;

const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const RUNTIME_ROLE = "dna_app_runtime";
const RACE_MERGE_GENERATION_ID = "owner-race-merge-outcomes-v1";
const RACE_MERGE_TERMINAL_COHORT_ORDINAL = 199;
const RACE_MERGE_TERMINAL_CORE_COUNT = 26;
const RACE_MERGE_FULL_COHORT_SIZE = 100;
const MAXIMUM_CONCURRENT_CORE_LOADS = 128;
const MAXIMUM_CONCURRENT_COHORT_LOADS = 32;
const MAXIMUM_NEON_READ_COMPUTE_MILLI_CU_HOURS = 5_000;
const MAXIMUM_MEMBERSHIPS = 10_000_000;
const MAXIMUM_RECORDS_IN_MEMORY = 320_000;
const MERGE_FAN_IN = 32;
const GAP_BOOTSTRAP_BASE_NEON_STORAGE_BYTES = 16 * 1024 * 1024;
const GAP_BOOTSTRAP_PER_CORE_NEON_STORAGE_BYTES = 16 * 1024;
const GAP_BOOTSTRAP_NEON_COMPUTE_MILLI_CU_HOURS = 1_000;
const HARD_NEON_STORAGE_BYTES = 1_000_000_000;
const OWNER_NEON_STORAGE_BYTES = 950_000_000;
const ACQUISITION_BATCH_RUNTIME_CUTOFF_MS = 110 * 60_000;
const GAP_FIRST_PAGE_NEON_STORAGE_RESERVE_BYTES = 128 * 1024 * 1024;
const GAP_FIRST_PAGE_NEON_COMPUTE_RESERVE_MILLI_CU_HOURS = 5_000;

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

function r2BudgetWindowId(input: {
  ownerId: string;
  startAt: string;
  endAt: string;
}): string {
  return dnaOpenLabRawEvidenceSha256({
    domain: "dna-open-lab-r2-budget-window/v1",
    value: Object.freeze(input),
  });
}

function raceDocuments(
  documents: Parameters<
    typeof completeDnaPopulationCoreHistoryAuthority
  >[0]["baseRaceDocuments"],
) {
  return (async function* () {
    for (const document of documents) yield document;
  })();
}

describeConnected(
  "hosted Preview population Core-outcome exact-gap measurement",
  () => {
    it(
      "reconciles canonical Race/Core membership against durable local outcomes without DNA calls or writes",
      async () => {
        const connectedRunStartedAt = Date.now();
        const exactCodeHeadSha =
          requiredEnvironment("GITHUB_SHA").toLowerCase();
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
        const neonApiKey = requiredEnvironment("NEON_API_KEY");
        const neonProjectId = requiredEnvironment("NEON_PROJECT_ID");
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
            neonApiKey,
            neonProjectId,
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
          approvalPacket:
            DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET,
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
        const baselineEvidence =
          createDnaOpenLabP5FirstBackfillR2EvidenceWriter({
            ownerId,
            bucketName,
            storage,
            approvalPacket:
              DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET,
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
        console.log("DNA_POPULATION_CORE_OUTCOME_GAP_PHASE=race-audit-loaded");

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
        const population = completeDnaPopulationCoreHistoryAuthority({
          baseRaceDocuments: audit.raceDocuments,
          entrantRecords: entrant.records,
          expectedUnresolvedRaceCount: audit.authority.unresolvedRaceCount,
          expectedUnresolvedRaceSetSha256:
            audit.authority.unresolvedRaceSetSha256,
        });
        console.log(
          "DNA_POPULATION_CORE_OUTCOME_GAP_PHASE=entrant-authority-loaded",
        );

        const raceMergeRepository =
          createNeonRaceMergeCoreOutcomeR2GenerationRepository({
            databaseUrl,
            databaseOwnerId,
            ownerId,
            runtimeRole: RUNTIME_ROLE,
          });
        const raceMergeStore = createRaceMergeCoreOutcomeR2Store({
          ownerId,
          bucketName,
          storage,
        });
        const expectedRaceMergeManifestCount =
          (RACE_MERGE_TERMINAL_COHORT_ORDINAL - 1) *
            RACE_MERGE_FULL_COHORT_SIZE +
          RACE_MERGE_TERMINAL_CORE_COUNT;
        const plannedRaceMergeReadClassBOperations =
          expectedRaceMergeManifestCount * 2;
        if (!Number.isSafeInteger(plannedRaceMergeReadClassBOperations)) {
          throw new Error("Race Merge read operation projection is invalid");
        }

        const capacity = await capacitySource.measure({ ownerId });
        if (capacity.r2StorageClass !== "Standard") {
          throw new Error("R2 storage class is not eligible");
        }
        const r2Projection = projectDnaPopulationEntrantAuthorityR2Cost({
          currentUsage: capacity.currentR2Usage,
          plannedUsage: {
            storageBytes: 0,
            classAOperations: 0,
            classBOperations: plannedRaceMergeReadClassBOperations,
          },
        });
        if (
          !r2Projection.allowed ||
          r2Projection.projectedPaidCostMicroUsd !== 0 ||
          r2Projection.paidUsageAllowed !== false
        ) {
          throw new Error("Race Merge read-only scan exceeds A$0 R2 capacity");
        }

        const projectedNeonStorageBytes =
          capacity.currentNeonUsage.storageBytes;
        const projectedNeonComputeMilliCuHours =
          capacity.currentNeonUsage.computeMilliCuHours +
          MAXIMUM_NEON_READ_COMPUTE_MILLI_CU_HOURS;
        if (
          !Number.isSafeInteger(projectedNeonComputeMilliCuHours) ||
          projectedNeonStorageBytes >
            DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.storageBytes ||
          projectedNeonComputeMilliCuHours >
            DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.computeMilliCuHours
        ) {
          throw new Error("read-only scan exceeds A$0 Neon capacity");
        }
        console.log("DNA_POPULATION_CORE_OUTCOME_GAP_PHASE=capacity-verified");

        const raceMergeSource = await readDnaRaceMergeOutcomeDurableSource({
          ownerId,
          generationId: RACE_MERGE_GENERATION_ID,
          terminalCohortOrdinal: RACE_MERGE_TERMINAL_COHORT_ORDINAL,
          terminalCoreCount: RACE_MERGE_TERMINAL_CORE_COUNT,
          maximumConcurrentCohortLoads: MAXIMUM_CONCURRENT_COHORT_LOADS,
          repository: raceMergeRepository,
          store: raceMergeStore,
        });
        if (raceMergeSource.manifestCount !== expectedRaceMergeManifestCount) {
          throw new Error("Race Merge terminal manifest authority drifted");
        }
        console.log(
          "DNA_POPULATION_CORE_OUTCOME_GAP_PHASE=race-merge-source-loaded",
        );

        const persistedApiSource =
          await readDnaPersistedApiOutcomeDurableSource({
            ownerId,
            repository:
              createNeonActiveDnaCoreRaceHistoryGenerationReadRepository({
                databaseUrl,
                databaseOwnerId,
                ownerId,
                runtimeRole: RUNTIME_ROLE,
              }),
          });

        console.log(
          "DNA_POPULATION_CORE_OUTCOME_GAP_PHASE=persisted-api-source-loaded",
        );
        const scratchRoot = await mkdtemp(
          join(tmpdir(), "dna-population-core-outcome-gap-"),
        );
        try {
          console.log(
            "DNA_POPULATION_CORE_OUTCOME_GAP_PHASE=reconciliation-started",
          );
          const reconciliation = await reconcileDnaPopulationCoreOutcomeGap({
            documents: raceDocuments(population.raceDocuments),
            scratchStore:
              createEphemeralJsonlExternalSortedRunStore<DnaPopulationCoreRaceLink>(
                {
                  rootDirectory: scratchRoot,
                  namespace: "population-core-outcome-gap",
                },
              ),
            runPrefix: "population-core-outcome-gap",
            linkIndexBounds: {
              maximumRecordsInMemory: MAXIMUM_RECORDS_IN_MEMORY,
              mergeFanIn: MERGE_FAN_IN,
              maximumMemberships: MAXIMUM_MEMBERSHIPS,
              maximumRunObjects: 1_000,
              maximumRacesPerCore: 1_000_000,
            },
            planBounds: {
              maximumLinkedCores: 100_000,
              maximumRequiredMemberships: MAXIMUM_MEMBERSHIPS,
              maximumOutcomesPerSourcePerCore: 1_000_000,
            },
            maximumConcurrentCoreLoads: MAXIMUM_CONCURRENT_CORE_LOADS,
            raceMergeSource,
            persistedApiSource,
          });

          console.log(
            "DNA_POPULATION_CORE_OUTCOME_GAP_PHASE=reconciliation-complete",
          );
          expect(reconciliation).toMatchObject({
            status: "complete",
            dnaProviderRequestCount: 0,
            persistentWritePerformed: false,
            paidUsageAllowed: false,
            outcomeCoverage: {
              status: "complete",
              dnaProviderRequestCount: 0,
            },
          });

          const gapCoreSetSha256 = dnaOpenLabRawEvidenceSha256({
            domain: "dna-population-core-outcome-api-gap-core-set/v1",
            coreIds: reconciliation.outcomeCoverage.apiGapCoreIds,
          });
          const sanitizedCoverage = Object.freeze({
            version: reconciliation.outcomeCoverage.version,
            status: reconciliation.outcomeCoverage.status,
            linkedCoreCount: reconciliation.outcomeCoverage.linkedCoreCount,
            requiredMembershipCount:
              reconciliation.outcomeCoverage.requiredMembershipCount,
            coveredMembershipCount:
              reconciliation.outcomeCoverage.coveredMembershipCount,
            raceMergeCoveredMembershipCount:
              reconciliation.outcomeCoverage.raceMergeCoveredMembershipCount,
            apiCoveredMembershipCount:
              reconciliation.outcomeCoverage.apiCoveredMembershipCount,
            exactCrossSourceOverlapCount:
              reconciliation.outcomeCoverage.exactCrossSourceOverlapCount,
            replayDuplicateCount:
              reconciliation.outcomeCoverage.replayDuplicateCount,
            extraOutcomeCount: reconciliation.outcomeCoverage.extraOutcomeCount,
            missingMembershipCount:
              reconciliation.outcomeCoverage.missingMembershipCount,
            apiGapCoreCount: reconciliation.outcomeCoverage.apiGapCoreCount,
            requiredMembershipSetSha256:
              reconciliation.outcomeCoverage.requiredMembershipSetSha256,
            coveredMembershipSetSha256:
              reconciliation.outcomeCoverage.coveredMembershipSetSha256,
            missingMembershipSetSha256:
              reconciliation.outcomeCoverage.missingMembershipSetSha256,
            dnaProviderRequestCount:
              reconciliation.outcomeCoverage.dnaProviderRequestCount,
          });
          const report = Object.freeze({
            version: 1,
            status: "complete" as const,
            exactCodeHeadSha,
            capacity: Object.freeze({
              r2MeasuredAt: capacity.measuredAt,
              neonMeasuredAt: capacity.neonMeasuredAt,
              currentR2StorageBytes: capacity.currentR2Usage.storageBytes,
              projectedR2StorageBytes: r2Projection.projectedUsage.storageBytes,
              currentR2ClassBOperations:
                capacity.currentR2Usage.classBOperations,
              projectedR2ClassBOperations:
                r2Projection.projectedUsage.classBOperations,
              plannedRaceMergeReadClassBOperations,
              currentNeonStorageBytes: capacity.currentNeonUsage.storageBytes,
              projectedNeonStorageBytes,
              currentNeonComputeMilliCuHours:
                capacity.currentNeonUsage.computeMilliCuHours,
              projectedNeonComputeMilliCuHours,
              paidUsageAllowed: false as const,
            }),
            raceMerge: Object.freeze({
              terminalCohortOrdinal: RACE_MERGE_TERMINAL_COHORT_ORDINAL,
              terminalCoreCount: RACE_MERGE_TERMINAL_CORE_COUNT,
              manifestCount: raceMergeSource.manifestCount,
              uniqueOutcomeCount: raceMergeSource.uniqueOutcomeCount,
              sourceObservationCount: raceMergeSource.sourceObservationCount,
              retainedR2Bytes: raceMergeSource.retainedR2Bytes,
            }),
            persistedApi:
              persistedApiSource === null
                ? Object.freeze({
                    present: false as const,
                    observationCount: 0,
                    coreCount: 0,
                    payloadSha256: null,
                  })
                : Object.freeze({
                    present: true as const,
                    observationCount: persistedApiSource.observationCount,
                    coreCount: persistedApiSource.coreCount,
                    payloadSha256: persistedApiSource.payloadSha256,
                  }),
            raceAuthority: reconciliation.raceAuthority,
            outcomeCoverage: Object.freeze({
              ...sanitizedCoverage,
              apiGapCoreSetSha256: gapCoreSetSha256,
            }),
            safety: Object.freeze({
              maximumConcurrentCoreLoads: MAXIMUM_CONCURRENT_CORE_LOADS,
              maximumConcurrentCohortLoads: MAXIMUM_CONCURRENT_COHORT_LOADS,
              dnaProviderRequestCount: 0 as const,
              persistentWritePerformed: false as const,
              providerWritePerformed: false as const,
              paidUsageAllowed: false as const,
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
            neonApiKey,
            neonProjectId,
          ]) {
            expect(serialized).not.toContain(secret);
          }
          expect(serialized).not.toContain('"apiGapCoreIds"');
          for (const coreId of reconciliation.outcomeCoverage.apiGapCoreIds) {
            expect(serialized).not.toContain(`"sourceCoreId":${coreId}`);
          }
          console.log(
            "DNA_POPULATION_CORE_OUTCOME_GAP_MEASUREMENT=" + serialized,
          );

          if (process.env.DNA_POPULATION_CORE_OUTCOME_GAP_BOOTSTRAP === "1") {
            const expectedApiGapCoreCount = Number(
              requiredEnvironment(
                "DNA_POPULATION_CORE_OUTCOME_GAP_EXPECTED_CORE_COUNT",
              ),
            );
            const authority =
              createDnaPopulationCoreOutcomeGapAcquisitionAuthority({
                evaluatedAt: requiredEnvironment(
                  "DNA_POPULATION_CORE_OUTCOME_GAP_EVALUATED_AT",
                ),
                apiGapCoreIds: reconciliation.outcomeCoverage.apiGapCoreIds,
                expectedApiGapCoreCount,
                expectedApiGapCoreSetSha256: requiredEnvironment(
                  "DNA_POPULATION_CORE_OUTCOME_GAP_EXPECTED_CORE_SET_SHA256",
                ),
                expectedMissingMembershipSetSha256: requiredEnvironment(
                  "DNA_POPULATION_CORE_OUTCOME_GAP_EXPECTED_MISSING_MEMBERSHIP_SET_SHA256",
                ),
              });
            expect(authority.apiGapCoreCount).toBe(
              reconciliation.outcomeCoverage.apiGapCoreCount,
            );
            const cohort = selectDnaPopulationCoreOutcomeGapAcquisitionCohort({
              authority,
              cohortOrdinal: 1,
            });

            const freshCapacity = await capacitySource.measure({ ownerId });
            const freshR2Projection =
              projectDnaPopulationEntrantAuthorityR2Cost({
                currentUsage: freshCapacity.currentR2Usage,
                plannedUsage: {
                  storageBytes: 0,
                  classAOperations: 0,
                  classBOperations: 0,
                },
              });
            if (
              !freshR2Projection.allowed ||
              freshR2Projection.projectedPaidCostMicroUsd !== 0 ||
              freshR2Projection.paidUsageAllowed !== false
            ) {
              throw new Error(
                "exact-gap acquisition bootstrap exceeds A$0 R2 capacity",
              );
            }

            const plannedNeonStorageBytes =
              GAP_BOOTSTRAP_BASE_NEON_STORAGE_BYTES +
              cohort.coreCount * GAP_BOOTSTRAP_PER_CORE_NEON_STORAGE_BYTES;
            const projectedBootstrapNeonStorageBytes =
              freshCapacity.currentNeonUsage.storageBytes +
              plannedNeonStorageBytes;
            const projectedBootstrapNeonComputeMilliCuHours =
              freshCapacity.currentNeonUsage.computeMilliCuHours +
              GAP_BOOTSTRAP_NEON_COMPUTE_MILLI_CU_HOURS;
            if (
              !Number.isSafeInteger(plannedNeonStorageBytes) ||
              !Number.isSafeInteger(projectedBootstrapNeonStorageBytes) ||
              !Number.isSafeInteger(
                projectedBootstrapNeonComputeMilliCuHours,
              ) ||
              projectedBootstrapNeonStorageBytes >
                DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.storageBytes ||
              projectedBootstrapNeonStorageBytes > HARD_NEON_STORAGE_BYTES ||
              projectedBootstrapNeonComputeMilliCuHours >
                DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.computeMilliCuHours
            ) {
              throw new Error(
                "exact-gap acquisition bootstrap exceeds A$0 Neon capacity",
              );
            }

            const acquisitionRepository =
              createNeonDnaCoreRaceHistoryAcquisitionRepository({
                databaseUrl,
                databaseOwnerId,
                ownerId,
                runtimeRole: RUNTIME_ROLE,
                populationAuthority: {
                  generationId: cohort.authorityGenerationId,
                  coreIds: cohort.coreIds,
                },
              });
            const latestComplete =
              await acquisitionRepository.loadLatestComplete();
            const cycle = createDnaCoreRaceHistoryAcquisitionCycle({
              previousCompletedCycleId: latestComplete?.cycle.cycleId ?? null,
              currentStateGenerationId: cohort.authorityGenerationId,
              evaluatedAt: cohort.evaluatedAt,
              coreIds: cohort.coreIds,
            });
            const stored = await acquisitionRepository.saveAttempt({
              expectedRevision: null,
              cycle,
            });
            expect(stored.cycle.coreSetSha256).toBe(cohort.coreSetSha256);
            expect(stored.cycle.coreIds.length).toBe(cohort.coreCount);

            const bootstrapReport = Object.freeze({
              version: 1,
              status: "ready_for_targeted_acquisition" as const,
              exactCodeHeadSha,
              apiGapCoreCount: authority.apiGapCoreCount,
              apiGapCoreSetSha256: authority.apiGapCoreSetSha256,
              missingMembershipSetSha256: authority.missingMembershipSetSha256,
              cohortOrdinal: cohort.cohortOrdinal,
              cohortCount: cohort.cohortCount,
              cohortCoreCount: cohort.coreCount,
              remainingCoreCount: cohort.remainingCoreCount,
              cohortCoreSetSha256: cohort.coreSetSha256,
              currentNeonStorageBytes:
                freshCapacity.currentNeonUsage.storageBytes,
              projectedBootstrapNeonStorageBytes,
              dnaProviderRequestCount: 0 as const,
              persistentWritePerformed: true as const,
              providerWritePerformed: false as const,
              paidUsageAllowed: false as const,
            });
            const bootstrapSerialized = JSON.stringify(bootstrapReport);
            expect(bootstrapSerialized).not.toContain('"coreIds"');
            for (const coreId of cohort.coreIds) {
              expect(bootstrapSerialized).not.toContain(
                `"sourceCoreId":${coreId}`,
              );
            }
            console.log(
              "DNA_POPULATION_CORE_OUTCOME_GAP_BOOTSTRAP=" +
                bootstrapSerialized,
            );
          }

          const firstExactGapApiPage =
            process.env.DNA_POPULATION_CORE_OUTCOME_GAP_FIRST_API_PAGE === "1";
          const continueExactGapApiPage =
            process.env.DNA_POPULATION_CORE_OUTCOME_GAP_CONTINUE_API_PAGE ===
            "1";
          if (firstExactGapApiPage || continueExactGapApiPage) {
            expect(firstExactGapApiPage && continueExactGapApiPage).toBe(false);
            const maximumPages = firstExactGapApiPage
              ? 1
              : Number(
                  requiredEnvironment(
                    "DNA_POPULATION_CORE_OUTCOME_GAP_MAXIMUM_PAGES",
                  ),
                );
            if (
              !Number.isSafeInteger(maximumPages) ||
              maximumPages < 1 ||
              maximumPages > 300
            ) {
              throw new Error("exact-gap maximum page count is invalid");
            }
            const authority =
              createDnaPopulationCoreOutcomeGapAcquisitionAuthority({
                evaluatedAt: requiredEnvironment(
                  "DNA_POPULATION_CORE_OUTCOME_GAP_ACQUISITION_EVALUATED_AT",
                ),
                apiGapCoreIds: reconciliation.outcomeCoverage.apiGapCoreIds,
                expectedApiGapCoreCount: Number(
                  requiredEnvironment(
                    "DNA_POPULATION_CORE_OUTCOME_GAP_EXPECTED_CORE_COUNT",
                  ),
                ),
                expectedApiGapCoreSetSha256: requiredEnvironment(
                  "DNA_POPULATION_CORE_OUTCOME_GAP_EXPECTED_CORE_SET_SHA256",
                ),
                expectedMissingMembershipSetSha256: requiredEnvironment(
                  "DNA_POPULATION_CORE_OUTCOME_GAP_EXPECTED_MISSING_MEMBERSHIP_SET_SHA256",
                ),
              });
            const cohort = selectDnaPopulationCoreOutcomeGapAcquisitionCohort({
              authority,
              cohortOrdinal: 1,
            });
            const acquisitionRepository =
              createNeonDnaCoreRaceHistoryAcquisitionRepository({
                databaseUrl,
                databaseOwnerId,
                ownerId,
                runtimeRole: RUNTIME_ROLE,
                populationAuthority: {
                  generationId: cohort.authorityGenerationId,
                  coreIds: cohort.coreIds,
                },
              });
            const latestComplete =
              await acquisitionRepository.loadLatestComplete();
            const expectedCycle = createDnaCoreRaceHistoryAcquisitionCycle({
              previousCompletedCycleId: latestComplete?.cycle.cycleId ?? null,
              currentStateGenerationId: cohort.authorityGenerationId,
              evaluatedAt: cohort.evaluatedAt,
              coreIds: cohort.coreIds,
            });

            const persistedAttempt = await acquisitionRepository.loadAttempt({
              cycleId: expectedCycle.cycleId,
              attemptNumber: 1,
            });
            expect(persistedAttempt?.cycle).toEqual(expectedCycle);
            const persistedCores = await acquisitionRepository.loadCores({
              cycleId: expectedCycle.cycleId,
              attemptNumber: 1,
            });
            expect(persistedCores).toHaveLength(cohort.coreCount);
            expect(
              dnaCoreRaceHistoryCoreSetSha256(
                persistedCores.map((stored) => stored.checkpoint.coreId),
              ),
            ).toBe(cohort.coreSetSha256);
            const progress = (
              cores: typeof persistedCores,
            ): Readonly<{
              completedPageCount: number;
              sourceRowCount: number;
              acceptedResultCount: number;
              quarantineCount: number;
              replayDuplicateCount: number;
              completedCoreCount: number;
            }> =>
              Object.freeze(
                cores.reduce(
                  (total, { checkpoint }) => ({
                    completedPageCount:
                      total.completedPageCount + checkpoint.completedPageCount,
                    sourceRowCount:
                      total.sourceRowCount + checkpoint.sourceRowCount,
                    acceptedResultCount:
                      total.acceptedResultCount +
                      checkpoint.acceptedResultCount,
                    quarantineCount:
                      total.quarantineCount + checkpoint.quarantineCount,
                    replayDuplicateCount:
                      total.replayDuplicateCount +
                      checkpoint.replayDuplicateCount,
                    completedCoreCount:
                      total.completedCoreCount +
                      (checkpoint.status === "complete" ? 1 : 0),
                  }),
                  {
                    completedPageCount: 0,
                    sourceRowCount: 0,
                    acceptedResultCount: 0,
                    quarantineCount: 0,
                    replayDuplicateCount: 0,
                    completedCoreCount: 0,
                  },
                ),
              );
            const progressBefore = progress(persistedCores);
            if (firstExactGapApiPage) {
              expect(progressBefore).toEqual({
                completedPageCount: 0,
                sourceRowCount: 0,
                acceptedResultCount: 0,
                quarantineCount: 0,
                replayDuplicateCount: 0,
                completedCoreCount: 0,
              });
              expect(
                persistedCores.every(
                  ({ checkpoint }) =>
                    checkpoint.status === "running" &&
                    checkpoint.nextPage === 1,
                ),
              ).toBe(true);
            } else {
              expect(progressBefore.completedPageCount).toBeGreaterThanOrEqual(
                1,
              );
            }

            const budgetRepository =
              neonDnaOpenLabR2BudgetRepositoryFromEnvironment({
                databaseUrl,
                databaseOwnerId,
                runtimeRole: RUNTIME_ROLE,
              });
            if (budgetRepository.status !== "ready") {
              throw new Error("R2 budget repository is unavailable");
            }

            const client = createDnaCoreRaceHistoryClient();
            const requestBudget = createDnaOpenLabRequestBudget({
              initialRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
              maximumRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
            });
            const evidenceStore = createDnaCoreRaceHistoryR2EvidenceStore({
              ownerId,
              bucketName,
              storage,
            });
            let pagesAdvanced = 0;
            let batchStatus: "advanced" | "complete" = "advanced";
            let resultKind: "page_advanced" | "collection_complete" =
              "page_advanced";
            let resultSource: "recovered" | "provider" | null = null;
            let lastFreshCapacity: Awaited<
              ReturnType<typeof capacitySource.measure>
            > | null = null;
            let lastProjectedR2StorageBytes: number | null = null;
            let lastProjectedNeonStorageBytes: number | null = null;
            let runtimeCutoffReached = false;

            for (let pageIndex = 0; pageIndex < maximumPages; pageIndex += 1) {
              if (
                Date.now() - connectedRunStartedAt >=
                ACQUISITION_BATCH_RUNTIME_CUTOFF_MS
              ) {
                runtimeCutoffReached = true;
                break;
              }
              // Capacity is remeasured before every material page write. This
              // deliberately trades a little throughput for a hard A$0 stop.
              const freshCapacity = await capacitySource.measure({ ownerId });
              if (freshCapacity.r2StorageClass !== "Standard") {
                throw new Error("R2 storage class is not eligible");
              }
              const stepR2Projection =
                projectDnaPopulationEntrantAuthorityR2Cost({
                  currentUsage: freshCapacity.currentR2Usage,
                  plannedUsage: DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE,
                });
              if (
                !stepR2Projection.allowed ||
                stepR2Projection.projectedPaidCostMicroUsd !== 0 ||
                stepR2Projection.paidUsageAllowed !== false
              ) {
                throw new Error("exact-gap API page exceeds A$0 R2 capacity");
              }

              const projectedNeonStorageBytes =
                freshCapacity.currentNeonUsage.storageBytes +
                GAP_FIRST_PAGE_NEON_STORAGE_RESERVE_BYTES;
              const projectedNeonComputeMilliCuHours =
                freshCapacity.currentNeonUsage.computeMilliCuHours +
                GAP_FIRST_PAGE_NEON_COMPUTE_RESERVE_MILLI_CU_HOURS;
              if (
                !Number.isSafeInteger(projectedNeonStorageBytes) ||
                !Number.isSafeInteger(projectedNeonComputeMilliCuHours) ||
                projectedNeonStorageBytes > OWNER_NEON_STORAGE_BYTES ||
                projectedNeonStorageBytes > HARD_NEON_STORAGE_BYTES ||
                projectedNeonStorageBytes >
                  DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.storageBytes ||
                projectedNeonComputeMilliCuHours >
                  DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.computeMilliCuHours
              ) {
                throw new Error("exact-gap API page exceeds A$0 Neon capacity");
              }

              const budgetWindowId = r2BudgetWindowId({
                ownerId,
                startAt: freshCapacity.billingWindowStartAt,
                endAt: freshCapacity.billingWindowEndAt,
              });
              const existingWindow = await budgetRepository.readWindow(ownerId);
              if (existingWindow?.windowId !== budgetWindowId) {
                await budgetRepository.openWindow({
                  ownerId,
                  windowId: budgetWindowId,
                  windowStartAt: freshCapacity.billingWindowStartAt,
                  windowEndAt: freshCapacity.billingWindowEndAt,
                  measuredAt: freshCapacity.measuredAt,
                  baselineUsage: freshCapacity.currentR2Usage,
                });
              }

              const attemptedAt = new Date(
                Math.max(Date.now(), Date.parse(cohort.evaluatedAt)),
              ).toISOString();
              const acquisition =
                await runDnaCoreRaceHistoryPrivateCollectorStep({
                  ownerId,
                  budgetWindowId,
                  evaluatedAt: cohort.evaluatedAt,
                  attemptedAt,
                  loadServingCores: async () =>
                    Object.freeze(
                      cohort.coreIds.map((coreId) =>
                        Object.freeze({
                          generationId: cohort.authorityGenerationId,
                          canonical: Object.freeze({
                            sourceCoreId: String(coreId),
                          }),
                        }),
                      ),
                    ),
                  acquisitionRepository,
                  budgetRepository,
                  client,
                  requestBudget,
                  evidenceStore,
                });

              lastFreshCapacity = freshCapacity;
              lastProjectedR2StorageBytes =
                stepR2Projection.projectedUsage.storageBytes;
              lastProjectedNeonStorageBytes = projectedNeonStorageBytes;
              if (acquisition.kind === "page_advanced") {
                pagesAdvanced += 1;
                resultKind = acquisition.kind;
                resultSource = acquisition.source;
                continue;
              }
              if (acquisition.kind === "collection_complete") {
                batchStatus = "complete";
                resultKind = acquisition.kind;
                resultSource = null;
                break;
              }
              throw new Error(
                `exact-gap acquisition stopped with ${acquisition.kind}`,
              );
            }

            if (runtimeCutoffReached && pagesAdvanced === 0) {
              throw new Error(
                "exact-gap reconciliation left no bounded time for a page",
              );
            }
            if (
              lastFreshCapacity === null ||
              lastProjectedR2StorageBytes === null ||
              lastProjectedNeonStorageBytes === null
            ) {
              throw new Error("exact-gap batch produced no capacity evidence");
            }
            const persistedCoresAfter = await acquisitionRepository.loadCores({
              cycleId: expectedCycle.cycleId,
              attemptNumber: 1,
            });
            const progressAfter = progress(persistedCoresAfter);
            expect(progressAfter.completedPageCount).toBe(
              progressBefore.completedPageCount + pagesAdvanced,
            );

            const acquisitionReport = Object.freeze({
              version: 2,
              status: batchStatus,
              exactCodeHeadSha,
              apiGapCoreCount: authority.apiGapCoreCount,
              missingMembershipCount:
                reconciliation.outcomeCoverage.missingMembershipCount,
              apiGapCoreSetSha256: authority.apiGapCoreSetSha256,
              missingMembershipSetSha256: authority.missingMembershipSetSha256,
              cohortOrdinal: cohort.cohortOrdinal,
              cohortCount: cohort.cohortCount,
              cohortCoreCount: cohort.coreCount,
              cohortCoreSetSha256: cohort.coreSetSha256,
              maximumAggregateRequestsPerMinute:
                DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
              maximumPages,
              pagesAdvanced,
              runtimeCutoffReached,
              resultKind,
              resultSource,
              progress: Object.freeze({
                before: progressBefore,
                after: progressAfter,
              }),
              capacity: Object.freeze({
                measuredAt: lastFreshCapacity.measuredAt,
                currentR2StorageBytes:
                  lastFreshCapacity.currentR2Usage.storageBytes,
                projectedNextStepR2StorageBytes: lastProjectedR2StorageBytes,
                currentNeonStorageBytes:
                  lastFreshCapacity.currentNeonUsage.storageBytes,
                projectedNextPageNeonStorageBytes:
                  lastProjectedNeonStorageBytes,
              }),
              safety: Object.freeze({
                persistedCheckpointReadBack: true as const,
                exactGapCohortOnly: true as const,
                capacityMeasuredBeforeEveryPage: true as const,
                persistentCheckpointWritePerformed: pagesAdvanced > 0,
                privateEvidenceWriteMayBePerformed: pagesAdvanced > 0,
                providerWritePerformed: false as const,
                paidUsageAllowed: false as const,
                previewOnly: true as const,
              }),
            });
            const acquisitionSerialized = JSON.stringify(acquisitionReport);
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
              neonApiKey,
              neonProjectId,
            ]) {
              expect(acquisitionSerialized).not.toContain(secret);
            }
            expect(acquisitionSerialized).not.toContain('"coreIds"');
            for (const coreId of cohort.coreIds) {
              expect(acquisitionSerialized).not.toContain(
                `"sourceCoreId":${coreId}`,
              );
            }
            console.log(
              (firstExactGapApiPage
                ? "DNA_POPULATION_CORE_OUTCOME_GAP_FIRST_API_PAGE="
                : "DNA_POPULATION_CORE_OUTCOME_GAP_CONTINUE_API_PAGE=") +
                acquisitionSerialized,
            );
            if (continueExactGapApiPage && process.env.GITHUB_OUTPUT) {
              await appendFile(
                process.env.GITHUB_OUTPUT,
                `batch_status=${batchStatus}\npages_advanced=${pagesAdvanced}\n`,
                "utf8",
              );
            }
          }
        } finally {
          await rm(scratchRoot, { recursive: true, force: true });
        }
      },
      135 * 60_000,
    );
  },
);
