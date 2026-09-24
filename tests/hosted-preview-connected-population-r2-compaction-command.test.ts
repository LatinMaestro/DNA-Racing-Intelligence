import { describe, expect, it } from "vitest";

import { cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment } from "@/lib/cloudflare-neon-dna-open-lab-provider-capacity-source";
import { createCloudflareR2DatasetEvidencePort } from "@/lib/cloudflare-r2-dataset-evidence-port";
import { DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET } from "@/lib/dna-open-lab-p5-first-backfill-approval";
import { createDnaOpenLabProviderCapacityPreflight } from "@/lib/dna-open-lab-provider-capacity-preflight";
import { createDnaOpenLabP5FirstBackfillR2EvidenceWriter } from "@/lib/dna-open-lab-p5-first-backfill-r2-evidence";
import {
  createDnaPopulationRaceIndexR2CompactionOperator,
  DNA_POPULATION_RACE_INDEX_R2_COMPACTION_INTENT,
  DNA_POPULATION_RACE_INDEX_R2_COMPACTION_OPERATOR_VERSION,
} from "@/lib/dna-population-race-index-r2-compaction-operator";
import { createDnaPopulationRaceIndexR2ChunkStore } from "@/lib/dna-population-race-index-r2-chunk";
import { createNeonDnaOpenLabP5FirstBackfillLedger } from "@/lib/neon-dna-open-lab-p5-first-backfill-ledger";
import { createNeonDnaPopulationRaceIndexGenerationRepository } from "@/lib/neon-dna-population-race-index-generation";

const connected =
  process.env.DNA_POPULATION_R2_COMPACTION_PRIVATE_PREVIEW_COMMAND === "1";
const describeConnected = connected ? describe : describe.skip;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const RUNTIME_ROLE = "dna_app_runtime";

type DiagnosticStage =
  | "environment"
  | "capacity-source"
  | "repository-composition"
  | "operator-execution"
  | "receipt-validation";

type OperatorBoundary =
  | "not-started"
  | "baseline-load"
  | "after-baseline-load"
  | "generation-load"
  | "after-generation-load"
  | "capacity-preflight"
  | "after-capacity-preflight"
  | "legacy-read"
  | "after-legacy-read"
  | "r2-write"
  | "after-r2-write"
  | "neon-register"
  | "after-neon-register"
  | "finalize"
  | "after-finalize";

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

function connectedFailureId(error: unknown): string {
  if (!(error instanceof Error)) return "unexpected_failure";
  if (error.message.includes("bounded byte capacity")) {
    return "r2_chunk_byte_bound";
  }
  if (error.message.includes("storage-negative chunk retirement count")) {
    return "neon_chunk_retirement_count";
  }
  if (error.message.includes("stored chunk")) return "r2_chunk_replay";
  if (error.message.includes("population race R2 compaction registration")) {
    return "neon_chunk_registration";
  }
  if (error.message.includes("population race index isolation")) {
    return "neon_runtime_isolation";
  }
  return "unexpected_failure";
}

describeConnected("hosted Preview population R2 compaction command", () => {
  it(
    "moves one bounded unique legacy race chunk to private R2 without DNA requests",
    async () => {
      let diagnosticStage: DiagnosticStage = "environment";
      let operatorBoundary: OperatorBoundary = "not-started";
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

        diagnosticStage = "capacity-source";
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

        diagnosticStage = "repository-composition";
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
        const rawRepository =
          createNeonDnaPopulationRaceIndexGenerationRepository({
            databaseUrl,
            databaseOwnerId,
            ownerId,
            runtimeRole: RUNTIME_ROLE,
          });
        const rawCapacityPreflight = createDnaOpenLabProviderCapacityPreflight({
          configuredOwnerId: ownerId,
          measurementSource: capacitySource,
        });
        const rawChunkStore = createDnaPopulationRaceIndexR2ChunkStore({
          ownerId,
          bucketName,
          storage,
        });
        const repository = Object.freeze({
          ...rawRepository,
          async load(...args: Parameters<typeof rawRepository.load>) {
            operatorBoundary = "generation-load";
            const result = await rawRepository.load(...args);
            operatorBoundary = "after-generation-load";
            return result;
          },
          async readLegacyChunk(
            ...args: Parameters<typeof rawRepository.readLegacyChunk>
          ) {
            operatorBoundary = "legacy-read";
            const result = await rawRepository.readLegacyChunk(...args);
            operatorBoundary = "after-legacy-read";
            return result;
          },
          async registerCompactionChunk(
            ...args: Parameters<typeof rawRepository.registerCompactionChunk>
          ) {
            operatorBoundary = "neon-register";
            const result = await rawRepository.registerCompactionChunk(...args);
            operatorBoundary = "after-neon-register";
            return result;
          },
          async finalizeCompaction(
            ...args: Parameters<typeof rawRepository.finalizeCompaction>
          ) {
            operatorBoundary = "finalize";
            const result = await rawRepository.finalizeCompaction(...args);
            operatorBoundary = "after-finalize";
            return result;
          },
        });
        const capacityPreflight = Object.freeze({
          ...rawCapacityPreflight,
          async inspect(
            ...args: Parameters<typeof rawCapacityPreflight.inspect>
          ) {
            operatorBoundary = "capacity-preflight";
            const result = await rawCapacityPreflight.inspect(...args);
            operatorBoundary = "after-capacity-preflight";
            return result;
          },
        });
        const chunkStore = Object.freeze({
          ...rawChunkStore,
          async write(...args: Parameters<typeof rawChunkStore.write>) {
            operatorBoundary = "r2-write";
            const result = await rawChunkStore.write(...args);
            operatorBoundary = "after-r2-write";
            return result;
          },
        });
        const operator = createDnaPopulationRaceIndexR2CompactionOperator({
          configuredOwnerId: ownerId,
          baseline: {
            async load(...args: Parameters<typeof ledger.load>) {
              operatorBoundary = "baseline-load";
              const result = await ledger.load(...args);
              operatorBoundary = "after-baseline-load";
              return result;
            },
          },
          repository,
          capacityPreflight,
          chunkStore,
        });

        diagnosticStage = "operator-execution";
        const receipt = await operator.execute({
          operatorVersion:
            DNA_POPULATION_RACE_INDEX_R2_COMPACTION_OPERATOR_VERSION,
          intent: DNA_POPULATION_RACE_INDEX_R2_COMPACTION_INTENT,
          allowPersistentWrite: true,
          authenticatedOwnerId: ownerId,
          exactCodeHeadSha,
          workerId: "population-r2-compaction-preview-worker",
          attemptedAt: requiredEnvironment(
            "DNA_POPULATION_R2_COMPACTION_ATTEMPTED_AT",
          ),
          maximumRows: 4_000,
        });

        diagnosticStage = "receipt-validation";
        const report = Object.freeze({
          status: receipt.status,
          reason: receipt.reason,
          exactCodeHeadSha: receipt.exactCodeHeadSha,
          beforeCompactedRaceCount: receipt.beforeCompactedRaceCount,
          afterCompactedRaceCount: receipt.afterCompactedRaceCount,
          uniqueRaceCount: receipt.uniqueRaceCount,
          r2ChunkCount: receipt.r2ChunkCount,
          storageLayout: receipt.storageLayout,
          providerCapacityBlockerIds: receipt.providerCapacityBlockerIds,
          r2ObjectCreated: receipt.r2ObjectCreated,
          dnaProviderRequestCount: receipt.dnaProviderRequestCount,
          paidUsageAllowed: receipt.paidUsageAllowed,
          previewOnly: receipt.previewOnly,
          preserveLastGood: receipt.preserveLastGood,
        });
        expect(report).toMatchObject({
          exactCodeHeadSha,
          dnaProviderRequestCount: 0,
          paidUsageAllowed: false,
          previewOnly: true,
          preserveLastGood: true,
        });
        if (report.status === "advanced") {
          expect(report.afterCompactedRaceCount).toBeGreaterThan(
            report.beforeCompactedRaceCount,
          );
        }
        if (report.status === "complete") {
          expect(report.afterCompactedRaceCount).toBe(report.uniqueRaceCount);
          expect(report.storageLayout).toBe("r2_chunked_v1");
        }
        if (report.status === "held") {
          expect(report.reason).toMatch(/^provider_capacity_[a-z0-9_]+$/u);
          expect(report.afterCompactedRaceCount).toBe(
            report.beforeCompactedRaceCount,
          );
        }
        console.log(
          `DNA_POPULATION_R2_COMPACTION_PROGRESS=${JSON.stringify(report)}`,
        );
      } catch (error) {
        console.log(
          `DNA_POPULATION_R2_COMPACTION_FAILURE=${JSON.stringify({
            stage: diagnosticStage,
            boundary: operatorBoundary,
          })}`,
        );
        console.error(
          `DNA_POPULATION_R2_COMPACTION_FAILURE_ID=${connectedFailureId(error)}`,
        );
        throw new Error("DNA population R2 compaction private Preview failed");
      }
    },
    30 * 60_000,
  );
});
