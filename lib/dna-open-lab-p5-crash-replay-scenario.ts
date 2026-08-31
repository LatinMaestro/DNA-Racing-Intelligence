import { createHash } from "node:crypto";

import {
  createDnaCurrentStateAcquisitionSchedule,
  DNA_CURRENT_STATE_ACQUISITION_GROUPS,
  type DnaCurrentStateAcquisitionGroup,
} from "./dna-open-lab-current-state-acquisition-cadence";
import {
  runDnaCurrentStateAcquisitionStep,
  type DnaCurrentStateAcquisitionCycleCheckpoint,
  type DnaCurrentStateAcquisitionCycleCheckpointRepository,
  type StoredDnaCurrentStateAcquisitionCycleCheckpoint,
} from "./dna-open-lab-current-state-acquisition-runner";
import type { DnaOpenLabClientPool } from "./dna-open-lab-client-pool";
import type { DnaCurrentStateSyncPlan } from "./dna-open-lab-current-state-sync-plan";
import type { DnaOpenLabResponse } from "./dna-open-lab-v1-client";
import type { DnaOpenLabP5ComponentRecoveryEvidence } from "./dna-open-lab-p5-component-recovery-executor";
import type { DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot } from "./dna-open-lab-p5-private-preview-recovery";
import {
  createDnaOpenLabP5RecoveryTemporaryEvidenceReader,
  createDnaOpenLabP5RecoveryTemporaryEvidenceSink,
  DNA_OPEN_LAB_P5_RECOVERY_TEMPORARY_EVIDENCE_AUTHORITY,
  type DnaOpenLabR2CurrentStateEvidenceReaderConfiguration,
  type DnaOpenLabR2CurrentStateEvidenceStoragePort,
} from "./dna-open-lab-r2-current-state-evidence";

type CrashReplayEvidence = Extract<
  DnaOpenLabP5ComponentRecoveryEvidence,
  { caseId: "crash_after_evidence_write" }
>;

export type DnaOpenLabP5CrashReplayScenarioConfiguration = Readonly<{
  ownerId: string;
  bucketName: string;
  cycleId: string;
  attemptedAt: string;
  storage: DnaOpenLabR2CurrentStateEvidenceStoragePort &
    DnaOpenLabR2CurrentStateEvidenceReaderConfiguration["storage"];
  inspectProviderSafety: () => Promise<DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot>;
  cleanupSyntheticCase: () => Promise<void>;
}>;

class RestartableCheckpointRepository implements DnaCurrentStateAcquisitionCycleCheckpointRepository {
  stored: StoredDnaCurrentStateAcquisitionCycleCheckpoint | null = null;
  saveCount = 0;
  failSaveNumber: number | null = 2;

  async load(cycleId: string) {
    return this.stored?.checkpoint.cycleId === cycleId ? this.stored : null;
  }

  async save(input: {
    expectedRevision: string | null;
    checkpoint: DnaCurrentStateAcquisitionCycleCheckpoint;
  }) {
    this.saveCount += 1;
    if (this.failSaveNumber === this.saveCount) {
      throw new Error("synthetic crash before checkpoint advancement");
    }
    if (this.stored === null) {
      if (input.expectedRevision !== null) {
        throw new Error("synthetic checkpoint authority is missing");
      }
      this.stored = Object.freeze({
        revision: "1",
        checkpoint: input.checkpoint,
      });
      return this.stored;
    }
    if (input.expectedRevision !== this.stored.revision) {
      throw new Error("synthetic checkpoint revision conflict");
    }
    this.stored = Object.freeze({
      revision: String(Number(this.stored.revision) + 1),
      checkpoint: input.checkpoint,
    });
    return this.stored;
  }
}

function tokenOnlySchedule(evaluatedAt: string) {
  const plan: DnaCurrentStateSyncPlan = Object.freeze({
    bootstrap: Object.freeze([
      Object.freeze({
        scope: "tokens" as const,
        endpoint: "tokens.prices" as const,
        payload: Object.freeze({}),
      }),
    ]),
    hydrate: Object.freeze([]),
    deferredUntilP3: Object.freeze([
      "cores.telemetry",
      "cores.telemetry_bulk",
      "cores.telemetry_benchmark",
    ] as const),
  });
  const scheduled = createDnaCurrentStateAcquisitionSchedule({
    evaluatedAt,
    plan,
  });
  const tokenRequests = scheduled.requestBatches
    .flat()
    .filter((entry) => entry.group === "token_prices");
  return Object.freeze({
    ...scheduled,
    dueGroups: Object.freeze(["token_prices"] as const),
    requestBatches: Object.freeze([Object.freeze(tokenRequests)]),
    scheduledRequestCount: tokenRequests.length,
  });
}

function syntheticPool(): DnaOpenLabClientPool {
  const response: DnaOpenLabResponse<unknown> = Object.freeze({
    result: Object.freeze({ recoveryProbe: true }),
    httpStatus: 200,
    rateLimit: Object.freeze({
      limit: 30,
      remaining: 29,
      resetSeconds: 60,
      rateClass: "api_key",
      retryAfterSeconds: null,
    }),
  });
  return Object.freeze({
    execute: async () => response,
    snapshot: () =>
      Object.freeze({
        independentRateBucketsEnabled: false,
        aggregateBudget: null,
        lanes: Object.freeze([]),
      }),
  }) as unknown as DnaOpenLabClientPool;
}

function sha256(parts: readonly unknown[]): string {
  return createHash("sha256")
    .update(JSON.stringify(parts), "utf8")
    .digest("hex");
}

function revision(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("DNA Open Lab P5 crash replay scenario failed.");
  }
  return parsed;
}

function cachedEvidence(
  at: string,
): Record<DnaCurrentStateAcquisitionGroup, string> {
  return Object.fromEntries(
    DNA_CURRENT_STATE_ACQUISITION_GROUPS.map((group) => [group, at]),
  ) as Record<DnaCurrentStateAcquisitionGroup, string>;
}

/**
 * Exercises the production acquisition runner through a real private R2
 * first-write/replay/read-back boundary. The checkpoint is deliberately
 * synthetic and restartable, so no Neon or owner row can be written. Cleanup
 * is required before the scenario can return passing component evidence.
 */
export function createDnaOpenLabP5CrashAfterEvidenceWriteScenario(
  configuration: DnaOpenLabP5CrashReplayScenarioConfiguration,
): () => Promise<CrashReplayEvidence> {
  return async () => {
    const repository = new RestartableCheckpointRepository();
    const schedule = tokenOnlySchedule(configuration.attemptedAt);
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
    const before = await configuration.inspectProviderSafety();
    if (before.syntheticResidueObjectCount !== 0) {
      throw new Error("DNA Open Lab P5 crash replay scenario failed.");
    }
    const writtenReceipts: Awaited<ReturnType<typeof sink>>[] = [];
    const persistEvidence: typeof sink = async (input) => {
      const receipt = await sink(input);
      writtenReceipts.push(receipt);
      return receipt;
    };
    const commonInput = {
      cycleId: configuration.cycleId,
      attemptedAt: configuration.attemptedAt,
      schedule,
      checkpointRepository: repository,
      pool: syntheticPool(),
      persistEvidence,
      cachedEvidenceObservedAt: cachedEvidence(configuration.attemptedAt),
      pauseLastGood: async () => undefined,
    };

    await runDnaCurrentStateAcquisitionStep(commonInput).then(
      () => {
        throw new Error("DNA Open Lab P5 crash replay scenario failed.");
      },
      (error: unknown) => {
        if (
          !(error instanceof Error) ||
          error.message !== "synthetic crash before checkpoint advancement"
        ) {
          throw new Error("DNA Open Lab P5 crash replay scenario failed.");
        }
      },
    );
    const checkpointRevisionBefore = revision(repository.stored?.revision);
    const afterFirstWrite = await configuration.inspectProviderSafety();
    const firstReceipt = writtenReceipts[0];
    if (
      firstReceipt === undefined ||
      afterFirstWrite.syntheticResidueObjectCount !== 1
    ) {
      throw new Error("DNA Open Lab P5 crash replay scenario failed.");
    }

    repository.failSaveNumber = null;
    const replay = await runDnaCurrentStateAcquisitionStep(commonInput);
    if (replay.kind !== "request_completed") {
      throw new Error("DNA Open Lab P5 crash replay scenario failed.");
    }
    const replayReceipt = replay.stored.checkpoint.receipts[0];
    if (replayReceipt === undefined) {
      throw new Error("DNA Open Lab P5 crash replay scenario failed.");
    }
    const afterReplay = await configuration.inspectProviderSafety();
    const readBack = await reader({
      cycleId: configuration.cycleId,
      receipt: replayReceipt,
    });
    const checkpointRevisionAfter = revision(replay.stored.revision);
    const checkpointSha = sha256([
      replay.stored.revision,
      replay.stored.checkpoint,
    ]);
    const firstReceiptSha = sha256([
      firstReceipt.requestKey,
      firstReceipt.observedAt,
      firstReceipt.contentSha256,
      firstReceipt.evidenceObjectKey,
    ]);
    const replayReceiptSha = sha256([
      replayReceipt.requestKey,
      replayReceipt.observedAt,
      replayReceipt.contentSha256,
      replayReceipt.evidenceObjectKey,
    ]);
    if (
      readBack.requestKey !== replayReceipt.requestKey ||
      afterReplay.syntheticResidueObjectCount !== 1
    ) {
      throw new Error("DNA Open Lab P5 crash replay scenario failed.");
    }

    await configuration.cleanupSyntheticCase();
    const cleaned = await configuration.inspectProviderSafety();
    if (
      cleaned.syntheticResidueObjectCount !== 0 ||
      before.ownerDataSha256 !== cleaned.ownerDataSha256 ||
      before.checkpointStateSha256 !== cleaned.checkpointStateSha256 ||
      before.servingStateSha256 !== cleaned.servingStateSha256 ||
      before.retainedEvidenceSha256 !== cleaned.retainedEvidenceSha256
    ) {
      throw new Error("DNA Open Lab P5 crash replay scenario failed.");
    }

    return Object.freeze({
      caseId: "crash_after_evidence_write",
      apiRequestCount: 0,
      syntheticProviderWriteCount: 2,
      persistentOwnerDataWriteCount: 0,
      residueObjectCount: 0,
      rawPayloadIncluded: false,
      secretMaterialIncluded: false,
      lastGoodGenerationBefore: before.servingStateSha256,
      lastGoodGenerationAfter: cleaned.servingStateSha256,
      expectedCheckpointSha256: checkpointSha,
      recoveredCheckpointSha256: checkpointSha,
      expectedEvidenceSha256: replayReceipt.contentSha256,
      readBackEvidenceSha256: replayReceipt.contentSha256,
      retryBoundaryAt: configuration.attemptedAt,
      firstRetryAt: configuration.attemptedAt,
      catchUpStarted: true,
      catchUpCompleted: true,
      summary:
        "Private temporary evidence replayed exactly once and cleanup restored provider safety.",
      firstReceiptSha256: firstReceiptSha,
      replayReceiptSha256: replayReceiptSha,
      checkpointRevisionBefore,
      checkpointRevisionAfter,
      objectCountBefore: afterFirstWrite.syntheticResidueObjectCount,
      objectCountAfter: afterReplay.syntheticResidueObjectCount,
    });
  };
}
