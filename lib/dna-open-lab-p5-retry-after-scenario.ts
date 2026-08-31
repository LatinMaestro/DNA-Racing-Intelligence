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
import {
  DnaOpenLabApiError,
  type DnaOpenLabResponse,
} from "./dna-open-lab-v1-client";
import type { DnaOpenLabP5ComponentRecoveryEvidence } from "./dna-open-lab-p5-component-recovery-executor";
import type { DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot } from "./dna-open-lab-p5-private-preview-recovery";
import {
  createDnaOpenLabP5RecoveryTemporaryEvidenceReader,
  createDnaOpenLabP5RecoveryTemporaryEvidenceSink,
  DNA_OPEN_LAB_P5_RECOVERY_TEMPORARY_EVIDENCE_AUTHORITY,
  type DnaOpenLabR2CurrentStateEvidenceReaderConfiguration,
  type DnaOpenLabR2CurrentStateEvidenceStoragePort,
} from "./dna-open-lab-r2-current-state-evidence";

type RetryAfterEvidence = Extract<
  DnaOpenLabP5ComponentRecoveryEvidence,
  { caseId: "rate_limited_retry_after" }
>;

export type DnaOpenLabP5RetryAfterScenarioConfiguration = Readonly<{
  ownerId: string;
  bucketName: string;
  cycleId: string;
  rateLimitedAt: string;
  retryAfterSeconds: number;
  storage: DnaOpenLabR2CurrentStateEvidenceStoragePort &
    DnaOpenLabR2CurrentStateEvidenceReaderConfiguration["storage"];
  inspectProviderSafety: () => Promise<DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot>;
  cleanupSyntheticCase: () => Promise<void>;
}>;

class RetryCheckpointRepository implements DnaCurrentStateAcquisitionCycleCheckpointRepository {
  stored: StoredDnaCurrentStateAcquisitionCycleCheckpoint | null = null;

  async load(cycleId: string) {
    return this.stored?.checkpoint.cycleId === cycleId ? this.stored : null;
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
    if (input.expectedRevision !== this.stored.revision) scenarioError();
    this.stored = Object.freeze({
      revision: String(Number(this.stored.revision) + 1),
      checkpoint: input.checkpoint,
    });
    return this.stored;
  }
}

function scenarioError(): never {
  throw new Error("DNA Open Lab P5 Retry-After scenario failed.");
}

function positiveSeconds(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 86_400) {
    scenarioError();
  }
  return value;
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

function rateLimitedPool(retryAfterSeconds: number, calls: { count: number }) {
  return Object.freeze({
    execute: async () => {
      calls.count += 1;
      throw new DnaOpenLabApiError({
        kind: "rate_limited",
        message: "synthetic 429",
        httpStatus: 429,
        rateLimit: Object.freeze({
          limit: 30,
          remaining: 0,
          resetSeconds: 60,
          rateClass: "api_key",
          retryAfterSeconds,
        }),
      });
    },
    snapshot: () =>
      Object.freeze({
        independentRateBucketsEnabled: false,
        aggregateBudget: null,
        lanes: Object.freeze([]),
      }),
  }) as unknown as DnaOpenLabClientPool;
}

function successfulPool(calls: { count: number }): DnaOpenLabClientPool {
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
    execute: async () => {
      calls.count += 1;
      return response;
    },
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
 * Exercises a response-authoritative synthetic 429 through the production
 * acquisition runner. A call before Retry-After remains checkpoint-blocked and
 * cannot reach the request pool. The first permitted retry resumes the same
 * checkpoint, retains one immutable temporary R2 receipt, completes catch-up
 * and restores the exact provider safety boundary after mandatory cleanup.
 */
export function createDnaOpenLabP5RetryAfterScenario(
  configuration: DnaOpenLabP5RetryAfterScenarioConfiguration,
): () => Promise<RetryAfterEvidence> {
  return async () => {
    const rateLimitedAt = timestamp(configuration.rateLimitedAt);
    const retryAfterSeconds = positiveSeconds(configuration.retryAfterSeconds);
    const retryAt = new Date(
      Date.parse(rateLimitedAt) + retryAfterSeconds * 1_000,
    ).toISOString();
    const earlyRetryAt = new Date(Date.parse(retryAt) - 1_000).toISOString();
    const repository = new RetryCheckpointRepository();
    const schedule = tokenOnlySchedule(rateLimitedAt);
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
    const limitedCalls = { count: 0 };
    const successCalls = { count: 0 };
    const pauseCalls: Array<{
      reason: string;
      attemptedAt: string;
      retryAfterSeconds: number | null;
    }> = [];
    const commonInput = {
      cycleId: configuration.cycleId,
      schedule,
      checkpointRepository: repository,
      cachedEvidenceObservedAt: cachedEvidence(retryAt),
      pauseLastGood: async (input: {
        reason: string;
        attemptedAt: string;
        retryAfterSeconds: number | null;
      }) => {
        pauseCalls.push(input);
      },
    };

    const paused = await runDnaCurrentStateAcquisitionStep({
      ...commonInput,
      attemptedAt: rateLimitedAt,
      pool: rateLimitedPool(retryAfterSeconds, limitedCalls),
      persistEvidence: sink,
    });
    if (
      paused.kind !== "paused" ||
      paused.reason !== "rate_limited" ||
      paused.retryNotBefore !== retryAt ||
      limitedCalls.count !== 1 ||
      pauseCalls.length !== 1 ||
      pauseCalls[0]?.reason !== "rate_limited" ||
      pauseCalls[0]?.retryAfterSeconds !== retryAfterSeconds
    ) {
      scenarioError();
    }

    const early = await runDnaCurrentStateAcquisitionStep({
      ...commonInput,
      attemptedAt: earlyRetryAt,
      pool: rateLimitedPool(retryAfterSeconds, limitedCalls),
      persistEvidence: sink,
    });
    if (
      early.kind !== "paused" ||
      limitedCalls.count !== 1 ||
      pauseCalls.length !== 1 ||
      (await configuration.inspectProviderSafety())
        .syntheticResidueObjectCount !== 0
    ) {
      scenarioError();
    }

    const completed = await runDnaCurrentStateAcquisitionStep({
      ...commonInput,
      attemptedAt: retryAt,
      pool: successfulPool(successCalls),
      persistEvidence: sink,
    });
    if (
      completed.kind !== "request_completed" ||
      successCalls.count !== 1 ||
      completed.stored.checkpoint.receipts.length !== 1
    ) {
      scenarioError();
    }
    const receipt = completed.stored.checkpoint.receipts[0];
    if (receipt === undefined) scenarioError();
    const readBack = await reader({
      cycleId: configuration.cycleId,
      receipt,
    });
    const ready = await runDnaCurrentStateAcquisitionStep({
      ...commonInput,
      attemptedAt: retryAt,
      pool: successfulPool(successCalls),
      persistEvidence: sink,
    });
    if (
      ready.kind !== "ready_to_publish" ||
      successCalls.count !== 1 ||
      readBack.requestKey !== receipt.requestKey ||
      (await configuration.inspectProviderSafety())
        .syntheticResidueObjectCount !== 1
    ) {
      scenarioError();
    }
    const checkpointSha256 = sha256(ready.stored);

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
      caseId: "rate_limited_retry_after",
      apiRequestCount: 0,
      syntheticProviderWriteCount: 1,
      persistentOwnerDataWriteCount: 0,
      residueObjectCount: 0,
      rawPayloadIncluded: false,
      secretMaterialIncluded: false,
      lastGoodGenerationBefore: before.servingStateSha256,
      lastGoodGenerationAfter: cleaned.servingStateSha256,
      expectedCheckpointSha256: checkpointSha256,
      recoveredCheckpointSha256: checkpointSha256,
      expectedEvidenceSha256: receipt.contentSha256,
      readBackEvidenceSha256: receipt.contentSha256,
      retryBoundaryAt: rateLimitedAt,
      firstRetryAt: retryAt,
      catchUpStarted: true,
      catchUpCompleted: true,
      summary:
        "Retry-After blocked an early request, then the same synthetic checkpoint resumed and completed without changing last-good serving.",
      rateLimitedAt,
      retryAfterSeconds,
      attemptedRetryAt: Object.freeze([retryAt]),
    });
  };
}
