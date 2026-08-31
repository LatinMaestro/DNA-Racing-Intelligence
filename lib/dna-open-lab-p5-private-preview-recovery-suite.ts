import type { DnaOpenLabP5ComponentRecoveryScenarios } from "./dna-open-lab-p5-component-recovery-executor";
import {
  DNA_OPEN_LAB_P5_PRIVATE_PREVIEW_RECOVERY_AUTHORITY,
  runGuardedDnaOpenLabP5PrivatePreviewRecoveryCase,
  type DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot,
} from "./dna-open-lab-p5-private-preview-recovery";
import type {
  DnaOpenLabP5RecoveryInvocationResult,
  DnaOpenLabP5SanitizedRecoveryEvidence,
} from "./dna-open-lab-p5-recovery-invocation";
import {
  DNA_OPEN_LAB_P5_RECOVERY_CASES,
  type DnaOpenLabP5RecoveryCase,
  type DnaOpenLabP5RecoveryCheckpoint,
} from "./dna-open-lab-p5-recovery-harness";

export const DNA_OPEN_LAB_P5_PRIVATE_PREVIEW_RECOVERY_SUITE_AUTHORITY =
  "guarded_private_preview_recovery_suite" as const;

export type DnaOpenLabP5PrivatePreviewRecoverySuiteInput = Readonly<{
  authority: typeof DNA_OPEN_LAB_P5_PRIVATE_PREVIEW_RECOVERY_SUITE_AUTHORITY;
  expectedCodeHeadSha: string;
  actualCodeHeadSha: string;
  checkpoint: DnaOpenLabP5RecoveryCheckpoint | null;
  executedAt: (caseId: DnaOpenLabP5RecoveryCase) => string;
  scenarios: DnaOpenLabP5ComponentRecoveryScenarios;
  inspectProviderSafety: () => Promise<DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot>;
  cleanupSyntheticCase: () => Promise<void>;
  emitEvidence: (canonicalJson: string) => Promise<void>;
}>;

export type DnaOpenLabP5PrivatePreviewRecoverySuiteResult = Readonly<{
  checkpoint: DnaOpenLabP5RecoveryCheckpoint;
  evidence: readonly DnaOpenLabP5SanitizedRecoveryEvidence[];
  final: DnaOpenLabP5RecoveryInvocationResult;
}>;

function suiteError(): never {
  throw new Error(
    "DNA Open Lab P5 guarded private Preview recovery suite failed.",
  );
}

/**
 * Runs every remaining P5 recovery case in canonical order. Each case crosses
 * the existing exact-head, cleanup and unchanged-provider guard independently,
 * so a failure cannot emit that case or advance the restart checkpoint.
 * Completing this suite does not authorise persistent owner-data sync.
 */
export async function runGuardedDnaOpenLabP5PrivatePreviewRecoverySuite(
  input: DnaOpenLabP5PrivatePreviewRecoverySuiteInput,
): Promise<DnaOpenLabP5PrivatePreviewRecoverySuiteResult> {
  if (
    input.authority !==
      DNA_OPEN_LAB_P5_PRIVATE_PREVIEW_RECOVERY_SUITE_AUTHORITY ||
    typeof input.executedAt !== "function" ||
    typeof input.emitEvidence !== "function"
  ) {
    suiteError();
  }

  let checkpoint = input.checkpoint;
  const evidence: DnaOpenLabP5SanitizedRecoveryEvidence[] = [];
  let final: DnaOpenLabP5RecoveryInvocationResult | null = null;

  while (
    (checkpoint?.results.length ?? 0) < DNA_OPEN_LAB_P5_RECOVERY_CASES.length
  ) {
    const caseId =
      DNA_OPEN_LAB_P5_RECOVERY_CASES[checkpoint?.results.length ?? 0];
    if (caseId === undefined) suiteError();
    const result = await runGuardedDnaOpenLabP5PrivatePreviewRecoveryCase({
      authority: DNA_OPEN_LAB_P5_PRIVATE_PREVIEW_RECOVERY_AUTHORITY,
      expectedCodeHeadSha: input.expectedCodeHeadSha,
      actualCodeHeadSha: input.actualCodeHeadSha,
      executedAt: input.executedAt(caseId),
      checkpoint,
      scenarios: input.scenarios,
      inspectProviderSafety: input.inspectProviderSafety,
      cleanupSyntheticCase: input.cleanupSyntheticCase,
      emitEvidence: input.emitEvidence,
    });
    checkpoint = result.checkpoint;
    evidence.push(result.evidence);
    final = result;
  }

  if (
    checkpoint === null ||
    final === null ||
    checkpoint.results.length !== DNA_OPEN_LAB_P5_RECOVERY_CASES.length ||
    final.evidence.connectedRecoveryEvidenceComplete !== true ||
    final.evidence.readyToUpdateP5RecoveryRows !== true ||
    final.evidence.firstPersistentPrivatePreviewSyncAllowed !== false ||
    final.evidence.productionChangesAllowed !== false
  ) {
    suiteError();
  }

  return Object.freeze({
    checkpoint,
    evidence: Object.freeze(evidence),
    final,
  });
}
