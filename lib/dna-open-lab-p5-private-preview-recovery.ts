import type { DnaOpenLabP5ComponentRecoveryScenarios } from "./dna-open-lab-p5-component-recovery-executor";
import { createDnaOpenLabP5ComponentRecoveryCaseRunner } from "./dna-open-lab-p5-component-recovery-executor";
import {
  DNA_OPEN_LAB_P5_RECOVERY_INVOCATION_AUTHORITY,
  invokeDnaOpenLabP5PrivatePreviewRecoveryCase,
  type DnaOpenLabP5RecoveryInvocationResult,
} from "./dna-open-lab-p5-recovery-invocation";
import type { DnaOpenLabP5RecoveryCheckpoint } from "./dna-open-lab-p5-recovery-harness";

const SHA_1_PATTERN = /^[0-9a-f]{40}$/u;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;

export const DNA_OPEN_LAB_P5_PRIVATE_PREVIEW_RECOVERY_AUTHORITY =
  "guarded_private_preview_recovery_case" as const;

export type DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot = Readonly<{
  ownerDataSha256: string;
  checkpointStateSha256: string;
  servingStateSha256: string;
  retainedEvidenceSha256: string;
  persistentOwnerDataRowCount: number;
  syntheticResidueObjectCount: number;
}>;

export type DnaOpenLabP5PrivatePreviewRecoveryInput = Readonly<{
  authority: typeof DNA_OPEN_LAB_P5_PRIVATE_PREVIEW_RECOVERY_AUTHORITY;
  expectedCodeHeadSha: string;
  actualCodeHeadSha: string;
  executedAt: string;
  checkpoint: DnaOpenLabP5RecoveryCheckpoint | null;
  scenarios: DnaOpenLabP5ComponentRecoveryScenarios;
  inspectProviderSafety: () => Promise<DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot>;
  cleanupSyntheticCase: () => Promise<void>;
  emitEvidence: (canonicalJson: string) => Promise<void>;
}>;

function recoveryError(): never {
  throw new Error(
    "DNA Open Lab P5 guarded private Preview recovery case failed.",
  );
}

function exactHeadSha(value: string): string {
  const normalized = value.trim();
  if (!SHA_1_PATTERN.test(normalized)) recoveryError();
  return normalized;
}

function count(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) recoveryError();
  return value;
}

function sha256(value: string): string {
  const normalized = value.trim();
  if (!SHA_256_PATTERN.test(normalized)) recoveryError();
  return normalized;
}

function safetySnapshot(
  value: DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot,
): DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot {
  return Object.freeze({
    ownerDataSha256: sha256(value.ownerDataSha256),
    checkpointStateSha256: sha256(value.checkpointStateSha256),
    servingStateSha256: sha256(value.servingStateSha256),
    retainedEvidenceSha256: sha256(value.retainedEvidenceSha256),
    persistentOwnerDataRowCount: count(value.persistentOwnerDataRowCount),
    syntheticResidueObjectCount: count(value.syntheticResidueObjectCount),
  });
}

function sameProviderState(
  before: DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot,
  after: DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot,
): boolean {
  return (
    before.ownerDataSha256 === after.ownerDataSha256 &&
    before.checkpointStateSha256 === after.checkpointStateSha256 &&
    before.servingStateSha256 === after.servingStateSha256 &&
    before.retainedEvidenceSha256 === after.retainedEvidenceSha256 &&
    before.persistentOwnerDataRowCount === after.persistentOwnerDataRowCount &&
    before.syntheticResidueObjectCount === 0 &&
    after.syntheticResidueObjectCount === 0
  );
}

/**
 * Composes one component-backed private Preview recovery case with mandatory
 * provider-state proof and cleanup. The inner invocation writes only to an
 * in-memory evidence buffer. Nothing is emitted until cleanup succeeds and the
 * owner data, checkpoints, serving state and retained evidence exactly match
 * their pre-case fingerprints with zero synthetic residue.
 */
export async function runGuardedDnaOpenLabP5PrivatePreviewRecoveryCase(
  input: DnaOpenLabP5PrivatePreviewRecoveryInput,
): Promise<DnaOpenLabP5RecoveryInvocationResult> {
  let expectedCodeHeadSha: string;
  try {
    if (
      input.authority !== DNA_OPEN_LAB_P5_PRIVATE_PREVIEW_RECOVERY_AUTHORITY ||
      typeof input.inspectProviderSafety !== "function" ||
      typeof input.cleanupSyntheticCase !== "function" ||
      typeof input.emitEvidence !== "function"
    ) {
      recoveryError();
    }
    expectedCodeHeadSha = exactHeadSha(input.expectedCodeHeadSha);
    if (exactHeadSha(input.actualCodeHeadSha) !== expectedCodeHeadSha) {
      recoveryError();
    }
  } catch {
    return recoveryError();
  }

  let before: DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot;
  try {
    before = safetySnapshot(await input.inspectProviderSafety());
    if (before.syntheticResidueObjectCount !== 0) recoveryError();
  } catch {
    return recoveryError();
  }

  let bufferedEvidence: string | null = null;
  let invocationResult: DnaOpenLabP5RecoveryInvocationResult | null = null;
  let executionFailed = false;
  try {
    invocationResult = await invokeDnaOpenLabP5PrivatePreviewRecoveryCase({
      authority: DNA_OPEN_LAB_P5_RECOVERY_INVOCATION_AUTHORITY,
      expectedCodeHeadSha,
      actualCodeHeadSha: input.actualCodeHeadSha,
      executedAt: input.executedAt,
      checkpoint: input.checkpoint,
      runCase: createDnaOpenLabP5ComponentRecoveryCaseRunner({
        scenarios: input.scenarios,
      }),
      emitEvidence: async (canonicalJson) => {
        if (bufferedEvidence !== null) recoveryError();
        bufferedEvidence = canonicalJson;
      },
    });
  } catch {
    executionFailed = true;
  }

  let cleanupFailed = false;
  try {
    await input.cleanupSyntheticCase();
  } catch {
    cleanupFailed = true;
  }

  let after: DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot;
  try {
    after = safetySnapshot(await input.inspectProviderSafety());
  } catch {
    return recoveryError();
  }
  if (
    executionFailed ||
    cleanupFailed ||
    invocationResult === null ||
    bufferedEvidence === null ||
    !sameProviderState(before, after)
  ) {
    return recoveryError();
  }

  try {
    await input.emitEvidence(bufferedEvidence);
  } catch {
    return recoveryError();
  }
  return invocationResult;
}
