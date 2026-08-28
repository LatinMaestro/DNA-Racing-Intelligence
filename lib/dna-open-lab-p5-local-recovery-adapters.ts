import type {
  DnaOpenLabP5RecoveryCase,
  DnaOpenLabP5RecoveryObservation,
} from "./dna-open-lab-p5-recovery-harness";

type CommonTrace = Readonly<{
  apiRequestCount: number;
  syntheticProviderWriteCount: number;
  persistentOwnerDataWriteCount: 0;
  residueObjectCount: 0;
  rawPayloadIncluded: false;
  secretMaterialIncluded: false;
  lastGoodPreserved: boolean;
  checkpointRecovered: boolean;
  immutableEvidenceVerified: boolean;
  retryBoundaryObserved: boolean;
  catchUpCompleted: boolean;
  summary: string;
}>;

export type DnaOpenLabP5LocalRecoveryTrace =
  | Readonly<
      CommonTrace & {
        caseId: "crash_after_evidence_write";
        replayReturnedOriginalReceipt: boolean;
        checkpointAdvanceCount: number;
        duplicateObjectCount: number;
      }
    >
  | Readonly<
      CommonTrace & {
        caseId: "concurrent_checkpoint_advancement";
        losingWriterRejected: boolean;
        servingGenerationChanged: boolean;
      }
    >
  | Readonly<
      CommonTrace & {
        caseId: "rate_limited_retry_after";
        retryAfterSeconds: number;
        immediateRetryCount: number;
      }
    >
  | Readonly<
      CommonTrace & {
        caseId: "lower_rate_allowance";
        configuredAggregateCeiling: number;
        observedAllowance: number;
        effectiveAllowance: number;
      }
    >
  | Readonly<
      CommonTrace & {
        caseId: "eligibility_loss";
        syncPaused: boolean;
        destructiveResetPerformed: boolean;
        cachedSiteAvailable: boolean;
      }
    >
  | Readonly<
      CommonTrace & {
        caseId: "eligibility_reinstatement";
        resumedFromDurableAuthority: boolean;
        indexedPublicationCompleted: boolean;
        pauseClearedAfterPublication: boolean;
      }
    >
  | Readonly<
      CommonTrace & {
        caseId: "api_outage_or_invalid_body";
        responseBodyAuthorityPreserved: boolean;
        partialCandidatePublished: boolean;
      }
    >
  | Readonly<
      CommonTrace & {
        caseId: "missing_or_conflicting_evidence";
        conflictingEvidenceRejected: boolean;
        neonStagingAttemptCount: number;
      }
    >
  | Readonly<
      CommonTrace & {
        caseId: "atomic_publication_failure";
        servingPointerChanged: boolean;
        receiptIndexSplit: boolean;
        retryIdempotent: boolean;
      }
    >
  | Readonly<
      CommonTrace & {
        caseId: "dynamic_plan_drift";
        cachedReceiptReuseCount: number;
        fullCycleRequired: boolean;
      }
    >;

function commonAssertions(trace: CommonTrace): boolean {
  return (
    trace.lastGoodPreserved &&
    trace.checkpointRecovered &&
    trace.immutableEvidenceVerified &&
    trace.retryBoundaryObserved &&
    trace.catchUpCompleted
  );
}

function caseAssertions(trace: DnaOpenLabP5LocalRecoveryTrace): boolean {
  switch (trace.caseId) {
    case "crash_after_evidence_write":
      return (
        trace.replayReturnedOriginalReceipt &&
        trace.checkpointAdvanceCount === 1 &&
        trace.duplicateObjectCount === 0
      );
    case "concurrent_checkpoint_advancement":
      return trace.losingWriterRejected && !trace.servingGenerationChanged;
    case "rate_limited_retry_after":
      return (
        Number.isSafeInteger(trace.retryAfterSeconds) &&
        trace.retryAfterSeconds > 0 &&
        trace.immediateRetryCount === 0
      );
    case "lower_rate_allowance":
      return (
        trace.configuredAggregateCeiling === 30 &&
        Number.isSafeInteger(trace.observedAllowance) &&
        trace.observedAllowance >= 0 &&
        trace.observedAllowance < trace.configuredAggregateCeiling &&
        trace.effectiveAllowance === trace.observedAllowance
      );
    case "eligibility_loss":
      return (
        trace.syncPaused &&
        !trace.destructiveResetPerformed &&
        trace.cachedSiteAvailable
      );
    case "eligibility_reinstatement":
      return (
        trace.resumedFromDurableAuthority &&
        trace.indexedPublicationCompleted &&
        trace.pauseClearedAfterPublication
      );
    case "api_outage_or_invalid_body":
      return (
        trace.responseBodyAuthorityPreserved && !trace.partialCandidatePublished
      );
    case "missing_or_conflicting_evidence":
      return (
        trace.conflictingEvidenceRejected && trace.neonStagingAttemptCount === 0
      );
    case "atomic_publication_failure":
      return (
        !trace.servingPointerChanged &&
        !trace.receiptIndexSplit &&
        trace.retryIdempotent
      );
    case "dynamic_plan_drift":
      return trace.cachedReceiptReuseCount === 0 && trace.fullCycleRequired;
  }
}

/**
 * Converts a case-specific local recovery trace into the generic bounded P5
 * harness observation. A trace can report `passed` only when every common and
 * case-specific assertion is present.
 */
export function adaptDnaOpenLabP5LocalRecoveryTrace(
  trace: DnaOpenLabP5LocalRecoveryTrace,
): DnaOpenLabP5RecoveryObservation {
  return Object.freeze({
    caseId: trace.caseId,
    outcome:
      commonAssertions(trace) && caseAssertions(trace) ? "passed" : "failed",
    apiRequestCount: trace.apiRequestCount,
    syntheticProviderWriteCount: trace.syntheticProviderWriteCount,
    persistentOwnerDataWriteCount: trace.persistentOwnerDataWriteCount,
    residueObjectCount: trace.residueObjectCount,
    rawPayloadIncluded: trace.rawPayloadIncluded,
    secretMaterialIncluded: trace.secretMaterialIncluded,
    lastGoodPreserved: trace.lastGoodPreserved,
    checkpointRecovered: trace.checkpointRecovered,
    immutableEvidenceVerified: trace.immutableEvidenceVerified,
    retryBoundaryObserved: trace.retryBoundaryObserved,
    catchUpCompleted: trace.catchUpCompleted,
    summary: trace.summary,
  });
}

export function createDnaOpenLabP5LocalRecoveryCaseRunner(input: {
  executeCase: (
    caseId: DnaOpenLabP5RecoveryCase,
  ) => Promise<DnaOpenLabP5LocalRecoveryTrace>;
}): (
  caseId: DnaOpenLabP5RecoveryCase,
) => Promise<DnaOpenLabP5RecoveryObservation> {
  return async (caseId) => {
    const trace = await input.executeCase(caseId);
    if (trace.caseId !== caseId) {
      throw new Error(
        `DNA Open Lab P5 local recovery adapter: expected ${caseId}, received ${trace.caseId}`,
      );
    }
    return adaptDnaOpenLabP5LocalRecoveryTrace(trace);
  };
}
