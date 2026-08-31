import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createCloudflareDnaOpenLabP5RecoverySafetyPort } from "@/lib/cloudflare-dna-open-lab-p5-recovery-safety-port";
import { createCloudflareR2DatasetEvidencePort } from "@/lib/cloudflare-r2-dataset-evidence-port";
import { createDnaOpenLabP5CrashAfterEvidenceWriteScenario } from "@/lib/dna-open-lab-p5-crash-replay-scenario";
import {
  DNA_OPEN_LAB_P5_PRIVATE_PREVIEW_RECOVERY_AUTHORITY,
  runGuardedDnaOpenLabP5PrivatePreviewRecoveryCase,
} from "@/lib/dna-open-lab-p5-private-preview-recovery";
import { createDnaOpenLabP5RecoveryProviderSafety } from "@/lib/dna-open-lab-p5-recovery-provider-safety";
import { createNeonDnaOpenLabP5RecoverySafetyInspector } from "@/lib/neon-dna-open-lab-p5-recovery-safety-port";

const connected =
  process.env.DNA_OPEN_LAB_P5_CONNECTED_RECOVERY_CRASH_REPLAY === "1";
const cleanupOnly = process.env.DNA_OPEN_LAB_P5_RECOVERY_CLEANUP_ONLY === "1";
const describeConnected = connected ? describe : describe.skip;
const describeCleanup = cleanupOnly ? describe : describe.skip;
const runtimeRole = "dna_app_runtime";

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

function providerConfiguration() {
  return Object.freeze({
    accountId: requiredEnvironment("CLOUDFLARE_ACCOUNT_ID"),
    apiToken: requiredEnvironment("CLOUDFLARE_API_TOKEN"),
    accessKeyId: requiredEnvironment("DNA_R2_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnvironment("DNA_R2_SECRET_ACCESS_KEY"),
    bucketName: requiredEnvironment("DNA_R2_BUCKET_NAME"),
    databaseUrl: requiredEnvironment("DATABASE_URL"),
    databaseOwnerId: requiredEnvironment("DNA_DATABASE_OWNER_ID"),
    authorizedOwnerId: requiredEnvironment("AUTHORIZED_CLERK_USER_ID"),
  });
}

function recoverySafety(
  configuration: ReturnType<typeof providerConfiguration>,
) {
  const inspectNeon = createNeonDnaOpenLabP5RecoverySafetyInspector({
    authorizedOwnerId: configuration.authorizedOwnerId,
    databaseOwnerId: configuration.databaseOwnerId,
    databaseUrl: configuration.databaseUrl,
    runtimeRole,
  });
  const r2 = createCloudflareDnaOpenLabP5RecoverySafetyPort({
    ownerId: configuration.authorizedOwnerId,
    accountId: configuration.accountId,
    accessKeyId: configuration.accessKeyId,
    secretAccessKey: configuration.secretAccessKey,
    bucketName: configuration.bucketName,
  });
  return createDnaOpenLabP5RecoveryProviderSafety({
    inspectNeon,
    inspectR2: r2.inspect,
    cleanupR2SyntheticCase: r2.cleanupSyntheticCase,
  });
}

describeConnected("hosted Preview P5 crash/replay recovery", () => {
  it("proves immutable replay and restores the private provider boundary", async () => {
    try {
      const configuration = providerConfiguration();
      const codeHeadSha = requiredEnvironment("GITHUB_SHA").toLowerCase();
      const runnerTemp = requiredEnvironment("RUNNER_TEMP");
      const executedAt = new Date().toISOString();
      const safety = recoverySafety(configuration);
      const storage = createCloudflareR2DatasetEvidencePort({
        accountId: configuration.accountId,
        apiToken: configuration.apiToken,
        accessKeyId: configuration.accessKeyId,
        secretAccessKey: configuration.secretAccessKey,
      });
      const scenario = createDnaOpenLabP5CrashAfterEvidenceWriteScenario({
        ownerId: configuration.authorizedOwnerId,
        bucketName: configuration.bucketName,
        cycleId: "75000000-0000-4000-8000-000000000389",
        attemptedAt: executedAt,
        storage,
        inspectProviderSafety: safety.inspectProviderSafety,
        cleanupSyntheticCase: safety.cleanupSyntheticCase,
      });
      const result = await runGuardedDnaOpenLabP5PrivatePreviewRecoveryCase({
        authority: DNA_OPEN_LAB_P5_PRIVATE_PREVIEW_RECOVERY_AUTHORITY,
        expectedCodeHeadSha: codeHeadSha,
        actualCodeHeadSha: codeHeadSha,
        executedAt,
        checkpoint: null,
        scenarios: {
          crash_after_evidence_write: scenario,
        } as never,
        inspectProviderSafety: safety.inspectProviderSafety,
        cleanupSyntheticCase: safety.cleanupSyntheticCase,
        emitEvidence: async (canonicalJson) => {
          await writeFile(
            join(
              runnerTemp,
              "dna-open-lab-p5-recovery-crash-replay-evidence.json",
            ),
            `${canonicalJson}\n`,
            { encoding: "utf8", flag: "wx" },
          );
          console.log(canonicalJson);
        },
      });

      expect(result.evidence).toMatchObject({
        schemaVersion: 1,
        evidenceKind: "dna_open_lab_p5_private_preview_recovery_case",
        codeHeadSha,
        providerScope: "private_preview",
        completedCaseId: "crash_after_evidence_write",
        nextCaseId: "concurrent_checkpoint_advancement",
        completedCaseCount: 1,
        casePassed: true,
        recoveryComplete: false,
        persistentOwnerDataWriteCount: 0,
        residueObjectCount: 0,
        connectedRecoveryEvidenceComplete: false,
        readyToUpdateP5RecoveryRows: false,
        firstPersistentPrivatePreviewSyncAllowed: false,
        productionChangesAllowed: false,
      });
      await expect(safety.inspectProviderSafety()).resolves.toMatchObject({
        syntheticResidueObjectCount: 0,
      });
    } catch {
      throw new Error("DNA Open Lab P5 connected crash/replay recovery failed");
    }
  }, 120_000);
});

describeCleanup("hosted Preview P5 crash/replay cleanup", () => {
  it("removes only the temporary recovery prefix and proves zero residue", async () => {
    try {
      const safety = recoverySafety(providerConfiguration());
      await safety.cleanupSyntheticCase();
      await expect(safety.inspectProviderSafety()).resolves.toMatchObject({
        syntheticResidueObjectCount: 0,
      });
    } catch {
      throw new Error("DNA Open Lab P5 crash/replay cleanup failed");
    }
  }, 60_000);
});
