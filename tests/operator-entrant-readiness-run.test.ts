import { describe, expect, it } from "vitest";

import { cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment } from "@/lib/cloudflare-neon-dna-open-lab-provider-capacity-source";
import { dnaPopulationEntrantAuthorityConnectedRuntimeFromEnvironment } from "@/lib/dna-population-entrant-authority-connected-runtime";
import { createDnaPopulationEntrantAuthorityReadinessHandoff } from "@/lib/dna-population-entrant-authority-readiness-handoff";
import { DnaOpenLabProviderCapacityMeasurementError } from "@/lib/dna-open-lab-provider-capacity-preflight";

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
        try {
          const measurement = await capacitySource.measure({ ownerId });
          console.log(
            "DNA_POPULATION_ENTRANT_AUTHORITY_CAPACITY_STAGE=" +
              JSON.stringify({
                status: "ready",
                measuredAt: measurement.measuredAt,
                neonMeasuredAt: measurement.neonMeasuredAt,
              }),
          );
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

        const runtime =
          dnaPopulationEntrantAuthorityConnectedRuntimeFromEnvironment({
            environment: Object.freeze({
              authorizedOwnerId: ownerId,
              exactCodeHeadSha,
              databaseUrl: requiredEnvironment("DATABASE_URL"),
              databaseOwnerId: requiredEnvironment("DNA_DATABASE_OWNER_ID"),
              runtimeRole: RUNTIME_ROLE,
              dnaOpenLabApiKey: requiredEnvironment("DNA_OPEN_LAB_API_KEY_1"),
              cloudflareAccountId: requiredEnvironment("CLOUDFLARE_ACCOUNT_ID"),
              cloudflareApiToken: requiredEnvironment("CLOUDFLARE_API_TOKEN"),
              cloudflareAnalyticsApiToken: requiredEnvironment(
                "CLOUDFLARE_ANALYTICS_API_TOKEN",
              ),
              r2BucketName: requiredEnvironment("DNA_R2_BUCKET_NAME"),
              r2StorageClass: requiredEnvironment("DNA_R2_STORAGE_CLASS"),
              r2AccessKeyId: requiredEnvironment("DNA_R2_ACCESS_KEY_ID"),
              r2SecretAccessKey: requiredEnvironment(
                "DNA_R2_SECRET_ACCESS_KEY",
              ),
              neonApiKey: requiredEnvironment("NEON_API_KEY"),
              neonProjectId: requiredEnvironment("NEON_PROJECT_ID"),
            }),
          });
        if (runtime.status !== "ready") {
          throw new Error("entrant readiness runtime is unavailable");
        }
        expect(runtime.exactCodeHeadSha).toBe(exactCodeHeadSha);

        const receipt = await runtime.inspectReadiness();
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
