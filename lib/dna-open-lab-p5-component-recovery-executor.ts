import {
  createDnaOpenLabP5LocalRecoveryCaseRunner,
  type DnaOpenLabP5LocalRecoveryTrace,
} from "./dna-open-lab-p5-local-recovery-adapters";
import type {
  DnaOpenLabP5RecoveryCase,
  DnaOpenLabP5RecoveryObservation,
} from "./dna-open-lab-p5-recovery-harness";

const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;

type CommonComponentEvidence = Readonly<{
  apiRequestCount: number;
  syntheticProviderWriteCount: number;
  persistentOwnerDataWriteCount: 0;
  residueObjectCount: 0;
  rawPayloadIncluded: false;
  secretMaterialIncluded: false;
  lastGoodGenerationBefore: string;
  lastGoodGenerationAfter: string;
  expectedCheckpointSha256: string;
  recoveredCheckpointSha256: string;
  expectedEvidenceSha256: string;
  readBackEvidenceSha256: string;
  retryBoundaryAt: string;
  firstRetryAt: string;
  catchUpStarted: boolean;
  catchUpCompleted: boolean;
  summary: string;
}>;

export type DnaOpenLabP5ComponentRecoveryEvidence =
  | Readonly<
      CommonComponentEvidence & {
        caseId: "crash_after_evidence_write";
        firstReceiptSha256: string;
        replayReceiptSha256: string;
        checkpointRevisionBefore: number;
        checkpointRevisionAfter: number;
        objectCountBefore: number;
        objectCountAfter: number;
      }
    >
  | Readonly<
      CommonComponentEvidence & {
        caseId: "concurrent_checkpoint_advancement";
        winningWriterAccepted: boolean;
        losingWriterAccepted: boolean;
        servingGenerationBefore: string;
        servingGenerationAfter: string;
      }
    >
  | Readonly<
      CommonComponentEvidence & {
        caseId: "rate_limited_retry_after";
        rateLimitedAt: string;
        retryAfterSeconds: number;
        attemptedRetryAt: readonly string[];
      }
    >
  | Readonly<
      CommonComponentEvidence & {
        caseId: "lower_rate_allowance";
        configuredAggregateCeiling: number;
        observedAllowance: number;
        appliedAllowance: number;
      }
    >
  | Readonly<
      CommonComponentEvidence & {
        caseId: "eligibility_loss";
        syncStateAfter: string;
        destructiveResetCount: number;
        cachedServingGeneration: string | null;
      }
    >
  | Readonly<
      CommonComponentEvidence & {
        caseId: "eligibility_reinstatement";
        checkpointSha256BeforeResume: string;
        checkpointSha256UsedForResume: string;
        indexedPublicationCount: number;
        syncStateAfter: string;
      }
    >
  | Readonly<
      CommonComponentEvidence & {
        caseId: "api_outage_or_invalid_body";
        httpStatus: number;
        responseBodyStatus: string;
        acceptedCandidateCount: number;
      }
    >
  | Readonly<
      CommonComponentEvidence & {
        caseId: "missing_or_conflicting_evidence";
        expectedReceiptSha256: string;
        presentedReceiptSha256: string | null;
        neonStagingAttemptCount: number;
      }
    >
  | Readonly<
      CommonComponentEvidence & {
        caseId: "atomic_publication_failure";
        servingGenerationBefore: string;
        servingGenerationAfterFailure: string;
        canonicalCommitCount: number;
        receiptIndexCommitCount: number;
        firstAttemptSha256: string;
        retryAttemptSha256: string;
      }
    >
  | Readonly<
      CommonComponentEvidence & {
        caseId: "dynamic_plan_drift";
        checkpointPlanSha256: string;
        currentPlanSha256: string;
        cachedReceiptReuseCount: number;
        replacementCycleStarted: boolean;
      }
    >;

export type DnaOpenLabP5ComponentRecoveryScenarios = Readonly<{
  [Case in DnaOpenLabP5RecoveryCase]: () => Promise<
    Extract<DnaOpenLabP5ComponentRecoveryEvidence, { caseId: Case }>
  >;
}>;

function executorError(message: string): never {
  throw new Error(`DNA Open Lab P5 component recovery executor: ${message}`);
}

function sha256(value: string, field: string): string {
  const normalized = value.trim();
  if (!SHA_256_PATTERN.test(normalized)) {
    executorError(`${field} must be an exact SHA-256 value`);
  }
  return normalized;
}

function timestamp(value: string, field: string): number {
  const normalized = value.trim();
  const milliseconds = Date.parse(normalized);
  if (
    Number.isNaN(milliseconds) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      normalized,
    )
  ) {
    executorError(`${field} must be a timezone-qualified ISO timestamp`);
  }
  return milliseconds;
}

function count(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    executorError(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function httpStatus(value: number): number {
  const normalized = count(value, "httpStatus");
  if (normalized < 100 || normalized > 599) {
    executorError("httpStatus must be between 100 and 599");
  }
  return normalized;
}

function text(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 1_000) {
    executorError(`${field} must contain 1 to 1,000 characters`);
  }
  return normalized;
}

function commonTrace(
  evidence: CommonComponentEvidence,
): Omit<DnaOpenLabP5LocalRecoveryTrace, "caseId"> {
  const retryBoundary = timestamp(evidence.retryBoundaryAt, "retryBoundaryAt");
  const firstRetry = timestamp(evidence.firstRetryAt, "firstRetryAt");
  return Object.freeze({
    apiRequestCount: count(evidence.apiRequestCount, "apiRequestCount"),
    syntheticProviderWriteCount: count(
      evidence.syntheticProviderWriteCount,
      "syntheticProviderWriteCount",
    ),
    persistentOwnerDataWriteCount: evidence.persistentOwnerDataWriteCount,
    residueObjectCount: evidence.residueObjectCount,
    rawPayloadIncluded: evidence.rawPayloadIncluded,
    secretMaterialIncluded: evidence.secretMaterialIncluded,
    lastGoodPreserved:
      text(evidence.lastGoodGenerationBefore, "lastGoodGenerationBefore") ===
      text(evidence.lastGoodGenerationAfter, "lastGoodGenerationAfter"),
    checkpointRecovered:
      sha256(evidence.expectedCheckpointSha256, "expectedCheckpointSha256") ===
      sha256(evidence.recoveredCheckpointSha256, "recoveredCheckpointSha256"),
    immutableEvidenceVerified:
      sha256(evidence.expectedEvidenceSha256, "expectedEvidenceSha256") ===
      sha256(evidence.readBackEvidenceSha256, "readBackEvidenceSha256"),
    retryBoundaryObserved: firstRetry >= retryBoundary,
    // Eligibility loss is the pause half of a deliberately separate
    // loss/reinstatement pair. Its successful outcome proves that catch-up has
    // not started while access is unavailable; every other case must prove a
    // completed catch-up path.
    catchUpCompleted:
      "caseId" in evidence && evidence.caseId === "eligibility_loss"
        ? !evidence.catchUpStarted && !evidence.catchUpCompleted
        : evidence.catchUpStarted && evidence.catchUpCompleted,
    summary: text(evidence.summary, "summary"),
  });
}

function immediateRetryCount(input: {
  rateLimitedAt: string;
  retryAfterSeconds: number;
  attemptedRetryAt: readonly string[];
}): number {
  const limitedAt = timestamp(input.rateLimitedAt, "rateLimitedAt");
  const retryAfterSeconds = count(input.retryAfterSeconds, "retryAfterSeconds");
  const allowedAt = limitedAt + retryAfterSeconds * 1_000;
  return input.attemptedRetryAt.filter(
    (attemptedAt, index) =>
      timestamp(attemptedAt, `attemptedRetryAt[${index}]`) < allowedAt,
  ).length;
}

function responseBodyAuthority(input: {
  httpStatus: number;
  responseBodyStatus: string;
}): boolean {
  httpStatus(input.httpStatus);
  return text(input.responseBodyStatus, "responseBodyStatus") !== "success";
}

function trace(
  evidence: DnaOpenLabP5ComponentRecoveryEvidence,
): DnaOpenLabP5LocalRecoveryTrace {
  const common = commonTrace(evidence);
  switch (evidence.caseId) {
    case "crash_after_evidence_write":
      return Object.freeze({
        ...common,
        caseId: evidence.caseId,
        replayReturnedOriginalReceipt:
          sha256(evidence.firstReceiptSha256, "firstReceiptSha256") ===
          sha256(evidence.replayReceiptSha256, "replayReceiptSha256"),
        checkpointAdvanceCount:
          count(evidence.checkpointRevisionAfter, "checkpointRevisionAfter") -
          count(evidence.checkpointRevisionBefore, "checkpointRevisionBefore"),
        duplicateObjectCount:
          count(evidence.objectCountAfter, "objectCountAfter") -
          count(evidence.objectCountBefore, "objectCountBefore"),
      });
    case "concurrent_checkpoint_advancement":
      return Object.freeze({
        ...common,
        caseId: evidence.caseId,
        losingWriterRejected:
          evidence.winningWriterAccepted && !evidence.losingWriterAccepted,
        servingGenerationChanged:
          text(evidence.servingGenerationBefore, "servingGenerationBefore") !==
          text(evidence.servingGenerationAfter, "servingGenerationAfter"),
      });
    case "rate_limited_retry_after":
      return Object.freeze({
        ...common,
        caseId: evidence.caseId,
        retryAfterSeconds: count(
          evidence.retryAfterSeconds,
          "retryAfterSeconds",
        ),
        immediateRetryCount: immediateRetryCount(evidence),
      });
    case "lower_rate_allowance":
      return Object.freeze({
        ...common,
        caseId: evidence.caseId,
        configuredAggregateCeiling: count(
          evidence.configuredAggregateCeiling,
          "configuredAggregateCeiling",
        ),
        observedAllowance: count(
          evidence.observedAllowance,
          "observedAllowance",
        ),
        effectiveAllowance: count(
          evidence.appliedAllowance,
          "appliedAllowance",
        ),
      });
    case "eligibility_loss":
      return Object.freeze({
        ...common,
        caseId: evidence.caseId,
        syncPaused: evidence.syncStateAfter === "paused",
        destructiveResetPerformed:
          count(evidence.destructiveResetCount, "destructiveResetCount") > 0,
        cachedSiteAvailable:
          evidence.cachedServingGeneration !== null &&
          text(evidence.cachedServingGeneration, "cachedServingGeneration")
            .length > 0,
      });
    case "eligibility_reinstatement":
      return Object.freeze({
        ...common,
        caseId: evidence.caseId,
        resumedFromDurableAuthority:
          sha256(
            evidence.checkpointSha256BeforeResume,
            "checkpointSha256BeforeResume",
          ) ===
          sha256(
            evidence.checkpointSha256UsedForResume,
            "checkpointSha256UsedForResume",
          ),
        indexedPublicationCompleted:
          count(evidence.indexedPublicationCount, "indexedPublicationCount") ===
          1,
        pauseClearedAfterPublication: evidence.syncStateAfter === "current",
      });
    case "api_outage_or_invalid_body":
      return Object.freeze({
        ...common,
        caseId: evidence.caseId,
        responseBodyAuthorityPreserved: responseBodyAuthority(evidence),
        partialCandidatePublished:
          count(evidence.acceptedCandidateCount, "acceptedCandidateCount") > 0,
      });
    case "missing_or_conflicting_evidence":
      return Object.freeze({
        ...common,
        caseId: evidence.caseId,
        conflictingEvidenceRejected:
          sha256(evidence.expectedReceiptSha256, "expectedReceiptSha256") !==
          (evidence.presentedReceiptSha256 === null
            ? "missing"
            : sha256(
                evidence.presentedReceiptSha256,
                "presentedReceiptSha256",
              )),
        neonStagingAttemptCount: count(
          evidence.neonStagingAttemptCount,
          "neonStagingAttemptCount",
        ),
      });
    case "atomic_publication_failure":
      return Object.freeze({
        ...common,
        caseId: evidence.caseId,
        servingPointerChanged:
          text(evidence.servingGenerationBefore, "servingGenerationBefore") !==
          text(
            evidence.servingGenerationAfterFailure,
            "servingGenerationAfterFailure",
          ),
        receiptIndexSplit:
          count(evidence.canonicalCommitCount, "canonicalCommitCount") !==
            count(
              evidence.receiptIndexCommitCount,
              "receiptIndexCommitCount",
            ) || evidence.canonicalCommitCount !== 0,
        retryIdempotent:
          sha256(evidence.firstAttemptSha256, "firstAttemptSha256") ===
          sha256(evidence.retryAttemptSha256, "retryAttemptSha256"),
      });
    case "dynamic_plan_drift":
      return Object.freeze({
        ...common,
        caseId: evidence.caseId,
        cachedReceiptReuseCount: count(
          evidence.cachedReceiptReuseCount,
          "cachedReceiptReuseCount",
        ),
        fullCycleRequired:
          sha256(evidence.checkpointPlanSha256, "checkpointPlanSha256") !==
            sha256(evidence.currentPlanSha256, "currentPlanSha256") &&
          evidence.replacementCycleStarted,
      });
  }
}

async function executeScenario(input: {
  caseId: DnaOpenLabP5RecoveryCase;
  scenarios: DnaOpenLabP5ComponentRecoveryScenarios;
}): Promise<DnaOpenLabP5LocalRecoveryTrace> {
  const evidence = await input.scenarios[input.caseId]();
  if (evidence.caseId !== input.caseId) {
    executorError(`expected ${input.caseId}, received ${evidence.caseId}`);
  }
  return trace(evidence);
}

/**
 * Runs one case-specific component scenario and derives its recovery trace from
 * raw identities, counters, pointers and timestamps. Scenario implementations
 * cannot submit generic pass/fail flags to the bounded P5 harness.
 */
export function createDnaOpenLabP5ComponentRecoveryCaseRunner(input: {
  scenarios: DnaOpenLabP5ComponentRecoveryScenarios;
}): (
  caseId: DnaOpenLabP5RecoveryCase,
) => Promise<DnaOpenLabP5RecoveryObservation> {
  return createDnaOpenLabP5LocalRecoveryCaseRunner({
    executeCase: (caseId) =>
      executeScenario({ caseId, scenarios: input.scenarios }),
  });
}
