import {
  DNA_OPEN_LAB_P5_RECOVERY_CASES,
  type DnaOpenLabP5RecoveryCase,
} from "./dna-open-lab-p5-recovery-harness";

export const DNA_OPEN_LAB_P5_CONNECTED_RECOVERY_FAILURE_PHASES = Object.freeze([
  "configuration",
  "provider_ports",
  "ordered_case",
  "artifact_write",
  "result_assertion",
  "final_provider_safety",
  "cleanup_synthetic_prefix",
  "cleanup_neon_safety",
  "cleanup_r2_safety",
  "cleanup_provider_safety",
] as const);

export type DnaOpenLabP5ConnectedRecoveryFailurePhase =
  (typeof DNA_OPEN_LAB_P5_CONNECTED_RECOVERY_FAILURE_PHASES)[number];

export type DnaOpenLabP5ConnectedRecoveryDiagnostic = Readonly<{
  phase: DnaOpenLabP5ConnectedRecoveryFailurePhase;
  completedCaseCount: number;
  nextCaseId: DnaOpenLabP5RecoveryCase | null;
}>;

function diagnosticError(): never {
  throw new Error("DNA Open Lab P5 connected recovery diagnostic failed.");
}

/**
 * Produces a fixed allowlisted failure location for connected logs. It accepts
 * no provider error, identity, object key, URL or payload text.
 */
export function createDnaOpenLabP5ConnectedRecoveryDiagnostic(input: {
  phase: DnaOpenLabP5ConnectedRecoveryFailurePhase;
  completedCaseCount: number;
}): DnaOpenLabP5ConnectedRecoveryDiagnostic {
  if (
    !DNA_OPEN_LAB_P5_CONNECTED_RECOVERY_FAILURE_PHASES.includes(input.phase) ||
    !Number.isSafeInteger(input.completedCaseCount) ||
    input.completedCaseCount < 0 ||
    input.completedCaseCount > DNA_OPEN_LAB_P5_RECOVERY_CASES.length
  ) {
    diagnosticError();
  }
  return Object.freeze({
    phase: input.phase,
    completedCaseCount: input.completedCaseCount,
    nextCaseId:
      DNA_OPEN_LAB_P5_RECOVERY_CASES[input.completedCaseCount] ?? null,
  });
}

export function connectedRecoveryFailure(
  diagnostic: DnaOpenLabP5ConnectedRecoveryDiagnostic,
): Error {
  const validated = createDnaOpenLabP5ConnectedRecoveryDiagnostic(diagnostic);
  return new Error(
    `DNA Open Lab P5 connected recovery failed: phase=${validated.phase}; completed_case_count=${validated.completedCaseCount}; next_case=${validated.nextCaseId ?? "none"}.`,
  );
}
