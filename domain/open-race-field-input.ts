export type OpenRaceMode = "bike" | "car" | "horse";

export type OpenRaceRestriction = Readonly<{
  restrictionId: string;
  kind: "class" | "element" | "f_number" | "maiden" | "other";
  value: string;
  evidenceStatus: "confirmed" | "uncertain";
}>;

export type OpenRaceOpponentInput = Readonly<{
  coreId: string;
  identityStatus: "confirmed" | "unresolved";
}>;

export type OpenRaceFieldInput = Readonly<{
  requestId: string;
  capturedAt: string;
  dataCurrentThrough: string;
  lastImported: string;
  freshness: "current" | "ageing" | "stale" | "unknown";
  mode: OpenRaceMode;
  distanceMeters: number;
  gateCount: number;
  availableGates: number;
  raceFormat: string;
  entryFee: Readonly<{
    amount: string;
    asset: string;
  }> | null;
  opponents: readonly OpenRaceOpponentInput[];
  restrictions: readonly OpenRaceRestriction[];
}>;

export type OpenRaceFieldResult = Readonly<{
  requestId: string;
  capturedAt: string;
  dataCurrentThrough: string;
  lastImported: string;
  freshness: OpenRaceFieldInput["freshness"];
  mode: OpenRaceMode;
  distanceMeters: number;
  gateCount: number;
  availableGates: number;
  raceFormat: string;
  entryFee: OpenRaceFieldInput["entryFee"];
  opponentCoreIds: readonly string[];
  restrictions: readonly OpenRaceRestriction[];
  status: "ready_for_provisional_selection" | "review_required";
  reviewReasons: readonly string[];
  fieldStage: "forming";
  currentRaceStarsAccepted: false;
  historicalSnapshotOnly: true;
  liveGameConnection: false;
  sourceDisclosure: string;
}>;

const modes: readonly OpenRaceMode[] = ["bike", "car", "horse"];
const restrictionKinds: readonly OpenRaceRestriction["kind"][] = [
  "class",
  "element",
  "f_number",
  "maiden",
  "other",
];

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

function exactNonNegativeDecimal(value: string, label: string): string {
  const normalized = required(value, label);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) {
    throw new Error(`${label} must be an exact non-negative decimal.`);
  }
  return normalized;
}

function rejectCurrentRaceStars(value: object, label: string): void {
  const forbiddenKey = Object.keys(value).find((key) =>
    /(gold|blue|star)/i.test(key),
  );
  if (forbiddenKey !== undefined) {
    throw new Error(
      `${label} cannot contain current-race star input while the field is forming.`,
    );
  }
}

export function validateOpenRaceField(
  input: OpenRaceFieldInput,
): OpenRaceFieldResult {
  rejectCurrentRaceStars(input, "Open Race field");
  const requestId = required(input.requestId, "Request ID");
  const capturedAt = timestamp(input.capturedAt, "Capture time");
  const dataCurrentThrough = timestamp(
    input.dataCurrentThrough,
    "Data current through",
  );
  const lastImported = timestamp(input.lastImported, "Last imported");
  if (Date.parse(lastImported) < Date.parse(dataCurrentThrough)) {
    throw new Error("Last imported cannot precede data current through.");
  }
  if (Date.parse(capturedAt) < Date.parse(lastImported)) {
    throw new Error("Field capture cannot predate imported evidence.");
  }
  if (!["current", "ageing", "stale", "unknown"].includes(input.freshness)) {
    throw new Error("Open Race freshness is invalid.");
  }
  if (!modes.includes(input.mode)) {
    throw new Error("Open Race mode is invalid.");
  }

  const distanceMeters = positiveSafeInteger(
    input.distanceMeters,
    "Distance metres",
  );
  const gateCount = positiveSafeInteger(input.gateCount, "Gate count");
  const availableGates = positiveSafeInteger(
    input.availableGates,
    "Available gates",
  );
  if (availableGates > gateCount) {
    throw new Error("Available gates cannot exceed gate count.");
  }

  const opponentCoreIds = input.opponents.map(({ coreId }) =>
    required(coreId, "Opponent core ID"),
  );
  if (new Set(opponentCoreIds).size !== opponentCoreIds.length) {
    throw new Error("Opponent core IDs must be unique.");
  }
  if (opponentCoreIds.length + availableGates !== gateCount) {
    throw new Error(
      "Entered opponents plus available gates must equal gate count.",
    );
  }

  const restrictionIds = input.restrictions.map(({ restrictionId }) =>
    required(restrictionId, "Restriction ID"),
  );
  if (new Set(restrictionIds).size !== restrictionIds.length) {
    throw new Error("Restriction IDs must be unique.");
  }
  const restrictions = input.restrictions.map((restriction) => {
    if (!restrictionKinds.includes(restriction.kind)) {
      throw new Error(
        `Restriction kind is invalid for ${restriction.restrictionId}.`,
      );
    }
    if (!["confirmed", "uncertain"].includes(restriction.evidenceStatus)) {
      throw new Error(
        `Restriction evidence status is invalid for ${restriction.restrictionId}.`,
      );
    }
    return {
      restrictionId: required(restriction.restrictionId, "Restriction ID"),
      kind: restriction.kind,
      value: required(restriction.value, "Restriction value"),
      evidenceStatus: restriction.evidenceStatus,
    };
  });

  const entryFee =
    input.entryFee === null
      ? null
      : {
          amount: exactNonNegativeDecimal(
            input.entryFee.amount,
            "Entry fee amount",
          ),
          asset: required(input.entryFee.asset, "Entry fee asset"),
        };
  const raceFormat = required(input.raceFormat, "Race format");
  const reviewReasons: string[] = [];
  if (input.freshness === "stale" || input.freshness === "unknown") {
    reviewReasons.push("Historical evidence is stale or freshness is unknown.");
  }
  if (
    input.opponents.some(
      ({ identityStatus }) => identityStatus === "unresolved",
    )
  ) {
    reviewReasons.push("One or more opponent identities are unresolved.");
  }
  if (
    input.opponents.some(
      ({ identityStatus }) =>
        !["confirmed", "unresolved"].includes(identityStatus),
    )
  ) {
    throw new Error("Opponent identity status is invalid.");
  }
  if (
    restrictions.some(({ evidenceStatus }) => evidenceStatus === "uncertain")
  ) {
    reviewReasons.push("One or more eligibility restrictions are uncertain.");
  }

  return {
    requestId,
    capturedAt,
    dataCurrentThrough,
    lastImported,
    freshness: input.freshness,
    mode: input.mode,
    distanceMeters,
    gateCount,
    availableGates,
    raceFormat,
    entryFee,
    opponentCoreIds,
    restrictions,
    status:
      reviewReasons.length === 0
        ? "ready_for_provisional_selection"
        : "review_required",
    reviewReasons,
    fieldStage: "forming",
    currentRaceStarsAccepted: false,
    historicalSnapshotOnly: true,
    liveGameConnection: false,
    sourceDisclosure:
      "Current race parameters are manually entered. Historical evidence is imported and is not live game data.",
  };
}
