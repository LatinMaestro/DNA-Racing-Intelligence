export type OpenRaceComparisonSignal =
  | Readonly<{ status: "assigned"; coreId: string }>
  | Readonly<{
      status: "not_assigned" | "not_observed" | "not_applicable";
    }>;

export type OpenRaceStarComparisonInput = Readonly<{
  comparisonId: string;
  lockId: string;
  observationId: string;
  rankingEvaluatedAt: string;
  lockedAt: string;
  observedAt: string;
  comparedAt: string;
  gateCount: number;
  enteredCoreIds: readonly string[];
  rankedCandidateCoreIds: readonly string[];
  provisionalRecommendedCoreId: string | null;
  selectedOwnedCoreId: string;
  gold: OpenRaceComparisonSignal;
  blue: OpenRaceComparisonSignal;
  observationRecordStatus: "recorded" | "review_required";
}>;

export type OpenRaceStarComparisonResult = Readonly<{
  comparisonId: string;
  lockId: string;
  observationId: string;
  comparedAt: string;
  provisionalRecommendedCoreId: string | null;
  selectedOwnedCoreId: string;
  selectedCoreSignal:
    | "both"
    | "gold_only"
    | "blue_only"
    | "neither_assigned"
    | "incomplete_observation";
  provisionalLeaderSignal:
    | "both"
    | "gold_only"
    | "blue_only"
    | "neither_assigned"
    | "incomplete_observation"
    | "not_entered"
    | "no_provisional_leader";
  diagnosticStatus: "observation_compared" | "review_required";
  issues: readonly string[];
  frozenPreEntryRanking: true;
  rankingChanged: false;
  observationOnly: true;
  predictionSuccessClaimAllowed: false;
  completedOutcomeClaimAllowed: false;
  replacementRecommendationAllowed: false;
  recommendation: null;
}>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function timestamp(value: string, label: string): string {
  const parsed = Date.parse(required(value, label));
  if (Number.isNaN(parsed)) throw new Error(`${label} must be valid.`);
  return new Date(parsed).toISOString();
}

function rejectOutcomes(value: object): void {
  const forbiddenKey = Object.keys(value).find((key) =>
    /(finish|winner|prize|payout|elapsed|raceResult|replacement|newRanking)/i.test(
      key,
    ),
  );
  if (forbiddenKey !== undefined) {
    throw new Error(
      "Star comparison cannot contain outcomes, replacement advice or a new ranking.",
    );
  }
}

function validateSignal(
  signal: OpenRaceComparisonSignal,
  label: string,
  enteredCoreIds: readonly string[],
  notApplicableAllowed: boolean,
): OpenRaceComparisonSignal {
  if (
    !["assigned", "not_assigned", "not_observed", "not_applicable"].includes(
      signal.status,
    )
  ) {
    throw new Error(`${label} observation status is invalid.`);
  }
  if (signal.status === "not_applicable" && !notApplicableAllowed) {
    throw new Error(`${label} cannot be not applicable.`);
  }
  if (signal.status === "assigned") {
    const coreId = required(signal.coreId, `${label} core ID`);
    if (!enteredCoreIds.includes(coreId)) {
      throw new Error(`${label} core must be in the locked field.`);
    }
    return { status: "assigned", coreId };
  }
  return { status: signal.status };
}

function signalFor(
  coreId: string,
  gold: OpenRaceComparisonSignal,
  blue: OpenRaceComparisonSignal,
):
  | "both"
  | "gold_only"
  | "blue_only"
  | "neither_assigned"
  | "incomplete_observation" {
  if (gold.status === "not_observed" || blue.status === "not_observed") {
    return "incomplete_observation";
  }
  const receivedGold = gold.status === "assigned" && gold.coreId === coreId;
  const receivedBlue = blue.status === "assigned" && blue.coreId === coreId;
  if (receivedGold && receivedBlue) return "both";
  if (receivedGold) return "gold_only";
  if (receivedBlue) return "blue_only";
  return "neither_assigned";
}

export function compareOpenRaceStars(
  input: OpenRaceStarComparisonInput,
): OpenRaceStarComparisonResult {
  rejectOutcomes(input);
  const comparisonId = required(input.comparisonId, "Comparison ID");
  const lockId = required(input.lockId, "Lock ID");
  const observationId = required(input.observationId, "Observation ID");
  const rankingEvaluatedAt = timestamp(
    input.rankingEvaluatedAt,
    "Ranking evaluation time",
  );
  const lockedAt = timestamp(input.lockedAt, "Lock time");
  const observedAt = timestamp(input.observedAt, "Observation time");
  const comparedAt = timestamp(input.comparedAt, "Comparison time");
  if (Date.parse(lockedAt) < Date.parse(rankingEvaluatedAt)) {
    throw new Error("Field lock cannot predate the pre-entry ranking.");
  }
  if (Date.parse(observedAt) < Date.parse(lockedAt)) {
    throw new Error("Star observation cannot predate field lock.");
  }
  if (Date.parse(comparedAt) < Date.parse(observedAt)) {
    throw new Error("Diagnostic comparison cannot predate star observation.");
  }
  if (!Number.isSafeInteger(input.gateCount) || input.gateCount <= 0) {
    throw new Error("Gate count must be a positive safe integer.");
  }

  const enteredCoreIds = input.enteredCoreIds.map((coreId) =>
    required(coreId, "Entered core ID"),
  );
  if (
    enteredCoreIds.length !== input.gateCount ||
    new Set(enteredCoreIds).size !== enteredCoreIds.length
  ) {
    throw new Error("Locked field must contain one unique core per gate.");
  }
  const rankedCandidateCoreIds = input.rankedCandidateCoreIds.map((coreId) =>
    required(coreId, "Ranked candidate core ID"),
  );
  if (
    rankedCandidateCoreIds.length === 0 ||
    new Set(rankedCandidateCoreIds).size !== rankedCandidateCoreIds.length
  ) {
    throw new Error("Frozen pre-entry candidate ranking must be non-empty.");
  }
  const selectedOwnedCoreId = required(
    input.selectedOwnedCoreId,
    "Selected owned core ID",
  );
  if (!enteredCoreIds.includes(selectedOwnedCoreId)) {
    throw new Error("Selected owned core must be in the locked field.");
  }
  if (!rankedCandidateCoreIds.includes(selectedOwnedCoreId)) {
    throw new Error(
      "Selected owned core must be present in the frozen pre-entry ranking.",
    );
  }
  const provisionalRecommendedCoreId =
    input.provisionalRecommendedCoreId === null
      ? null
      : required(
          input.provisionalRecommendedCoreId,
          "Provisional recommended core ID",
        );
  if (
    provisionalRecommendedCoreId !== null &&
    provisionalRecommendedCoreId !== rankedCandidateCoreIds[0]
  ) {
    throw new Error(
      "Provisional leader must match the first frozen pre-entry candidate.",
    );
  }
  if (
    !["recorded", "review_required"].includes(input.observationRecordStatus)
  ) {
    throw new Error("Observation record status is invalid.");
  }

  const gold = validateSignal(input.gold, "Gold", enteredCoreIds, true);
  const blue = validateSignal(input.blue, "Blue", enteredCoreIds, false);
  const issues: string[] = [];
  if (input.observationRecordStatus === "review_required") {
    issues.push("The manual star observation requires review.");
  }
  if (input.gateCount <= 3 && gold.status !== "not_applicable") {
    issues.push("Gold is not applicable at three gates or fewer.");
  }
  if (input.gateCount > 3 && gold.status === "not_applicable") {
    issues.push("Gold was applicable at this gate count.");
  }
  if (gold.status === "not_observed" || blue.status === "not_observed") {
    issues.push("The revealed star observation is incomplete.");
  }

  return {
    comparisonId,
    lockId,
    observationId,
    comparedAt,
    provisionalRecommendedCoreId,
    selectedOwnedCoreId,
    selectedCoreSignal: signalFor(selectedOwnedCoreId, gold, blue),
    provisionalLeaderSignal:
      provisionalRecommendedCoreId === null
        ? "no_provisional_leader"
        : !enteredCoreIds.includes(provisionalRecommendedCoreId)
          ? "not_entered"
          : signalFor(provisionalRecommendedCoreId, gold, blue),
    diagnosticStatus:
      issues.length === 0 ? "observation_compared" : "review_required",
    issues,
    frozenPreEntryRanking: true,
    rankingChanged: false,
    observationOnly: true,
    predictionSuccessClaimAllowed: false,
    completedOutcomeClaimAllowed: false,
    replacementRecommendationAllowed: false,
    recommendation: null,
  };
}
