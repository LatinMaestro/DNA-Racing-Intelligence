import { describe, expect, it } from "vitest";

import {
  DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_COMMAND_INTENT,
  DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_COMMAND_VERSION,
  dnaCoreRaceHistoryPrivateGenerationCommandFromEnvironment,
} from "@/lib/dna-core-race-history-private-generation-command";

const connected =
  process.env.DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_COMMAND === "1";
const describeConnected = connected ? describe : describe.skip;
const API_KEY_PATTERN = /^dna_[A-Za-z0-9_-]{43}$/u;

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

function maximumSteps(): number {
  const parsed = Number(
    requiredEnvironment(
      "DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_MAXIMUM_STEPS",
    ),
  );
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error("bounded Core-history step count is invalid");
  }
  return parsed;
}

describeConnected(
  "hosted Preview bounded Core race-history private generation command",
  () => {
    it(
      "advances an exact-main owner-isolated generation and emits no private content",
      async () => {
        const apiKeys = [
          requiredEnvironment("DNA_OPEN_LAB_API_KEY_1"),
          requiredEnvironment("DNA_OPEN_LAB_API_KEY_2"),
          requiredEnvironment("DNA_OPEN_LAB_API_KEY_3"),
        ] as const;
        if (
          apiKeys.some((key) => !API_KEY_PATTERN.test(key)) ||
          new Set(apiKeys).size !== apiKeys.length
        ) {
          throw new Error("three distinct DNA Open Lab API keys are required");
        }
        const ownerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
        const command =
          dnaCoreRaceHistoryPrivateGenerationCommandFromEnvironment({
            authorizedOwnerId: ownerId,
            ownerId,
            cloudflareAccountId: requiredEnvironment("CLOUDFLARE_ACCOUNT_ID"),
            cloudflareApiToken: requiredEnvironment("CLOUDFLARE_API_TOKEN"),
            cloudflareAnalyticsApiToken: requiredEnvironment(
              "CLOUDFLARE_ANALYTICS_API_TOKEN",
            ),
            databaseUrl: requiredEnvironment("DATABASE_URL"),
            databaseOwnerId: requiredEnvironment("DNA_DATABASE_OWNER_ID"),
            runtimeRole: "dna_app_runtime",
            dnaOpenLabApiKey1: apiKeys[0],
            dnaOpenLabApiKey2: apiKeys[1],
            dnaOpenLabApiKey3: apiKeys[2],
            neonApiKey: requiredEnvironment("NEON_API_KEY"),
            neonProjectId: requiredEnvironment("NEON_PROJECT_ID"),
            r2AccessKeyId: requiredEnvironment("DNA_R2_ACCESS_KEY_ID"),
            r2BucketName: requiredEnvironment("DNA_R2_BUCKET_NAME"),
            r2SecretAccessKey: requiredEnvironment("DNA_R2_SECRET_ACCESS_KEY"),
            r2StorageClass: requiredEnvironment("DNA_R2_STORAGE_CLASS"),
          });
        if (command.status !== "ready") {
          throw new Error("bounded Core-history command is not configured");
        }
        const receipt = await command.execute({
          commandVersion:
            DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_COMMAND_VERSION,
          intent: DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_COMMAND_INTENT,
          allowPersistentWrite: true,
          exactCodeHeadSha: requiredEnvironment("GITHUB_SHA"),
          evaluatedAt: requiredEnvironment(
            "DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_EVALUATED_AT",
          ),
          maximumSteps: maximumSteps(),
        });
        const report = Object.freeze({ ...receipt });
        console.log(JSON.stringify(report));
        expect(report).toMatchObject({
          stepCount: expect.any(Number),
          exactCodeHeadSha: requiredEnvironment("GITHUB_SHA").toLowerCase(),
          persistentWriteArmed: true,
          previewOnly: true,
          paidUsageAllowed: false,
          preserveLastGood: true,
        });
        expect(report.status).not.toBe("held");
        if (
          process.env
            .DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_REQUIRE_COMPLETE === "1"
        ) {
          expect(report.status).toBe("complete");
        }
        expect(report.stepCount).toBeGreaterThan(0);
        expect(report.stepCount).toBeLessThanOrEqual(maximumSteps());
      },
      60 * 60_000,
    );
  },
);
