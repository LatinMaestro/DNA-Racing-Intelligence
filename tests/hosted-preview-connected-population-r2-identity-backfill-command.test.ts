import { describe, expect, it } from "vitest";

import { cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment } from "@/lib/cloudflare-neon-dna-open-lab-provider-capacity-source";
import { createCloudflareR2DatasetEvidencePort } from "@/lib/cloudflare-r2-dataset-evidence-port";
import { DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET } from "@/lib/dna-open-lab-p5-first-backfill-approval";
import { createDnaOpenLabProviderCapacityPreflight } from "@/lib/dna-open-lab-provider-capacity-preflight";
import {
  createDnaPopulationRaceIndexR2IdentityBackfillOperator,
  DNA_POPULATION_RACE_INDEX_R2_IDENTITY_BACKFILL_INTENT,
  DNA_POPULATION_RACE_INDEX_R2_IDENTITY_BACKFILL_OPERATOR_VERSION,
} from "@/lib/dna-population-race-index-r2-identity-backfill-operator";
import { createDnaPopulationRaceIndexR2ChunkStore } from "@/lib/dna-population-race-index-r2-chunk";
import { createNeonDnaOpenLabP5FirstBackfillLedger } from "@/lib/neon-dna-open-lab-p5-first-backfill-ledger";
import { createNeonDnaPopulationRaceIndexGenerationRepository } from "@/lib/neon-dna-population-race-index-generation";

const connected =
  process.env.DNA_POPULATION_R2_IDENTITY_BACKFILL_PRIVATE_PREVIEW_COMMAND ===
  "1";
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

describeConnected(
  "hosted Preview population R2 identity backfill command",
  () => {
    it(
      "rebuilds one compact identity chunk from verified private R2 without DNA requests",
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

          const ledger = createNeonDnaOpenLabP5FirstBackfillLedger({
            databaseUrl,
            databaseOwnerId,
            ownerId,
            runtimeRole: RUNTIME_ROLE,
            approvalPacket:
              DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET,
          });
          const storage = createCloudflareR2DatasetEvidencePort({
            accountId,
            apiToken: requiredEnvironment("CLOUDFLARE_API_TOKEN"),
            accessKeyId: requiredEnvironment("DNA_R2_ACCESS_KEY_ID"),
            secretAccessKey: requiredEnvironment("DNA_R2_SECRET_ACCESS_KEY"),
          });
          const repository =
            createNeonDnaPopulationRaceIndexGenerationRepository({
              databaseUrl,
              databaseOwnerId,
              ownerId,
              runtimeRole: RUNTIME_ROLE,
            });
          const operator =
            createDnaPopulationRaceIndexR2IdentityBackfillOperator({
              configuredOwnerId: ownerId,
              baseline: { load: ledger.load.bind(ledger) },
              repository,
              capacityPreflight: createDnaOpenLabProviderCapacityPreflight({
                configuredOwnerId: ownerId,
                measurementSource: capacitySource,
              }),
              chunkStore: createDnaPopulationRaceIndexR2ChunkStore({
                ownerId,
                bucketName,
                storage,
              }),
            });

          const receipt = await operator.execute({
            operatorVersion:
              DNA_POPULATION_RACE_INDEX_R2_IDENTITY_BACKFILL_OPERATOR_VERSION,
            intent: DNA_POPULATION_RACE_INDEX_R2_IDENTITY_BACKFILL_INTENT,
            allowPersistentWrite: true,
            authenticatedOwnerId: ownerId,
            exactCodeHeadSha,
            workerId: "population-r2-identity-preview-worker",
            attemptedAt: requiredEnvironment(
              "DNA_POPULATION_R2_IDENTITY_BACKFILL_ATTEMPTED_AT",
            ),
          });
          const report = Object.freeze({
            status: receipt.status,
            reason: receipt.reason,
            exactCodeHeadSha: receipt.exactCodeHeadSha,
            beforeIdentityChunkCount: receipt.beforeIdentityChunkCount,
            afterIdentityChunkCount: receipt.afterIdentityChunkCount,
            r2ChunkCount: receipt.r2ChunkCount,
            uniqueRaceCount: receipt.uniqueRaceCount,
            providerCapacityBlockerIds: receipt.providerCapacityBlockerIds,
            r2ReadPerformed: receipt.r2ReadPerformed,
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
            expect(report.afterIdentityChunkCount).toBe(
              report.beforeIdentityChunkCount + 1,
            );
            expect(report.r2ReadPerformed).toBe(true);
          }
          if (report.status === "complete") {
            expect(report.afterIdentityChunkCount).toBe(report.r2ChunkCount);
          }
          if (report.status === "held") {
            expect(report.reason).toMatch(/^provider_capacity_[a-z0-9_]+$/u);
            expect(report.afterIdentityChunkCount).toBe(
              report.beforeIdentityChunkCount,
            );
            expect(report.r2ReadPerformed).toBe(false);
          }
          console.log(
            `DNA_POPULATION_R2_IDENTITY_BACKFILL_PROGRESS=${JSON.stringify(report)}`,
          );
        } catch {
          throw new Error(
            "DNA population R2 identity backfill private Preview failed",
          );
        }
      },
      30 * 60_000,
    );
  },
);
