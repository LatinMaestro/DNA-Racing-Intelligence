export type OpenRaceFieldLockInput = Readonly<{
  lockId: string;
  requestId: string;
  preEntryRankingId: string;
  fieldCapturedAt: string;
  rankingEvaluatedAt: string;
  lockedAt: string;
  fieldStage: "forming";
  gateCount: number;
  availableGates: number;
  enteredCoreIds: readonly string[];
  selectedOwnedCoreId: string;
  provisionalRecommendedCoreId: string | null;
  preEntryStatus: "provisional" | "insufficient_evidence";
  userConfirmedCommittedEntry: boolean;
  allGatesFilled: boolean;
  raceSetToRun: boolean;
}>;

export type OpenRaceFieldLockResult = Readonly<{
  lockId: string;
  requestId: string;
  preEntryRankingId: string;
  lockedAt: string;
  gateCount: number;
  enteredCoreIds: readonly string[];
  selectedOwnedCoreId: string;
  provisionalRecommendedCoreId: string | null;
  selectionMatchedProvisionalLeader: boolean | null;
  preEntryStatus: OpenRaceFieldLockInput["preEntryStatus"];
  fieldStage: "locked_observation";
  commitmentStatus: "entry_committed";
  optionalObservationAllowed: true;
  replacementRecommendationAllowed: false;
  coreSwitchAllowed: false;
  raceEntryAllowed: false;
  currentRaceStarsCaptured: false;
  warnings: readonly string[];
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

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function rejectPostLockEvidence(value: object): void {
  const forbiddenKey = Object.keys(value).find((key) =>
    /(gold|blue|star|finish|winner|prize|result)/i.test(key),
  );
  if (forbiddenKey !== undefined) {
    throw new Error(
      "Field lock cannot contain post-lock stars or race outcomes.",
    );
  }
}

export function lockOpenRaceField(
  input: OpenRaceFieldLockInput,
): OpenRaceFieldLockResult {
  rejectPostLockEvidence(input);
  const lockId = required(input.lockId, "Lock ID");
  const requestId = required(input.requestId, "Request ID");
  const preEntryRankingId = required(
    input.preEntryRankingId,
    "Pre-entry ranking ID",
  );
  const fieldCapturedAt = timestamp(
    input.fieldCapturedAt,
    "Field capture time",
  );
  const rankingEvaluatedAt = timestamp(
    input.rankingEvaluatedAt,
    "Ranking evaluation time",
  );
  const lockedAt = timestamp(input.lockedAt, "Lock time");
  if (Date.parse(rankingEvaluatedAt) < Date.parse(fieldCapturedAt)) {
    throw new Error("Pre-entry ranking cannot predate field capture.");
  }
  if (Date.parse(lockedAt) < Date.parse(rankingEvaluatedAt)) {
    throw new Error("Field lock cannot predate the pre-entry ranking.");
  }
  if (input.fieldStage !== "forming") {
    throw new Error("Only a forming field can transition to field lock.");
  }

  const gateCount = positiveSafeInteger(input.gateCount, "Gate count");
  if (!Number.isSafeInteger(input.availableGates) || input.availableGates < 0) {
    throw new Error("Available gates must be a non-negative safe integer.");
  }
  if (input.availableGates !== 0 || !input.allGatesFilled) {
    throw new Error("Field lock requires all gates to be filled.");
  }

  const enteredCoreIds = input.enteredCoreIds.map((coreId) =>
    required(coreId, "Entered core ID"),
  );
  if (enteredCoreIds.length !== gateCount) {
    throw new Error("Entered core count must equal gate count at field lock.");
  }
  if (new Set(enteredCoreIds).size !== enteredCoreIds.length) {
    throw new Error("Entered core IDs must be unique at field lock.");
  }

  const selectedOwnedCoreId = required(
    input.selectedOwnedCoreId,
    "Selected owned core ID",
  );
  if (!enteredCoreIds.includes(selectedOwnedCoreId)) {
    throw new Error("The committed owned core must be in the locked field.");
  }
  const provisionalRecommendedCoreId =
    input.provisionalRecommendedCoreId === null
      ? null
      : required(
          input.provisionalRecommendedCoreId,
          "Provisional recommended core ID",
        );
  if (
    (input.preEntryStatus === "provisional" &&
      provisionalRecommendedCoreId === null) ||
    (input.preEntryStatus === "insufficient_evidence" &&
      provisionalRecommendedCoreId !== null)
  ) {
    throw new Error(
      "Pre-entry status and provisional recommended core are inconsistent.",
    );
  }
  if (
    !["provisional", "insufficient_evidence"].includes(input.preEntryStatus)
  ) {
    throw new Error("Pre-entry status is invalid.");
  }
  if (!input.userConfirmedCommittedEntry) {
    throw new Error("The user must confirm the committed entry.");
  }
  if (!input.raceSetToRun) {
    throw new Error("The race must be set to run before star observation.");
  }

  const warnings: string[] = [];
  if (input.preEntryStatus === "insufficient_evidence") {
    warnings.push(
      "The committed entry had no resolved pre-entry recommendation.",
    );
  } else if (selectedOwnedCoreId !== provisionalRecommendedCoreId) {
    warnings.push(
      "The committed owned core differs from the provisional pre-entry leader.",
    );
  }

  return {
    lockId,
    requestId,
    preEntryRankingId,
    lockedAt,
    gateCount,
    enteredCoreIds,
    selectedOwnedCoreId,
    provisionalRecommendedCoreId,
    selectionMatchedProvisionalLeader:
      provisionalRecommendedCoreId === null
        ? null
        : selectedOwnedCoreId === provisionalRecommendedCoreId,
    preEntryStatus: input.preEntryStatus,
    fieldStage: "locked_observation",
    commitmentStatus: "entry_committed",
    optionalObservationAllowed: true,
    replacementRecommendationAllowed: false,
    coreSwitchAllowed: false,
    raceEntryAllowed: false,
    currentRaceStarsCaptured: false,
    warnings,
  };
}
