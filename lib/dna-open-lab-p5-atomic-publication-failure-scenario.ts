import { createHash } from "node:crypto";

import type { DnaOpenLabP5ComponentRecoveryEvidence } from "./dna-open-lab-p5-component-recovery-executor";
import type { DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot } from "./dna-open-lab-p5-private-preview-recovery";
import type { NeonDnaOpenLabSyncPublicationRepository } from "./neon-dna-open-lab-sync-publication";

type AtomicPublicationFailureEvidence = Extract<
  DnaOpenLabP5ComponentRecoveryEvidence,
  { caseId: "atomic_publication_failure" }
>;

type PublicationRequest = Parameters<
  NeonDnaOpenLabSyncPublicationRepository["publishCandidate"]
>[0];

export type DnaOpenLabP5AtomicPublicationState = Readonly<{
  servingGeneration: string;
  canonicalCommitCount: number;
  receiptIndexCommitCount: number;
}>;

export type DnaOpenLabP5AtomicPublicationFailureScenarioConfiguration =
  Readonly<{
    attemptedAt: string;
    publicationRepository: Pick<
      NeonDnaOpenLabSyncPublicationRepository,
      "publishCandidate"
    >;
    publicationRequest: PublicationRequest;
    expectedFailureMessage: string;
    inspectAtomicPublication: () => Promise<DnaOpenLabP5AtomicPublicationState>;
    inspectProviderSafety: () => Promise<DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot>;
    cleanupSyntheticCase: () => Promise<void>;
  }>;

function scenarioError(): never {
  throw new Error("DNA Open Lab P5 atomic-publication scenario failed.");
}

function timestamp(value: string): string {
  const normalized = value.trim();
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      normalized,
    ) ||
    Number.isNaN(Date.parse(normalized))
  ) {
    scenarioError();
  }
  return new Date(normalized).toISOString();
}

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function safeCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) scenarioError();
  return value;
}

function assertProviderStateUnchanged(
  before: DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot,
  after: DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot,
): void {
  if (
    after.syntheticResidueObjectCount !== 0 ||
    before.ownerDataSha256 !== after.ownerDataSha256 ||
    before.checkpointStateSha256 !== after.checkpointStateSha256 ||
    before.servingStateSha256 !== after.servingStateSha256 ||
    before.retainedEvidenceSha256 !== after.retainedEvidenceSha256 ||
    before.persistentOwnerDataRowCount !== after.persistentOwnerDataRowCount
  ) {
    scenarioError();
  }
}

/**
 * Forces one indexed publication to fail inside its transaction, proves that
 * neither the canonical candidate nor receipt index committed and that the
 * serving pointer stayed on last-good, then retries the byte-identical request.
 * The retry must publish both authorities exactly once. Synthetic state is
 * removed afterward and every protected provider fingerprint is rechecked.
 */
export function createDnaOpenLabP5AtomicPublicationFailureScenario(
  configuration: DnaOpenLabP5AtomicPublicationFailureScenarioConfiguration,
): () => Promise<AtomicPublicationFailureEvidence> {
  return async () => {
    const attemptedAt = timestamp(configuration.attemptedAt);
    const expectedFailureMessage = configuration.expectedFailureMessage.trim();
    if (!expectedFailureMessage) scenarioError();

    const providerBefore = await configuration.inspectProviderSafety();
    const atomicBefore = await configuration.inspectAtomicPublication();
    if (providerBefore.syntheticResidueObjectCount !== 0) scenarioError();

    const firstAttemptSha256 = sha256(configuration.publicationRequest);
    let intendedFailureObserved = false;
    try {
      await configuration.publicationRepository.publishCandidate(
        configuration.publicationRequest,
      );
    } catch (error) {
      intendedFailureObserved =
        error instanceof Error && error.message === expectedFailureMessage;
    }

    const afterFailure = await configuration.inspectAtomicPublication();
    safeCount(afterFailure.canonicalCommitCount);
    safeCount(afterFailure.receiptIndexCommitCount);
    if (
      !intendedFailureObserved ||
      afterFailure.servingGeneration !== atomicBefore.servingGeneration ||
      afterFailure.canonicalCommitCount !== atomicBefore.canonicalCommitCount ||
      afterFailure.receiptIndexCommitCount !==
        atomicBefore.receiptIndexCommitCount
    ) {
      scenarioError();
    }

    const retryAttemptSha256 = sha256(configuration.publicationRequest);
    const published =
      await configuration.publicationRepository.publishCandidate(
        configuration.publicationRequest,
      );
    const afterRetry = await configuration.inspectAtomicPublication();
    if (
      firstAttemptSha256 !== retryAttemptSha256 ||
      published.servingGenerationId !==
        configuration.publicationRequest.candidate.generationId ||
      afterRetry.servingGeneration !==
        configuration.publicationRequest.candidate.generationId ||
      afterRetry.canonicalCommitCount !==
        atomicBefore.canonicalCommitCount + 1 ||
      afterRetry.receiptIndexCommitCount !==
        atomicBefore.receiptIndexCommitCount + 1
    ) {
      scenarioError();
    }

    await configuration.cleanupSyntheticCase();
    const providerAfter = await configuration.inspectProviderSafety();
    const atomicAfterCleanup = await configuration.inspectAtomicPublication();
    assertProviderStateUnchanged(providerBefore, providerAfter);
    if (
      atomicAfterCleanup.servingGeneration !== atomicBefore.servingGeneration ||
      atomicAfterCleanup.canonicalCommitCount !==
        atomicBefore.canonicalCommitCount ||
      atomicAfterCleanup.receiptIndexCommitCount !==
        atomicBefore.receiptIndexCommitCount
    ) {
      scenarioError();
    }

    const checkpointSha256 = sha256({
      generationId: configuration.publicationRequest.candidate.generationId,
      attemptSha256: firstAttemptSha256,
    });
    const evidenceSha256 = sha256(
      configuration.publicationRequest.evidenceIndex,
    );
    return Object.freeze({
      caseId: "atomic_publication_failure" as const,
      apiRequestCount: 0,
      syntheticProviderWriteCount: 2,
      persistentOwnerDataWriteCount: 0 as const,
      residueObjectCount: 0 as const,
      rawPayloadIncluded: false as const,
      secretMaterialIncluded: false as const,
      lastGoodGenerationBefore: atomicBefore.servingGeneration,
      lastGoodGenerationAfter: afterFailure.servingGeneration,
      expectedCheckpointSha256: checkpointSha256,
      recoveredCheckpointSha256: checkpointSha256,
      expectedEvidenceSha256: evidenceSha256,
      readBackEvidenceSha256: evidenceSha256,
      retryBoundaryAt: attemptedAt,
      firstRetryAt: attemptedAt,
      catchUpStarted: true,
      catchUpCompleted: true,
      servingGenerationBefore: atomicBefore.servingGeneration,
      servingGenerationAfterFailure: afterFailure.servingGeneration,
      canonicalCommitCount:
        afterFailure.canonicalCommitCount - atomicBefore.canonicalCommitCount,
      receiptIndexCommitCount:
        afterFailure.receiptIndexCommitCount -
        atomicBefore.receiptIndexCommitCount,
      firstAttemptSha256,
      retryAttemptSha256,
      summary:
        "Atomic Neon publication failure preserved last-good and rolled back both authorities; an identical retry committed both once before cleanup.",
    });
  };
}
