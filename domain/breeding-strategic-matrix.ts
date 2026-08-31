import type { BreedingIntelligencePairCandidate } from "./breeding-intelligence";
import { buildBreedingIntelligenceMatrix } from "./breeding-scope-matrix";
import {
  buildStrategicBreedingBoard,
  type StrategicBreedingBoard,
  type VaultCoveragePolicy,
  type VaultEliteRacer,
  type VaultFNumberSegment,
} from "./breeding-vault-coverage";

export function buildStrategicBreedingIntelligenceMatrix(
  input: Readonly<{
    observedDistancesMetres: readonly number[];
    pairs: readonly BreedingIntelligencePairCandidate[];
    ownedEliteRacers: readonly VaultEliteRacer[];
    fNumberSegments?: readonly VaultFNumberSegment[];
    coveragePolicy?: VaultCoveragePolicy;
  }>,
): readonly StrategicBreedingBoard[] {
  const boards = buildBreedingIntelligenceMatrix({
    observedDistancesMetres: input.observedDistancesMetres,
    pairs: input.pairs,
  });
  return Object.freeze(
    boards.map((board) =>
      buildStrategicBreedingBoard({
        board,
        ownedEliteRacers: input.ownedEliteRacers,
        fNumberSegments: input.fNumberSegments,
        policy: input.coveragePolicy,
      }),
    ),
  );
}
