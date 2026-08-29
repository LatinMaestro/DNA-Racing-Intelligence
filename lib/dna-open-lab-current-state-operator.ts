import type { DnaCurrentStateAcquisitionGroup } from "./dna-open-lab-current-state-acquisition-cadence";
import type {
  DnaCurrentStateAcquisitionCycleCheckpointRepository,
  DnaCurrentStateAcquisitionEvidenceReceipt,
} from "./dna-open-lab-current-state-acquisition-runner";
import type { DnaOpenLabClientPool } from "./dna-open-lab-client-pool";
import {
  runDnaCurrentStateScheduledCycleStep,
  type DnaCurrentStateScheduledCycleStepResult,
} from "./dna-open-lab-current-state-cycle-coordinator";
import {
  runDnaCurrentStateDiscoveryStep,
  type DnaCurrentStateDiscoveryStepResult,
} from "./dna-open-lab-current-state-discovery-runner";
import type { DnaOpenLabStoredCurrentStateEvidence } from "./dna-open-lab-r2-current-state-evidence";
import type { DnaCurrentStateRequest } from "./dna-open-lab-current-state-sync-plan";
import type { DnaOpenLabResponse, DnaRaceMode } from "./dna-open-lab-v1-client";
import type { NeonDnaOpenLabSyncPublicationRepository } from "./neon-dna-open-lab-sync-publication";
import {
  evaluateDnaOpenLabZeroCostRefresh,
  type DnaOpenLabR2Usage,
  type DnaOpenLabZeroCostRefreshDecision,
} from "./dna-open-lab-zero-cost-refresh-policy";

export type DnaCurrentStateOperatorStepResult =
  | Readonly<{
      kind: "budget_blocked";
      budget: DnaOpenLabZeroCostRefreshDecision;
    }>
  | Readonly<{
      kind: "discovering";
      discovery: Extract<
        DnaCurrentStateDiscoveryStepResult,
        { kind: "discovering" }
      >;
    }>
  | Readonly<{
      kind: "scheduled";
      discovery: Extract<
        DnaCurrentStateDiscoveryStepResult,
        { kind: "final_plan_ready" }
      >;
      scheduled: DnaCurrentStateScheduledCycleStepResult;
    }>;

/**
 * One restart-safe operator boundary for dynamic discovery, bounded current
 * acquisition and exact publication. The discovery runner returns immediately
 * after any request, so continuing into scheduled acquisition can still issue
 * at most one API request across the whole invocation.
 */
export async function runDnaCurrentStateOperatorStep(input: {
  ownerId: string;
  cycleId: string;
  evaluatedAt: string;
  attemptedAt: string;
  recordedAt: string;
  acceptedAt: string;
  vault: string;
  spliceModes?: readonly DnaRaceMode[];
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
  currentR2Usage: DnaOpenLabR2Usage;
  plannedRefreshR2Usage: DnaOpenLabR2Usage;
}): Promise<DnaCurrentStateOperatorStepResult> {
  const budget = evaluateDnaOpenLabZeroCostRefresh({
    currentUsage: input.currentR2Usage,
    plannedRefreshUsage: input.plannedRefreshR2Usage,
  });
  if (!budget.allowed) {
    return Object.freeze({ kind: "budget_blocked", budget });
  }
  const discovery = await runDnaCurrentStateDiscoveryStep({
    cycleId: input.cycleId,
    evaluatedAt: input.evaluatedAt,
    attemptedAt: input.attemptedAt,
    vault: input.vault,
    ...(input.spliceModes === undefined
      ? {}
      : { spliceModes: input.spliceModes }),
    checkpointRepository: input.checkpointRepository,
    pool: input.pool,
    persistEvidence: input.persistEvidence,
    readEvidence: input.readEvidence,
    pauseLastGood: async (recovery) => {
      await input.publicationRepository.pause({
        ownerId: input.ownerId,
        ...recovery,
      });
    },
  });
  if (discovery.kind === "discovering") {
    return Object.freeze({ kind: "discovering", discovery });
  }

  const scheduled = await runDnaCurrentStateScheduledCycleStep({
    ownerId: input.ownerId,
    cycleId: input.cycleId,
    evaluatedAt: input.evaluatedAt,
    attemptedAt: input.attemptedAt,
    recordedAt: input.recordedAt,
    acceptedAt: input.acceptedAt,
    plan: discovery.plan,
    checkpointRepository: input.checkpointRepository,
    publicationRepository: input.publicationRepository,
    pool: input.pool,
    persistEvidence: input.persistEvidence,
    readEvidence: input.readEvidence,
  });
  return Object.freeze({ kind: "scheduled", discovery, scheduled });
}
