import type { CanonicalRaceDocumentMetadata } from "./dna-open-lab-v1-adapters";
import type {
  DnaPersistedApiOutcomeDurableSource,
  DnaRaceMergeOutcomeDurableSource,
} from "./dna-population-core-outcome-durable-sources";
import {
  planDnaPopulationCoreOutcomeGapAcquisition,
  type DnaPopulationCoreOutcomeGapPlan,
} from "./dna-population-core-outcome-gap-plan";
import {
  buildDnaPopulationCoreRaceLinkIndex,
  type DnaPopulationCoreRaceLink,
  type DnaPopulationCoreRaceLinkIndexBounds,
} from "./dna-population-core-race-link-index";
import type { RaceArchiveExternalSortedRunStore } from "./race-archive-external-sort";

export type DnaPopulationCoreOutcomeGapReconciliation = Readonly<{
  version: 1;
  status: "complete";
  raceAuthority: Readonly<{
    status: "complete_for_resolved_race_authority";
    raceDocumentCount: number;
    resolvedRaceCount: number;
    quarantinedRaceCount: number;
    linkedCoreCount: number;
    membershipCount: number;
    membershipSetSha256: string;
  }>;
  outcomeCoverage: DnaPopulationCoreOutcomeGapPlan;
  dnaProviderRequestCount: 0;
  persistentWritePerformed: false;
  paidUsageAllowed: false;
}>;

/**
 * Connects the canonical Race authority to the Race Merge-first outcome gap
 * planner. The supplied sources are already-opened durable read-only evidence;
 * this composition makes no DNA request and writes only disposable local
 * external-sort runs, which are always cleaned up.
 */
export async function reconcileDnaPopulationCoreOutcomeGap(input: {
  documents: AsyncIterable<CanonicalRaceDocumentMetadata>;
  scratchStore: RaceArchiveExternalSortedRunStore<DnaPopulationCoreRaceLink>;
  runPrefix: string;
  linkIndexBounds: DnaPopulationCoreRaceLinkIndexBounds;
  planBounds: Readonly<{
    maximumLinkedCores: number;
    maximumRequiredMemberships: number;
    maximumOutcomesPerSourcePerCore: number;
  }>;
  maximumConcurrentCoreLoads?: number;
  raceMergeSource: Pick<DnaRaceMergeOutcomeDurableSource, "loadOutcomes">;
  persistedApiSource: Pick<
    DnaPersistedApiOutcomeDurableSource,
    "loadOutcomes"
  > | null;
}): Promise<DnaPopulationCoreOutcomeGapReconciliation> {
  const index = await buildDnaPopulationCoreRaceLinkIndex({
    documents: input.documents,
    store: input.scratchStore,
    runPrefix: input.runPrefix,
    bounds: input.linkIndexBounds,
  });

  try {
    const outcomeCoverage =
      await planDnaPopulationCoreOutcomeGapAcquisition({
        linkedHistories: index.read(),
        loadRaceMergeOutcomes: input.raceMergeSource.loadOutcomes,
        loadPersistedApiOutcomes:
          input.persistedApiSource?.loadOutcomes ?? (async () => Object.freeze([])),
        bounds: input.planBounds,
        ...(input.maximumConcurrentCoreLoads === undefined
          ? {}
          : {
              maximumConcurrentCoreLoads:
                input.maximumConcurrentCoreLoads,
            }),
      });

    if (
      outcomeCoverage.linkedCoreCount !== index.linkedCoreCount ||
      outcomeCoverage.requiredMembershipCount !== index.membershipCount
    ) {
      throw new Error(
        "DNA population Core outcome reconciliation changed canonical membership coverage",
      );
    }

    return Object.freeze({
      version: 1 as const,
      status: "complete" as const,
      raceAuthority: Object.freeze({
        status: index.status,
        raceDocumentCount: index.raceDocumentCount,
        resolvedRaceCount: index.resolvedRaceCount,
        quarantinedRaceCount: index.quarantinedRaceCount,
        linkedCoreCount: index.linkedCoreCount,
        membershipCount: index.membershipCount,
        membershipSetSha256: index.membershipSetSha256,
      }),
      outcomeCoverage,
      dnaProviderRequestCount: 0 as const,
      persistentWritePerformed: false as const,
      paidUsageAllowed: false as const,
    });
  } finally {
    await index.cleanup();
  }
}
