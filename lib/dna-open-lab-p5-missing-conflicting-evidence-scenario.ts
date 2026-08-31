import { createHash } from "node:crypto";

import {
  createDnaCurrentStateAcquisitionSchedule,
  DNA_CURRENT_STATE_ACQUISITION_GROUPS,
} from "./dna-open-lab-current-state-acquisition-cadence";
import type {
  DnaCurrentStateAcquisitionCycleCheckpoint,
  DnaCurrentStateAcquisitionEvidenceReceipt,
} from "./dna-open-lab-current-state-acquisition-runner";
import { publishDnaCurrentStateAcquisitionCycle } from "./dna-open-lab-current-state-publication-runner";
import { createDnaCurrentStateSyncPlan } from "./dna-open-lab-current-state-sync-plan";
import type { DnaOpenLabP5ComponentRecoveryEvidence } from "./dna-open-lab-p5-component-recovery-executor";
import type { DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot } from "./dna-open-lab-p5-private-preview-recovery";
import {
  createDnaOpenLabP5RecoveryTemporaryEvidenceReader,
  createDnaOpenLabP5RecoveryTemporaryEvidenceSink,
  DNA_OPEN_LAB_P5_RECOVERY_TEMPORARY_EVIDENCE_AUTHORITY,
  type DnaOpenLabR2CurrentStateEvidenceReaderConfiguration,
  type DnaOpenLabR2CurrentStateEvidenceStoragePort,
} from "./dna-open-lab-r2-current-state-evidence";
import type { NeonDnaOpenLabSyncPublicationRepository } from "./neon-dna-open-lab-sync-publication";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";

type MissingConflictingEvidence = Extract<
  DnaOpenLabP5ComponentRecoveryEvidence,
  { caseId: "missing_or_conflicting_evidence" }
>;

const EVIDENCE_HEAD_REJECTION =
  "DNA Open Lab R2 current-state evidence: evidence object head does not match its receipt";

export type DnaOpenLabP5MissingConflictingEvidenceScenarioConfiguration =
  Readonly<{
    ownerId: string;
    bucketName: string;
    cycleId: string;
    attemptedAt: string;
    storage: DnaOpenLabR2CurrentStateEvidenceStoragePort &
      DnaOpenLabR2CurrentStateEvidenceReaderConfiguration["storage"];
    inspectProviderSafety: () => Promise<DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot>;
    cleanupSyntheticCase: () => Promise<void>;
  }>;

function scenarioError(): never {
  throw new Error(
    "DNA Open Lab P5 missing/conflicting-evidence scenario failed.",
  );
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

function differentSha256(value: string): string {
  const replacement = value.startsWith("0") ? "1" : "0";
  return `${replacement}${value.slice(1)}`;
}

function schedule(evaluatedAt: string) {
  return createDnaCurrentStateAcquisitionSchedule({
    evaluatedAt,
    plan: createDnaCurrentStateSyncPlan({
      vault: "p5-recovery-synthetic-vault",
      ownedCoreIds: [],
      activeRaceIds: [],
      spliceModes: ["bike"],
      spliceArenaPagesByMode: { bike: [1] },
    }),
  });
}

function checkpoint(input: {
  cycleId: string;
  evaluatedAt: string;
  receipts: readonly DnaCurrentStateAcquisitionEvidenceReceipt[];
  schedule: ReturnType<typeof schedule>;
}): DnaCurrentStateAcquisitionCycleCheckpoint {
  const entries = input.schedule.requestBatches.flat();
  return Object.freeze({
    version: 1,
    cycleId: input.cycleId,
    evaluatedAt: input.evaluatedAt,
    scheduleSha256: dnaOpenLabRawEvidenceSha256({
      evaluatedAt: input.evaluatedAt,
      completionScope: input.schedule.completionScope,
      dueGroups: input.schedule.dueGroups,
      requests: entries,
    }),
    status: "ready_to_publish",
    scheduledRequestKeys: Object.freeze(
      entries.map((entry) =>
        dnaOpenLabRawEvidenceSha256({
          group: entry.group,
          request: entry.request,
        }),
      ),
    ),
    receipts: Object.freeze(input.receipts),
    completedGroups: DNA_CURRENT_STATE_ACQUISITION_GROUPS,
    pauseReason: null,
    retryNotBefore: null,
  });
}

function assertUnchangedProviderState(
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
 * Revalidates one temporary immutable receipt, then presents both a conflicting
 * checksum and a missing object to the production evidence reader through the
 * full publication runner. Both attempts must fail before the Neon repository
 * can stage a candidate. Last-good and every protected provider fingerprint
 * remain unchanged, and the temporary control object is removed afterward.
 */
export function createDnaOpenLabP5MissingConflictingEvidenceScenario(
  configuration: DnaOpenLabP5MissingConflictingEvidenceScenarioConfiguration,
): () => Promise<MissingConflictingEvidence> {
  return async () => {
    const attemptedAt = timestamp(configuration.attemptedAt);
    const before = await configuration.inspectProviderSafety();
    if (before.syntheticResidueObjectCount !== 0) scenarioError();

    const acquisitionSchedule = schedule(attemptedAt);
    if (
      acquisitionSchedule.status !== "ready" ||
      acquisitionSchedule.completionScope !== "all_current_state"
    ) {
      scenarioError();
    }
    const entries = acquisitionSchedule.requestBatches.flat();
    const firstEntry = entries[0];
    if (firstEntry === undefined) scenarioError();
    const requestKey = dnaOpenLabRawEvidenceSha256({
      group: firstEntry.group,
      request: firstEntry.request,
    });
    const sink = createDnaOpenLabP5RecoveryTemporaryEvidenceSink({
      authority: DNA_OPEN_LAB_P5_RECOVERY_TEMPORARY_EVIDENCE_AUTHORITY,
      ownerId: configuration.ownerId,
      bucketName: configuration.bucketName,
      storage: configuration.storage,
    });
    const reader = createDnaOpenLabP5RecoveryTemporaryEvidenceReader({
      authority: DNA_OPEN_LAB_P5_RECOVERY_TEMPORARY_EVIDENCE_AUTHORITY,
      ownerId: configuration.ownerId,
      bucketName: configuration.bucketName,
      storage: configuration.storage,
    });
    const receipt = await sink({
      cycleId: configuration.cycleId,
      group: firstEntry.group,
      requestKey,
      request: firstEntry.request,
      response: Object.freeze({
        result: Object.freeze({ recoveryProbe: true }),
        httpStatus: 200,
        rateLimit: Object.freeze({
          limit: 30,
          remaining: 29,
          resetSeconds: 60,
          rateClass: "api_key",
          retryAfterSeconds: null,
        }),
      }),
      observedAt: attemptedAt,
    });
    const control = await reader({
      cycleId: configuration.cycleId,
      receipt,
    });
    if (
      control.requestKey !== receipt.requestKey ||
      control.observedAt !== receipt.observedAt
    ) {
      scenarioError();
    }

    let neonStagingAttemptCount = 0;
    const publicationRepository = {
      publishCandidate: async () => {
        neonStagingAttemptCount += 1;
        return scenarioError();
      },
    } as unknown as NeonDnaOpenLabSyncPublicationRepository;
    const placeholderReceipts = entries.map((entry) => {
      const key = dnaOpenLabRawEvidenceSha256({
        group: entry.group,
        request: entry.request,
      });
      return Object.freeze({
        requestKey: key,
        observedAt: attemptedAt,
        contentSha256: sha256({ key, missing: true }),
        evidenceObjectKey: `missing/${key}.json`,
      });
    });

    const runPublication = async (
      firstReceipt: DnaCurrentStateAcquisitionEvidenceReceipt,
    ) => {
      const receipts = [firstReceipt, ...placeholderReceipts.slice(1)];
      await publishDnaCurrentStateAcquisitionCycle({
        ownerId: configuration.ownerId,
        cycleId: configuration.cycleId,
        schedule: acquisitionSchedule,
        checkpoint: checkpoint({
          cycleId: configuration.cycleId,
          evaluatedAt: attemptedAt,
          receipts,
          schedule: acquisitionSchedule,
        }),
        validatedAt: attemptedAt,
        recordedAt: attemptedAt,
        acceptedAt: attemptedAt,
        readEvidence: reader,
        publicationRepository,
      });
    };

    const rejectedByEvidenceHead = async (
      firstReceipt: DnaCurrentStateAcquisitionEvidenceReceipt,
    ): Promise<boolean> => {
      try {
        await runPublication(firstReceipt);
        return false;
      } catch (error) {
        return (
          error instanceof Error && error.message === EVIDENCE_HEAD_REJECTION
        );
      }
    };

    const presentedReceiptSha256 = differentSha256(receipt.contentSha256);
    const conflictingRejected = await rejectedByEvidenceHead(
      Object.freeze({
        ...receipt,
        contentSha256: presentedReceiptSha256,
      }),
    );

    await configuration.cleanupSyntheticCase();
    const missingRejected = await rejectedByEvidenceHead(receipt);

    const after = await configuration.inspectProviderSafety();
    if (
      !conflictingRejected ||
      !missingRejected ||
      neonStagingAttemptCount !== 0
    ) {
      scenarioError();
    }
    assertUnchangedProviderState(before, after);

    const recoveredCheckpointSha256 = sha256(
      checkpoint({
        cycleId: configuration.cycleId,
        evaluatedAt: attemptedAt,
        receipts: [receipt, ...placeholderReceipts.slice(1)],
        schedule: acquisitionSchedule,
      }),
    );
    return Object.freeze({
      caseId: "missing_or_conflicting_evidence" as const,
      apiRequestCount: 0,
      syntheticProviderWriteCount: 1,
      persistentOwnerDataWriteCount: 0 as const,
      residueObjectCount: 0 as const,
      rawPayloadIncluded: false as const,
      secretMaterialIncluded: false as const,
      lastGoodGenerationBefore: before.servingStateSha256,
      lastGoodGenerationAfter: after.servingStateSha256,
      expectedCheckpointSha256: recoveredCheckpointSha256,
      recoveredCheckpointSha256,
      expectedEvidenceSha256: receipt.contentSha256,
      readBackEvidenceSha256: receipt.contentSha256,
      retryBoundaryAt: attemptedAt,
      firstRetryAt: attemptedAt,
      catchUpStarted: true,
      catchUpCompleted: true,
      expectedReceiptSha256: receipt.contentSha256,
      presentedReceiptSha256,
      neonStagingAttemptCount,
      summary:
        "Missing and conflicting immutable R2 evidence failed before Neon staging while last-good serving remained intact.",
    });
  };
}
