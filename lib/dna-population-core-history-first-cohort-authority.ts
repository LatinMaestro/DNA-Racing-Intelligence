import type { DnaPopulationCoreHistoryReadOnlyMeasurement } from "./dna-population-core-history-read-only-measurement";
import {
  DNA_POPULATION_CORE_HISTORY_READINESS_MAXIMUM_PAGES_PER_CORE,
  selectDnaPopulationCoreHistoryReadOnlySlice,
} from "./dna-population-core-history-read-only-measurement";
import type { DnaPopulationHistoryAcquisitionPlan } from "./dna-population-history-acquisition-plan";
import { DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE } from "./dna-open-lab-request-budget";

export const DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_AUTHORITY_VERSION =
  "dna-population-core-history-first-cohort-authority/v1" as const;
export const DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_CORE_COUNT = 1 as const;

const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;

export type DnaPopulationCoreHistoryFirstCohortAuthority = Readonly<{
  authorityVersion: typeof DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_AUTHORITY_VERSION;
  exactCodeHeadSha: string;
  cohortOrdinal: 0;
  cohortOffset: 0;
  coreIds: readonly [number];
  populationCoreCount: number;
  persistedPerformanceCoreCount: number;
  populationCoreSetSha256: string;
  persistedPerformanceCoreSetSha256: string;
  acquisitionCoreSetSha256: string;
  selectedCoreSetSha256: string;
  measurementSliceSha256: string;
  providerRequestCount: number;
  projectedPersistentR2Usage: DnaPopulationCoreHistoryReadOnlyMeasurement["projectedPersistentR2Usage"];
  populationUniverseCompleteness: DnaPopulationHistoryAcquisitionPlan["populationUniverseCompleteness"];
  unresolvedRaceCount: number;
  capacityPreflightRequired: true;
  providerReadAllowed: false;
  persistentWriteAllowed: false;
  paidUsageAllowed: false;
  previewOnly: true;
}>;

function authorityError(message: string): never {
  throw new Error(`Population Core history first cohort authority: ${message}`);
}

/**
 * Binds the fresh read-only readiness proof to exactly one deterministic
 * population Core. This is selection authority only: capacity must be checked
 * again immediately before a separately authorized connected write.
 */
export function createDnaPopulationCoreHistoryFirstCohortAuthority(input: {
  exactCodeHeadSha: string;
  plan: DnaPopulationHistoryAcquisitionPlan;
  measurement: DnaPopulationCoreHistoryReadOnlyMeasurement;
}): DnaPopulationCoreHistoryFirstCohortAuthority {
  const exactCodeHeadSha = input.exactCodeHeadSha.trim().toLowerCase();
  if (!COMMIT_PATTERN.test(exactCodeHeadSha)) {
    authorityError("exact main commit is invalid");
  }
  if (
    input.plan.populationCoreSetSha256 === null ||
    input.plan.persistedPerformanceCoreSetSha256 === null ||
    input.plan.missingPerformanceCoreSetSha256 === null
  ) {
    authorityError("population plan identities are incomplete");
  }
  const selected = selectDnaPopulationCoreHistoryReadOnlySlice({
    plan: input.plan,
    cohortOrdinal: 0,
    cohortOffset: 0,
    maximumCoreCount: DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_CORE_COUNT,
    maximumPagesPerCore:
      DNA_POPULATION_CORE_HISTORY_READINESS_MAXIMUM_PAGES_PER_CORE,
  });
  const measurement = input.measurement;
  if (
    measurement.status !== "complete" ||
    measurement.reason !== null ||
    measurement.cohortOrdinal !== selected.cohortOrdinal ||
    measurement.cohortOffset !== selected.cohortOffset ||
    measurement.selectedCoreCount !== selected.coreIds.length ||
    measurement.completeCoreCount !== selected.coreIds.length ||
    measurement.selectedCohortFullyMeasured !== true ||
    measurement.acquisitionCoreSetSha256 !==
      selected.acquisitionCoreSetSha256 ||
    measurement.selectedCoreSetSha256 !== selected.selectedCoreSetSha256 ||
    measurement.measurementSliceSha256 !== selected.measurementSliceSha256
  ) {
    authorityError("read-only measurement does not match the first slice");
  }
  if (
    measurement.providerReadPerformed !== true ||
    measurement.providerRequestCount < 1 ||
    measurement.aggregateRequestsPerMinute < 1 ||
    measurement.aggregateRequestsPerMinute >
      DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE ||
    measurement.persistentWritePerformed !== false ||
    measurement.providerWritePerformed !== false ||
    measurement.paidUsageAllowed !== false
  ) {
    authorityError("read-only measurement safety authority drifted");
  }
  const [coreId] = selected.coreIds;
  if (coreId === undefined) {
    authorityError("selected Core identity is unavailable");
  }

  return Object.freeze({
    authorityVersion:
      DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_AUTHORITY_VERSION,
    exactCodeHeadSha,
    cohortOrdinal: 0 as const,
    cohortOffset: 0 as const,
    coreIds: Object.freeze([coreId]) as readonly [number],
    populationCoreCount: input.plan.populationCoreCount,
    persistedPerformanceCoreCount: input.plan.persistedPerformanceCoreCount,
    populationCoreSetSha256: input.plan.populationCoreSetSha256,
    persistedPerformanceCoreSetSha256:
      input.plan.persistedPerformanceCoreSetSha256,
    acquisitionCoreSetSha256: selected.acquisitionCoreSetSha256,
    selectedCoreSetSha256: selected.selectedCoreSetSha256,
    measurementSliceSha256: selected.measurementSliceSha256,
    providerRequestCount: measurement.providerRequestCount,
    projectedPersistentR2Usage: Object.freeze({
      ...measurement.projectedPersistentR2Usage,
    }),
    populationUniverseCompleteness: input.plan.populationUniverseCompleteness,
    unresolvedRaceCount: input.plan.unresolvedRaceCount,
    capacityPreflightRequired: true as const,
    providerReadAllowed: false as const,
    persistentWriteAllowed: false as const,
    paidUsageAllowed: false as const,
    previewOnly: true as const,
  });
}
