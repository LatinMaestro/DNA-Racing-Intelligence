import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { dnaPopulationEntrantAuthorityConnectedRuntimeFromEnvironment } from "@/lib/dna-population-entrant-authority-connected-runtime";
import { DnaPopulationEntrantAuthorityRemediationError } from "@/lib/dna-population-entrant-authority-remediation";

const CONNECTED_ENVIRONMENT =
  "DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_3_READINESS";
const connected = process.env[CONNECTED_ENVIRONMENT] === "1";
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

function failureId(error: unknown): string {
  if (error instanceof DnaPopulationEntrantAuthorityRemediationError) {
    return error.diagnostic;
  }
  return "unexpected_failure";
}

const remediationMainGuard = Object.freeze({
  async assertCurrentMain(expectedHeadSha: string) {
    execFileSync("git", ["fetch", "--no-tags", "origin", "main"], {
      stdio: "ignore",
    });
    const currentMainSha = execFileSync("git", ["rev-parse", "origin/main"], {
      encoding: "utf8",
    })
      .trim()
      .toLowerCase();
    if (currentMainSha !== expectedHeadSha) {
      throw new Error("current main does not match remediation authority");
    }
    return Object.freeze({ currentMainSha });
  },
});

describeConnected(
  "hosted Preview entrant remediation cohort 3 readiness",
  () => {
    it(
      "proves bounded cohort 3 without DNA access or persistence",
      async () => {
        let stage = "environment";
        try {
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

          stage = "runtime-composition";
          const runtime =
            dnaPopulationEntrantAuthorityConnectedRuntimeFromEnvironment({
              remediationMainGuard,
              environment: Object.freeze({
                authorizedOwnerId: requiredEnvironment(
                  "AUTHORIZED_CLERK_USER_ID",
                ),
                exactCodeHeadSha,
                databaseUrl: requiredEnvironment("DATABASE_URL"),
                databaseOwnerId: requiredEnvironment("DNA_DATABASE_OWNER_ID"),
                runtimeRole: RUNTIME_ROLE,
                dnaOpenLabApiKeys: [
                  requiredEnvironment("DNA_OPEN_LAB_API_KEY_1"),
                  requiredEnvironment("DNA_OPEN_LAB_API_KEY_2"),
                  requiredEnvironment("DNA_OPEN_LAB_API_KEY_3"),
                ],
                cloudflareAccountId: requiredEnvironment(
                  "CLOUDFLARE_ACCOUNT_ID",
                ),
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
            throw new Error("entrant remediation runtime is unavailable");
          }

          stage = "inspect";
          const receipt =
            await runtime.inspectRemediationCohort3Readiness();
          expect(receipt).toMatchObject({
            status: "ready_for_cohort_3",
            exactCodeHeadSha,
            completedCohortCount: 2,
            nextCohortOrdinal: 3,
            priorSelectedRaceCount: 40,
            aggregateRequestsPerMinute: 90,
            providerRequestPerformed: false,
            persistentWritePerformed: false,
            providerWritePerformed: false,
            publicationActivated: false,
            previewOnly: true,
            paidUsageAllowed: false,
            lastGoodBasePreserved: true,
          });
          expect(receipt.priorReplacementRaceCount).toBeGreaterThanOrEqual(0);
          expect(receipt.priorReplacementRaceCount).toBeLessThanOrEqual(
            receipt.priorSelectedRaceCount,
          );
          expect(receipt.nextSelectedRaceCount).toBeGreaterThan(0);
          expect(receipt.nextSelectedRaceCount).toBeLessThanOrEqual(20);
          const remaining = receipt.remainingUnscannedQuarantineCount;
          expect(remaining).toBeGreaterThanOrEqual(0);
          expect(new Date(receipt.capacityObservedAt).toISOString()).toBe(
            receipt.capacityObservedAt,
          );

          console.log(
            "DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_3_READINESS=" +
              JSON.stringify(receipt),
          );
        } catch (error) {
          console.log(
            "DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_3_READINESS_FAILURE=" +
              JSON.stringify({ stage, diagnostic: failureId(error) }),
          );
          throw new Error(
            "DNA population entrant remediation cohort 3 readiness failed",
          );
        }
      },
      30 * 60_000,
    );
  },
);
