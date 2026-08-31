import { createHash } from "node:crypto";

import {
  createDnaCurrentStateAcquisitionSchedule,
  DNA_CURRENT_STATE_ACQUISITION_GROUPS,
} from "./dna-open-lab-current-state-acquisition-cadence";
import type { DnaCurrentStateAcquisitionCycleCheckpoint } from "./dna-open-lab-current-state-acquisition-runner";
import {
  createDnaCurrentStateScheduledCycleAuthority,
  dnaCurrentStatePublicationMode,
} from "./dna-open-lab-current-state-cycle-coordinator";
import { createDnaCurrentStateEvidenceIndex } from "./dna-open-lab-current-state-evidence-index";
import type { DnaOpenLabP5ComponentRecoveryEvidence } from "./dna-open-lab-p5-component-recovery-executor";
import type { DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot } from "./dna-open-lab-p5-private-preview-recovery";
import { createDnaCurrentStateSyncPlan } from "./dna-open-lab-current-state-sync-plan";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";

type DynamicPlanDriftEvidence = Extract<
  DnaOpenLabP5ComponentRecoveryEvidence,
  { caseId: "dynamic_plan_drift" }
>;

export type DnaOpenLabP5DynamicPlanDriftScenarioConfiguration = Readonly<{
  cycleId: string;
  indexedAt: string;
  evaluatedAt: string;
  inspectProviderSafety: () => Promise<DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot>;
  cleanupSyntheticCase: () => Promise<void>;
}>;

function scenarioError(): never {
  throw new Error("DNA Open Lab P5 dynamic-plan-drift scenario failed.");
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

function priorAuthority(input: { cycleId: string; indexedAt: string }) {
  const plan = createDnaCurrentStateSyncPlan({
    vault: "p5-recovery-plan-vault",
    ownedCoreIds: [101],
    activeRaceIds: ["race-1"],
    spliceModes: ["bike"],
    spliceArenaPagesByMode: { bike: [1] },
  });
  const schedule = createDnaCurrentStateAcquisitionSchedule({
    evaluatedAt: input.indexedAt,
    plan,
  });
  if (schedule.status !== "ready") scenarioError();
  const entries = schedule.requestBatches.flat();
  const requestKey = (offset: number) =>
    dnaOpenLabRawEvidenceSha256({
      group: entries[offset]!.group,
      request: entries[offset]!.request,
    });
  const checkpoint: DnaCurrentStateAcquisitionCycleCheckpoint = Object.freeze({
    version: 1,
    cycleId: input.cycleId,
    evaluatedAt: input.indexedAt,
    scheduleSha256: dnaOpenLabRawEvidenceSha256({
      evaluatedAt: input.indexedAt,
      completionScope: schedule.completionScope,
      dueGroups: schedule.dueGroups,
      requests: entries,
    }),
    status: "ready_to_publish",
    scheduledRequestKeys: Object.freeze(
      entries.map((_, offset) => requestKey(offset)),
    ),
    receipts: Object.freeze(
      entries.map((_, offset) => ({
        requestKey: requestKey(offset),
        observedAt: input.indexedAt,
        contentSha256: sha256({ offset }),
        evidenceObjectKey: `private/${input.cycleId}/${requestKey(offset)}.json`,
      })),
    ),
    completedGroups: DNA_CURRENT_STATE_ACQUISITION_GROUPS,
    pauseReason: null,
    retryNotBefore: null,
  });
  return {
    plan,
    index: createDnaCurrentStateEvidenceIndex({
      plan,
      schedule,
      checkpoint,
      prior: null,
      indexedAt: input.indexedAt,
    }),
  };
}

/**
 * Exercises owner-Core, active-race and Arena-page changes independently, then
 * together, against the production scheduled-cycle authority. Every changed
 * plan must discard the prior receipt cache and require all recurring groups.
 */
export function createDnaOpenLabP5DynamicPlanDriftScenario(
  configuration: DnaOpenLabP5DynamicPlanDriftScenarioConfiguration,
): () => Promise<DynamicPlanDriftEvidence> {
  return async () => {
    const indexedAt = timestamp(configuration.indexedAt);
    const evaluatedAt = timestamp(configuration.evaluatedAt);
    if (Date.parse(evaluatedAt) <= Date.parse(indexedAt)) scenarioError();
    const before = await configuration.inspectProviderSafety();
    if (before.syntheticResidueObjectCount !== 0) scenarioError();

    const prior = priorAuthority({
      cycleId: configuration.cycleId,
      indexedAt,
    });
    const changedPlans = [
      createDnaCurrentStateSyncPlan({
        vault: "p5-recovery-plan-vault",
        ownedCoreIds: [101, 202],
        activeRaceIds: ["race-1"],
        spliceModes: ["bike"],
        spliceArenaPagesByMode: { bike: [1] },
      }),
      createDnaCurrentStateSyncPlan({
        vault: "p5-recovery-plan-vault",
        ownedCoreIds: [101],
        activeRaceIds: ["race-1", "race-2"],
        spliceModes: ["bike"],
        spliceArenaPagesByMode: { bike: [1] },
      }),
      createDnaCurrentStateSyncPlan({
        vault: "p5-recovery-plan-vault",
        ownedCoreIds: [101],
        activeRaceIds: ["race-1"],
        spliceModes: ["bike"],
        spliceArenaPagesByMode: { bike: [1, 2] },
      }),
      createDnaCurrentStateSyncPlan({
        vault: "p5-recovery-plan-vault",
        ownedCoreIds: [101, 202],
        activeRaceIds: ["race-1", "race-2"],
        spliceModes: ["bike"],
        spliceArenaPagesByMode: { bike: [1, 2] },
      }),
    ] as const;

    let cachedReceiptReuseCount = 0;
    for (const plan of changedPlans) {
      const authority = createDnaCurrentStateScheduledCycleAuthority({
        evaluatedAt,
        plan,
        priorIndex: prior.index,
      });
      cachedReceiptReuseCount += Object.keys(
        authority.cachedEvidenceObservedAt,
      ).length;
      if (
        authority.schedule.status !== "ready" ||
        authority.schedule.completionScope !== "all_current_state" ||
        authority.schedule.dueGroups.length !==
          DNA_CURRENT_STATE_ACQUISITION_GROUPS.length ||
        !DNA_CURRENT_STATE_ACQUISITION_GROUPS.every((group) =>
          authority.schedule.dueGroups.includes(group),
        ) ||
        dnaCurrentStatePublicationMode(authority.schedule) !== "full"
      ) {
        scenarioError();
      }
    }

    const replacement = createDnaCurrentStateAcquisitionSchedule({
      evaluatedAt,
      plan: changedPlans[3],
    });
    const currentPlanSha256 = dnaOpenLabRawEvidenceSha256({
      requests: replacement.requestBatches.flat(),
    });
    if (
      cachedReceiptReuseCount !== 0 ||
      currentPlanSha256 === prior.index.planSha256
    ) {
      scenarioError();
    }

    await configuration.cleanupSyntheticCase();
    const after = await configuration.inspectProviderSafety();
    assertProviderStateUnchanged(before, after);

    const evidenceSha256 = sha256(prior.index.receipts);
    return Object.freeze({
      caseId: "dynamic_plan_drift" as const,
      apiRequestCount: 0,
      syntheticProviderWriteCount: 0,
      persistentOwnerDataWriteCount: 0 as const,
      residueObjectCount: 0 as const,
      rawPayloadIncluded: false as const,
      secretMaterialIncluded: false as const,
      lastGoodGenerationBefore: before.servingStateSha256,
      lastGoodGenerationAfter: after.servingStateSha256,
      expectedCheckpointSha256: prior.index.planSha256,
      recoveredCheckpointSha256: prior.index.planSha256,
      expectedEvidenceSha256: evidenceSha256,
      readBackEvidenceSha256: evidenceSha256,
      retryBoundaryAt: evaluatedAt,
      firstRetryAt: evaluatedAt,
      catchUpStarted: true,
      catchUpCompleted: true,
      checkpointPlanSha256: prior.index.planSha256,
      currentPlanSha256,
      cachedReceiptReuseCount,
      replacementCycleStarted: replacement.status === "ready",
      summary:
        "Ownership, active-race and Arena plan drift discarded all cached receipts and required one complete replacement cycle.",
    });
  };
}
