export type OpenRaceCoreClass = "Genesis" | "Morphed" | "Freak" | "X-Class";
export type OpenRaceElement = "Metal" | "Fire" | "Earth" | "Water";

export type OpenRaceEligibilityRules = Readonly<{
  ruleSetId: string;
  evidenceStatus: "confirmed" | "uncertain";
  allowedClasses: readonly OpenRaceCoreClass[] | null;
  allowedElements: readonly OpenRaceElement[] | null;
  minimumFNumber: number | null;
  maximumFNumber: number | null;
  maidenRequirement: "required" | "excluded" | "not_restricted";
}>;

export type OpenRaceEligibilityCore = Readonly<{
  coreId: string;
  activeOwnership: "confirmed" | "not_owned" | "unresolved";
  availability: "available" | "unavailable" | "unresolved";
  coreClass: OpenRaceCoreClass | null;
  element: OpenRaceElement | null;
  fNumber: number | null;
  maidenState: "eligible" | "not_eligible" | "unknown" | "invalid";
  attributeEvidence: "complete" | "partial" | "invalid";
}>;

export type OpenRaceEligibilityInput = Readonly<{
  evaluationId: string;
  evaluatedAt: string;
  vaultDataCurrentThrough: string;
  freshness: "current" | "ageing" | "stale" | "unknown";
  rules: OpenRaceEligibilityRules;
  cores: readonly OpenRaceEligibilityCore[];
}>;

export type OpenRaceEligibilityResult = Readonly<{
  evaluationId: string;
  evaluatedAt: string;
  vaultDataCurrentThrough: string;
  freshness: OpenRaceEligibilityInput["freshness"];
  eligibleCoreIds: readonly string[];
  cores: readonly Readonly<{
    coreId: string;
    status: "eligible" | "ineligible" | "review_required";
    reasons: readonly string[];
  }>[];
  rankingPerformed: false;
  recommendationMade: false;
  currentRaceStarsUsed: false;
  ownershipMutated: false;
}>;

const classes: readonly OpenRaceCoreClass[] = [
  "Genesis",
  "Morphed",
  "Freak",
  "X-Class",
];
const elements: readonly OpenRaceElement[] = [
  "Metal",
  "Fire",
  "Earth",
  "Water",
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

function fNumber(value: number | null, label: string): void {
  if (value !== null && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new Error(`${label} must be a positive safe integer or null.`);
  }
}

function uniqueValues<T>(values: readonly T[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
}

function rejectStarFields(value: object, label: string): void {
  const forbiddenKey = Object.keys(value).find((key) =>
    /(gold|blue|star)/i.test(key),
  );
  if (forbiddenKey !== undefined) {
    throw new Error(`${label} cannot contain current-race star evidence.`);
  }
}

export function evaluateOpenRaceEligibility(
  input: OpenRaceEligibilityInput,
): OpenRaceEligibilityResult {
  rejectStarFields(input, "Open Race eligibility");
  const evaluationId = required(input.evaluationId, "Evaluation ID");
  const evaluatedAt = timestamp(input.evaluatedAt, "Evaluation time");
  const vaultDataCurrentThrough = timestamp(
    input.vaultDataCurrentThrough,
    "Vault data current through",
  );
  if (Date.parse(evaluatedAt) < Date.parse(vaultDataCurrentThrough)) {
    throw new Error("Evaluation cannot predate Vault evidence.");
  }
  if (!["current", "ageing", "stale", "unknown"].includes(input.freshness)) {
    throw new Error("Vault freshness is invalid.");
  }

  required(input.rules.ruleSetId, "Rule-set ID");
  if (!["confirmed", "uncertain"].includes(input.rules.evidenceStatus)) {
    throw new Error("Rule-set evidence status is invalid.");
  }
  if (
    !["required", "excluded", "not_restricted"].includes(
      input.rules.maidenRequirement,
    )
  ) {
    throw new Error("Maiden requirement is invalid.");
  }
  if (input.rules.allowedClasses !== null) {
    uniqueValues(input.rules.allowedClasses, "Allowed classes");
    if (
      input.rules.allowedClasses.length === 0 ||
      input.rules.allowedClasses.some((value) => !classes.includes(value))
    ) {
      throw new Error("Allowed classes must contain supported values.");
    }
  }
  if (input.rules.allowedElements !== null) {
    uniqueValues(input.rules.allowedElements, "Allowed elements");
    if (
      input.rules.allowedElements.length === 0 ||
      input.rules.allowedElements.some((value) => !elements.includes(value))
    ) {
      throw new Error("Allowed elements must contain supported values.");
    }
  }
  fNumber(input.rules.minimumFNumber, "Minimum F-number");
  fNumber(input.rules.maximumFNumber, "Maximum F-number");
  if (
    input.rules.minimumFNumber !== null &&
    input.rules.maximumFNumber !== null &&
    input.rules.minimumFNumber > input.rules.maximumFNumber
  ) {
    throw new Error("Minimum F-number cannot exceed maximum F-number.");
  }

  const coreIds = input.cores.map(({ coreId }) => required(coreId, "Core ID"));
  uniqueValues(coreIds, "Core IDs");
  const globalReview =
    input.rules.evidenceStatus !== "confirmed" ||
    input.freshness === "stale" ||
    input.freshness === "unknown";

  const cores = input.cores.map((core) => {
    const coreId = required(core.coreId, "Core ID");
    rejectStarFields(core, `Eligibility core ${coreId}`);
    if (
      !["confirmed", "not_owned", "unresolved"].includes(core.activeOwnership)
    ) {
      throw new Error(`Ownership status is invalid for ${coreId}.`);
    }
    if (
      !["available", "unavailable", "unresolved"].includes(core.availability)
    ) {
      throw new Error(`Availability status is invalid for ${coreId}.`);
    }
    if (core.coreClass !== null && !classes.includes(core.coreClass)) {
      throw new Error(`Core class is invalid for ${coreId}.`);
    }
    if (core.element !== null && !elements.includes(core.element)) {
      throw new Error(`Element is invalid for ${coreId}.`);
    }
    fNumber(core.fNumber, `F-number for ${coreId}`);
    if (
      !["eligible", "not_eligible", "unknown", "invalid"].includes(
        core.maidenState,
      )
    ) {
      throw new Error(`Maiden state is invalid for ${coreId}.`);
    }
    if (!["complete", "partial", "invalid"].includes(core.attributeEvidence)) {
      throw new Error(`Attribute evidence is invalid for ${coreId}.`);
    }

    const reasons: string[] = [];
    let status: "eligible" | "ineligible" | "review_required" = "eligible";
    if (globalReview) {
      status = "review_required";
      reasons.push(
        "Eligibility rules or Vault freshness require manual confirmation.",
      );
    }
    if (
      core.activeOwnership === "unresolved" ||
      core.availability === "unresolved" ||
      core.attributeEvidence !== "complete" ||
      core.coreClass === null ||
      core.element === null ||
      core.fNumber === null
    ) {
      status = "review_required";
      reasons.push(
        "Core ownership, availability or attributes are unresolved.",
      );
    }
    if (core.activeOwnership === "not_owned") {
      status = "ineligible";
      reasons.push("Core is not confirmed in the active Vault.");
    }
    if (core.availability === "unavailable") {
      status = "ineligible";
      reasons.push("Core is manually unavailable.");
    }
    if (
      input.rules.evidenceStatus === "confirmed" &&
      core.coreClass !== null &&
      input.rules.allowedClasses !== null &&
      !input.rules.allowedClasses.includes(core.coreClass)
    ) {
      status = "ineligible";
      reasons.push("Core class is outside the confirmed race restrictions.");
    }
    if (
      input.rules.evidenceStatus === "confirmed" &&
      core.element !== null &&
      input.rules.allowedElements !== null &&
      !input.rules.allowedElements.includes(core.element)
    ) {
      status = "ineligible";
      reasons.push("Core element is outside the confirmed race restrictions.");
    }
    if (
      input.rules.evidenceStatus === "confirmed" &&
      core.fNumber !== null &&
      ((input.rules.minimumFNumber !== null &&
        core.fNumber < input.rules.minimumFNumber) ||
        (input.rules.maximumFNumber !== null &&
          core.fNumber > input.rules.maximumFNumber))
    ) {
      status = "ineligible";
      reasons.push("Core F-number is outside the confirmed race restrictions.");
    }
    if (
      input.rules.evidenceStatus === "confirmed" &&
      input.rules.maidenRequirement === "required"
    ) {
      if (core.maidenState === "not_eligible") {
        status = "ineligible";
        reasons.push("The race requires confirmed Maiden eligibility.");
      } else if (core.maidenState !== "eligible") {
        status = "review_required";
        reasons.push("Maiden eligibility is unresolved.");
      }
    }
    if (
      input.rules.evidenceStatus === "confirmed" &&
      input.rules.maidenRequirement === "excluded"
    ) {
      if (core.maidenState === "eligible") {
        status = "ineligible";
        reasons.push("The race excludes Maiden Eligible cores.");
      } else if (
        core.maidenState === "unknown" ||
        core.maidenState === "invalid"
      ) {
        status = "review_required";
        reasons.push("Maiden eligibility is unresolved.");
      }
    }
    return { coreId, status, reasons: [...new Set(reasons)] };
  });

  return {
    evaluationId,
    evaluatedAt,
    vaultDataCurrentThrough,
    freshness: input.freshness,
    eligibleCoreIds: cores
      .filter(({ status }) => status === "eligible")
      .map(({ coreId }) => coreId)
      .sort(),
    cores,
    rankingPerformed: false,
    recommendationMade: false,
    currentRaceStarsUsed: false,
    ownershipMutated: false,
  };
}
