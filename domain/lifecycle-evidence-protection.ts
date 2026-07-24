export type LifecycleCoreClass = "Genesis" | "Morphed" | "Freak" | "X-Class";
export type LifecycleFreshness = "current" | "ageing" | "stale" | "unknown";
export type MaidenEvidenceState =
  "eligible" | "not_eligible" | "unknown" | "invalid";
export type LifecycleEvidenceState =
  "supported" | "not_supported" | "unresolved";

export type LifecycleProtectionCoreInput = Readonly<{
  coreId: string;
  coreClass: LifecycleCoreClass;
  activeOwnership: boolean;
  maidenState: MaidenEvidenceState;
  discoveryState: "promising" | "complete" | "exhausted" | "unresolved";
  racingValue: LifecycleEvidenceState;
  breedingValue: LifecycleEvidenceState;
  lineageValue: "distinctive" | "common" | "unresolved";
  evidenceCoverage: "complete" | "partial";
  negativeEvidenceSources: readonly (
    | "weak_time"
    | "weak_finish"
    | "eligible_no_star"
    | "gold_ineligible_absence"
    | "low_vault_fit"
  )[];
}>;

export type LifecycleProtectionInput = Readonly<{
  reviewId: string;
  evaluatedAt: string;
  dataCurrentThrough: string;
  lastImported: string;
  freshness: LifecycleFreshness;
  cores: readonly LifecycleProtectionCoreInput[];
}>;

export type LifecycleProtectionResult = Readonly<{
  reviewId: string;
  evaluatedAt: string;
  dataCurrentThrough: string;
  lastImported: string;
  freshness: LifecycleFreshness;
  cores: readonly Readonly<{
    coreId: string;
    activeOwnership: boolean;
    reviewStatus: "ready" | "review_required" | "historical_only";
    protectedFromSale: boolean;
    burnEligibility: "forbidden" | "review_required" | "eligible_for_review";
    protectionReasons: readonly string[];
    nonStarNegativeEvidencePresent: boolean;
    noStarEvidenceCanCauseBurn: false;
    finalRecommendationAllowed: false;
  }>[];
  sourceFactsMutated: false;
  ledgerMutationAllowed: false;
  actualBurnCreditConsidered: false;
}>;

const classes: readonly LifecycleCoreClass[] = [
  "Genesis",
  "Morphed",
  "Freak",
  "X-Class",
];
const freshnessValues: readonly LifecycleFreshness[] = [
  "current",
  "ageing",
  "stale",
  "unknown",
];
const maidenStates: readonly MaidenEvidenceState[] = [
  "eligible",
  "not_eligible",
  "unknown",
  "invalid",
];
const evidenceStates: readonly LifecycleEvidenceState[] = [
  "supported",
  "not_supported",
  "unresolved",
];
const negativeSources: readonly LifecycleProtectionCoreInput["negativeEvidenceSources"][number][] =
  [
    "weak_time",
    "weak_finish",
    "eligible_no_star",
    "gold_ineligible_absence",
    "low_vault_fit",
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

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must be unique.`);
  }
}

export function protectLifecycleEvidence(
  input: LifecycleProtectionInput,
): LifecycleProtectionResult {
  const reviewId = required(input.reviewId, "Review ID");
  const evaluatedAt = timestamp(input.evaluatedAt, "Evaluation time");
  const dataCurrentThrough = timestamp(
    input.dataCurrentThrough,
    "Data current through",
  );
  const lastImported = timestamp(input.lastImported, "Last imported");
  if (Date.parse(lastImported) < Date.parse(dataCurrentThrough)) {
    throw new Error("Last imported cannot precede data current through.");
  }
  if (Date.parse(evaluatedAt) < Date.parse(lastImported)) {
    throw new Error("Evaluation cannot predate imported evidence.");
  }
  if (!freshnessValues.includes(input.freshness)) {
    throw new Error("Lifecycle freshness is invalid.");
  }

  unique(
    input.cores.map(({ coreId }) => required(coreId, "Core ID")),
    "Core IDs",
  );

  const cores = input.cores
    .map((core) => {
      const coreId = required(core.coreId, "Core ID");
      if (!classes.includes(core.coreClass)) {
        throw new Error(`Core class is invalid for ${coreId}.`);
      }
      if (!maidenStates.includes(core.maidenState)) {
        throw new Error(`Maiden state is invalid for ${coreId}.`);
      }
      if (
        !["promising", "complete", "exhausted", "unresolved"].includes(
          core.discoveryState,
        )
      ) {
        throw new Error(`Discovery state is invalid for ${coreId}.`);
      }
      if (
        !evidenceStates.includes(core.racingValue) ||
        !evidenceStates.includes(core.breedingValue)
      ) {
        throw new Error(`Lifecycle evidence state is invalid for ${coreId}.`);
      }
      if (
        !["distinctive", "common", "unresolved"].includes(core.lineageValue)
      ) {
        throw new Error(`Lineage state is invalid for ${coreId}.`);
      }
      if (!["complete", "partial"].includes(core.evidenceCoverage)) {
        throw new Error(`Evidence coverage is invalid for ${coreId}.`);
      }
      unique(core.negativeEvidenceSources, `Negative evidence for ${coreId}`);
      for (const source of core.negativeEvidenceSources) {
        if (!negativeSources.includes(source)) {
          throw new Error(`Negative evidence source is invalid for ${coreId}.`);
        }
      }

      if (!core.activeOwnership) {
        return {
          coreId,
          activeOwnership: false,
          reviewStatus: "historical_only" as const,
          protectedFromSale: true,
          burnEligibility: "forbidden" as const,
          protectionReasons: ["Core is not confirmed in the active Vault."],
          nonStarNegativeEvidencePresent: false,
          noStarEvidenceCanCauseBurn: false as const,
          finalRecommendationAllowed: false as const,
        };
      }

      const reasons: string[] = [];
      if (input.freshness === "stale" || input.freshness === "unknown") {
        reasons.push("Imported evidence is stale or freshness is unknown.");
      }
      if (core.evidenceCoverage !== "complete") {
        reasons.push("Lifecycle evidence coverage is incomplete.");
      }
      if (
        core.maidenState === "eligible" ||
        core.maidenState === "unknown" ||
        core.maidenState === "invalid"
      ) {
        reasons.push("Maiden opportunity is available or unresolved.");
      }
      if (
        core.discoveryState === "promising" ||
        core.discoveryState === "unresolved"
      ) {
        reasons.push("Discovery value is promising or unresolved.");
      }
      if (core.racingValue === "supported") {
        reasons.push("Supported racing value must be protected.");
      } else if (core.racingValue === "unresolved") {
        reasons.push("Racing value is unresolved.");
      }
      if (core.breedingValue === "supported") {
        reasons.push("Supported breeding value must be protected.");
      } else if (core.breedingValue === "unresolved") {
        reasons.push("Breeding value is unresolved.");
      }
      if (core.lineageValue === "distinctive") {
        reasons.push("Distinctive lineage value must be protected.");
      } else if (core.lineageValue === "unresolved") {
        reasons.push("Lineage value is unresolved.");
      }

      const nonStarNegativeEvidencePresent =
        core.negativeEvidenceSources.includes("weak_time") ||
        core.negativeEvidenceSources.includes("weak_finish") ||
        core.negativeEvidenceSources.includes("low_vault_fit");
      const starOnlyNegativeEvidence =
        core.negativeEvidenceSources.length > 0 &&
        !nonStarNegativeEvidencePresent;
      if (starOnlyNegativeEvidence) {
        reasons.push(
          "No-star or Gold-ineligible evidence cannot support disposal alone.",
        );
      }

      const evidenceReviewRequired = reasons.length > 0;
      const protectedFromSale = evidenceReviewRequired;
      const burnEligibility =
        core.coreClass === "Genesis"
          ? ("forbidden" as const)
          : evidenceReviewRequired
            ? ("review_required" as const)
            : ("eligible_for_review" as const);
      if (core.coreClass === "Genesis") {
        reasons.push("Genesis cores cannot be burned.");
      }

      return {
        coreId,
        activeOwnership: true,
        reviewStatus: evidenceReviewRequired
          ? ("review_required" as const)
          : ("ready" as const),
        protectedFromSale,
        burnEligibility,
        protectionReasons: [...new Set(reasons)],
        nonStarNegativeEvidencePresent,
        noStarEvidenceCanCauseBurn: false as const,
        finalRecommendationAllowed: false as const,
      };
    })
    .sort((left, right) => left.coreId.localeCompare(right.coreId));

  return {
    reviewId,
    evaluatedAt,
    dataCurrentThrough,
    lastImported,
    freshness: input.freshness,
    cores,
    sourceFactsMutated: false,
    ledgerMutationAllowed: false,
    actualBurnCreditConsidered: false,
  };
}
