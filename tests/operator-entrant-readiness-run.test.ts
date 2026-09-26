import { describe, expect, it } from "vitest";

import { cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment } from "@/lib/cloudflare-neon-dna-open-lab-provider-capacity-source";
import { createCloudflareR2DatasetEvidencePort } from "@/lib/cloudflare-r2-dataset-evidence-port";
import {
  createDnaPopulationEntrantAuthorityCapacityGate,
  DNA_POPULATION_ENTRANT_AUTHORITY_VERIFIED_COMPACT_BYTES_FLOOR,
} from "@/lib/dna-population-entrant-authority-capacity-gate";
import { createDnaPopulationEntrantAuthorityLiveAuditSource } from "@/lib/dna-population-entrant-authority-live-audit-source";
import { createDnaPopulationEntrantAuthorityReadinessInspector } from "@/lib/dna-population-entrant-authority-readiness";
import {
  DNA_POPULATION_ENTRANT_LIVE_AUDIT_MAXIMUM_CLASS_B_OPERATIONS,
} from "@/lib/dna-population-entrant-authority-live-audit-source";
import { createDnaPopulationEntrantAuthorityReadinessHandoff } from "@/lib/dna-population-entrant-authority-readiness-handoff";
import { DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET } from "@/lib/dna-open-lab-p5-first-backfill-approval";
import { createDnaOpenLabP5FirstBackfillR2EvidenceWriter } from "@/lib/dna-open-lab-p5-first-backfill-r2-evidence";
import { DnaOpenLabProviderCapacityMeasurementError } from "@/lib/dna-open-lab-provider-capacity-preflight";
import { DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS } from "@/lib/dna-open-lab-zero-cost-refresh-policy";
import { DNA_POPULATION_RACE_INDEX_P5_AUTHORITY } from "@/lib/dna-population-race-index-private-preview-operator";
import { createDnaPopulationRaceIndexR2ChunkStore } from "@/lib/dna-population-race-index-r2-chunk";
import { createNeonDnaOpenLabP5FirstBackfillLedger } from "@/lib/neon-dna-open-lab-p5-first-backfill-ledger";
import { createNeonDnaPopulationRaceIndexGenerationRepository } from "@/lib/neon-dna-population-race-index-generation";
import { createNeonDnaOpenLabSyncPublicationRepository } from "@/lib/neon-dna-open-lab-sync-publication";

const connected =
  process.env.DNA_POPULATION_ENTRANT_AUTHORITY_OPERATOR_READINESS === "1";
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
    throw new Error("required environment is unavailable");
  }
  return value;
}

describeConnected(
  "operator branch read-only entrant authority readiness",
  () => {
    it(
      "inspects exact current main authority and emits a zero-cost commissioning handoff",
      async () => {
        const exactCodeHeadSha = requiredEnvironment(
          "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_MAIN_SHA",
        ).toLowerCase();
        if (!COMMIT_PATTERN.test(exactCodeHeadSha)) {
          throw new Error("exact main commit is unavailable");
        }

        const ownerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
        const capacitySource =
          cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment({
            authorizedOwnerId: ownerId,
            cloudflareAccountId: requiredEnvironment("CLOUDFLARE_ACCOUNT_ID"),
            cloudflareAnalyticsApiToken: requiredEnvironment(
              "CLOUDFLARE_ANALYTICS_API_TOKEN",
            ),
            r2BucketName: requiredEnvironment("DNA_R2_BUCKET_NAME"),
            r2StorageClass: requiredEnvironment("DNA_R2_STORAGE_CLASS"),
            neonApiKey: requiredEnvironment("NEON_API_KEY"),
            neonProjectId: requiredEnvironment("NEON_PROJECT_ID"),
          });
        if (capacitySource.status !== "ready") {
          throw new Error("operator capacity source is not configured");
        }
        let providerMeasurement;
        try {
          providerMeasurement = await capacitySource.measure({ ownerId });
          const readBudgetAvailable =
            providerMeasurement.currentR2Usage.classBOperations +
              DNA_POPULATION_ENTRANT_LIVE_AUDIT_MAXIMUM_CLASS_B_OPERATIONS <=
            DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.classBOperations;
          console.log(
            "DNA_POPULATION_ENTRANT_AUTHORITY_CAPACITY_STAGE=" +
              JSON.stringify({
                status: "ready",
                measuredAt: providerMeasurement.measuredAt,
                neonMeasuredAt: providerMeasurement.neonMeasuredAt,
                readBudgetAvailable,
              }),
          );
          if (!readBudgetAvailable) {
            throw new Error("operator live-audit read budget is unavailable");
          }
        } catch (error) {
          const failureId =
            error instanceof DnaOpenLabProviderCapacityMeasurementError
              ? error.failureId
              : "unexpected_measurement_failure";
          console.log(
            "DNA_POPULATION_ENTRANT_AUTHORITY_CAPACITY_STAGE=" +
              JSON.stringify({
                status: "failed",
                failureId,
              }),
          );
          throw new Error("operator capacity diagnostic failed");
        }

        const databaseUrl = requiredEnvironment("DATABASE_URL");
        const databaseOwnerId = requiredEnvironment("DNA_DATABASE_OWNER_ID");
        const baseline = createNeonDnaOpenLabP5FirstBackfillLedger({
          databaseUrl,
          databaseOwnerId,
          ownerId,
          runtimeRole: RUNTIME_ROLE,
          approvalPacket: DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET,
        });
        const baselineState = await baseline.load();
        const baselineReady =
          baselineState !== null &&
          baselineState.status === "complete" &&
          baselineState.completionSha256 !== null &&
          baselineState.logicalRequestCount ===
            DNA_POPULATION_RACE_INDEX_P5_AUTHORITY.logicalRequestCount &&
          baselineState.retainedR2Bytes ===
            DNA_POPULATION_RACE_INDEX_P5_AUTHORITY.retainedR2Bytes &&
          baselineState.omittedIdentityObservationCount ===
            DNA_POPULATION_RACE_INDEX_P5_AUTHORITY.omittedIdentityObservationCount;
        console.log(
          "DNA_POPULATION_ENTRANT_AUTHORITY_BASELINE_STAGE=" +
            JSON.stringify({
              status: baselineReady ? "ready" : "failed",
            }),
        );
        if (!baselineReady || baselineState.completionSha256 === null) {
          throw new Error("operator baseline diagnostic failed");
        }

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
        const populationIndexReady =
          populationIndex !== null &&
          populationIndex.state === "published" &&
          populationIndex.generationId === baselineState.completionSha256 &&
          populationIndex.lastRequestOrdinal === baselineState.logicalRequestCount &&
          populationIndex.processedReceiptCount === baselineState.logicalRequestCount &&
          populationIndex.processedReceiptBytes === baselineState.retainedR2Bytes &&
          populationIndex.processedIdentityOmissionCount ===
            baselineState.omittedIdentityObservationCount &&
          populationIndex.storageLayout === "r2_chunked_v1" &&
          populationIndex.r2ChunkCount > 0 &&
          populationIndex.r2IdentityChunkCount === populationIndex.r2ChunkCount &&
          populationIndex.r2CompactedRaceCount === populationIndex.uniqueRaceCount &&
          populationIndex.r2LastSourceRaceId !== null &&
          populationIndex.legacyStorageRetiredAt !== null;
        console.log(
          "DNA_POPULATION_ENTRANT_AUTHORITY_INDEX_STAGE=" +
            JSON.stringify({
              status: populationIndexReady ? "ready" : "failed",
              ...(populationIndexReady
                ? {
                    r2ChunkCount: populationIndex.r2ChunkCount,
                    uniqueRaceCount: populationIndex.uniqueRaceCount,
                  }
                : {}),
            }),
        );
        if (!populationIndexReady || populationIndex === null) {
          throw new Error("operator population index diagnostic failed");
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
          if (page.length < 1) {
            throw new Error("operator manifest pagination diagnostic failed");
          }
          manifests.push(...page);
          afterChunkOrdinal = page.at(-1)!.chunkOrdinal;
        }
        const manifestRows = manifests.reduce(
          (sum, manifest) => sum + manifest.rowCount,
          0,
        );
        const manifestsReady =
          manifests.length === populationIndex.r2ChunkCount &&
          manifestRows === populationIndex.uniqueRaceCount &&
          manifests.every(
            (manifest, index) =>
              manifest.version === 1 &&
              manifest.chunkOrdinal === index + 1 &&
              manifest.identityRegisteredAt !== null,
          );
        console.log(
          "DNA_POPULATION_ENTRANT_AUTHORITY_MANIFEST_STAGE=" +
            JSON.stringify({
              status: manifestsReady ? "ready" : "failed",
              manifestCount: manifests.length,
              manifestRows,
            }),
        );
        if (!manifestsReady) {
          throw new Error("operator manifest diagnostic failed");
        }

        const bucketName = requiredEnvironment("DNA_R2_BUCKET_NAME");
        const storage = createCloudflareR2DatasetEvidencePort({
          accountId: requiredEnvironment("CLOUDFLARE_ACCOUNT_ID"),
          apiToken: requiredEnvironment("CLOUDFLARE_API_TOKEN"),
          accessKeyId: requiredEnvironment("DNA_R2_ACCESS_KEY_ID"),
          secretAccessKey: requiredEnvironment("DNA_R2_SECRET_ACCESS_KEY"),
        });
        const baselineEvidence = createDnaOpenLabP5FirstBackfillR2EvidenceWriter({
          ownerId,
          bucketName,
          storage,
          approvalPacket: DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET,
        });
        const publicationRepository =
          createNeonDnaOpenLabSyncPublicationRepository({
            databaseUrl,
            databaseOwnerId,
            runtimeRole: RUNTIME_ROLE,
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
            populationIndex: populationIndexRepository,
            chunkStore: populationChunkStore,
            storage,
            capacitySource,
          });

        let liveAudit;
        try {
          liveAudit = await authoritySource.load({
            ownerId,
            exactCodeHeadSha,
          });
          console.log(
            "DNA_POPULATION_ENTRANT_AUTHORITY_LIVE_AUDIT_STAGE=" +
              JSON.stringify({
                status: "ready",
                unresolvedRaceCount: liveAudit.authority.unresolvedRaceCount,
                unresolvedRaceSetSha256:
                  liveAudit.authority.unresolvedRaceSetSha256,
              }),
          );
        } catch (error) {
          const prefix = "Population entrant live audit: ";
          const reason =
            error instanceof Error && error.message.startsWith(prefix)
              ? error.message.slice(prefix.length)
              : "underlying_read_failure";
          console.log(
            "DNA_POPULATION_ENTRANT_AUTHORITY_LIVE_AUDIT_STAGE=" +
              JSON.stringify({
                status: "failed",
                reason,
              }),
          );
          throw new Error("operator live audit diagnostic failed");
        }

        const capacityGate = createDnaPopulationEntrantAuthorityCapacityGate({
          ownerId,
          measurementSource: capacitySource,
          sizingAuthority: Object.freeze({
            version: 1 as const,
            unresolvedRaceCount: liveAudit.authority.unresolvedRaceCount,
            unresolvedRaceSetSha256:
              liveAudit.authority.unresolvedRaceSetSha256,
            measuredMaximumCompactEntrantAuthorityBytes:
              DNA_POPULATION_ENTRANT_AUTHORITY_VERIFIED_COMPACT_BYTES_FLOOR,
            verifiedIncrementalMaximumCompactEntrantAuthorityBytes:
              DNA_POPULATION_ENTRANT_AUTHORITY_VERIFIED_COMPACT_BYTES_FLOOR,
          }),
        });
        const readiness = createDnaPopulationEntrantAuthorityReadinessInspector({
          ownerId,
          exactCodeHeadSha,
          authoritySource: Object.freeze({
            load: async () => liveAudit,
          }),
          capacityGate,
        });
        const receipt = await readiness.inspect();
        expect(receipt).toMatchObject({
          status: "ready",
          exactCodeHeadSha,
          previewOnly: true,
          dnaEntrantHydrationPerformed: false,
          checkpointInitializationPerformed: false,
          entrantChunkPersistentWritePerformed: false,
          providerWritePerformed: false,
          paidUsageAllowed: false,
        });
        expect(receipt.unresolvedRaceCount).toBeGreaterThan(0);
        expect(receipt.unresolvedRaceSetSha256).toMatch(/^[a-f0-9]{64}$/u);

        const handoff =
          createDnaPopulationEntrantAuthorityReadinessHandoff(receipt);
        expect(handoff).toMatchObject({
          exactCodeHeadSha,
          expectedUnresolvedRaceCount: receipt.unresolvedRaceCount,
          expectedUnresolvedRaceSetSha256: receipt.unresolvedRaceSetSha256,
          readinessCapacityObservedAt: receipt.capacityObservedAt,
        });

        console.log(
          "DNA_POPULATION_ENTRANT_AUTHORITY_READINESS=" +
            JSON.stringify(receipt),
        );
        console.log(
          "DNA_POPULATION_ENTRANT_AUTHORITY_COMMISSIONING_HANDOFF=" +
            JSON.stringify(handoff),
        );
      },
      30 * 60_000,
    );
  },
);
