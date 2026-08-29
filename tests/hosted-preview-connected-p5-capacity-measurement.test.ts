import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createCloudflareDnaOpenLabP5R2S3ListBinding } from "@/lib/cloudflare-dna-open-lab-p5-r2-s3-list-binding";
import { createCloudflareR2DatasetEvidencePort } from "@/lib/cloudflare-r2-dataset-evidence-port";
import {
  DNA_OPEN_LAB_P5_CAPACITY_INVOCATION_AUTHORITY,
  invokeDnaOpenLabP5PrivatePreviewCapacityMeasurement,
} from "@/lib/dna-open-lab-p5-capacity-invocation";

const connected = process.env.DNA_OPEN_LAB_P5_CONNECTED_CAPACITY === "1";
const describeConnected = connected ? describe : describe.skip;
const bucketName = "dna-racing-import-preview";
const runtimeRole = "dna_app_runtime";
const billingWindowDays = 30;
const aggregateRequestCeilingPerMinute = 30;
const classAOperationsPerRequest = 1;
const classBOperationsPerRequest = 2;
const projectedMonthlyClassAOperations =
  aggregateRequestCeilingPerMinute *
  60 *
  24 *
  billingWindowDays *
  classAOperationsPerRequest;
const projectedMonthlyClassBOperations =
  projectedMonthlyClassAOperations * classBOperationsPerRequest;
const priceAuthorityRef = "https://developers.cloudflare.com/r2/pricing/";
const priceEffectiveAt = "2026-08-07T00:00:00.000Z";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (
    value.length < 1 ||
    value.length > 4_096 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

describeConnected("hosted Preview P5 connected capacity measurement", () => {
  it("measures the rollback-only API path and emits sanitized evidence", async () => {
    try {
      const accountId = requiredEnvironment("CLOUDFLARE_ACCOUNT_ID");
      const apiToken = requiredEnvironment("CLOUDFLARE_API_TOKEN");
      const accessKeyId = requiredEnvironment("DNA_R2_ACCESS_KEY_ID");
      const secretAccessKey = requiredEnvironment("DNA_R2_SECRET_ACCESS_KEY");
      const databaseUrl = requiredEnvironment("DATABASE_URL");
      const databaseOwnerId = requiredEnvironment("DNA_DATABASE_OWNER_ID");
      const authorizedOwnerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
      const codeHeadSha = requiredEnvironment("GITHUB_SHA").toLowerCase();
      const repository = requiredEnvironment("GITHUB_REPOSITORY");
      const runId = requiredEnvironment("GITHUB_RUN_ID");
      const runAttempt = requiredEnvironment("GITHUB_RUN_ATTEMPT");
      const runnerTemp = requiredEnvironment("RUNNER_TEMP");
      const measuredAt = new Date().toISOString();
      const planAuthority = Object.freeze({
        schemaVersion: 1,
        source: "dna_open_lab_api_only_current_state",
        aggregateRequestCeilingPerMinute,
        billingWindowDays,
        classAOperationsPerRequest,
        classBOperationsPerRequest,
        currentStateCadenceMinutes: Object.freeze({
          raceActivity: 1,
          tokenPrices: 5,
          vaultIdentity: 15,
          coreCurrentState: 15,
          spliceArena: 30,
        }),
        pairReads: "on_demand_only",
      });
      const r2Storage = createCloudflareR2DatasetEvidencePort({
        accountId,
        apiToken,
        accessKeyId,
        secretAccessKey,
      });
      const r2Bucket = createCloudflareDnaOpenLabP5R2S3ListBinding({
        accountId,
        accessKeyId,
        secretAccessKey,
        bucketName,
      });

      const evidence =
        await invokeDnaOpenLabP5PrivatePreviewCapacityMeasurement({
          authority: DNA_OPEN_LAB_P5_CAPACITY_INVOCATION_AUTHORITY,
          expectedCodeHeadSha: codeHeadSha,
          configuration: {
            codeHeadSha,
            planChecksum: sha256(planAuthority),
            measurementAuthorityRef: `https://github.com/${repository}/actions/runs/${runId}/attempts/${runAttempt}`,
            measuredAt,
            neon: {
              authorizedOwnerId,
              databaseOwnerId,
              databaseUrl,
              runtimeRole,
            },
            r2: {
              ownerId: authorizedOwnerId,
              bucketName,
              bucket: r2Bucket,
              readBucketPrivacy: r2Storage.readBucketPrivacy,
            },
            syntheticR2Storage: r2Storage,
            projectedMonthlyClassAOperations,
            projectedMonthlyClassBOperations,
            priceAuthorityRef,
            priceEffectiveAt,
            bytesPerBillableGb: 1_000_000_000,
            storageMicroUsdPerGbMonth: 15_000,
            classAMicroUsdPerMillion: 4_500_000,
            classBMicroUsdPerMillion: 360_000,
            r2PageLimit: 100,
            r2MaximumPages: 20,
            r2MaximumObjects: 1_000,
          },
          emitEvidence: async (canonicalJson) => {
            await writeFile(
              join(runnerTemp, "dna-open-lab-p5-capacity-evidence.json"),
              `${canonicalJson}\n`,
              { encoding: "utf8", flag: "wx" },
            );
            console.log(canonicalJson);
          },
        });

      expect(evidence).toMatchObject({
        schemaVersion: 1,
        evidenceKind: "dna_open_lab_p5_private_preview_capacity",
        codeHeadSha,
        providerScope: "private_preview",
        connectedCapacityEvidenceComplete: true,
        readyToUpdateP5CapacityRows: true,
        firstPersistentPrivatePreviewSyncAllowed: false,
        productionChangesAllowed: false,
      });
      expect(evidence.postgres.positivePeakHeadroom).toBe(true);
      expect(evidence.r2.retainedObjectCount).toBeGreaterThan(0);
      expect(evidence.r2.retainedTotalBytes).toBeGreaterThan(0);
      expect(evidence.r2.projectedMonthlyClassAOperations).toBe(
        projectedMonthlyClassAOperations,
      );
      expect(evidence.r2.projectedMonthlyClassBOperations).toBe(
        projectedMonthlyClassBOperations,
      );
    } catch {
      throw new Error("DNA Open Lab P5 connected capacity measurement failed");
    }
  }, 120_000);
});
