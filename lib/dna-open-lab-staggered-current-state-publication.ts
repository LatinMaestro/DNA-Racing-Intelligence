import {
  DNA_CURRENT_STATE_ACQUISITION_GROUPS,
  createDnaCurrentStateAcquisitionSchedule,
  type DnaCurrentStateAcquisitionSchedule,
} from "./dna-open-lab-current-state-acquisition-cadence";
import type {
  DnaCurrentStateAcquisitionCycleCheckpoint,
  DnaCurrentStateAcquisitionEvidenceReceipt,
} from "./dna-open-lab-current-state-acquisition-runner";
import {
  createDnaCurrentStateEvidenceIndex,
  type DnaCurrentStateEvidenceIndex,
} from "./dna-open-lab-current-state-evidence-index";
import {
  assembleDnaCurrentStatePublication,
  type DnaCurrentStatePublicationAssembly,
} from "./dna-open-lab-current-state-publication-runner";
import type { DnaOpenLabStoredCurrentStateEvidence } from "./dna-open-lab-r2-current-state-evidence";
import type { DnaCurrentStateSyncPlan } from "./dna-open-lab-current-state-sync-plan";
import type { NeonDnaOpenLabSyncPublicationRepository } from "./neon-dna-open-lab-sync-publication";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";

function staggeredError(message: string): never {
  throw new Error(
    `DNA Open Lab staggered current-state publication: ${message}`,
  );
}

function requestKey(entry: {
  group: string;
  request: Readonly<Record<string, unknown>>;
}): string {
  return dnaOpenLabRawEvidenceSha256({
    group: entry.group,
    request: entry.request,
  });
}

function replayAuthority(input: {
  plan: DnaCurrentStateSyncPlan;
  index: DnaCurrentStateEvidenceIndex;
}): {
  schedule: DnaCurrentStateAcquisitionSchedule;
  checkpoint: DnaCurrentStateAcquisitionCycleCheckpoint;
  sourceCycleByRequestKey: ReadonlyMap<string, string>;
} {
  const replayAt = input.index.receipts
    .map((receipt) => receipt.observedAt)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
  if (replayAt === undefined) {
    staggeredError("receipt index is empty");
  }
  const schedule = createDnaCurrentStateAcquisitionSchedule({
    evaluatedAt: replayAt,
    plan: input.plan,
  });
  const scheduled = schedule.requestBatches.flat();
  const scheduledKeys = scheduled.map(requestKey);
  if (
    schedule.completionScope !== "all_current_state" ||
    JSON.stringify(schedule.dueGroups) !==
      JSON.stringify(DNA_CURRENT_STATE_ACQUISITION_GROUPS) ||
    scheduled.length !== input.index.receipts.length ||
    dnaOpenLabRawEvidenceSha256({ requests: scheduled }) !==
      input.index.planSha256 ||
    JSON.stringify(scheduledKeys) !==
      JSON.stringify(input.index.receipts.map((receipt) => receipt.requestKey))
  ) {
    staggeredError("receipt index does not reconstruct the full plan");
  }
  const receipts = Object.freeze(
    input.index.receipts.map((receipt) =>
      Object.freeze({
        requestKey: receipt.requestKey,
        observedAt: receipt.observedAt,
        contentSha256: receipt.contentSha256,
        evidenceObjectKey: receipt.evidenceObjectKey,
      }),
    ),
  );
  return Object.freeze({
    schedule,
    checkpoint: Object.freeze({
      version: 1,
      cycleId: input.index.generationId,
      evaluatedAt: schedule.evaluatedAt,
      scheduleSha256: dnaOpenLabRawEvidenceSha256({
        evaluatedAt: schedule.evaluatedAt,
        completionScope: schedule.completionScope,
        dueGroups: schedule.dueGroups,
        requests: scheduled,
      }),
      status: "ready_to_publish",
      scheduledRequestKeys: Object.freeze(scheduledKeys),
      receipts,
      completedGroups: DNA_CURRENT_STATE_ACQUISITION_GROUPS,
      pauseReason: null,
      retryNotBefore: null,
    }),
    sourceCycleByRequestKey: new Map(
      input.index.receipts.map((receipt) => [
        receipt.requestKey,
        receipt.cycleId,
      ]),
    ),
  });
}

/** Reconstructs every family from current and carried immutable receipts. */
export async function assembleDnaStaggeredCurrentStatePublication(input: {
  plan: DnaCurrentStateSyncPlan;
  schedule: DnaCurrentStateAcquisitionSchedule;
  checkpoint: DnaCurrentStateAcquisitionCycleCheckpoint;
  priorIndex: DnaCurrentStateEvidenceIndex;
  indexedAt: string;
  validatedAt: string;
  readEvidence: (input: {
    cycleId: string;
    receipt: DnaCurrentStateAcquisitionEvidenceReceipt;
  }) => Promise<DnaOpenLabStoredCurrentStateEvidence>;
}): Promise<{
  assembly: DnaCurrentStatePublicationAssembly;
  evidenceIndex: DnaCurrentStateEvidenceIndex;
}> {
  if (
    input.schedule.dueGroups.length < 1 ||
    input.schedule.dueGroups.length >=
      DNA_CURRENT_STATE_ACQUISITION_GROUPS.length
  ) {
    staggeredError("schedule must contain a proper non-empty due-group subset");
  }
  const evidenceIndex = createDnaCurrentStateEvidenceIndex({
    plan: input.plan,
    schedule: input.schedule,
    checkpoint: input.checkpoint,
    prior: input.priorIndex,
    indexedAt: input.indexedAt,
  });
  const replay = replayAuthority({ plan: input.plan, index: evidenceIndex });
  const assembly = await assembleDnaCurrentStatePublication({
    cycleId: evidenceIndex.generationId,
    schedule: replay.schedule,
    checkpoint: replay.checkpoint,
    validatedAt: input.validatedAt,
    readEvidence: input.readEvidence,
    receiptSourceCycleId(receipt) {
      return (
        replay.sourceCycleByRequestKey.get(receipt.requestKey) ??
        staggeredError("receipt source cycle is unavailable")
      );
    },
  });
  return Object.freeze({ assembly, evidenceIndex });
}

/** Publishes one mixed-cycle generation through the indexed atomic repository. */
export async function publishDnaStaggeredCurrentStateAcquisitionCycle(input: {
  ownerId: string;
  plan: DnaCurrentStateSyncPlan;
  schedule: DnaCurrentStateAcquisitionSchedule;
  checkpoint: DnaCurrentStateAcquisitionCycleCheckpoint;
  validatedAt: string;
  recordedAt: string;
  acceptedAt: string;
  readEvidence: (input: {
    cycleId: string;
    receipt: DnaCurrentStateAcquisitionEvidenceReceipt;
  }) => Promise<DnaOpenLabStoredCurrentStateEvidence>;
  publicationRepository: NeonDnaOpenLabSyncPublicationRepository;
}) {
  const priorIndex =
    await input.publicationRepository.readServingCurrentStateEvidenceIndex({
      ownerId: input.ownerId,
      validatedAt: input.validatedAt,
    });
  if (priorIndex === null) {
    staggeredError("serving last-good receipt index is unavailable");
  }
  const { assembly, evidenceIndex } =
    await assembleDnaStaggeredCurrentStatePublication({
      ...input,
      priorIndex,
      indexedAt: input.recordedAt,
    });
  return input.publicationRepository.publishCandidate({
    ownerId: input.ownerId,
    recordedAt: input.recordedAt,
    acceptedAt: input.acceptedAt,
    evidenceIndex,
    ...assembly,
  });
}
