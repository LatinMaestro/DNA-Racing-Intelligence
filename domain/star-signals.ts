import { isGoldStarEligible } from "@/domain/game-rules";

export type StarDataStatus = "complete" | "missing" | "invalid";

export type NormalizedStar = {
  value: boolean | null;
  status: StarDataStatus;
  rawValue: unknown;
};

export function normalizeStarValue(rawValue: unknown): NormalizedStar {
  if (typeof rawValue === "boolean")
    return { value: rawValue, status: "complete", rawValue };

  if (typeof rawValue === "string") {
    const normalized = rawValue.trim().toLowerCase();
    if (normalized === "true")
      return { value: true, status: "complete", rawValue };
    if (normalized === "false")
      return { value: false, status: "complete", rawValue };
    if (normalized === "") return { value: null, status: "missing", rawValue };
  }

  if (rawValue === null || rawValue === undefined) {
    return { value: null, status: "missing", rawValue };
  }

  return { value: null, status: "invalid", rawValue };
}

export type EventStarEntry = {
  coreId: string;
  goldStar: boolean | null;
  blueStar: boolean | null;
};

export type StarWarning =
  | "GOLD_INELIGIBLE_ASSIGNMENT"
  | "MULTIPLE_GOLD_ASSIGNMENTS"
  | "MULTIPLE_BLUE_ASSIGNMENTS";

export function validateEventStars(
  gateCount: number,
  entries: readonly EventStarEntry[],
): StarWarning[] {
  const warnings: StarWarning[] = [];
  const goldCount = entries.filter((entry) => entry.goldStar === true).length;
  const blueCount = entries.filter((entry) => entry.blueStar === true).length;

  if (!isGoldStarEligible(gateCount) && goldCount > 0)
    warnings.push("GOLD_INELIGIBLE_ASSIGNMENT");
  if (goldCount > 1) warnings.push("MULTIPLE_GOLD_ASSIGNMENTS");
  if (blueCount > 1) warnings.push("MULTIPLE_BLUE_ASSIGNMENTS");

  return warnings;
}

export function isNegativeGoldOpportunity(input: {
  gateCount: number;
  eventAssignedGold: boolean;
  entryGoldStar: boolean | null;
}): boolean {
  return (
    isGoldStarEligible(input.gateCount) &&
    input.eventAssignedGold &&
    input.entryGoldStar === false
  );
}
