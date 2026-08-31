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

type ConcurrentCheckpointEvidence = Extract<
  DnaOpenLabP5ComponentRecoveryEvidence,
  { caseId: "concurrent_checkpoint_advancement" }
>;

export type DnaOpenLabP5ConcurrentCheckpointScenarioConfiguration = Readonly<{
  ownerId: string;
  bucketName: string;
  cycleId: string;
  attemptedAt: string;
  storage: DnaOpenLabR2CurrentStateEvidenceStoragePort &
    DnaOpenLabR2CurrentStateEvidenceReaderConfiguration["storage"];
  inspectProviderSafety: () => Promise<DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot>;
  cleanupSyntheticCase: () => Promise<void>;
}>;

class ConcurrentCheckpointRepository implements DnaCurrentStateAcquisitionCycleCheckpointRepository {
  stored: StoredDnaCurrentStateAcquisitionCycleCheckpoint | null = null;
  private concurrent = false;
  private arrived = 0;
  private releaseWriters: (() => void) | null = null;
  private readonly writersReady = new Promise<void>((resolve) => {
    this.releaseWriters = resolve;
  });

  async load(cycleId: string) {
    return this.stored?.checkpoint.cycleId === cycleId ? this.stored : null;
  }

  startConcurrentAdvancement(): void {
    if (this.stored?.revision !== "1") scenarioError();
    this.concurrent = true;
  }

  async save(input: {
    expectedRevision: string | null;
    checkpoint: DnaCurrentStateAcquisitionCycleCheckpoint;
  }) {
    if (this.stored === null) {
      if (input.expectedRevision !== null) scenarioError();
      this.stored = Object.freeze({
        revision: "1",
        checkpoint: input.checkpoint,
      });
      return this.stored;
    }
    if (!this.concurrent) {
      throw new Error("synthetic preparation stopped before advancement");
    }
    this.arrived += 1;
    if (this.arrived === 2) this.releaseWriters?.();
    await this.writersReady;
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

function scenarioError(): never {
  throw new Error("DNA Open Lab P5 concurrent checkpoint scenario failed.");
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

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function cachedEvidence(
  at: string,
): Record<DnaCurrentStateAcquisitionGroup, string> {
  return Object.fromEntries(
    DNA_CURRENT_STATE_ACQUISITION_GROUPS.map((group) => [group, at]),
  ) as Record<DnaCurrentStateAcquisitionGroup, string>;
}

/**
 * Sends two workers through the production acquisition runner from the same
 * synthetic revision. Both workers replay the same immutable temporary R2
 * evidence, but the checkpoint repository accepts exactly one compare-and-swap.
 * No Neon checkpoint, publication or owner row can be written.
 */
export function createDnaOpenLabP5ConcurrentCheckpointScenario(
  configuration: DnaOpenLabP5ConcurrentCheckpointScenarioConfiguration,
): () => Promise<ConcurrentCheckpointEvidence> {
  return async () => {
    const repository = new ConcurrentCheckpointRepository();
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
    if (before.syntheticResidueObjectCount !== 0) scenarioError();
    let providerWriteCount = 0;
    const persistEvidence: typeof sink = async (input) => {
      providerWriteCount += 1;
      return sink(input);
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
      () => scenarioError(),
      (error: unknown) => {
        if (
          !(error instanceof Error) ||
          error.message !== "synthetic preparation stopped before advancement"
        ) {
          scenarioError();
        }
      },
    );
    if (
      repository.stored?.revision !== "1" ||
      (await configuration.inspectProviderSafety())
        .syntheticResidueObjectCount !== 1
    ) {
      scenarioError();
    }

    repository.startConcurrentAdvancement();
    const attempts = await Promise.allSettled([
      runDnaCurrentStateAcquisitionStep(commonInput),
      runDnaCurrentStateAcquisitionStep(commonInput),
    ]);
    const winners = attempts.filter(
      (attempt) =>
        attempt.status === "fulfilled" &&
        attempt.value.kind === "request_completed",
    );
    const losers = attempts.filter(
      (attempt) =>
        attempt.status === "rejected" &&
        attempt.reason instanceof Error &&
        attempt.reason.message === "synthetic checkpoint revision conflict",
    );
    const winner = winners[0];
    if (
      winners.length !== 1 ||
      losers.length !== 1 ||
      winner?.status !== "fulfilled" ||
      winner.value.kind !== "request_completed" ||
      String(repository.stored?.revision) !== "2" ||
      repository.stored.checkpoint.receipts.length !== 1 ||
      providerWriteCount !== 3
    ) {
      scenarioError();
    }

    const receipt = repository.stored.checkpoint.receipts[0];
    if (receipt === undefined) scenarioError();
    const readBack = await reader({
      cycleId: configuration.cycleId,
      receipt,
    });
    const recoveredCheckpointSha256 = sha256(repository.stored);
    if (
      readBack.requestKey !== receipt.requestKey ||
      (await configuration.inspectProviderSafety())
        .syntheticResidueObjectCount !== 1
    ) {
      scenarioError();
    }

    await configuration.cleanupSyntheticCase();
    const cleaned = await configuration.inspectProviderSafety();
    if (
      cleaned.syntheticResidueObjectCount !== 0 ||
      before.ownerDataSha256 !== cleaned.ownerDataSha256 ||
      before.checkpointStateSha256 !== cleaned.checkpointStateSha256 ||
      before.servingStateSha256 !== cleaned.servingStateSha256 ||
      before.retainedEvidenceSha256 !== cleaned.retainedEvidenceSha256 ||
      before.persistentOwnerDataRowCount !== cleaned.persistentOwnerDataRowCount
    ) {
      scenarioError();
    }

    return Object.freeze({
      caseId: "concurrent_checkpoint_advancement",
      apiRequestCount: 0,
      syntheticProviderWriteCount: providerWriteCount,
      persistentOwnerDataWriteCount: 0,
      residueObjectCount: 0,
      rawPayloadIncluded: false,
      secretMaterialIncluded: false,
      lastGoodGenerationBefore: before.servingStateSha256,
      lastGoodGenerationAfter: cleaned.servingStateSha256,
      expectedCheckpointSha256: recoveredCheckpointSha256,
      recoveredCheckpointSha256,
      expectedEvidenceSha256: receipt.contentSha256,
      readBackEvidenceSha256: receipt.contentSha256,
      retryBoundaryAt: configuration.attemptedAt,
      firstRetryAt: configuration.attemptedAt,
      catchUpStarted: true,
      catchUpCompleted: true,
      summary:
        "Exactly one concurrent synthetic checkpoint writer advanced; immutable evidence and last-good serving remained unchanged.",
      winningWriterAccepted: true,
      losingWriterAccepted: false,
      servingGenerationBefore: before.servingStateSha256,
      servingGenerationAfter: cleaned.servingStateSha256,
    });
  };
}
