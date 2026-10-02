import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { dnaPopulationEntrantAuthorityConnectedRuntimeFromEnvironment } from "@/lib/dna-population-entrant-authority-connected-runtime";
import {
  DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_3_COMMAND_VERSION,
  DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_3_INTENT,
  DnaPopulationEntrantAuthorityRemediationError,
} from "@/lib/dna-population-entrant-authority-remediation";

const connected =
  process.env
    .DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_CONTINUATION_COMMAND === "1";
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

function exactTimestamp(name: string): string {
  const value = requiredEnvironment(name);
  const parsed = new Date(value);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== value ||
    parsed.getTime() > Date.now()
  ) {
    throw new Error("remediation cohort 3 timestamp is unavailable");
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
      throw new Error(
        "current main does not match remediation cohort 3 authority",
      );
    }
    return Object.freeze({ currentMainSha });
  },
});

describeConnected(
  "hosted Preview population entrant authority remediation cohort 3",
  () => {
    it(
      "retains exactly one bounded continuation cohort without publication",
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
          const cohortObservedAt = exactTimestamp(
            "DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_3_OBSERVED_AT",
          );

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
            throw new Error(
              "entrant remediation cohort 3 runtime is unavailable",
            );
          }

          stage = "execute";
          const receipt = await runtime.executeRemediationCohort3({
            commandVersion:
              DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_3_COMMAND_VERSION,
            intent:
              DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_3_INTENT,
            allowPersistentWrite: true,
            exactCodeHeadSha,
            cohortObservedAt,
          });
          expect(receipt).toMatchObject({
            exactCodeHeadSha,
            cohortOrdinal: 3,
            priorSelectedRaceCount: 40,
            aggregateRequestsPerMinute: 90,
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
          expect(receipt.selectedRaceCount).toBeGreaterThan(0);
          expect(receipt.selectedRaceCount).toBeLessThanOrEqual(20);
          expect(receipt.providerRequestCount).toBeGreaterThanOrEqual(0);
          expect(receipt.providerRequestCount).toBeLessThanOrEqual(63);
          expect(receipt.baseRecordSetSha256).toMatch(/^[a-f0-9]{64}$/u);
          expect(receipt.selectedRaceSetSha256).toMatch(/^[a-f0-9]{64}$/u);
          expect(receipt.replacementSetSha256).toMatch(/^[a-f0-9]{64}$/u);
          expect(receipt.replacementRaceCount).toBeGreaterThanOrEqual(0);
          expect(receipt.replacementRaceCount).toBeLessThanOrEqual(
            receipt.selectedRaceCount,
          );
          expect(receipt.quarantinedRaceCountAfterEvidence).toBe(
            receipt.quarantinedRaceCountBefore -
              receipt.priorReplacementRaceCount -
              receipt.replacementRaceCount,
          );

          console.log(
            "DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_3_RESULT=" +
              JSON.stringify(receipt),
          );
        } catch (error) {
          console.log(
            "DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_3_FAILURE=" +
              JSON.stringify({ stage, diagnostic: failureId(error) }),
          );
          throw new Error(
            "DNA population entrant authority private Preview remediation cohort 3 failed",
          );
        }
      },
      30 * 60_000,
    );
  },
);
