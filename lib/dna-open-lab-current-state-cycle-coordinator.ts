import {
  createDnaCurrentStateAcquisitionSchedule,
  DNA_CURRENT_STATE_ACQUISITION_GROUPS,
  type DnaCurrentStateAcquisitionCheckpoint,
  type DnaCurrentStateAcquisitionGroup,
  type DnaCurrentStateAcquisitionSchedule,
} from "./dna-open-lab-current-state-acquisition-cadence";
import {
  runDnaCurrentStateAcquisitionStep,
  type DnaCurrentStateAcquisitionCycleCheckpointRepository,
  type DnaCurrentStateAcquisitionEvidenceReceipt,
  type DnaCurrentStateAcquisitionStepResult,
} from "./dna-open-lab-current-state-acquisition-runner";
import type { DnaOpenLabClientPool } from "./dna-open-lab-client-pool";
import {
  validateDnaCurrentStateEvidenceIndex,
  type DnaCurrentStateEvidenceIndex,
} from "./dna-open-lab-current-state-evidence-index";
import { publishDnaCurrentStateAcquisitionCycle } from "./dna-open-lab-current-state-publication-runner";
import type { DnaOpenLabStoredCurrentStateEvidence } from "./dna-open-lab-r2-current-state-evidence";
import { publishDnaStaggeredCurrentStateAcquisitionCycle } from "./dna-open-lab-staggered-current-state-publication";
import type {
  DnaCurrentStateRequest,
  DnaCurrentStateSyncPlan,
} from "./dna-open-lab-current-state-sync-plan";
import type { DnaOpenLabResponse } from "./dna-open-lab-v1-client";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";
import type { DnaLastGoodSyncState } from "./dna-open-lab-last-good-publication";
import type { NeonDnaOpenLabSyncPublicationRepository } from "./neon-dna-open-lab-sync-publication";

export type DnaCurrentStatePublicationMode = "full" | "staggered";

export type DnaCurrentStateScheduledCycleAuthority = Readonly<{
  schedule: DnaCurrentStateAcquisitionSchedule;
  cachedEvidenceObservedAt: Readonly<
    Partial<Record<DnaCurrentStateAcquisitionGroup, string>>
  >;
}>;

export type DnaCurrentStateScheduledCycleStepResult =
  | Readonly<{
      kind: "idle" | "retry_blocked";
      nextEvaluationAt: string;
    }>
  | Readonly<{
      kind: "acquiring";
      publicationMode: DnaCurrentStatePublicationMode;
      step: DnaCurrentStateAcquisitionStepResult;
    }>
  | Readonly<{
      kind: "published";
      publicationMode: DnaCurrentStatePublicationMode;
      state: DnaLastGoodSyncState;
    }>;

function fullPlanSha256(
  plan: DnaCurrentStateSyncPlan,
  evaluatedAt: string,
): string {
  const full = createDnaCurrentStateAcquisitionSchedule({ evaluatedAt, plan });
  return dnaOpenLabRawEvidenceSha256({
    requests: full.requestBatches.flat(),
  });
}

function latestReceiptByGroup(
  index: DnaCurrentStateEvidenceIndex,
): Partial<Record<DnaCurrentStateAcquisitionGroup, string>> {
  const result: Partial<Record<DnaCurrentStateAcquisitionGroup, string>> = {};
  for (const receipt of index.receipts) {
    const current = result[receipt.group];
    if (
      current === undefined ||
      Date.parse(receipt.observedAt) > Date.parse(current)
    ) {
      result[receipt.group] = receipt.observedAt;
    }
  }
  return result;
}

/**
 * Derives cadence only from the serving last-good index. Plan drift forces a
 * full cycle, so cached receipts can never be applied to a changed ownership,
 * race or Arena request set.
 */
export function createDnaCurrentStateScheduledCycleAuthority(input: {
  evaluatedAt: string;
  plan: DnaCurrentStateSyncPlan;
  priorIndex: DnaCurrentStateEvidenceIndex | null;
}): DnaCurrentStateScheduledCycleAuthority {
  let cachedEvidenceObservedAt: Partial<
    Record<DnaCurrentStateAcquisitionGroup, string>
  > = {};
  let checkpoints:
    | Partial<
        Record<
          DnaCurrentStateAcquisitionGroup,
          DnaCurrentStateAcquisitionCheckpoint
        >
      >
    | undefined;

  if (
    input.priorIndex !== null &&
    input.priorIndex.planSha256 ===
      fullPlanSha256(input.plan, input.evaluatedAt)
  ) {
    const prior = validateDnaCurrentStateEvidenceIndex({
      index: input.priorIndex,
      plan: input.plan,
      validatedAt: input.evaluatedAt,
    });
    cachedEvidenceObservedAt = latestReceiptByGroup(prior);
    checkpoints = Object.fromEntries(
      Object.entries(cachedEvidenceObservedAt).map(([group, completedAt]) => [
        group,
        { completedAt },
      ]),
    );
  }

  return Object.freeze({
    schedule: createDnaCurrentStateAcquisitionSchedule({
      evaluatedAt: input.evaluatedAt,
      plan: input.plan,
      ...(checkpoints === undefined ? {} : { checkpoints }),
    }),
    cachedEvidenceObservedAt: Object.freeze(cachedEvidenceObservedAt),
  });
}

export function dnaCurrentStatePublicationMode(
  schedule: DnaCurrentStateAcquisitionSchedule,
): DnaCurrentStatePublicationMode {
  if (schedule.status !== "ready" || schedule.dueGroups.length < 1) {
    throw new Error(
      "DNA Open Lab current-state cycle coordinator: publication requires a ready schedule",
    );
  }
  return schedule.dueGroups.length ===
    DNA_CURRENT_STATE_ACQUISITION_GROUPS.length
    ? "full"
    : "staggered";
}

/**
 * Advances one durable scheduled cycle step. Each invocation makes at most one
 * API request through the bounded pool. API interruptions are recorded by both
 * the compare-and-swap cycle checkpoint and last-good publication state. A
 * ready cycle selects full or staggered reconstruction and publishes once.
 */
export async function runDnaCurrentStateScheduledCycleStep(input: {
  ownerId: string;
  cycleId: string;
  evaluatedAt: string;
  attemptedAt: string;
  recordedAt: string;
  acceptedAt: string;
  plan: DnaCurrentStateSyncPlan;
  checkpointRepository: DnaCurrentStateAcquisitionCycleCheckpointRepository;
  publicationRepository: NeonDnaOpenLabSyncPublicationRepository;
  pool: DnaOpenLabClientPool;
  persistEvidence: (input: {
    cycleId: string;
    group: DnaCurrentStateAcquisitionGroup;
    requestKey: string;
    request: DnaCurrentStateRequest;
    response: DnaOpenLabResponse<unknown>;
    observedAt: string;
  }) => Promise<DnaCurrentStateAcquisitionEvidenceReceipt>;
  readEvidence: (input: {
    cycleId: string;
    receipt: DnaCurrentStateAcquisitionEvidenceReceipt;
  }) => Promise<DnaOpenLabStoredCurrentStateEvidence>;
}): Promise<DnaCurrentStateScheduledCycleStepResult> {
  const priorIndex =
    await input.publicationRepository.readServingCurrentStateEvidenceIndex({
      ownerId: input.ownerId,
      validatedAt: input.attemptedAt,
    });
  const authority = createDnaCurrentStateScheduledCycleAuthority({
    evaluatedAt: input.evaluatedAt,
    plan: input.plan,
    priorIndex,
  });
  if (authority.schedule.status !== "ready") {
    return Object.freeze({
      kind: authority.schedule.status,
      nextEvaluationAt: authority.schedule.nextEvaluationAt,
    });
  }

  const publicationMode = dnaCurrentStatePublicationMode(authority.schedule);
  const step = await runDnaCurrentStateAcquisitionStep({
    cycleId: input.cycleId,
    attemptedAt: input.attemptedAt,
    schedule: authority.schedule,
    checkpointRepository: input.checkpointRepository,
    pool: input.pool,
    persistEvidence: input.persistEvidence,
    cachedEvidenceObservedAt: authority.cachedEvidenceObservedAt,
    pauseLastGood: async (recovery) => {
      await input.publicationRepository.pause({
        ownerId: input.ownerId,
        ...recovery,
      });
    },
  });
  if (step.kind !== "ready_to_publish") {
    return Object.freeze({ kind: "acquiring", publicationMode, step });
  }

  const common = {
    ownerId: input.ownerId,
    cycleId: input.cycleId,
    schedule: authority.schedule,
    checkpoint: step.stored.checkpoint,
    validatedAt: input.attemptedAt,
    recordedAt: input.recordedAt,
    acceptedAt: input.acceptedAt,
    readEvidence: input.readEvidence,
    publicationRepository: input.publicationRepository,
  } as const;
  const state =
    publicationMode === "full"
      ? await publishDnaCurrentStateAcquisitionCycle(common)
      : await publishDnaStaggeredCurrentStateAcquisitionCycle({
          ...common,
          plan: input.plan,
        });
  return Object.freeze({ kind: "published", publicationMode, state });
}
