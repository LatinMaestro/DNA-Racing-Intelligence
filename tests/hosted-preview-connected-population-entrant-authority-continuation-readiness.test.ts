import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { dnaPopulationEntrantAuthorityConnectedRuntimeFromEnvironment } from "@/lib/dna-population-entrant-authority-connected-runtime";

const connected =
  process.env.DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_READINESS === "1";
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

function positiveCount(name: string): number {
  const value = requiredEnvironment(name);
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error("count environment is unavailable");
  }
  const count = Number(value);
  if (!Number.isSafeInteger(count)) {
    throw new Error("count environment is unavailable");
  }
  return count;
}

function sha256(name: string): string {
  const value = requiredEnvironment(name);
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error("hash environment is unavailable");
  }
  return value;
}

describeConnected(
  "hosted Preview population entrant continuation readiness",
  () => {
    it(
      "proves the exact durable incomplete boundary and fresh zero-cost capacity without writes",
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
            acceptedUnresolvedAuthority: Object.freeze({
              unresolvedRaceCount: positiveCount(
                "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_UNRESOLVED_RACE_COUNT",
              ),
              unresolvedRaceSetSha256: sha256(
                "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_UNRESOLVED_RACE_SET_SHA256",
              ),
            }),
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
          throw new Error("entrant continuation readiness runtime unavailable");
        }

        const receipt = await runtime.inspectContinuationReadiness();

        expect(receipt).toMatchObject({
          status: "ready_for_continuation",
          exactCodeHeadSha,
          previewOnly: true,
          providerRequestPerformed: false,
          persistentWritePerformed: false,
          providerWritePerformed: false,
          paidUsageAllowed: false,
        });
        expect(receipt.recoveredChunkCount).toBeGreaterThanOrEqual(1);
        expect(receipt.recoveredRaceCount).toBeGreaterThanOrEqual(1);
        expect(receipt.nextChunkOrdinal).toBe(receipt.recoveredChunkCount + 1);
        expect(receipt.recoveredRaceCount).toBeLessThan(
          receipt.unresolvedRaceCount,
        );
        expect(receipt.unresolvedRaceSetSha256).toMatch(/^[a-f0-9]{64}$/u);
        expect(receipt.durableBoundarySha256).toMatch(/^[a-f0-9]{64}$/u);

        const resultPath = join(
          requiredEnvironment("RUNNER_TEMP"),
          "dna-entrant-continuation-readiness.json",
        );
        await writeFile(resultPath, JSON.stringify(receipt), {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        console.log(
          "DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_READINESS=" +
            JSON.stringify(receipt),
        );
      },
      30 * 60_000,
    );
  },
);
