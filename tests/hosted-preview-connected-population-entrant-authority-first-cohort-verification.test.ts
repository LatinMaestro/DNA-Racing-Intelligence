import { describe, expect, it } from "vitest";

import { dnaPopulationEntrantAuthorityConnectedRuntimeFromEnvironment } from "@/lib/dna-population-entrant-authority-connected-runtime";

const connected =
  process.env.DNA_POPULATION_ENTRANT_AUTHORITY_FIRST_COHORT_VERIFICATION === "1";
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
  "hosted Preview population entrant first-cohort verification",
  () => {
    it(
      "reopens the first durable cohort and proves checkpoint/R2 consistency without writes",
      async () => {
        const exactCodeHeadSha =
          requiredEnvironment("GITHUB_SHA").toLowerCase();
        const expectedMainSha = requiredEnvironment(
          "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_MAIN_SHA",
        ).toLowerCase();
        if (
          !COMMIT_PATTERN.test(exactCodeHeadSha) ||
          expectedMainSha !== exactCodeHeadSha
        ) {
          throw new Error("exact main commit is unavailable");
        }

        const runtime =
          dnaPopulationEntrantAuthorityConnectedRuntimeFromEnvironment({
            environment: Object.freeze({
              authorizedOwnerId: requiredEnvironment(
                "AUTHORIZED_CLERK_USER_ID",
              ),
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
          throw new Error("entrant first-cohort verification runtime unavailable");
        }

        const receipt = await runtime.inspectFirstCohortVerification();

        expect(receipt).toMatchObject({
          status: "verified_first_cohort",
          exactCodeHeadSha,
          chunkOrdinal: 1,
          nextChunkOrdinal: 2,
          previewOnly: true,
          providerRequestPerformed: false,
          persistentWritePerformed: false,
          providerWritePerformed: false,
          paidUsageAllowed: false,
        });
        expect(receipt.rowCount).toBeGreaterThan(0);
        expect(receipt.rowCount).toBeLessThanOrEqual(5_000);
        expect(receipt.resolvedRaceCount + receipt.quarantinedRaceCount).toBe(
          receipt.rowCount,
        );
        expect(receipt.unresolvedRaceCount).toBeGreaterThanOrEqual(
          receipt.rowCount,
        );
        expect(receipt.unresolvedRaceSetSha256).toMatch(/^[a-f0-9]{64}$/u);
        expect(receipt.bodySha256).toMatch(/^[a-f0-9]{64}$/u);
        expect(receipt.raceSetSha256).toMatch(/^[a-f0-9]{64}$/u);
        expect(receipt.recordSetSha256).toMatch(/^[a-f0-9]{64}$/u);

        console.log(
          "DNA_POPULATION_ENTRANT_AUTHORITY_FIRST_COHORT_VERIFICATION=" +
            JSON.stringify(receipt),
        );
      },
      30 * 60_000,
    );
  },
);
