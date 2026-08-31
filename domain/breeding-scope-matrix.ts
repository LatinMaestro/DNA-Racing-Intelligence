import {
  buildBreedingIntelligenceBoard,
  type BreedingIntelligenceBoard,
  type BreedingIntelligencePairCandidate,
} from "./breeding-intelligence";
import { probeModes, type ProbeMode } from "./discovery-probe-plan";

export type BreedingAnalysisScope = Readonly<{
  mode: ProbeMode;
  distanceMetres: number;
}>;

function normalizeObservedDistances(
  distances: readonly number[],
): readonly number[] {
  const normalized = [...new Set(distances)].sort((left, right) => left - right);
  for (const distance of normalized) {
    if (!Number.isSafeInteger(distance) || distance <= 0) {
      throw new Error(
        "Observed breeding distance must be a positive safe integer.",
      );
    }
  }
  return Object.freeze(normalized);
}

export function buildBreedingAnalysisScopes(
  observedDistancesMetres: readonly number[],
): readonly BreedingAnalysisScope[] {
  const distances = normalizeObservedDistances(observedDistancesMetres);
  return Object.freeze(
    probeModes.flatMap((mode) =>
      distances.map((distanceMetres) =>
        Object.freeze({ mode, distanceMetres }),
      ),
    ),
  );
}

export function buildBreedingIntelligenceMatrix(input: Readonly<{
  observedDistancesMetres: readonly number[];
  pairs: readonly BreedingIntelligencePairCandidate[];
}>): readonly BreedingIntelligenceBoard[] {
  return Object.freeze(
    buildBreedingAnalysisScopes(input.observedDistancesMetres).map((scope) =>
      buildBreedingIntelligenceBoard({
        mode: scope.mode,
        distanceMetres: scope.distanceMetres,
        pairs: input.pairs,
      }),
    ),
  );
}
