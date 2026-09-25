import { createHash } from "node:crypto";

import type { RaceMode } from "@/domain/import-contract";
import { DNA_CORE_RACE_HISTORY_MAXIMUM_CORES } from "./dna-core-race-history-acquisition-cycle";
import type { DnaPopulationHistoryAcquisitionPlan } from "./dna-population-history-acquisition-plan";
import type { CanonicalRaceDocumentMetadata } from "./dna-open-lab-v1-adapters";

const POSITIVE_INTEGER = /^[1-9]\d*$/u;
const MODES = Object.freeze(["bike", "car", "horse"] as const);

function sha256(parts: readonly (string | number)[]): string {
  return createHash("sha256")
    .update(parts.map(String).join("\u0000"), "utf8")
    .digest("hex");
}

function numericCoreId(value: string): number | null {
  if (!POSITIVE_INTEGER.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizedCoreIds(
  values: readonly number[],
  field: string,
): Set<number> {
  const result = new Set<number>();
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 1 || result.has(value)) {
      throw new Error(
        `DNA population history accumulator ${field} Core IDs are invalid.`,
      );
    }
    result.add(value);
  }
  return result;
}

function coreSetSha256(label: string, coreIds: readonly number[]): string {
  return sha256(["dna_open_lab", "population_history", label, ...coreIds]);
}

function modeCounts(): Record<RaceMode, number> {
  return { bike: 0, car: 0, horse: 0 };
}

function modeCoreSets(): Record<RaceMode, Set<number>> {
  return {
    bike: new Set<number>(),
    car: new Set<number>(),
    horse: new Set<number>(),
  };
}

export function createDnaPopulationHistoryAcquisitionAccumulator(): Readonly<{
  accept: (document: CanonicalRaceDocumentMetadata) => void;
  finalize: (
    persistedPerformanceCoreIds?: readonly number[],
  ) => DnaPopulationHistoryAcquisitionPlan;
}> {
  const raceIds = new Set<string>();
  const populationByMode = modeCoreSets();
  const population = new Set<number>();
  const raceCountByMode = modeCounts();
  const raceWithoutEntrantAuthorityByMode = modeCounts();
  let raceWithUnknownModeCount = 0;
  let finalized = false;

  return Object.freeze({
    accept(document) {
      if (finalized) {
        throw new Error("DNA population history accumulator is finalized.");
      }
      if (
        document.sourceType !== "race_document" ||
        document.sourceRaceId.trim() === "" ||
        raceIds.has(document.sourceRaceId)
      ) {
        throw new Error(
          "DNA population history accumulator Race authority is invalid.",
        );
      }
      raceIds.add(document.sourceRaceId);

      const mode = document.mode;
      if (mode === undefined || !MODES.includes(mode)) {
        raceWithUnknownModeCount += 1;
        return;
      }
      raceCountByMode[mode] += 1;
      if (
        document.entrantCoreIds === undefined ||
        document.entrantCoreIds.length === 0
      ) {
        raceWithoutEntrantAuthorityByMode[mode] += 1;
        return;
      }

      const raceEntrants = new Set<number>();
      for (const value of document.entrantCoreIds) {
        const coreId = numericCoreId(value);
        if (coreId === null || raceEntrants.has(coreId)) {
          raceWithoutEntrantAuthorityByMode[mode] += 1;
          return;
        }
        raceEntrants.add(coreId);
      }
      for (const coreId of raceEntrants) {
        populationByMode[mode].add(coreId);
        population.add(coreId);
      }
    },

    finalize(persistedPerformanceCoreIds = []) {
      if (finalized) {
        throw new Error("DNA population history accumulator is finalized.");
      }
      finalized = true;
      const persisted = normalizedCoreIds(
        persistedPerformanceCoreIds,
        "persisted performance",
      );
      const populationIds = [...population].sort((left, right) => left - right);
      const persistedPopulationIds = populationIds.filter((coreId) =>
        persisted.has(coreId),
      );
      const missingPerformanceCoreIds = populationIds.filter(
        (coreId) => !persisted.has(coreId),
      );
      const incompleteAuthority =
        raceWithUnknownModeCount > 0 ||
        MODES.some((mode) => raceWithoutEntrantAuthorityByMode[mode] > 0);
      const status = incompleteAuthority
        ? ("held_incomplete_race_authority" as const)
        : missingPerformanceCoreIds.length === 0
          ? ("complete_population_enrichment" as const)
          : ("ready_for_budget_measurement" as const);
      const cohorts =
        missingPerformanceCoreIds.length === 0
          ? []
          : Array.from(
              {
                length: Math.ceil(
                  missingPerformanceCoreIds.length /
                    DNA_CORE_RACE_HISTORY_MAXIMUM_CORES,
                ),
              },
              (_, ordinal) => {
                const coreIds = Object.freeze(
                  missingPerformanceCoreIds.slice(
                    ordinal * DNA_CORE_RACE_HISTORY_MAXIMUM_CORES,
                    (ordinal + 1) * DNA_CORE_RACE_HISTORY_MAXIMUM_CORES,
                  ),
                );
                return Object.freeze({
                  ordinal,
                  coreIds,
                  coreSetSha256: coreSetSha256(`cohort:${ordinal}`, coreIds),
                });
              },
            );

      return Object.freeze({
        status,
        raceDocumentCount: raceIds.size,
        raceCountByMode: Object.freeze({ ...raceCountByMode }),
        raceWithoutEntrantAuthorityByMode: Object.freeze({
          ...raceWithoutEntrantAuthorityByMode,
        }),
        raceWithUnknownModeCount,
        populationCoreCountByMode: Object.freeze({
          bike: populationByMode.bike.size,
          car: populationByMode.car.size,
          horse: populationByMode.horse.size,
        }),
        populationCoreCount: populationIds.length,
        persistedPerformanceCoreCount: persistedPopulationIds.length,
        missingPerformanceCoreCount: missingPerformanceCoreIds.length,
        populationCoreSetSha256:
          populationIds.length === 0
            ? null
            : coreSetSha256("population", populationIds),
        persistedPerformanceCoreSetSha256:
          persistedPopulationIds.length === 0
            ? null
            : coreSetSha256("persisted", persistedPopulationIds),
        missingPerformanceCoreSetSha256:
          missingPerformanceCoreIds.length === 0
            ? null
            : coreSetSha256("missing", missingPerformanceCoreIds),
        cohorts: Object.freeze(cohorts),
        minimumProviderRequestCount: missingPerformanceCoreIds.length,
        structuralMaximumProviderRequestCount:
          missingPerformanceCoreIds.length * 10_000,
        budgetMeasurementRequired:
          !incompleteAuthority && missingPerformanceCoreIds.length > 0,
        providerReadAllowed: false as const,
        persistentWriteAllowed: false as const,
        paidUsageAllowed: false as const,
        incrementalOnly: true as const,
      });
    },
  });
}
