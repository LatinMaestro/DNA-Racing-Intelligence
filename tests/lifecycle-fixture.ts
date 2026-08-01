import {
  lifecycleActions,
  type LifecycleAction,
  type LifecycleActionCoreInput,
  type LifecycleActionRankingInput,
  type LifecycleEvidenceVersions,
} from "@/domain/lifecycle-action-ranking";

export const versions: LifecycleEvidenceVersions = {
  configurationVersion: "lifecycle-config-v2",
  candidateSnapshotVersion: "candidate-v7",
  racingSnapshotVersion: "racing-v11",
  discoverySnapshotVersion: "discovery-v4",
  maidenSnapshotVersion: "maiden-v3",
  breedingSnapshotVersion: "breeding-v6",
  lineageSnapshotVersion: "lineage-v5",
  marketSnapshotVersion: "market-v8",
};

export function core(
  coreId = "synthetic-core",
  scores: Partial<Record<LifecycleAction, number>> = { race: 9_000 },
  overrides: Partial<LifecycleActionCoreInput> = {},
): LifecycleActionCoreInput {
  return {
    coreId,
    coreClass: "Morphed",
    activeOwnership: true,
    protectionStatus: "clear",
    evidenceCoverage: "complete",
    racingState: "credible",
    maidenState: "not_eligible",
    discoveryState: "complete",
    breedingState: "valuable",
    lineageState: "valuable",
    marketEvidence: "confirmed",
    costBasisStatus: "known",
    starEvidenceState: "supporting_positive",
    nonStarNegativeEvidencePresent: false,
    evidenceVersions: versions,
    actionEvidence: lifecycleActions.map((action) => ({
      action,
      supportStatus: "supported",
      scoreBasisPoints: scores[action] ?? 1_000,
      evidenceReasons: [`Synthetic ${action} evidence.`],
    })),
    ...overrides,
  };
}

export function ranking(
  overrides: Partial<LifecycleActionRankingInput> = {},
): LifecycleActionRankingInput {
  return {
    rankingId: "synthetic-ranking",
    rankingLabel: "Synthetic lifecycle review",
    ...versions,
    evaluatedAt: "2026-07-28T00:00:00.000Z",
    dataCurrentThrough: "2026-07-27T00:00:00.000Z",
    lastImported: "2026-07-28T00:00:00.000Z",
    freshness: "current",
    cores: [core()],
    ...overrides,
  };
}
