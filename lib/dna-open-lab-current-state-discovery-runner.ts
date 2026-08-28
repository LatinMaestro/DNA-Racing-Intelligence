import { createHash } from "node:crypto";

import {
  assembleDnaCurrentStateSyncPlan,
  type DnaCurrentStateIdentityObservation,
} from "./dna-open-lab-current-state-plan-assembler";
import {
  DNA_CURRENT_STATE_ACQUISITION_GROUPS,
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
import type { DnaOpenLabStoredCurrentStateEvidence } from "./dna-open-lab-r2-current-state-evidence";
import { DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE } from "./dna-open-lab-request-budget";
import {
  createDnaCurrentStateSyncPlan,
  DNA_CURRENT_STATE_MAXIMUM_SCHEDULED_REQUESTS,
  type DnaCurrentStateRequest,
  type DnaCurrentStateSyncPlan,
} from "./dna-open-lab-current-state-sync-plan";
import type { DnaOpenLabResponse, DnaRaceMode } from "./dna-open-lab-v1-client";
import type { DnaSyncInterruptionReason } from "./dna-open-lab-last-good-publication";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type DiscoveryRequestEndpoint =
  "vault.cores_full" | "races.active" | "splice.arena";

export type DnaCurrentStateDiscoveryStepResult =
  | Readonly<{
      kind: "discovering";
      round: number;
      discoveryCycleId: string;
      step: DnaCurrentStateAcquisitionStepResult;
    }>
  | Readonly<{
      kind: "final_plan_ready";
      discoveryRoundCount: number;
      evidenceReceiptCount: number;
      ownedCoreIds: readonly number[];
      activeRaceIds: readonly string[];
      plan: DnaCurrentStateSyncPlan;
    }>;

function discoveryError(message: string): never {
  throw new Error(`DNA Open Lab current-state discovery runner: ${message}`);
}

function parentCycleId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) discoveryError("cycleId is invalid");
  return normalized;
}

function discoveryCycleId(cycleId: string, round: number): string {
  const hex = createHash("sha256")
    .update(`dna-current-state-discovery\u0000${cycleId}\u0000${round}`, "utf8")
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8).join(""),
    hex.slice(8, 12).join(""),
    hex.slice(12, 16).join(""),
    hex.slice(16, 20).join(""),
    hex.slice(20).join(""),
  ].join("-");
}

function groupForRequest(
  request: DnaCurrentStateRequest,
): DnaCurrentStateAcquisitionGroup {
  switch (request.endpoint as DiscoveryRequestEndpoint) {
    case "vault.cores_full":
      return "vault_identity";
    case "races.active":
      return "race_activity";
    case "splice.arena":
      return "splice_arena";
    default:
      return discoveryError("request is outside dynamic identity discovery");
  }
}

function discoverySchedule(input: {
  evaluatedAt: string;
  requests: readonly DnaCurrentStateRequest[];
}): DnaCurrentStateAcquisitionSchedule {
  if (
    input.requests.length < 1 ||
    input.requests.length > DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE
  ) {
    discoveryError("one discovery round must fit one aggregate request batch");
  }
  const scheduled = Object.freeze(
    input.requests.map((request) =>
      Object.freeze({ group: groupForRequest(request), request }),
    ),
  );
  const groupSet = new Set(scheduled.map((entry) => entry.group));
  const dueGroups = Object.freeze(
    DNA_CURRENT_STATE_ACQUISITION_GROUPS.filter((group) => groupSet.has(group)),
  );
  return Object.freeze({
    evaluatedAt: input.evaluatedAt,
    status: "ready",
    completionScope: "scheduled_requests_only",
    maximumAggregateRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
    dueGroups,
    requestBatches: Object.freeze([scheduled]),
    scheduledRequestCount: scheduled.length,
    nextEvaluationAt: input.evaluatedAt,
    onDemandPairRequestCount: 0,
  });
}

function bootstrapRequests(input: {
  vault: string;
  spliceModes: readonly DnaRaceMode[] | undefined;
}): readonly DnaCurrentStateRequest[] {
  const bootstrap = createDnaCurrentStateSyncPlan({
    vault: input.vault,
    ...(input.spliceModes === undefined
      ? {}
      : { spliceModes: input.spliceModes }),
  }).bootstrap;
  return Object.freeze(
    bootstrap.filter(
      (request) =>
        request.endpoint === "vault.cores_full" ||
        request.endpoint === "races.active" ||
        request.endpoint === "splice.arena",
    ),
  );
}

function identityObservation(
  value: DnaOpenLabStoredCurrentStateEvidence,
  expectedCycleId: string,
  receipt: DnaCurrentStateAcquisitionEvidenceReceipt,
): DnaCurrentStateIdentityObservation {
  if (
    value.cycleId !== expectedCycleId ||
    value.requestKey !== receipt.requestKey ||
    value.observedAt !== receipt.observedAt ||
    value.group !== groupForRequest(value.request)
  ) {
    discoveryError("stored evidence does not match its discovery receipt");
  }
  return Object.freeze({
    request: value.request,
    response: value.response,
    observedAt: value.observedAt,
  });
}

/**
 * Advances a durable dynamic-discovery workflow by at most one API request.
 * Bootstrap and each Arena continuation round use deterministic child cycle
 * identifiers, the existing compare-and-swap checkpoint repository and the
 * immutable evidence sink. On restart, completed rounds are read and verified
 * from evidence before the pure assembler decides the next page or final plan.
 *
 * The returned plan has not been acquired or published. It is the immutable
 * input for the normal cadence and bounded publication runner.
 */
export async function runDnaCurrentStateDiscoveryStep(input: {
  cycleId: string;
  evaluatedAt: string;
  attemptedAt: string;
  vault: string;
  spliceModes?: readonly DnaRaceMode[];
  checkpointRepository: DnaCurrentStateAcquisitionCycleCheckpointRepository;
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
  pauseLastGood: (input: {
    reason: DnaSyncInterruptionReason;
    attemptedAt: string;
    retryAfterSeconds: number | null;
  }) => Promise<void>;
}): Promise<DnaCurrentStateDiscoveryStepResult> {
  const rootCycleId = parentCycleId(input.cycleId);
  const observations: DnaCurrentStateIdentityObservation[] = [];
  let requests = bootstrapRequests({
    vault: input.vault,
    spliceModes: input.spliceModes,
  });
  let evidenceReceiptCount = 0;

  for (
    let round = 0;
    round < DNA_CURRENT_STATE_MAXIMUM_SCHEDULED_REQUESTS;
    round += 1
  ) {
    const childCycleId = discoveryCycleId(rootCycleId, round);
    const schedule = discoverySchedule({
      evaluatedAt: input.evaluatedAt,
      requests,
    });
    const step = await runDnaCurrentStateAcquisitionStep({
      cycleId: childCycleId,
      attemptedAt: input.attemptedAt,
      schedule,
      checkpointRepository: input.checkpointRepository,
      pool: input.pool,
      persistEvidence: input.persistEvidence,
      pauseLastGood: input.pauseLastGood,
    });

    if (step.kind !== "ready_to_publish") {
      if (step.kind === "awaiting_evidence") {
        discoveryError("a complete discovery round is missing evidence");
      }
      return Object.freeze({
        kind: "discovering",
        round,
        discoveryCycleId: childCycleId,
        step,
      });
    }

    const receipts = step.stored.checkpoint.receipts;
    evidenceReceiptCount += receipts.length;
    for (const receipt of receipts) {
      observations.push(
        identityObservation(
          await input.readEvidence({ cycleId: childCycleId, receipt }),
          childCycleId,
          receipt,
        ),
      );
    }

    const assembled = assembleDnaCurrentStateSyncPlan({
      vault: input.vault,
      observations,
      ...(input.spliceModes === undefined
        ? {}
        : { spliceModes: input.spliceModes }),
    });
    if (assembled.status === "ready") {
      if (assembled.plan === null) {
        discoveryError("ready assembly did not provide a final plan");
      }
      return Object.freeze({
        kind: "final_plan_ready",
        discoveryRoundCount: round + 1,
        evidenceReceiptCount,
        ownedCoreIds: assembled.ownedCoreIds,
        activeRaceIds: assembled.activeRaceIds,
        plan: assembled.plan,
      });
    }
    requests = assembled.continuationRequests;
  }

  return discoveryError("Arena discovery exceeded durable cycle capacity");
}
