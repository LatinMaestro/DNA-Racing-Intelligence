import {
  coreClasses,
  elements,
  offspringClass,
  offspringElement,
  offspringFNumber,
  type CoreClass,
  type Element,
} from "@/domain/game-rules";
import {
  evaluateFamilyPair,
  type FamilyPairDecision,
  type LineageCore,
} from "@/domain/lineage";

export type BreedingParentRuleInput = Readonly<{
  coreId: string;
  coreClass: CoreClass;
  element: Element;
  fNumber: number;
  selectionStatus: "selected" | "inactive" | "unknown";
  availability: "available" | "unavailable" | "unknown";
  spliceCapacityStatus: "available" | "exhausted" | "unknown";
  remainingSplices: number | null;
  cycleStatus: "ready" | "cooldown" | "unknown";
  nextEligibleAt: string | null;
  dataCurrentThrough: string | null;
  lastImported: string | null;
  freshness: "current" | "ageing" | "stale" | "unknown";
}>;

export type BreedingPairRuleInput = Readonly<{
  parentA: BreedingParentRuleInput;
  parentB: BreedingParentRuleInput;
  lineage: readonly LineageCore[];
  evaluatedAt: string;
}>;

export type BreedingPairRuleWarning =
  | "GATE_E_NOT_PASSED"
  | "FAMILY_INELIGIBLE"
  | "FAMILY_REVIEW_REQUIRED"
  | "PARENT_INACTIVE"
  | "PARENT_SELECTION_UNKNOWN"
  | "PARENT_UNAVAILABLE"
  | "PARENT_AVAILABILITY_UNKNOWN"
  | "SPLICE_CAPACITY_EXHAUSTED"
  | "SPLICE_CAPACITY_UNKNOWN"
  | "BREEDING_CYCLE_COOLDOWN"
  | "BREEDING_CYCLE_UNKNOWN"
  | "DATA_CUTOFF_UNKNOWN"
  | "LAST_IMPORTED_UNKNOWN"
  | "IMPORTED_DATA_AGEING"
  | "IMPORTED_DATA_STALE"
  | "STAR_INHERITANCE_NOT_ASSUMED";

export type BreedingPairRuleEvaluation = Readonly<{
  parentCoreIds: readonly [string, string];
  status:
    | "rule_eligible"
    | "family_ineligible"
    | "temporarily_unavailable"
    | "review_required";
  familyDecision: FamilyPairDecision;
  offspring: Readonly<{
    coreClass: CoreClass;
    element: Element;
    fNumber: number;
  }>;
  parentStates: readonly Readonly<{
    coreId: string;
    remainingSplices: number | null;
    cycleStatus: BreedingParentRuleInput["cycleStatus"];
    nextEligibleAt: string | null;
    dataCurrentThrough: string | null;
    lastImported: string | null;
    freshness: BreedingParentRuleInput["freshness"];
  }>[];
  warnings: readonly BreedingPairRuleWarning[];
  ruleEligible: boolean;
  offspringQualityPredicted: false;
  historicalStarsUsedAsInheritedTrait: false;
  recommendationAllowed: false;
  breedingExecutionAllowed: false;
}>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function timestamp(value: string | null, label: string): string | null {
  if (value === null) return null;
  const parsed = Date.parse(required(value, label));
  if (Number.isNaN(parsed)) throw new Error(`${label} must be valid.`);
  return new Date(parsed).toISOString();
}

function normalizeParent(
  input: BreedingParentRuleInput,
  evaluatedAt: string,
): BreedingParentRuleInput {
  const coreId = required(input.coreId, "Parent core ID");
  if (!coreClasses.includes(input.coreClass)) {
    throw new Error("Parent class is invalid.");
  }
  if (!elements.includes(input.element)) {
    throw new Error("Parent element is invalid.");
  }
  if (!["selected", "inactive", "unknown"].includes(input.selectionStatus)) {
    throw new Error("Parent selection status is invalid.");
  }
  if (!["available", "unavailable", "unknown"].includes(input.availability)) {
    throw new Error("Parent availability is invalid.");
  }
  if (
    !["available", "exhausted", "unknown"].includes(input.spliceCapacityStatus)
  ) {
    throw new Error("Parent splice-capacity status is invalid.");
  }
  if (!["ready", "cooldown", "unknown"].includes(input.cycleStatus)) {
    throw new Error("Parent breeding-cycle status is invalid.");
  }
  if (!["current", "ageing", "stale", "unknown"].includes(input.freshness)) {
    throw new Error("Parent freshness is invalid.");
  }
  if (!Number.isSafeInteger(input.fNumber) || input.fNumber <= 0) {
    throw new Error("Parent F-number must be a positive safe integer.");
  }
  if (
    input.remainingSplices !== null &&
    (!Number.isSafeInteger(input.remainingSplices) ||
      input.remainingSplices < 0)
  ) {
    throw new Error(
      "Remaining splices must be a non-negative safe integer or null.",
    );
  }
  if (
    (input.spliceCapacityStatus === "available" &&
      (input.remainingSplices === null || input.remainingSplices <= 0)) ||
    (input.spliceCapacityStatus === "exhausted" &&
      input.remainingSplices !== 0) ||
    (input.spliceCapacityStatus === "unknown" &&
      input.remainingSplices !== null)
  ) {
    throw new Error(
      "Splice-capacity status and remaining-splice evidence are inconsistent.",
    );
  }

  const nextEligibleAt = timestamp(
    input.nextEligibleAt,
    "Parent next-eligible time",
  );
  if ((input.cycleStatus === "cooldown") !== (nextEligibleAt !== null)) {
    throw new Error(
      "Only a confirmed cooldown requires one next-eligible timestamp.",
    );
  }
  if (
    nextEligibleAt !== null &&
    Date.parse(nextEligibleAt) <= Date.parse(evaluatedAt)
  ) {
    throw new Error(
      "A confirmed cooldown next-eligible time must follow evaluation.",
    );
  }

  const dataCurrentThrough = timestamp(
    input.dataCurrentThrough,
    "Parent data current through",
  );
  const lastImported = timestamp(input.lastImported, "Parent last imported");
  if (
    dataCurrentThrough !== null &&
    lastImported !== null &&
    Date.parse(lastImported) < Date.parse(dataCurrentThrough)
  ) {
    throw new Error(
      "Parent last imported cannot precede data current through.",
    );
  }

  return {
    ...input,
    coreId,
    nextEligibleAt,
    dataCurrentThrough,
    lastImported,
  };
}

export function evaluateBreedingPairRules(
  input: BreedingPairRuleInput,
): BreedingPairRuleEvaluation {
  const evaluatedAt = timestamp(input.evaluatedAt, "Evaluation time");
  if (evaluatedAt === null) throw new Error("Evaluation time is required.");
  const parentA = normalizeParent(input.parentA, evaluatedAt);
  const parentB = normalizeParent(input.parentB, evaluatedAt);
  if (parentA.coreId === parentB.coreId) {
    throw new Error("Breeding pair requires two distinct parent cores.");
  }
  if (!Number.isSafeInteger(parentA.fNumber + parentB.fNumber)) {
    throw new Error("Offspring F-number must remain an exact safe integer.");
  }
  const lineageById = new Map(
    input.lineage.map((core) => [core.coreId, core] as const),
  );
  for (const parent of [parentA, parentB]) {
    const lineageCore = lineageById.get(parent.coreId);
    if (lineageCore?.coreClass !== parent.coreClass) {
      throw new Error("Parent class must match the selected lineage evidence.");
    }
  }

  const familyDecision = evaluateFamilyPair(
    input.lineage,
    parentA.coreId,
    parentB.coreId,
  );
  const warnings = new Set<BreedingPairRuleWarning>([
    "GATE_E_NOT_PASSED",
    "STAR_INHERITANCE_NOT_ASSUMED",
  ]);
  if (familyDecision.status === "ineligible") {
    warnings.add("FAMILY_INELIGIBLE");
  }
  if (familyDecision.status === "review_required") {
    warnings.add("FAMILY_REVIEW_REQUIRED");
  }

  for (const parent of [parentA, parentB]) {
    if (parent.selectionStatus === "inactive") warnings.add("PARENT_INACTIVE");
    if (parent.selectionStatus === "unknown") {
      warnings.add("PARENT_SELECTION_UNKNOWN");
    }
    if (parent.availability === "unavailable") {
      warnings.add("PARENT_UNAVAILABLE");
    }
    if (parent.availability === "unknown") {
      warnings.add("PARENT_AVAILABILITY_UNKNOWN");
    }
    if (parent.spliceCapacityStatus === "exhausted") {
      warnings.add("SPLICE_CAPACITY_EXHAUSTED");
    }
    if (parent.spliceCapacityStatus === "unknown") {
      warnings.add("SPLICE_CAPACITY_UNKNOWN");
    }
    if (parent.cycleStatus === "cooldown") {
      warnings.add("BREEDING_CYCLE_COOLDOWN");
    }
    if (parent.cycleStatus === "unknown") {
      warnings.add("BREEDING_CYCLE_UNKNOWN");
    }
    if (parent.dataCurrentThrough === null || parent.freshness === "unknown") {
      warnings.add("DATA_CUTOFF_UNKNOWN");
    }
    if (parent.lastImported === null) warnings.add("LAST_IMPORTED_UNKNOWN");
    if (parent.freshness === "ageing") warnings.add("IMPORTED_DATA_AGEING");
    if (parent.freshness === "stale") warnings.add("IMPORTED_DATA_STALE");
  }

  const unavailable = [parentA, parentB].some(
    (parent) =>
      parent.selectionStatus === "inactive" ||
      parent.availability === "unavailable" ||
      parent.spliceCapacityStatus === "exhausted" ||
      parent.cycleStatus === "cooldown",
  );
  const unresolved = [parentA, parentB].some(
    (parent) =>
      parent.selectionStatus === "unknown" ||
      parent.availability === "unknown" ||
      parent.spliceCapacityStatus === "unknown" ||
      parent.cycleStatus === "unknown" ||
      parent.dataCurrentThrough === null ||
      parent.lastImported === null ||
      ["stale", "unknown"].includes(parent.freshness),
  );

  let status: BreedingPairRuleEvaluation["status"];
  if (familyDecision.status === "ineligible") {
    status = "family_ineligible";
  } else if (familyDecision.status === "review_required" || unresolved) {
    status = "review_required";
  } else if (unavailable) {
    status = "temporarily_unavailable";
  } else {
    status = "rule_eligible";
  }

  return {
    parentCoreIds: [parentA.coreId, parentB.coreId],
    status,
    familyDecision,
    offspring: {
      coreClass: offspringClass(parentA.coreClass, parentB.coreClass),
      element: offspringElement(parentA.element, parentB.element),
      fNumber: offspringFNumber(parentA.fNumber, parentB.fNumber),
    },
    parentStates: [parentA, parentB].map((parent) => ({
      coreId: parent.coreId,
      remainingSplices: parent.remainingSplices,
      cycleStatus: parent.cycleStatus,
      nextEligibleAt: parent.nextEligibleAt,
      dataCurrentThrough: parent.dataCurrentThrough,
      lastImported: parent.lastImported,
      freshness: parent.freshness,
    })),
    warnings: [...warnings],
    ruleEligible: status === "rule_eligible",
    offspringQualityPredicted: false,
    historicalStarsUsedAsInheritedTrait: false,
    recommendationAllowed: false,
    breedingExecutionAllowed: false,
  };
}
