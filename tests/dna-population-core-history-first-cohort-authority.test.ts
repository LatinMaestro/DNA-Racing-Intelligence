import { describe, expect, it } from "vitest";

import {
  createDnaPopulationCoreHistoryFirstCohortAuthority,
  DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_AUTHORITY_VERSION,
} from "@/lib/dna-population-core-history-first-cohort-authority";
import {
  DNA_POPULATION_CORE_HISTORY_READINESS_MAXIMUM_PAGES_PER_CORE,
  selectDnaPopulationCoreHistoryReadOnlySlice,
  type DnaPopulationCoreHistoryReadOnlyMeasurement,
} from "@/lib/dna-population-core-history-read-only-measurement";
import { planDnaPopulationHistoryAcquisition } from "@/lib/dna-population-history-acquisition-plan";
import type { CanonicalRaceDocumentMetadata } from "@/lib/dna-open-lab-v1-adapters";

const exactCodeHeadSha = "a".repeat(40);

function race(
  sourceRaceId: string,
  mode: "bike" | "car" | "horse" | undefined,
  entrantCoreIds: readonly string[] | undefined,
): CanonicalRaceDocumentMetadata {
  return Object.freeze({
    sourceType: "race_document",
    sourceRaceId,
    ...(mode === undefined ? {} : { mode }),
    ...(entrantCoreIds === undefined ? {} : { entrantCoreIds }),
  });
}

function plan() {
  return planDnaPopulationHistoryAcquisition({
    raceDocuments: [
      race("bike-1", "bike", ["101", "202"]),
      race("car-1", "car", ["202", "303"]),
      race("horse-1", "horse", ["303", "404"]),
      race("quarantined", undefined, undefined),
    ],
    persistedPerformanceCoreIds: [101],
    allowQuarantinedRaceGaps: true,
  });
}

function measurement(
  value: ReturnType<typeof plan> = plan(),
): DnaPopulationCoreHistoryReadOnlyMeasurement {
  const selected = selectDnaPopulationCoreHistoryReadOnlySlice({
    plan: value,
    cohortOrdinal: 0,
    cohortOffset: 0,
    maximumCoreCount: 1,
    maximumPagesPerCore:
      DNA_POPULATION_CORE_HISTORY_READINESS_MAXIMUM_PAGES_PER_CORE,
  });
  return Object.freeze({
    status: "complete" as const,
    reason: null,
    acquisitionCoreSetSha256: selected.acquisitionCoreSetSha256,
    selectedCoreSetSha256: selected.selectedCoreSetSha256,
    measurementSliceSha256: selected.measurementSliceSha256,
    cohortOrdinal: 0,
    cohortOffset: 0,
    selectedCoreCount: 1,
    completeCoreCount: 1,
    providerRequestCount: 13,
    sourceRowCount: 512,
    acceptedResultCount: 510,
    quarantineCount: 2,
    replayDuplicateCount: 0,
    canonicalResultBytes: 32_768,
    projectedPersistentR2Usage: Object.freeze({
      storageBytes: 208 * 1024 * 1024,
      classAOperations: 26,
      classBOperations: 91,
    }),
    selectedCohortFullyMeasured: true,
    providerReadPerformed: true,
    aggregateRequestsPerMinute: 30,
    persistentWritePerformed: false,
    providerWritePerformed: false,
    paidUsageAllowed: false,
  });
}

describe("population Core history first cohort authority", () => {
  it("binds one measured population Core while preserving quarantine incompleteness", () => {
    const value = plan();
    const authority = createDnaPopulationCoreHistoryFirstCohortAuthority({
      exactCodeHeadSha,
      plan: value,
      measurement: measurement(value),
    });

    expect(authority).toMatchObject({
      authorityVersion:
        DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_AUTHORITY_VERSION,
      exactCodeHeadSha,
      cohortOrdinal: 0,
      cohortOffset: 0,
      coreIds: [202],
      providerRequestCount: 13,
      populationUniverseCompleteness: "partial_due_to_unresolved_races",
      unresolvedRaceCount: 1,
      capacityPreflightRequired: true,
      providerReadAllowed: false,
      persistentWriteAllowed: false,
      paidUsageAllowed: false,
      previewOnly: true,
    });
  });

  it("rejects plan drift after measurement", () => {
    const measuredPlan = plan();
    const driftedPlan = planDnaPopulationHistoryAcquisition({
      raceDocuments: [race("bike-2", "bike", ["202", "303", "505"])],
      persistedPerformanceCoreIds: [202],
      allowQuarantinedRaceGaps: true,
    });

    expect(() =>
      createDnaPopulationCoreHistoryFirstCohortAuthority({
        exactCodeHeadSha,
        plan: driftedPlan,
        measurement: measurement(measuredPlan),
      }),
    ).toThrow("measurement does not match the first slice");
  });

  it("rejects incomplete, multi-Core or write-capable measurements", () => {
    const value = plan();
    const base = measurement(value);

    for (const unsafe of [
      { ...base, status: "held" as const, reason: "rate_limited" as const },
      { ...base, selectedCoreCount: 2 },
      { ...base, aggregateRequestsPerMinute: 31 },
      { ...base, persistentWritePerformed: true as never },
      { ...base, paidUsageAllowed: true as never },
    ]) {
      expect(() =>
        createDnaPopulationCoreHistoryFirstCohortAuthority({
          exactCodeHeadSha,
          plan: value,
          measurement: unsafe,
        }),
      ).toThrow();
    }
  });
});
