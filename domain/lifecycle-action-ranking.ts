import { canBurn, coreClasses, type CoreClass } from "@/domain/game-rules";

export const lifecycleActions = [
  "race",
  "discover",
  "reserve_maiden",
  "breed",
  "hold",
  "sell",
  "burn",
] as const;

export type LifecycleAction = (typeof lifecycleActions)[number];
export type LifecycleFreshness = "current" | "ageing" | "stale" | "unknown";

export type LifecycleEvidenceVersions = Readonly<{
  configurationVersion: string;
  candidateSnapshotVersion: string;
  racingSnapshotVersion: string;
  discoverySnapshotVersion: string;
  maidenSnapshotVersion: string;
  breedingSnapshotVersion: string;
  lineageSnapshotVersion: string;
  marketSnapshotVersion: string;
}>;

export type LifecycleActionEvidence = Readonly<{
  action: LifecycleAction;
  supportStatus: "supported" | "not_supported" | "unresolved";
  scoreBasisPoints: number;
  evidenceReasons: readonly string[];
}>;

export type LifecycleActionCoreInput = Readonly<{
  coreId: string;
  coreClass: CoreClass;
  activeOwnership: boolean;
  protectionStatus: "clear" | "review_required";
  evidenceCoverage: "complete" | "partial";
  racingState: "credible" | "weak" | "unresolved";
  maidenState: "eligible" | "not_eligible" | "unknown" | "invalid";
  discoveryState: "promising" | "complete" | "exhausted" | "unresolved";
  breedingState: "valuable" | "not_supported" | "not_applicable" | "unresolved";
  lineageState: "valuable" | "not_supported" | "not_applicable" | "unresolved";
  marketEvidence: "confirmed" | "absent" | "unresolved";
  costBasisStatus: "known" | "missing";
  starEvidenceState:
    | "supporting_positive"
    | "eligible_no_star"
    | "gold_ineligible"
    | "unavailable";
  nonStarNegativeEvidencePresent: boolean;
  evidenceVersions: LifecycleEvidenceVersions;
  actionEvidence: readonly LifecycleActionEvidence[];
}>;

export type LifecycleActionRankingInput = LifecycleEvidenceVersions &
  Readonly<{
    rankingId: string;
    rankingLabel: string;
    evaluatedAt: string;
    dataCurrentThrough: string;
    lastImported: string;
    freshness: LifecycleFreshness;
    cores: readonly LifecycleActionCoreInput[];
  }>;

export type LifecycleActionRankingResult = LifecycleEvidenceVersions &
  Readonly<{
    rankingId: string;
    rankingLabel: string;
    evaluatedAt: string;
    dataCurrentThrough: string;
    lastImported: string;
    freshness: LifecycleFreshness;
    cores: readonly Readonly<{
      coreId: string;
      coreClass: CoreClass;
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
      accountingWarnings: readonly string[];
      finalRecommendationAllowed: false;
      saleExecutionAllowed: false;
      burnExecutionAllowed: false;
      ledgerMutationAllowed: false;
      burnCreditUsedInRanking: false;
      saleProfitUsedInRanking: false;
    }>[];
    noStarEvidenceCanCauseBurn: false;
    sourceFactsMutated: false;
  }>;

const versionKeys = [
  "configurationVersion",
  "candidateSnapshotVersion",
  "racingSnapshotVersion",
  "discoverySnapshotVersion",
  "maidenSnapshotVersion",
  "breedingSnapshotVersion",
  "lineageSnapshotVersion",
  "marketSnapshotVersion",
] as const;

function required(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function canonicalTimestamp(value: unknown, label: string): string {
  const supplied = required(value, label);
  const parsed = new Date(supplied);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== supplied) {
    throw new Error(`${label} must be a canonical UTC timestamp.`);
  }
  return supplied;
}

function basisPoints(value: unknown, label: string): asserts value is number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > 10_000
  ) {
    throw new Error(`${label} must be an integer from 0 to 10000.`);
  }
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as T;
}

function validatedVersions(
  input: Record<string, unknown>,
): LifecycleEvidenceVersions {
  const values = Object.fromEntries(
    versionKeys.map((key) => [key, required(input[key], key)]),
  ) as LifecycleEvidenceVersions;
  return values;
}

function versionDriftReasons(
  expected: LifecycleEvidenceVersions,
  actual: LifecycleEvidenceVersions,
): string[] {
  return versionKeys
    .filter((key) => actual[key] !== expected[key])
    .map((key) => `${key} does not match the ranking evidence.`);
}

function unresolvedValueReasons(core: LifecycleActionCoreInput): string[] {
  const reasons: string[] = [];
  if (!core.activeOwnership)
    reasons.push("Core is not confirmed in the active Vault.");
  if (core.evidenceCoverage !== "complete")
    reasons.push("Lifecycle evidence coverage is incomplete.");
  if (core.protectionStatus !== "clear")
    reasons.push("Lifecycle protection review is unresolved.");
  if (core.racingState === "unresolved")
    reasons.push("Racing value is unresolved.");
  if (core.discoveryState === "unresolved")
    reasons.push("Discovery value is unresolved.");
  if (core.maidenState === "unknown" || core.maidenState === "invalid") {
    reasons.push("Maiden value is unresolved.");
  }
  if (core.breedingState === "unresolved")
    reasons.push("Breeding value is unresolved.");
  if (core.lineageState === "unresolved")
    reasons.push("Lineage value is unresolved.");
  if (core.marketEvidence === "unresolved")
    reasons.push("Market value is unresolved.");
  return reasons;
}

function actionHoldReasons(
  core: LifecycleActionCoreInput,
  evidence: LifecycleActionEvidence,
  reviewReasons: readonly string[],
): string[] {
  const reasons = [...reviewReasons];
  if (evidence.supportStatus !== "supported")
    reasons.push("Action evidence is not supported.");
  if (evidence.action === "race" && core.racingState !== "credible") {
    reasons.push("Race review requires credible racing evidence.");
  }
  if (evidence.action === "reserve_maiden" && core.maidenState !== "eligible") {
    reasons.push("Reserve-Maiden review requires confirmed eligible ME.");
  }
  if (evidence.action === "discover" && core.discoveryState !== "promising") {
    reasons.push(
      "Discovery review requires a promising unresolved hypothesis.",
    );
  }
  if (evidence.action === "breed" && core.breedingState !== "valuable") {
    reasons.push("Breed review requires supported breeding value.");
  }
  if (evidence.action === "sell" && core.marketEvidence !== "confirmed") {
    reasons.push("Sale review requires confirmed market evidence.");
  }
  if (evidence.action === "burn") {
    if (!canBurn(core.coreClass))
      reasons.push("Genesis cores cannot be burned.");
    const explicitIndependentNegative =
      core.racingState === "weak" ||
      core.breedingState === "not_supported" ||
      core.lineageState === "not_supported";
    if (!core.nonStarNegativeEvidencePresent || !explicitIndependentNegative) {
      reasons.push(
        "Burn review requires explicit independent non-star negative evidence.",
      );
    }
  }
  return [...new Set(reasons)];
}

function tiedRank(
  sorted: readonly LifecycleActionEvidence[],
  index: number,
): number {
  const score = sorted[index]?.scoreBasisPoints;
  let first = index;
  while (first > 0 && sorted[first - 1]?.scoreBasisPoints === score) first -= 1;
  return first + 1;
}

export function rankLifecycleActions(
  input: LifecycleActionRankingInput,
): LifecycleActionRankingResult {
  if (input === null || typeof input !== "object")
    throw new Error("Lifecycle evidence is invalid.");
  const record = input as unknown as Record<string, unknown>;
  const versions = validatedVersions(record);
  const rankingId = required(record.rankingId, "Ranking ID");
  const rankingLabel = required(record.rankingLabel, "Ranking label");
  const evaluatedAt = canonicalTimestamp(record.evaluatedAt, "Evaluation time");
  const dataCurrentThrough = canonicalTimestamp(
    record.dataCurrentThrough,
    "Data current through",
  );
  const lastImported = canonicalTimestamp(record.lastImported, "Last imported");
  const freshness = oneOf(
    record.freshness,
    ["current", "ageing", "stale", "unknown"],
    "Lifecycle freshness",
  );
  if (Date.parse(lastImported) < Date.parse(dataCurrentThrough)) {
    throw new Error("Last imported cannot precede data current through.");
  }
  if (Date.parse(evaluatedAt) < Date.parse(lastImported)) {
    throw new Error("Evaluation cannot predate imported evidence.");
  }
  if (!Array.isArray(record.cores))
    throw new Error("Lifecycle cores must be an array.");

  const coreIds = record.cores.map((item) =>
    required((item as Record<string, unknown>)?.coreId, "Core ID"),
  );
  if (new Set(coreIds).size !== coreIds.length)
    throw new Error("Core IDs must be unique.");

  const cores = (record.cores as unknown as LifecycleActionCoreInput[])
    .map((core) => {
      if (core === null || typeof core !== "object")
        throw new Error("Lifecycle core is invalid.");
      const coreId = required(core.coreId, "Core ID");
      const coreClass = oneOf(
        core.coreClass,
        coreClasses,
        `Core class for ${coreId}`,
      );
      if (
        typeof core.activeOwnership !== "boolean" ||
        typeof core.nonStarNegativeEvidencePresent !== "boolean"
      ) {
        throw new Error(`Lifecycle Booleans are invalid for ${coreId}.`);
      }
      oneOf(
        core.protectionStatus,
        ["clear", "review_required"],
        `Protection status for ${coreId}`,
      );
      oneOf(
        core.evidenceCoverage,
        ["complete", "partial"],
        `Evidence coverage for ${coreId}`,
      );
      oneOf(
        core.racingState,
        ["credible", "weak", "unresolved"],
        `Racing state for ${coreId}`,
      );
      oneOf(
        core.maidenState,
        ["eligible", "not_eligible", "unknown", "invalid"],
        `Maiden state for ${coreId}`,
      );
      oneOf(
        core.discoveryState,
        ["promising", "complete", "exhausted", "unresolved"],
        `Discovery state for ${coreId}`,
      );
      oneOf(
        core.breedingState,
        ["valuable", "not_supported", "not_applicable", "unresolved"],
        `Breeding state for ${coreId}`,
      );
      oneOf(
        core.lineageState,
        ["valuable", "not_supported", "not_applicable", "unresolved"],
        `Lineage state for ${coreId}`,
      );
      oneOf(
        core.marketEvidence,
        ["confirmed", "absent", "unresolved"],
        `Market evidence for ${coreId}`,
      );
      oneOf(
        core.costBasisStatus,
        ["known", "missing"],
        `Cost-basis status for ${coreId}`,
      );
      oneOf(
        core.starEvidenceState,
        [
          "supporting_positive",
          "eligible_no_star",
          "gold_ineligible",
          "unavailable",
        ],
        `Star evidence for ${coreId}`,
      );
      if (
        "burnCredit" in core ||
        "predictedBurnCredit" in core ||
        "bgcBurnCredit" in core
      ) {
        throw new Error(
          `Burn-credit evidence is forbidden in lifecycle ranking for ${coreId}.`,
        );
      }
      if (
        core.evidenceVersions === null ||
        typeof core.evidenceVersions !== "object"
      ) {
        throw new Error(`Evidence versions are required for ${coreId}.`);
      }
      const actualVersions = validatedVersions(
        core.evidenceVersions as unknown as Record<string, unknown>,
      );
      const reviewReasons = [
        ...(freshness === "stale" || freshness === "unknown"
          ? ["Imported evidence is stale or freshness is unknown."]
          : []),
        ...versionDriftReasons(versions, actualVersions),
        ...unresolvedValueReasons(core),
      ];
      if (
        !Array.isArray(core.actionEvidence) ||
        core.actionEvidence.length !== lifecycleActions.length
      ) {
        throw new Error(`Every lifecycle action is required for ${coreId}.`);
      }
      const suppliedActions = core.actionEvidence.map(({ action }) => action);
      if (
        new Set(suppliedActions).size !== lifecycleActions.length ||
        lifecycleActions.some((action) => !suppliedActions.includes(action))
      ) {
        throw new Error(`Lifecycle actions must be unique for ${coreId}.`);
      }
      const supported: LifecycleActionEvidence[] = [];
      const heldActions: { action: LifecycleAction; reasons: string[] }[] = [];
      for (const evidence of core.actionEvidence) {
        oneOf(
          evidence.action,
          lifecycleActions,
          `Lifecycle action for ${coreId}`,
        );
        oneOf(
          evidence.supportStatus,
          ["supported", "not_supported", "unresolved"],
          `Action support status for ${coreId}`,
        );
        basisPoints(
          evidence.scoreBasisPoints,
          `${evidence.action} score for ${coreId}`,
        );
        if (
          !Array.isArray(evidence.evidenceReasons) ||
          evidence.evidenceReasons.length === 0 ||
          evidence.evidenceReasons.some(
            (reason: unknown) =>
              typeof reason !== "string" || reason.trim() === "",
          )
        ) {
          throw new Error(
            `${evidence.action} requires explicit evidence reasons for ${coreId}.`,
          );
        }
        const reasons = actionHoldReasons(core, evidence, reviewReasons);
        if (reasons.length > 0)
          heldActions.push({ action: evidence.action, reasons });
        else supported.push(evidence);
      }
      const sorted = [...supported].sort(
        (left, right) =>
          right.scoreBasisPoints - left.scoreBasisPoints ||
          lifecycleActions.indexOf(left.action) -
            lifecycleActions.indexOf(right.action),
      );
      const rankedActions = sorted.map((evidence, index) => ({
        rank: tiedRank(sorted, index),
        action: evidence.action,
        scoreBasisPoints: evidence.scoreBasisPoints,
        evidenceReasons: evidence.evidenceReasons.map((reason) =>
          reason.trim(),
        ),
        strategicReviewOnly:
          evidence.action === "sell" || evidence.action === "burn",
      }));
      const topScore = rankedActions[0]?.scoreBasisPoints;
      const tiedTopCount =
        topScore === undefined
          ? 0
          : rankedActions.filter((item) => item.scoreBasisPoints === topScore)
              .length;
      if (tiedTopCount > 1)
        reviewReasons.push("Leading lifecycle actions are tied.");
      const accountingWarnings =
        core.costBasisStatus === "missing"
          ? [
              "Cost basis is unavailable; sale proceeds cannot be described as profit.",
            ]
          : [];
      return {
        coreId,
        coreClass,
        leadingAction:
          reviewReasons.length > 0 || tiedTopCount !== 1
            ? ("insufficient_evidence" as const)
            : (rankedActions[0]?.action ?? ("insufficient_evidence" as const)),
        rankedActions,
        heldActions: heldActions.sort(
          (left, right) =>
            lifecycleActions.indexOf(left.action) -
            lifecycleActions.indexOf(right.action),
        ),
        reviewReasons,
        accountingWarnings,
        finalRecommendationAllowed: false as const,
        saleExecutionAllowed: false as const,
        burnExecutionAllowed: false as const,
        ledgerMutationAllowed: false as const,
        burnCreditUsedInRanking: false as const,
        saleProfitUsedInRanking: false as const,
      };
    })
    .sort((left, right) => left.coreId.localeCompare(right.coreId));

  return {
    ...versions,
    rankingId,
    rankingLabel,
    evaluatedAt,
    dataCurrentThrough,
    lastImported,
    freshness,
    cores,
    noStarEvidenceCanCauseBurn: false,
    sourceFactsMutated: false,
  };
}
