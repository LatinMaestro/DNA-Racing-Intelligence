export const eligibilityCoreClasses = [
  "Genesis",
  "Morphed",
  "Freak",
  "X-Class",
] as const;
export type EligibilityCoreClass = (typeof eligibilityCoreClasses)[number];

export const eligibilityElements = ["Metal", "Fire", "Earth", "Water"] as const;
export type EligibilityElement = (typeof eligibilityElements)[number];

export type EligibilityFNumberRange = Readonly<{
  minimum: number;
  maximum: number;
}>;

export type TournamentLeaderboardGroupInput = Readonly<{
  groupId: string;
  label: string;
  classes: readonly EligibilityCoreClass[];
  elements: readonly EligibilityElement[];
  fNumbers: readonly EligibilityFNumberRange[];
}>;

export type TournamentEligibilityRuleInput = Readonly<{
  bracketId: string;
  classes: readonly EligibilityCoreClass[];
  elements: readonly EligibilityElement[];
  fNumbers: readonly EligibilityFNumberRange[];
  maidenRequirement: "any" | "maiden_eligible" | "not_maiden_eligible";
  leaderboardGroups: readonly TournamentLeaderboardGroupInput[];
}>;

export type TournamentEligibilityCoreInput = Readonly<{
  coreId: string;
  coreClass: EligibilityCoreClass | null;
  element: EligibilityElement | null;
  fNumber: number | null;
  activeOwned: boolean;
  identityResolved: boolean;
  maidenState: "eligible" | "not_eligible" | "unknown" | "invalid";
  availability: "available" | "unavailable" | "unknown";
  dataCurrentThrough: string | null;
  lastImported: string | null;
  freshness: "current" | "ageing" | "stale" | "unknown";
}>;

export type TournamentEligibilityReason =
  | "NOT_ACTIVE_OWNED"
  | "CORE_UNAVAILABLE"
  | "CLASS_INELIGIBLE"
  | "ELEMENT_INELIGIBLE"
  | "F_NUMBER_INELIGIBLE"
  | "MAIDEN_REQUIRED"
  | "MAIDEN_NOT_PERMITTED";

export type TournamentEligibilityWarning =
  | "IDENTITY_UNRESOLVED"
  | "CORE_ATTRIBUTE_INCOMPLETE"
  | "MAIDEN_STATE_UNRESOLVED"
  | "AVAILABILITY_UNKNOWN"
  | "LEADERBOARD_GROUP_UNRESOLVED"
  | "LEADERBOARD_GROUP_AMBIGUOUS"
  | "DATA_CUTOFF_UNKNOWN"
  | "LAST_IMPORTED_UNKNOWN"
  | "IMPORTED_DATA_AGEING"
  | "IMPORTED_DATA_STALE";

export type TournamentEligibilityResult = Readonly<{
  coreId: string;
  bracketId: string;
  status: "eligible" | "ineligible" | "review_required";
  leaderboardGroupId: string | null;
  reasons: readonly TournamentEligibilityReason[];
  warnings: readonly TournamentEligibilityWarning[];
  dataCurrentThrough: string | null;
  lastImported: string | null;
  freshness: TournamentEligibilityCoreInput["freshness"];
  performanceEvidenceUsed: false;
  starEvidenceUsed: false;
  automaticEntryAllowed: false;
}>;

type NormalizedGroup = Readonly<{
  groupId: string;
  label: string;
  classes: readonly EligibilityCoreClass[];
  elements: readonly EligibilityElement[];
  fNumbers: readonly EligibilityFNumberRange[];
}>;

type NormalizedRule = Readonly<{
  bracketId: string;
  classes: readonly EligibilityCoreClass[];
  elements: readonly EligibilityElement[];
  fNumbers: readonly EligibilityFNumberRange[];
  maidenRequirement: TournamentEligibilityRuleInput["maidenRequirement"];
  leaderboardGroups: readonly NormalizedGroup[];
}>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function optionalTimestamp(value: string | null, label: string): string | null {
  if (value === null) return null;
  const parsed = Date.parse(required(value, label));
  if (Number.isNaN(parsed)) throw new Error(`${label} must be valid.`);
  return new Date(parsed).toISOString();
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function normalizeEnumValues<T extends string>(
  values: readonly T[],
  allowed: readonly T[],
  label: string,
): readonly T[] {
  for (const value of values) {
    if (!allowed.includes(value)) throw new Error(`${label} is invalid.`);
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return [...values].sort((left, right) => left.localeCompare(right));
}

function normalizeRanges(
  values: readonly EligibilityFNumberRange[],
  label: string,
): readonly EligibilityFNumberRange[] {
  const normalized = values
    .map((range) => ({
      minimum: positiveInteger(range.minimum, `${label} minimum`),
      maximum: positiveInteger(range.maximum, `${label} maximum`),
    }))
    .sort(
      (left, right) =>
        left.minimum - right.minimum || left.maximum - right.maximum,
    );
  for (const [index, range] of normalized.entries()) {
    if (range.minimum > range.maximum) {
      throw new Error(`${label} minimum cannot exceed maximum.`);
    }
    const previous = normalized[index - 1];
    if (previous && range.minimum <= previous.maximum) {
      throw new Error(`${label} ranges must not overlap.`);
    }
  }
  return normalized;
}

function normalizeGroup(
  input: TournamentLeaderboardGroupInput,
): NormalizedGroup {
  const classes = normalizeEnumValues(
    input.classes,
    eligibilityCoreClasses,
    "Leaderboard class",
  );
  const elements = normalizeEnumValues(
    input.elements,
    eligibilityElements,
    "Leaderboard element",
  );
  const fNumbers = normalizeRanges(input.fNumbers, "Leaderboard F-number");
  if (classes.length === 0 && elements.length === 0 && fNumbers.length === 0) {
    throw new Error(
      "A leaderboard group requires at least one eligibility criterion.",
    );
  }
  return {
    groupId: required(input.groupId, "Leaderboard group ID"),
    label: required(input.label, "Leaderboard group label"),
    classes,
    elements,
    fNumbers,
  };
}

function normalizeRule(input: TournamentEligibilityRuleInput): NormalizedRule {
  if (
    !["any", "maiden_eligible", "not_maiden_eligible"].includes(
      input.maidenRequirement,
    )
  ) {
    throw new Error("Maiden requirement is invalid.");
  }
  const leaderboardGroups = input.leaderboardGroups
    .map(normalizeGroup)
    .sort((left, right) => left.groupId.localeCompare(right.groupId));
  if (
    new Set(leaderboardGroups.map((group) => group.groupId)).size !==
    leaderboardGroups.length
  ) {
    throw new Error("Leaderboard group IDs must be unique.");
  }
  return {
    bracketId: required(input.bracketId, "Bracket ID"),
    classes: normalizeEnumValues(
      input.classes,
      eligibilityCoreClasses,
      "Eligible class",
    ),
    elements: normalizeEnumValues(
      input.elements,
      eligibilityElements,
      "Eligible element",
    ),
    fNumbers: normalizeRanges(input.fNumbers, "Eligible F-number"),
    maidenRequirement: input.maidenRequirement,
    leaderboardGroups,
  };
}

function matchesRange(
  value: number,
  ranges: readonly EligibilityFNumberRange[],
): boolean {
  return ranges.some(
    (range) => value >= range.minimum && value <= range.maximum,
  );
}

function matchesGroup(
  core: TournamentEligibilityCoreInput,
  group: NormalizedGroup,
): boolean {
  return (
    (group.classes.length === 0 ||
      (core.coreClass !== null && group.classes.includes(core.coreClass))) &&
    (group.elements.length === 0 ||
      (core.element !== null && group.elements.includes(core.element))) &&
    (group.fNumbers.length === 0 ||
      (core.fNumber !== null && matchesRange(core.fNumber, group.fNumbers)))
  );
}

export function evaluateTournamentEligibility(
  ruleInput: TournamentEligibilityRuleInput,
  core: TournamentEligibilityCoreInput,
): TournamentEligibilityResult {
  const rule = normalizeRule(ruleInput);
  const coreId = required(core.coreId, "Core ID");
  if (typeof core.activeOwned !== "boolean") {
    throw new Error("Active ownership must be Boolean.");
  }
  if (typeof core.identityResolved !== "boolean") {
    throw new Error("Identity resolution must be Boolean.");
  }
  if (
    !["eligible", "not_eligible", "unknown", "invalid"].includes(
      core.maidenState,
    )
  ) {
    throw new Error("Maiden state is invalid.");
  }
  if (!["available", "unavailable", "unknown"].includes(core.availability)) {
    throw new Error("Core availability is invalid.");
  }
  if (!["current", "ageing", "stale", "unknown"].includes(core.freshness)) {
    throw new Error("Eligibility freshness is invalid.");
  }
  if (
    core.coreClass !== null &&
    !eligibilityCoreClasses.includes(core.coreClass)
  ) {
    throw new Error("Core class is invalid.");
  }
  if (core.element !== null && !eligibilityElements.includes(core.element)) {
    throw new Error("Core element is invalid.");
  }
  if (core.fNumber !== null) {
    positiveInteger(core.fNumber, "Core F-number");
  }

  const dataCurrentThrough = optionalTimestamp(
    core.dataCurrentThrough,
    "Data current through",
  );
  const lastImported = optionalTimestamp(core.lastImported, "Last imported");
  const reasons = new Set<TournamentEligibilityReason>();
  const warnings = new Set<TournamentEligibilityWarning>();

  if (!core.activeOwned) reasons.add("NOT_ACTIVE_OWNED");
  if (core.availability === "unavailable") reasons.add("CORE_UNAVAILABLE");
  if (!core.identityResolved) warnings.add("IDENTITY_UNRESOLVED");
  const classRequired =
    rule.classes.length > 0 ||
    rule.leaderboardGroups.some((group) => group.classes.length > 0);
  const elementRequired =
    rule.elements.length > 0 ||
    rule.leaderboardGroups.some((group) => group.elements.length > 0);
  const fNumberRequired =
    rule.fNumbers.length > 0 ||
    rule.leaderboardGroups.some((group) => group.fNumbers.length > 0);
  if (
    (classRequired && core.coreClass === null) ||
    (elementRequired && core.element === null) ||
    (fNumberRequired && core.fNumber === null)
  ) {
    warnings.add("CORE_ATTRIBUTE_INCOMPLETE");
  }
  if (core.availability === "unknown") warnings.add("AVAILABILITY_UNKNOWN");
  if (
    rule.maidenRequirement !== "any" &&
    ["unknown", "invalid"].includes(core.maidenState)
  ) {
    warnings.add("MAIDEN_STATE_UNRESOLVED");
  }
  if (
    rule.classes.length > 0 &&
    core.coreClass !== null &&
    !rule.classes.includes(core.coreClass)
  ) {
    reasons.add("CLASS_INELIGIBLE");
  }
  if (
    rule.elements.length > 0 &&
    core.element !== null &&
    !rule.elements.includes(core.element)
  ) {
    reasons.add("ELEMENT_INELIGIBLE");
  }
  if (
    rule.fNumbers.length > 0 &&
    core.fNumber !== null &&
    !matchesRange(core.fNumber, rule.fNumbers)
  ) {
    reasons.add("F_NUMBER_INELIGIBLE");
  }
  if (
    rule.maidenRequirement === "maiden_eligible" &&
    core.maidenState === "not_eligible"
  ) {
    reasons.add("MAIDEN_REQUIRED");
  }
  if (
    rule.maidenRequirement === "not_maiden_eligible" &&
    core.maidenState === "eligible"
  ) {
    reasons.add("MAIDEN_NOT_PERMITTED");
  }

  const matchedGroups = rule.leaderboardGroups.filter((group) =>
    matchesGroup(core, group),
  );
  let leaderboardGroupId: string | null = null;
  if (rule.leaderboardGroups.length > 0 && matchedGroups.length === 0) {
    warnings.add("LEADERBOARD_GROUP_UNRESOLVED");
  } else if (matchedGroups.length > 1) {
    warnings.add("LEADERBOARD_GROUP_AMBIGUOUS");
  } else if (matchedGroups[0]) {
    leaderboardGroupId = matchedGroups[0].groupId;
  }

  if (dataCurrentThrough === null || core.freshness === "unknown") {
    warnings.add("DATA_CUTOFF_UNKNOWN");
  }
  if (lastImported === null) warnings.add("LAST_IMPORTED_UNKNOWN");
  if (
    dataCurrentThrough !== null &&
    lastImported !== null &&
    Date.parse(lastImported) < Date.parse(dataCurrentThrough)
  ) {
    throw new Error("Last imported cannot precede data current through.");
  }
  if (core.freshness === "ageing") warnings.add("IMPORTED_DATA_AGEING");
  if (core.freshness === "stale") warnings.add("IMPORTED_DATA_STALE");

  return {
    coreId,
    bracketId: rule.bracketId,
    status:
      reasons.size > 0
        ? "ineligible"
        : warnings.size > 0
          ? "review_required"
          : "eligible",
    leaderboardGroupId,
    reasons: [...reasons].sort(),
    warnings: [...warnings].sort(),
    dataCurrentThrough,
    lastImported,
    freshness: core.freshness,
    performanceEvidenceUsed: false,
    starEvidenceUsed: false,
    automaticEntryAllowed: false,
  };
}
