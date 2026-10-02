import type { DnaCoreRaceHistoryServingAuthorityRow } from "./dna-core-race-history-private-collector";
import type { DnaPopulationHistoryAcquisitionPlan } from "./dna-population-history-acquisition-plan";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;

function sourceError(message: string): never {
  throw new Error(`DNA population Core-history cohort source: ${message}`);
}

/**
 * Converts one deterministic population-history cohort into the existing
 * Core-history collector's serving-authority shape without depending on the
 * owner Vault/current-state Core set.
 *
 * The generation identity is the cohort's own stable Core-set digest. This
 * boundary is pure: it performs no provider read, persistence or publication.
 */
export function populationCoreHistoryCohortServingAuthority(input: {
  plan: DnaPopulationHistoryAcquisitionPlan;
  cohortOrdinal: number;
}): readonly DnaCoreRaceHistoryServingAuthorityRow[] {
  if (
    input.plan.status !== "ready_for_budget_measurement" ||
    input.plan.missingPerformanceCoreCount < 1 ||
    input.plan.missingPerformanceCoreSetSha256 === null ||
    !SHA_256_PATTERN.test(input.plan.missingPerformanceCoreSetSha256)
  ) {
    sourceError("population plan is not ready for acquisition");
  }
  if (
    !Number.isSafeInteger(input.cohortOrdinal) ||
    input.cohortOrdinal < 0 ||
    input.cohortOrdinal >= input.plan.cohorts.length
  ) {
    sourceError("cohort ordinal is invalid");
  }
  const cohort = input.plan.cohorts[input.cohortOrdinal];
  if (
    cohort === undefined ||
    cohort.coreIds.length < 1 ||
    !SHA_256_PATTERN.test(cohort.coreSetSha256) ||
    new Set(cohort.coreIds).size !== cohort.coreIds.length ||
    cohort.coreIds.some(
      (coreId) => !Number.isSafeInteger(coreId) || coreId < 1,
    )
  ) {
    sourceError("cohort authority is invalid");
  }

  return Object.freeze(
    cohort.coreIds.map((coreId) =>
      Object.freeze({
        generationId: cohort.coreSetSha256,
        canonical: Object.freeze({ sourceCoreId: String(coreId) }),
      }),
    ),
  );
}
