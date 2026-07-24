export type LifecycleAction =
  "race" | "discover" | "reserve_maiden" | "breed" | "hold" | "sell" | "burn";

export type LifecycleActionEvidence = Readonly<{
  action: LifecycleAction;
  supportStatus: "supported" | "not_supported" | "unresolved";
  scoreBasisPoints: number;
  evidenceReasons: readonly string[];
}>;

export type LifecycleActionCoreInput = Readonly<{
  coreId: string;
  coreClass: "Genesis" | "Morphed" | "Freak" | "X-Class";
  activeOwnership: boolean;
  protectionStatus: "clear" | "review_required";
  evidenceCoverage: "complete" | "partial";
  maidenState: "eligible" | "not_eligible" | "unknown" | "invalid";
  discoveryState: "promising" | "complete" | "exhausted" | "unresolved";
  marketEvidence: "confirmed" | "absent" | "unresolved";
  nonStarNegativeEvidencePresent: boolean;
  actionEvidence: readonly LifecycleActionEvidence[];
}>;

export type LifecycleActionRankingInput = Readonly<{
  rankingId: string;
  evaluatedAt: string;
  dataCurrentThrough: string;
  lastImported: string;
  freshness: "current" | "ageing" | "stale" | "unknown";
  cores: readonly LifecycleActionCoreInput[];
}>;

export type LifecycleActionRankingResult = Readonly<{
  rankingId: string;
  evaluatedAt: string;
  dataCurrentThrough: string;
  lastImported: string;
  freshness: LifecycleActionRankingInput["freshness"];
  cores: readonly Readonly<{
    coreId: string;
    leadingAction: LifecycleAction | "insufficient_evidence";
    rankedActions: readonly Readonly<{
      rank: number;
      action: LifecycleAction;
      scoreBasisPoints: number;
      evidenceReasons: readonly string[];
      strategicReviewOnly: boolean;
    }>[];
    heldActions: readonly Readonly<{
      action: LifecycleAction;
      reasons: readonly string[];
    }>[];
    reviewReasons: readonly string[];
    finalRecommendationAllowed: false;
    saleExecutionAllowed: false;
    burnExecutionAllowed: false;
    ledgerMutationAllowed: false;
    burnCreditUsedInRanking: false;
  }>[];
  noStarEvidenceCanCauseBurn: false;
  sourceFactsMutated: false;
}>;

const actions: readonly LifecycleAction[] = [
  "race",
  "discover",
  "reserve_maiden",
  "breed",
  "hold",
  "sell",
  "burn",
];
const classes: readonly LifecycleActionCoreInput["coreClass"][] = [
  "Genesis",
  "Morphed",
  "Freak",
  "X-Class",
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

function basisPoints(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`${label} must be an integer from 0 to 10000.`);
  }
}

function actionHoldReasons(
  core: LifecycleActionCoreInput,
  evidence: LifecycleActionEvidence,
  globalReviewRequired: boolean,
): string[] {
  const reasons: string[] = [];
  if (evidence.supportStatus !== "supported") {
    reasons.push("Action evidence is not supported.");
  }
  if (globalReviewRequired) {
    reasons.push("Core-level evidence requires review.");
  }
  if (evidence.action === "reserve_maiden" && core.maidenState !== "eligible") {
    reasons.push("Reserve-Maiden action requires confirmed eligible ME.");
  }
  if (
    evidence.action === "discover" &&
    core.discoveryState !== "promising" &&
    core.discoveryState !== "unresolved"
  ) {
    reasons.push("Discovery action lacks a promising or unresolved path.");
  }
  if (evidence.action === "sell" && core.marketEvidence !== "confirmed") {
    reasons.push("Sale review requires confirmed market evidence.");
  }
  if (evidence.action === "burn") {
    if (core.coreClass === "Genesis") {
      reasons.push("Genesis cores cannot be burned.");
    }
    if (!core.nonStarNegativeEvidencePresent) {
      reasons.push(
        "Burn review requires independent non-star negative evidence.",
      );
    }
  }
  return [...new Set(reasons)];
}

export function rankLifecycleActions(
  input: LifecycleActionRankingInput,
): LifecycleActionRankingResult {
  const rankingId = required(input.rankingId, "Ranking ID");
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
  if (!["current", "ageing", "stale", "unknown"].includes(input.freshness)) {
    throw new Error("Lifecycle freshness is invalid.");
  }

  const coreIds = input.cores.map(({ coreId }) => required(coreId, "Core ID"));
  if (new Set(coreIds).size !== coreIds.length) {
    throw new Error("Core IDs must be unique.");
  }

  const cores = input.cores
    .map((core) => {
      const coreId = required(core.coreId, "Core ID");
      if (!classes.includes(core.coreClass)) {
        throw new Error(`Core class is invalid for ${coreId}.`);
      }
      if (!["clear", "review_required"].includes(core.protectionStatus)) {
        throw new Error(`Protection status is invalid for ${coreId}.`);
      }
      if (!["complete", "partial"].includes(core.evidenceCoverage)) {
        throw new Error(`Evidence coverage is invalid for ${coreId}.`);
      }
      if (
        !["eligible", "not_eligible", "unknown", "invalid"].includes(
          core.maidenState,
        )
      ) {
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
        !["confirmed", "absent", "unresolved"].includes(core.marketEvidence)
      ) {
        throw new Error(`Market evidence is invalid for ${coreId}.`);
      }
      if (core.actionEvidence.length !== actions.length) {
        throw new Error(`Every lifecycle action is required for ${coreId}.`);
      }
      const suppliedActions = core.actionEvidence.map(({ action }) => action);
      if (
        new Set(suppliedActions).size !== actions.length ||
        actions.some((action) => !suppliedActions.includes(action))
      ) {
        throw new Error(`Lifecycle actions must be unique for ${coreId}.`);
      }

      const reviewReasons: string[] = [];
      if (!core.activeOwnership) {
        reviewReasons.push("Core is not confirmed in the active Vault.");
      }
      if (input.freshness === "stale" || input.freshness === "unknown") {
        reviewReasons.push(
          "Imported evidence is stale or freshness is unknown.",
        );
      }
      if (core.evidenceCoverage !== "complete") {
        reviewReasons.push("Lifecycle evidence coverage is incomplete.");
      }
      if (core.protectionStatus !== "clear") {
        reviewReasons.push("Lifecycle protection review is unresolved.");
      }
      const globalReviewRequired = reviewReasons.length > 0;
      const supported: LifecycleActionEvidence[] = [];
      const heldActions: { action: LifecycleAction; reasons: string[] }[] = [];

      for (const evidence of core.actionEvidence) {
        if (!actions.includes(evidence.action)) {
          throw new Error(`Lifecycle action is invalid for ${coreId}.`);
        }
        if (
          !["supported", "not_supported", "unresolved"].includes(
            evidence.supportStatus,
          )
        ) {
          throw new Error(`Action support status is invalid for ${coreId}.`);
        }
        basisPoints(
          evidence.scoreBasisPoints,
          `${evidence.action} score for ${coreId}`,
        );
        if (
          evidence.evidenceReasons.length === 0 ||
          evidence.evidenceReasons.some((reason) => reason.trim() === "")
        ) {
          throw new Error(
            `${evidence.action} requires explicit evidence reasons for ${coreId}.`,
          );
        }
        const reasons = actionHoldReasons(core, evidence, globalReviewRequired);
        if (reasons.length > 0) {
          heldActions.push({ action: evidence.action, reasons });
        } else {
          supported.push(evidence);
        }
      }

      const sorted = [...supported].sort(
        (left, right) =>
          right.scoreBasisPoints - left.scoreBasisPoints ||
          actions.indexOf(left.action) - actions.indexOf(right.action),
      );
      const rankedActions = sorted.map((evidence, index) => {
        const prior = sorted[index - 1];
        const rank =
          index > 0 &&
          prior !== undefined &&
          prior.scoreBasisPoints === evidence.scoreBasisPoints
            ? rankedActionsRank(sorted, index - 1)
            : index + 1;
        return {
          rank,
          action: evidence.action,
          scoreBasisPoints: evidence.scoreBasisPoints,
          evidenceReasons: evidence.evidenceReasons.map((reason) =>
            reason.trim(),
          ),
          strategicReviewOnly:
            evidence.action === "sell" || evidence.action === "burn",
        };
      });
      const topScore = rankedActions[0]?.scoreBasisPoints;
      const tiedTopCount =
        topScore === undefined
          ? 0
          : rankedActions.filter(
              ({ scoreBasisPoints }) => scoreBasisPoints === topScore,
            ).length;
      if (tiedTopCount > 1) {
        reviewReasons.push("Leading lifecycle actions are tied.");
      }
      const leadingAction =
        reviewReasons.length > 0 || tiedTopCount !== 1
          ? ("insufficient_evidence" as const)
          : (rankedActions[0]?.action ?? "insufficient_evidence");

      return {
        coreId,
        leadingAction,
        rankedActions,
        heldActions: heldActions.sort(
          (left, right) =>
            actions.indexOf(left.action) - actions.indexOf(right.action),
        ),
        reviewReasons,
        finalRecommendationAllowed: false as const,
        saleExecutionAllowed: false as const,
        burnExecutionAllowed: false as const,
        ledgerMutationAllowed: false as const,
        burnCreditUsedInRanking: false as const,
      };
    })
    .sort((left, right) => left.coreId.localeCompare(right.coreId));

  return {
    rankingId,
    evaluatedAt,
    dataCurrentThrough,
    lastImported,
    freshness: input.freshness,
    cores,
    noStarEvidenceCanCauseBurn: false,
    sourceFactsMutated: false,
  };
}

function rankedActionsRank(
  sorted: readonly LifecycleActionEvidence[],
  index: number,
): number {
  const score = sorted[index]?.scoreBasisPoints;
  if (score === undefined) return index + 1;
  let first = index;
  while (first > 0 && sorted[first - 1]?.scoreBasisPoints === score) first -= 1;
  return first + 1;
}
