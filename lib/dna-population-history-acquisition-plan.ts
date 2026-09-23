import { createHash } from "node:crypto";

import type { RaceMode } from "@/domain/import-contract";
import { DNA_CORE_RACE_HISTORY_MAXIMUM_CORES } from "./dna-core-race-history-acquisition-cycle";
import type { CanonicalRaceDocumentMetadata } from "./dna-open-lab-v1-adapters";

const POSITIVE_INTEGER = /^[1-9]\d*$/u;
const MODES = Object.freeze(["bike", "car", "horse"] as const);

export type DnaPopulationHistoryAcquisitionCohort = Readonly<{
  ordinal: number;
  coreIds: readonly number[];
  coreSetSha256: string;
}>;

export type DnaPopulationHistoryAcquisitionPlan = Readonly<{
  status:
    | "ready_for_budget_measurement"
    | "held_incomplete_race_authority"
    | "complete_population_enrichment";
  raceDocumentCount: number;
  raceCountByMode: Readonly<Record<RaceMode, number>>;
  raceWithoutEntrantAuthorityByMode: Readonly<Record<RaceMode, number>>;
  raceWithUnknownModeCount: number;
  populationCoreCountByMode: Readonly<Record<RaceMode, number>>;
  populationCoreCount: number;
  persistedPerformanceCoreCount: number;
  missingPerformanceCoreCount: number;
  populationCoreSetSha256: string | null;
  persistedPerformanceCoreSetSha256: string | null;
  missingPerformanceCoreSetSha256: string | null;
  cohorts: readonly DnaPopulationHistoryAcquisitionCohort[];
  minimumProviderRequestCount: number;
  structuralMaximumProviderRequestCount: number;
  budgetMeasurementRequired: boolean;
  providerReadAllowed: false;
  persistentWriteAllowed: false;
  paidUsageAllowed: false;
  incrementalOnly: true;
}>;

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
      throw new Error(`DNA population history ${field} Core IDs are invalid.`);
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

/**
 * Builds the durable all-mode population enrichment universe from canonical
 * global Race documents.
 *
 * The finished-race archive is already the race-level historical authority.
 * This planner identifies only population Cores whose complete per-Core result
 * history has not yet been persisted. The provider history endpoint is Core
 * scoped and returns all modes, so a Core appearing in Bike, Car and Horse
 * races is acquired once and then reused by every analytical module.
 *
 * This is planning only. It never calls DNA Open Lab, writes R2/Neon, or
 * authorizes paid use. Any race with unknown mode or incomplete entrant
 * authority holds the plan rather than silently shrinking a mode population.
 */
export function planDnaPopulationHistoryAcquisition(input: {
  raceDocuments: readonly CanonicalRaceDocumentMetadata[];
  persistedPerformanceCoreIds?: readonly number[];
}): DnaPopulationHistoryAcquisitionPlan {
  const persisted = normalizedCoreIds(
    input.persistedPerformanceCoreIds ?? [],
    "persisted performance",
  );
  const raceIds = new Set<string>();
  const populationByMode = modeCoreSets();
  const population = new Set<number>();
  const raceCountByMode = modeCounts();
  const raceWithoutEntrantAuthorityByMode = modeCounts();
  let raceWithUnknownModeCount = 0;

  for (const document of input.raceDocuments) {
    if (
      document.sourceType !== "race_document" ||
      document.sourceRaceId.trim() === "" ||
      raceIds.has(document.sourceRaceId)
    ) {
      throw new Error("DNA population history Race authority is invalid.");
    }
    raceIds.add(document.sourceRaceId);

    const mode = document.mode;
    if (mode === undefined) {
      raceWithUnknownModeCount += 1;
      continue;
    }
    if (!MODES.includes(mode)) {
      raceWithUnknownModeCount += 1;
      continue;
    }

    raceCountByMode[mode] += 1;
    if (
      document.entrantCoreIds === undefined ||
      document.entrantCoreIds.length === 0
    ) {
      raceWithoutEntrantAuthorityByMode[mode] += 1;
      continue;
    }

    const raceEntrants = new Set<number>();
    let valid = true;
    for (const value of document.entrantCoreIds) {
      const coreId = numericCoreId(value);
      if (coreId === null || raceEntrants.has(coreId)) {
        valid = false;
        break;
      }
      raceEntrants.add(coreId);
    }
    if (!valid) {
      raceWithoutEntrantAuthorityByMode[mode] += 1;
      continue;
    }

    for (const coreId of raceEntrants) {
      populationByMode[mode].add(coreId);
      population.add(coreId);
    }
  }

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
    ? "held_incomplete_race_authority"
    : missingPerformanceCoreIds.length === 0
      ? "complete_population_enrichment"
      : "ready_for_budget_measurement";

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
    providerReadAllowed: false,
    persistentWriteAllowed: false,
    paidUsageAllowed: false,
    incrementalOnly: true,
  });
}
