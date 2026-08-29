import { createHash } from "node:crypto";

import {
  DNA_OPEN_LAB_P5_RECOVERY_CASES,
  runDnaOpenLabP5RecoveryHarnessStep,
  type DnaOpenLabP5RecoveryCase,
  type DnaOpenLabP5RecoveryCheckpoint,
  type DnaOpenLabP5RecoveryHarnessStep,
  type DnaOpenLabP5RecoveryObservation,
} from "./dna-open-lab-p5-recovery-harness";

const SHA_1_PATTERN = /^[0-9a-f]{40}$/u;
const MAXIMUM_EVIDENCE_BYTES = 16_384;

export const DNA_OPEN_LAB_P5_RECOVERY_INVOCATION_AUTHORITY =
  "bounded_private_preview_recovery_case" as const;

export type DnaOpenLabP5SanitizedRecoveryEvidence = Readonly<{
  schemaVersion: 1;
  evidenceKind: "dna_open_lab_p5_private_preview_recovery_case";
  evidenceSha256: string;
  codeHeadSha: string;
  providerScope: "private_preview";
  executedAt: string;
  completedCaseId: DnaOpenLabP5RecoveryCase;
  nextCaseId: DnaOpenLabP5RecoveryCase | null;
  completedCaseCount: number;
  totalCaseCount: 10;
  casePassed: boolean;
  recoveryComplete: boolean;
  reportPassed: boolean | null;
  checkpointSha256: string;
  reportSha256: string | null;
  persistentOwnerDataWriteCount: 0;
  residueObjectCount: 0;
  rawPayloadIncluded: false;
  secretMaterialIncluded: false;
  connectedRecoveryEvidenceComplete: boolean;
  readyToUpdateP5RecoveryRows: boolean;
  firstPersistentPrivatePreviewSyncAllowed: false;
  productionChangesAllowed: false;
}>;

export type DnaOpenLabP5RecoveryInvocationInput = Readonly<{
  authority: typeof DNA_OPEN_LAB_P5_RECOVERY_INVOCATION_AUTHORITY;
  expectedCodeHeadSha: string;
  actualCodeHeadSha: string;
  executedAt: string;
  checkpoint: DnaOpenLabP5RecoveryCheckpoint | null;
  runCase: (
    caseId: DnaOpenLabP5RecoveryCase,
  ) => Promise<DnaOpenLabP5RecoveryObservation>;
  emitEvidence: (canonicalJson: string) => Promise<void>;
}>;

export type DnaOpenLabP5RecoveryInvocationResult = Readonly<{
  evidence: DnaOpenLabP5SanitizedRecoveryEvidence;
  checkpoint: DnaOpenLabP5RecoveryCheckpoint;
}>;

function invocationError(): never {
  throw new Error(
    "DNA Open Lab P5 private Preview recovery invocation failed.",
  );
}

function exactHeadSha(value: string): string {
  const normalized = value.trim();
  if (!SHA_1_PATTERN.test(normalized)) invocationError();
  return normalized;
}

function sha256(domain: string, value: unknown): string {
  return createHash("sha256")
    .update(`${domain}\u0000${JSON.stringify(value)}`, "utf8")
    .digest("hex");
}

function sanitizeRecoveryEvidence(
  step: DnaOpenLabP5RecoveryHarnessStep,
  expectedCodeHeadSha: string,
): DnaOpenLabP5SanitizedRecoveryEvidence {
  if (
    step.checkpoint.codeHeadSha !== expectedCodeHeadSha ||
    step.checkpoint.providerScope !== "private_preview" ||
    step.checkpoint.results.length < 1 ||
    step.checkpoint.results.length > DNA_OPEN_LAB_P5_RECOVERY_CASES.length
  ) {
    invocationError();
  }

  const current = step.checkpoint.results.at(-1);
  if (
    current === undefined ||
    current.codeHeadSha !== expectedCodeHeadSha ||
    current.providerScope !== "private_preview" ||
    current.persistentOwnerDataWriteCount !== 0 ||
    current.residueObjectCount !== 0 ||
    current.rawPayloadIncluded !== false ||
    current.secretMaterialIncluded !== false
  ) {
    invocationError();
  }

  const recoveryComplete = step.kind === "complete";
  const reportPassed = recoveryComplete ? step.report.passed : null;
  const connectedRecoveryEvidenceComplete = reportPassed === true;
  const evidenceWithoutChecksum = Object.freeze({
    schemaVersion: 1 as const,
    evidenceKind: "dna_open_lab_p5_private_preview_recovery_case" as const,
    codeHeadSha: expectedCodeHeadSha,
    providerScope: "private_preview" as const,
    executedAt: current.executedAt,
    completedCaseId: current.caseId,
    nextCaseId: step.kind === "case_completed" ? step.nextCaseId : null,
    completedCaseCount: step.checkpoint.results.length,
    totalCaseCount: 10 as const,
    casePassed: current.outcome === "passed",
    recoveryComplete,
    reportPassed,
    checkpointSha256: sha256(
      "dna-open-lab-p5-recovery-checkpoint",
      step.checkpoint,
    ),
    reportSha256:
      step.kind === "complete"
        ? sha256("dna-open-lab-p5-recovery-report", step.report)
        : null,
    persistentOwnerDataWriteCount: 0 as const,
    residueObjectCount: 0 as const,
    rawPayloadIncluded: false as const,
    secretMaterialIncluded: false as const,
    connectedRecoveryEvidenceComplete,
    readyToUpdateP5RecoveryRows: connectedRecoveryEvidenceComplete,
    firstPersistentPrivatePreviewSyncAllowed: false as const,
    productionChangesAllowed: false as const,
  });
  return Object.freeze({
    ...evidenceWithoutChecksum,
    evidenceSha256: sha256(
      "dna-open-lab-p5-sanitized-recovery-evidence",
      evidenceWithoutChecksum,
    ),
  });
}

/**
 * Executes exactly one bounded private-Preview recovery case. Only a compact
 * whitelist record crosses the emission boundary; checkpoint/report contents,
 * provider configuration, identities, payloads, errors and summaries do not.
 * Completing this invocation never authorises persistent owner-data sync.
 */
export async function invokeDnaOpenLabP5PrivatePreviewRecoveryCase(
  input: DnaOpenLabP5RecoveryInvocationInput,
): Promise<DnaOpenLabP5RecoveryInvocationResult> {
  let expectedCodeHeadSha: string;
  try {
    if (
      input.authority !== DNA_OPEN_LAB_P5_RECOVERY_INVOCATION_AUTHORITY ||
      typeof input.runCase !== "function" ||
      typeof input.emitEvidence !== "function"
    ) {
      invocationError();
    }
    expectedCodeHeadSha = exactHeadSha(input.expectedCodeHeadSha);
    if (exactHeadSha(input.actualCodeHeadSha) !== expectedCodeHeadSha) {
      invocationError();
    }
  } catch {
    return invocationError();
  }

  let step: DnaOpenLabP5RecoveryHarnessStep;
  let evidence: DnaOpenLabP5SanitizedRecoveryEvidence;
  try {
    step = await runDnaOpenLabP5RecoveryHarnessStep({
      codeHeadSha: expectedCodeHeadSha,
      providerScope: "private_preview",
      executedAt: input.executedAt,
      checkpoint: input.checkpoint,
      runCase: input.runCase,
    });
    evidence = sanitizeRecoveryEvidence(step, expectedCodeHeadSha);
  } catch {
    return invocationError();
  }

  const canonicalJson = JSON.stringify(evidence);
  if (Buffer.byteLength(canonicalJson, "utf8") > MAXIMUM_EVIDENCE_BYTES) {
    invocationError();
  }
  try {
    await input.emitEvidence(canonicalJson);
  } catch {
    return invocationError();
  }

  return Object.freeze({ evidence, checkpoint: step.checkpoint });
}
