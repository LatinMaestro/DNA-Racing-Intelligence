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
  acceptDnaCurrentStateCandidate,
  createInitialDnaLastGoodSyncState,
  pauseDnaCurrentStateSync,
  type DnaCurrentStateCandidate,
  type DnaCurrentStateFamily,
  type DnaLastGoodSyncState,
} from "./dna-open-lab-last-good-publication";
import type { DnaOpenLabP5ComponentRecoveryEvidence } from "./dna-open-lab-p5-component-recovery-executor";
import type { DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot } from "./dna-open-lab-p5-private-preview-recovery";
import {
  createDnaOpenLabP5RecoveryTemporaryEvidenceReader,
  createDnaOpenLabP5RecoveryTemporaryEvidenceSink,
  DNA_OPEN_LAB_P5_RECOVERY_TEMPORARY_EVIDENCE_AUTHORITY,
  type DnaOpenLabR2CurrentStateEvidenceReaderConfiguration,
  type DnaOpenLabR2CurrentStateEvidenceStoragePort,
} from "./dna-open-lab-r2-current-state-evidence";
import {
  DnaOpenLabApiError,
  type DnaOpenLabResponse,
} from "./dna-open-lab-v1-client";

type EligibilityLossEvidence = Extract<
  DnaOpenLabP5ComponentRecoveryEvidence,
  { caseId: "eligibility_loss" }
>;

export type DnaOpenLabP5EligibilityLossScenarioConfiguration = Readonly<{
  ownerId: string;
  bucketName: string;
  cycleId: string;
  eligibilityLostAt: string;
  storage: DnaOpenLabR2CurrentStateEvidenceStoragePort &
    DnaOpenLabR2CurrentStateEvidenceReaderConfiguration["storage"];
  inspectProviderSafety: () => Promise<DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot>;
  cleanupSyntheticCase: () => Promise<void>;
}>;

class EligibilityCheckpointRepository implements DnaCurrentStateAcquisitionCycleCheckpointRepository {
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
  throw new Error("DNA Open Lab P5 eligibility-loss scenario failed.");
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

function tierOnlySchedule(evaluatedAt: string) {
  const plan: DnaCurrentStateSyncPlan = Object.freeze({
    bootstrap: Object.freeze([
      Object.freeze({
        scope: "vault" as const,
        endpoint: "vault.tier_badge" as const,
        payload: Object.freeze({ vault: "p5-recovery-synthetic-vault" }),
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
  const tierRequests = scheduled.requestBatches
    .flat()
    .filter((entry) => entry.group === "vault_identity");
  return Object.freeze({
    ...scheduled,
    completionScope: "scheduled_requests_only" as const,
    dueGroups: Object.freeze(["vault_identity"] as const),
    requestBatches: Object.freeze([Object.freeze(tierRequests)]),
    scheduledRequestCount: tierRequests.length,
  });
}

function cachedEvidence(
  at: string,
): Record<DnaCurrentStateAcquisitionGroup, string> {
  return Object.fromEntries(
    DNA_CURRENT_STATE_ACQUISITION_GROUPS.map((group) => [group, at]),
  ) as Record<DnaCurrentStateAcquisitionGroup, string>;
}

function acceptedCandidate(input: {
  generationId: string;
  observedAt: string;
}): DnaCurrentStateCandidate {
  const families = Object.fromEntries(
    (
      [
        "vault",
        "cores",
        "active_races",
        "race_fills",
        "tokens",
        "splice_arena",
      ] as const satisfies readonly DnaCurrentStateFamily[]
    ).map((family) => [
      family,
      Object.freeze({ status: "complete" as const, itemCount: 1 }),
    ]),
  ) as Record<
    DnaCurrentStateFamily,
    Readonly<{ status: "complete"; itemCount: number }>
  >;
  return Object.freeze({
    generationId: input.generationId,
    observedAt: input.observedAt,
    families: Object.freeze(families),
  });
}

function ineligiblePool(calls: { count: number }): DnaOpenLabClientPool {
  return Object.freeze({
    execute: async () => {
      calls.count += 1;
      throw new DnaOpenLabApiError({
        kind: "api_error",
        message: "synthetic TierBadge eligibility loss",
        httpStatus: 403,
        rateLimit: Object.freeze({
          limit: 30,
          remaining: 29,
          resetSeconds: 60,
          rateClass: "api_key",
          retryAfterSeconds: null,
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

function eligibilityEvidenceResponse(): DnaOpenLabResponse<unknown> {
  return Object.freeze({
    result: Object.freeze({ eligible: false, recoveryProbe: true }),
    httpStatus: 200,
    rateLimit: Object.freeze({
      limit: 30,
      remaining: 29,
      resetSeconds: 60,
      rateClass: "api_key",
      retryAfterSeconds: null,
    }),
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
 * Drives a synthetic TierBadge loss through the production bounded acquisition
 * runner and last-good state transition. The cycle pauses without a retry
 * boundary, keeps the accepted generation available, records catch-up as
 * pending and does not persist a response receipt. One recovery-only immutable
 * R2 marker is read back and removed to prove the connected cleanup boundary.
 */
export function createDnaOpenLabP5EligibilityLossScenario(
  configuration: DnaOpenLabP5EligibilityLossScenarioConfiguration,
): () => Promise<EligibilityLossEvidence> {
  return async () => {
    const eligibilityLostAt = timestamp(configuration.eligibilityLostAt);
    const priorObservedAt = new Date(
      Date.parse(eligibilityLostAt) - 1_000,
    ).toISOString();
    const before = await configuration.inspectProviderSafety();
    if (before.syntheticResidueObjectCount !== 0) scenarioError();

    const repository = new EligibilityCheckpointRepository();
    const schedule = tierOnlySchedule(eligibilityLostAt);
    let syncState: DnaLastGoodSyncState = acceptDnaCurrentStateCandidate({
      previous: createInitialDnaLastGoodSyncState(),
      candidate: acceptedCandidate({
        generationId: before.servingStateSha256,
        observedAt: priorObservedAt,
      }),
      acceptedAt: priorObservedAt,
    });
    const acceptedBefore = syncState.acceptedGenerationId;
    const servingBefore = syncState.servingGenerationId;
    const calls = { count: 0 };
    let persistEvidenceCount = 0;
    let pauseCount = 0;

    const paused = await runDnaCurrentStateAcquisitionStep({
      cycleId: configuration.cycleId,
      attemptedAt: eligibilityLostAt,
      schedule,
      checkpointRepository: repository,
      pool: ineligiblePool(calls),
      cachedEvidenceObservedAt: cachedEvidence(priorObservedAt),
      persistEvidence: async () => {
        persistEvidenceCount += 1;
        return scenarioError();
      },
      pauseLastGood: async (recovery) => {
        pauseCount += 1;
        syncState = pauseDnaCurrentStateSync({
          previous: syncState,
          reason: recovery.reason,
          attemptedAt: recovery.attemptedAt,
          retryAfterSeconds: recovery.retryAfterSeconds,
        });
      },
    });
    if (paused.kind !== "paused") scenarioError();

    const destructiveResetCount = [
      syncState.acceptedGenerationId !== acceptedBefore,
      syncState.servingGenerationId !== servingBefore,
      syncState.acceptedObservedAt === null,
      syncState.acceptedAt === null,
      paused.stored.checkpoint.receipts.length !== 0,
    ].filter(Boolean).length;
    if (
      paused.reason !== "api_ineligible" ||
      paused.retryNotBefore !== null ||
      paused.stored.checkpoint.status !== "paused" ||
      paused.stored.checkpoint.pauseReason !== "api_ineligible" ||
      calls.count !== 1 ||
      persistEvidenceCount !== 0 ||
      pauseCount !== 1 ||
      syncState.syncStatus !== "paused" ||
      !syncState.catchUpRequired ||
      syncState.lastInterruption?.reason !== "api_ineligible" ||
      destructiveResetCount !== 0
    ) {
      scenarioError();
    }

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
    const request = Object.freeze({
      scope: "vault" as const,
      endpoint: "vault.tier_badge" as const,
      payload: Object.freeze({ vault: "p5-recovery-synthetic-vault" }),
    });
    const requestKey = sha256({
      caseId: "eligibility_loss",
      cycleId: configuration.cycleId,
      request,
    });
    const receipt = await sink({
      cycleId: configuration.cycleId,
      group: "vault_identity",
      requestKey,
      request,
      response: eligibilityEvidenceResponse(),
      observedAt: eligibilityLostAt,
    });
    const readBack = await reader({
      cycleId: configuration.cycleId,
      receipt,
    });
    if (
      readBack.requestKey !== requestKey ||
      (readBack.response.result as { eligible?: unknown }).eligible !== false ||
      (await configuration.inspectProviderSafety())
        .syntheticResidueObjectCount !== 1
    ) {
      scenarioError();
    }

    const checkpointSha256 = sha256(paused.stored);
    await configuration.cleanupSyntheticCase();
    const cleaned = await configuration.inspectProviderSafety();
    assertUnchangedProviderState(before, cleaned);

    return Object.freeze({
      caseId: "eligibility_loss",
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
      retryBoundaryAt: eligibilityLostAt,
      firstRetryAt: eligibilityLostAt,
      catchUpStarted: false,
      catchUpCompleted: false,
      summary:
        "TierBadge eligibility loss paused the production acquisition state without a destructive reset; cached last-good serving remained available and catch-up stayed pending.",
      syncStateAfter: syncState.syncStatus,
      destructiveResetCount,
      cachedServingGeneration: syncState.servingGenerationId,
    });
  };
}
