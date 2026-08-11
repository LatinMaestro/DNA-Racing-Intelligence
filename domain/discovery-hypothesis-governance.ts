import type { ProbeLineageRelationship } from "./discovery-probe-plan";

export const MINIMUM_ANALYTICAL_EXACT_DISTANCE_RACES = 10;

export function discoveryHypothesisIsEligible(input: Readonly<{
  relationship: ProbeLineageRelationship;
  supportingRaceCount: number;
}>): boolean {
  if (!Number.isSafeInteger(input.supportingRaceCount) || input.supportingRaceCount < 0) {
    throw new Error("Discovery supporting race count must be a non-negative safe integer.");
  }

  if (input.relationship !== "population_pattern") return true;

  return input.supportingRaceCount >= MINIMUM_ANALYTICAL_EXACT_DISTANCE_RACES;
}
