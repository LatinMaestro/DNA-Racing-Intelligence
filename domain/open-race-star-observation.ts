export type OpenRaceGoldObservation =
  | Readonly<{ status: "assigned"; coreId: string }>
  | Readonly<{ status: "not_assigned" | "not_observed" | "not_applicable" }>;

export type OpenRaceBlueObservation =
  | Readonly<{ status: "assigned"; coreId: string }>
  | Readonly<{ status: "not_assigned" | "not_observed" }>;

export type OpenRaceStarObservationInput = Readonly<{
  observationId: string;
  lockId: string;
  gameEventId: string | null;
  lockedAt: string;
  observedAt: string;
  fieldStage: "locked_observation";
  gateCount: number;
  enteredCoreIds: readonly string[];
  selectedOwnedCoreId: string;
  gold: OpenRaceGoldObservation;
  blue: OpenRaceBlueObservation;
  note: string | null;
}>;

export type OpenRaceStarObservationResult = Readonly<{
  observationId: string;
  lockId: string;
  gameEventId: string | null;
  observedAt: string;
  gateCount: number;
  enteredCoreIds: readonly string[];
  selectedOwnedCoreId: string;
  gold: OpenRaceGoldObservation;
  blue: OpenRaceBlueObservation;
  goldApplicable: boolean;
  selectedCoreSignal:
    | "both"
    | "gold_only"
    | "blue_only"
    | "neither_assigned"
    | "incomplete_observation";
  recordStatus: "recorded" | "review_required";
  issues: readonly string[];
  sourceType: "manual_pre_run_star_observation";
  observationOnly: true;
  authoritativeHistoricalEvidence: false;
  completedRaceResult: false;
  replacementRecommendationAllowed: false;
  reconciliationStatus: "pending_authoritative_import";
  note: string | null;
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

function rejectRaceOutcome(value: object): void {
  const forbiddenKey = Object.keys(value).find((key) =>
    /(finish|winner|prize|payout|elapsed|result|replacement|recommend)/i.test(
      key,
    ),
  );
  if (forbiddenKey !== undefined) {
    throw new Error(
      "Pre-run star observation cannot contain race outcomes or recommendations.",
    );
  }
}

function validateGold(
  signal: OpenRaceGoldObservation,
  enteredCoreIds: readonly string[],
): OpenRaceGoldObservation {
  if (
    !["assigned", "not_assigned", "not_observed", "not_applicable"].includes(
      signal.status,
    )
  ) {
    throw new Error("Gold observation status is invalid.");
  }
  if (signal.status === "assigned") {
    const coreId = required(signal.coreId, "Gold core ID");
    if (!enteredCoreIds.includes(coreId)) {
      throw new Error("Gold core must be in the locked field.");
    }
    return { status: "assigned", coreId };
  }
  return { status: signal.status };
}

function validateBlue(
  signal: OpenRaceBlueObservation,
  enteredCoreIds: readonly string[],
): OpenRaceBlueObservation {
  if (!["assigned", "not_assigned", "not_observed"].includes(signal.status)) {
    throw new Error("Blue observation status is invalid.");
  }
  if (signal.status === "assigned") {
    const coreId = required(signal.coreId, "Blue core ID");
    if (!enteredCoreIds.includes(coreId)) {
      throw new Error("Blue core must be in the locked field.");
    }
    return { status: "assigned", coreId };
  }
  return { status: signal.status };
}

export function recordOpenRaceStarObservation(
  input: OpenRaceStarObservationInput,
): OpenRaceStarObservationResult {
  rejectRaceOutcome(input);
  const observationId = required(input.observationId, "Observation ID");
  const lockId = required(input.lockId, "Lock ID");
  const gameEventId =
    input.gameEventId === null
      ? null
      : required(input.gameEventId, "Game event ID");
  const lockedAt = timestamp(input.lockedAt, "Lock time");
  const observedAt = timestamp(input.observedAt, "Observation time");
  if (Date.parse(observedAt) < Date.parse(lockedAt)) {
    throw new Error("Star observation cannot predate field lock.");
  }
  if (input.fieldStage !== "locked_observation") {
    throw new Error("Stars may be observed only after field lock.");
  }
  const gateCount = positiveSafeInteger(input.gateCount, "Gate count");
  const enteredCoreIds = input.enteredCoreIds.map((coreId) =>
    required(coreId, "Entered core ID"),
  );
  if (enteredCoreIds.length !== gateCount) {
    throw new Error("Locked entered-core count must equal gate count.");
  }
  if (new Set(enteredCoreIds).size !== enteredCoreIds.length) {
    throw new Error("Locked entered-core IDs must be unique.");
  }
  const selectedOwnedCoreId = required(
    input.selectedOwnedCoreId,
    "Selected owned core ID",
  );
  if (!enteredCoreIds.includes(selectedOwnedCoreId)) {
    throw new Error("Selected owned core must be in the locked field.");
  }

  const gold = validateGold(input.gold, enteredCoreIds);
  const blue = validateBlue(input.blue, enteredCoreIds);
  const goldApplicable = gateCount > 3;
  const issues: string[] = [];
  if (!goldApplicable && gold.status !== "not_applicable") {
    issues.push(
      "Gold is not applicable at three gates or fewer; preserve this observation as an anomaly.",
    );
  }
  if (goldApplicable && gold.status === "not_applicable") {
    issues.push(
      "Gold was applicable at this gate count; not-applicable requires review.",
    );
  }

  const selectedGold =
    gold.status === "assigned" && gold.coreId === selectedOwnedCoreId;
  const selectedBlue =
    blue.status === "assigned" && blue.coreId === selectedOwnedCoreId;
  const observationComplete =
    gold.status !== "not_observed" && blue.status !== "not_observed";
  const selectedCoreSignal = !observationComplete
    ? "incomplete_observation"
    : selectedGold && selectedBlue
      ? "both"
      : selectedGold
        ? "gold_only"
        : selectedBlue
          ? "blue_only"
          : "neither_assigned";
  const note =
    input.note === null ? null : required(input.note, "Observation note");

  return {
    observationId,
    lockId,
    gameEventId,
    observedAt,
    gateCount,
    enteredCoreIds,
    selectedOwnedCoreId,
    gold,
    blue,
    goldApplicable,
    selectedCoreSignal,
    recordStatus: issues.length === 0 ? "recorded" : "review_required",
    issues,
    sourceType: "manual_pre_run_star_observation",
    observationOnly: true,
    authoritativeHistoricalEvidence: false,
    completedRaceResult: false,
    replacementRecommendationAllowed: false,
    reconciliationStatus: "pending_authoritative_import",
    note,
  };
}
