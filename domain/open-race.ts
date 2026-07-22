import { isGoldStarEligible } from "@/domain/game-rules";

export type OpenRaceSelectionInput = {
  mode: "bike" | "car" | "horse";
  distance: number;
  gateCount: number;
  opponentCoreIds: readonly string[];
  availableGates: number;
};

export type OpenRaceStage = "selection" | "locked_observation";

export function openRaceStarBoundary(stage: OpenRaceStage, gateCount: number) {
  if (stage === "selection") {
    return {
      currentStarsAvailable: false,
      observationOnly: false,
      replacementRecommendationAllowed: true,
      goldApplicable: false,
    } as const;
  }

  return {
    currentStarsAvailable: true,
    observationOnly: true,
    replacementRecommendationAllowed: false,
    goldApplicable: isGoldStarEligible(gateCount),
  } as const;
}
