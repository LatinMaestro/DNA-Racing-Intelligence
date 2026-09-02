import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createCloudflareDnaOpenLabP5RecoverySafetyPort } from "@/lib/cloudflare-dna-open-lab-p5-recovery-safety-port";
import { createCloudflareR2DatasetEvidencePort } from "@/lib/cloudflare-r2-dataset-evidence-port";
import { createDnaOpenLabP5AtomicPublicationFailureScenario } from "@/lib/dna-open-lab-p5-atomic-publication-failure-scenario";
import type { DnaOpenLabP5ComponentRecoveryScenarios } from "@/lib/dna-open-lab-p5-component-recovery-executor";
import { createDnaOpenLabP5ConcurrentCheckpointScenario } from "@/lib/dna-open-lab-p5-concurrent-checkpoint-scenario";
import {
  connectedRecoveryFailure,
  createDnaOpenLabP5ConnectedRecoveryDiagnostic,
  type DnaOpenLabP5ConnectedRecoveryFailurePhase,
} from "@/lib/dna-open-lab-p5-connected-recovery-diagnostic";
import {
  createDnaOpenLabP5CrashAfterEvidenceWriteScenario,
  type DnaOpenLabP5CrashReplayScenarioConfiguration,
} from "@/lib/dna-open-lab-p5-crash-replay-scenario";
import { createDnaOpenLabP5DynamicPlanDriftScenario } from "@/lib/dna-open-lab-p5-dynamic-plan-drift-scenario";
import { createDnaOpenLabP5EligibilityLossScenario } from "@/lib/dna-open-lab-p5-eligibility-loss-scenario";
import { createDnaOpenLabP5EligibilityReinstatementScenario } from "@/lib/dna-open-lab-p5-eligibility-reinstatement-scenario";
import { createDnaOpenLabP5LowerRateAllowanceScenario } from "@/lib/dna-open-lab-p5-lower-rate-allowance-scenario";
import { createDnaOpenLabP5MissingConflictingEvidenceScenario } from "@/lib/dna-open-lab-p5-missing-conflicting-evidence-scenario";
import { createDnaOpenLabP5OutageInvalidBodyScenario } from "@/lib/dna-open-lab-p5-outage-invalid-body-scenario";
import {
  DNA_OPEN_LAB_P5_PRIVATE_PREVIEW_RECOVERY_SUITE_AUTHORITY,
  runGuardedDnaOpenLabP5PrivatePreviewRecoverySuite,
} from "@/lib/dna-open-lab-p5-private-preview-recovery-suite";
import { createDnaOpenLabP5RecoveryProviderSafety } from "@/lib/dna-open-lab-p5-recovery-provider-safety";
import { createDnaOpenLabP5RetryAfterScenario } from "@/lib/dna-open-lab-p5-retry-after-scenario";
import { createNeonDnaOpenLabP5RecoverySafetyInspector } from "@/lib/neon-dna-open-lab-p5-recovery-safety-port";

const connected =
  process.env.DNA_OPEN_LAB_P5_CONNECTED_RECOVERY_ORDERED_SUITE === "1";
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
  const providerSafety = createDnaOpenLabP5RecoveryProviderSafety({
    inspectNeon,
    inspectR2: r2.inspect,
    cleanupR2SyntheticCase: r2.cleanupSyntheticCase,
  });
  return Object.freeze({
    ...providerSafety,
    inspectNeon,
    inspectR2: r2.inspect,
  });
}

function atomicPublicationScenario(input: {
  attemptedAt: string;
  inspectProviderSafety: ReturnType<
    typeof recoverySafety
  >["inspectProviderSafety"];
  cleanupProviderSafety: ReturnType<
    typeof recoverySafety
  >["cleanupSyntheticCase"];
}) {
  const lastGoodGenerationId = "74000000-0000-4000-8000-000000000001";
  const candidateGenerationId = "74000000-0000-4000-8000-000000000002";
  const expectedFailureMessage = "synthetic indexed publication interruption";
  let servingGeneration = lastGoodGenerationId;
  let canonicalCommitCount = 0;
  let receiptIndexCommitCount = 0;
  let failNextPublication = true;

  return createDnaOpenLabP5AtomicPublicationFailureScenario({
    attemptedAt: input.attemptedAt,
    publicationRepository: {
      publishCandidate: async () => {
        if (failNextPublication) {
          failNextPublication = false;
          throw new Error(expectedFailureMessage);
        }
        servingGeneration = candidateGenerationId;
        canonicalCommitCount += 1;
        receiptIndexCommitCount += 1;
        return {
          servingGenerationId: candidateGenerationId,
        } as never;
      },
    },
    publicationRequest: {
      ownerId: "bounded-private-preview-recovery",
      candidate: {
        generationId: candidateGenerationId,
        observedAt: input.attemptedAt,
        families: {},
      },
      evidenceIndex: {
        generationId: candidateGenerationId,
        receipts: [],
      },
    } as never,
    expectedFailureMessage,
    inspectAtomicPublication: async () => ({
      servingGeneration,
      canonicalCommitCount,
      receiptIndexCommitCount,
    }),
    inspectProviderSafety: input.inspectProviderSafety,
    cleanupSyntheticCase: async () => {
      servingGeneration = lastGoodGenerationId;
      canonicalCommitCount = 0;
      receiptIndexCommitCount = 0;
      await input.cleanupProviderSafety();
    },
  });
}

function scenarios(input: {
  ownerId: string;
  bucketName: string;
  storage: DnaOpenLabP5CrashReplayScenarioConfiguration["storage"];
  executedAt: string;
  safety: ReturnType<typeof recoverySafety>;
}): DnaOpenLabP5ComponentRecoveryScenarios {
  const common = {
    ownerId: input.ownerId,
    bucketName: input.bucketName,
    storage: input.storage,
    inspectProviderSafety: input.safety.inspectProviderSafety,
    cleanupSyntheticCase: input.safety.cleanupSyntheticCase,
  };
  return Object.freeze({
    crash_after_evidence_write:
      createDnaOpenLabP5CrashAfterEvidenceWriteScenario({
        ...common,
        cycleId: "75000000-0000-4000-8000-000000000389",
        attemptedAt: input.executedAt,
      }),
    concurrent_checkpoint_advancement:
      createDnaOpenLabP5ConcurrentCheckpointScenario({
        ...common,
        cycleId: "75000000-0000-4000-8000-000000000391",
        attemptedAt: input.executedAt,
      }),
    rate_limited_retry_after: createDnaOpenLabP5RetryAfterScenario({
      ...common,
      cycleId: "75000000-0000-4000-8000-000000000392",
      rateLimitedAt: input.executedAt,
      retryAfterSeconds: 30,
    }),
    lower_rate_allowance: createDnaOpenLabP5LowerRateAllowanceScenario({
      ...common,
      cycleId: "75000000-0000-4000-8000-000000000393",
      observedAt: input.executedAt,
      observedAllowance: 12,
    }),
    eligibility_loss: createDnaOpenLabP5EligibilityLossScenario({
      ...common,
      cycleId: "75000000-0000-4000-8000-000000000394",
      eligibilityLostAt: input.executedAt,
    }),
    eligibility_reinstatement:
      createDnaOpenLabP5EligibilityReinstatementScenario({
        ...common,
        cycleId: "75000000-0000-4000-8000-000000000396",
        eligibilityReinstatedAt: input.executedAt,
        reportStage: (stage) => {
          console.log(
            JSON.stringify({
              schemaVersion: 1,
              evidenceKind: "dna_open_lab_p5_eligibility_reinstatement_stage",
              caseId: "eligibility_reinstatement",
              stage,
            }),
          );
        },
      }),
    api_outage_or_invalid_body: createDnaOpenLabP5OutageInvalidBodyScenario({
      ...common,
      cycleId: "75000000-0000-4000-8000-000000000397",
      outageAt: input.executedAt,
    }),
    missing_or_conflicting_evidence:
      createDnaOpenLabP5MissingConflictingEvidenceScenario({
        ...common,
        cycleId: "75000000-0000-4000-8000-000000000400",
        attemptedAt: input.executedAt,
      }),
    atomic_publication_failure: atomicPublicationScenario({
      attemptedAt: input.executedAt,
      inspectProviderSafety: input.safety.inspectProviderSafety,
      cleanupProviderSafety: input.safety.cleanupSyntheticCase,
    }),
    dynamic_plan_drift: createDnaOpenLabP5DynamicPlanDriftScenario({
      cycleId: "75000000-0000-4000-8000-000000000402",
      indexedAt: input.executedAt,
      evaluatedAt: new Date(
        Date.parse(input.executedAt) + 60_000,
      ).toISOString(),
      inspectProviderSafety: input.safety.inspectProviderSafety,
      cleanupSyntheticCase: input.safety.cleanupSyntheticCase,
    }),
  });
}

describeConnected("hosted Preview P5 ordered recovery suite", () => {
  it("runs all ten cases and restores the private provider boundary", async () => {
    let completedCaseCount = 0;
    let phase: DnaOpenLabP5ConnectedRecoveryFailurePhase = "configuration";
    try {
      const configuration = providerConfiguration();
      const codeHeadSha = requiredEnvironment("GITHUB_SHA").toLowerCase();
      const runnerTemp = requiredEnvironment("RUNNER_TEMP");
      const startedAt = new Date().toISOString();
      phase = "provider_ports";
      const safety = recoverySafety(configuration);
      const storage = createCloudflareR2DatasetEvidencePort({
        accountId: configuration.accountId,
        apiToken: configuration.apiToken,
        accessKeyId: configuration.accessKeyId,
        secretAccessKey: configuration.secretAccessKey,
      });
      const evidence: string[] = [];
      phase = "ordered_case";
      const result = await runGuardedDnaOpenLabP5PrivatePreviewRecoverySuite({
        authority: DNA_OPEN_LAB_P5_PRIVATE_PREVIEW_RECOVERY_SUITE_AUTHORITY,
        expectedCodeHeadSha: codeHeadSha,
        actualCodeHeadSha: codeHeadSha,
        checkpoint: null,
        executedAt: () => startedAt,
        scenarios: scenarios({
          ownerId: configuration.authorizedOwnerId,
          bucketName: configuration.bucketName,
          storage,
          executedAt: startedAt,
          safety,
        }),
        inspectProviderSafety: safety.inspectProviderSafety,
        cleanupSyntheticCase: safety.cleanupSyntheticCase,
        emitEvidence: async (canonicalJson) => {
          evidence.push(canonicalJson);
          completedCaseCount = evidence.length;
          console.log(canonicalJson);
        },
      });

      phase = "artifact_write";
      await writeFile(
        join(runnerTemp, "dna-open-lab-p5-recovery-ordered-suite.jsonl"),
        `${evidence.join("\n")}\n`,
        { encoding: "utf8", flag: "wx" },
      );
      phase = "result_assertion";
      expect(evidence).toHaveLength(10);
      expect(result.checkpoint.results).toHaveLength(10);
      expect(result.final.evidence).toMatchObject({
        completedCaseId: "dynamic_plan_drift",
        nextCaseId: null,
        completedCaseCount: 10,
        recoveryComplete: true,
        connectedRecoveryEvidenceComplete: true,
        readyToUpdateP5RecoveryRows: true,
        firstPersistentPrivatePreviewSyncAllowed: false,
        productionChangesAllowed: false,
      });
      phase = "final_provider_safety";
      await expect(safety.inspectProviderSafety()).resolves.toMatchObject({
        syntheticResidueObjectCount: 0,
      });
    } catch {
      throw connectedRecoveryFailure(
        createDnaOpenLabP5ConnectedRecoveryDiagnostic({
          phase,
          completedCaseCount,
        }),
      );
    }
  }, 900_000);
});

describeCleanup("hosted Preview P5 ordered recovery cleanup", () => {
  it("removes only the temporary recovery prefix and proves zero residue", async () => {
    let phase: DnaOpenLabP5ConnectedRecoveryFailurePhase =
      "cleanup_synthetic_prefix";
    try {
      const safety = recoverySafety(providerConfiguration());
      await safety.cleanupSyntheticCase();
      phase = "cleanup_neon_safety";
      await safety.inspectNeon();
      phase = "cleanup_r2_safety";
      await safety.inspectR2();
      phase = "cleanup_provider_safety";
      await expect(safety.inspectProviderSafety()).resolves.toMatchObject({
        syntheticResidueObjectCount: 0,
      });
    } catch {
      throw connectedRecoveryFailure(
        createDnaOpenLabP5ConnectedRecoveryDiagnostic({
          phase,
          completedCaseCount: 0,
        }),
      );
    }
  }, 60_000);
});
