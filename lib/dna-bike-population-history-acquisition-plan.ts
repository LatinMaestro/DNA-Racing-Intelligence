import { createHash } from "node:crypto";

import type { CanonicalRaceDocumentMetadata } from "@/lib/dna-open-lab-v1-adapters";
import { DNA_CORE_RACE_HISTORY_MAXIMUM_CORES } from "@/lib/dna-core-race-history-acquisition-cycle";

const POSITIVE_INTEGER = /^[1-9]\d*$/u;

export type DnaBikePopulationHistoryAcquisitionCohort = Readonly<{
  ordinal: number;
  coreIds: readonly number[];
  coreSetSha256: string;
}>;

export type DnaBikePopulationHistoryAcquisitionPlan = Readonly<{
  status:
    | "ready_for_budget_measurement"
    | "held_incomplete_race_authority"
    | "held_no_unowned_population";
  bikeRaceCount: number;
  bikeRaceWithoutEntrantAuthorityCount: number;
  raceWithUnknownModeCount: number;
  populationCoreCount: number;
  ownedPopulationCoreCount: number;
  acquisitionCoreCount: number;
  populationCoreSetSha256: string | null;
  acquisitionCoreSetSha256: string | null;
  cohorts: readonly DnaBikePopulationHistoryAcquisitionCohort[];
  minimumProviderRequestCount: number;
  structuralMaximumProviderRequestCount: number;
  budgetMeasurementRequired: true;
  providerReadAllowed: false;
  persistentWriteAllowed: false;
  paidUsageAllowed: false;
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

function normalizedOwnedCoreIds(values: readonly number[]): Set<number> {
  const result = new Set<number>();
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 1 || result.has(value)) {
      throw new Error("Bike population history owned Core IDs are invalid.");
    }
    result.add(value);
  }
  return result;
}

function coreSetSha256(label: string, coreIds: readonly number[]): string {
  return sha256(["dna_open_lab", "bike_population_history", label, ...coreIds]);
}

/**
 * Builds the private Core-history request universe from canonical global Race
 * documents. This is planning only: it never calls the provider or authorizes
 * persistence. Any Race whose mode or Bike entrants are unavailable holds the
 * complete population plan rather than silently shrinking the denominator.
 */
export function planDnaBikePopulationHistoryAcquisition(input: {
  raceDocuments: readonly CanonicalRaceDocumentMetadata[];
  ownedCoreIds?: readonly number[];
}): DnaBikePopulationHistoryAcquisitionPlan {
  const ownedCoreIds = normalizedOwnedCoreIds(input.ownedCoreIds ?? []);
  const raceIds = new Set<string>();
  const populationCoreIds = new Set<number>();
  let bikeRaceCount = 0;
  let bikeRaceWithoutEntrantAuthorityCount = 0;
  let raceWithUnknownModeCount = 0;

  for (const document of input.raceDocuments) {
    if (
      document.sourceType !== "race_document" ||
      document.sourceRaceId.trim() === "" ||
      raceIds.has(document.sourceRaceId)
    ) {
      throw new Error("Bike population history Race authority is invalid.");
    }
    raceIds.add(document.sourceRaceId);
    if (document.mode === undefined) {
      raceWithUnknownModeCount += 1;
      continue;
    }
    if (document.mode !== "bike") continue;
    bikeRaceCount += 1;
    if (
      document.entrantCoreIds === undefined ||
      document.entrantCoreIds.length === 0
    ) {
      bikeRaceWithoutEntrantAuthorityCount += 1;
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
      bikeRaceWithoutEntrantAuthorityCount += 1;
      continue;
    }
    for (const coreId of raceEntrants) populationCoreIds.add(coreId);
  }

  const population = [...populationCoreIds].sort((left, right) => left - right);
  const acquisition = population.filter((coreId) => !ownedCoreIds.has(coreId));
  const incompleteAuthority =
    raceWithUnknownModeCount > 0 || bikeRaceWithoutEntrantAuthorityCount > 0;
  const status = incompleteAuthority
    ? "held_incomplete_race_authority"
    : acquisition.length === 0
      ? "held_no_unowned_population"
      : "ready_for_budget_measurement";
  const cohorts = acquisition.length
    ? Array.from(
        {
          length: Math.ceil(
            acquisition.length / DNA_CORE_RACE_HISTORY_MAXIMUM_CORES,
          ),
        },
        (_, ordinal) => {
          const coreIds = Object.freeze(
            acquisition.slice(
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
      )
    : [];

  return Object.freeze({
    status,
    bikeRaceCount,
    bikeRaceWithoutEntrantAuthorityCount,
    raceWithUnknownModeCount,
    populationCoreCount: population.length,
    ownedPopulationCoreCount: population.filter((coreId) =>
      ownedCoreIds.has(coreId),
    ).length,
    acquisitionCoreCount: acquisition.length,
    populationCoreSetSha256:
      population.length === 0 ? null : coreSetSha256("population", population),
    acquisitionCoreSetSha256:
      acquisition.length === 0
        ? null
        : coreSetSha256("acquisition", acquisition),
    cohorts: Object.freeze(cohorts),
    minimumProviderRequestCount: acquisition.length,
    structuralMaximumProviderRequestCount: acquisition.length * 10_000,
    budgetMeasurementRequired: true,
    providerReadAllowed: false,
    persistentWriteAllowed: false,
    paidUsageAllowed: false,
  });
}
