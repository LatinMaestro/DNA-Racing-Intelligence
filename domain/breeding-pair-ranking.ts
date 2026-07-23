export type BreedingRankingMode = "Bike" | "Car" | "Horse";
export type BreedingEvidenceConfidence = "low" | "moderate" | "high";
export type BreedingPairSource = "owned_owned" | "owned_arena" | "arena_arena";

export type BreedingRankingCandidateInput = Readonly<{
  pairId: string;
  parentCoreIds: readonly [string, string];
  source: BreedingPairSource;
  mode: BreedingRankingMode;
  exactDistanceM: number;
  ruleStatus: "eligible" | "ineligible" | "review_required";
  availabilityStatus: "confirmed" | "expired" | "unknown";
  evidenceConfidence: BreedingEvidenceConfidence;
  distributionStatus:
    "supported" | "insufficient" | "uncalibrated" | "not_evaluated";
  usesStarFeatures: boolean;
  starLiftStatus:
    "supported" | "not_supported" | "insufficient" | "not_evaluated";
  exceptionalUpsideBasisPoints: number;
  strongerOrExceptionalBasisPoints: number;
  vaultFitBasisPoints: number;
}>;

export type BreedingPairRankingInput = Readonly<{
  rankingId: string;
  evaluatedAt: string;
  dataCurrentThrough: string;
  lastImported: string;
  freshness: "current" | "ageing" | "stale" | "unknown";
  eliteWeightBasisPoints: number;
  vaultFitWeightBasisPoints: number;
  candidates: readonly BreedingRankingCandidateInput[];
}>;

type RankedBreedingPair = Readonly<{
  rank: number;
  pairId: string;
  parentCoreIds: readonly [string, string];
  source: BreedingPairSource;
  mode: BreedingRankingMode;
  exactDistanceM: number;
  evidenceConfidence: BreedingEvidenceConfidence;
  exceptionalUpsideBasisPoints: number;
  strongerOrExceptionalBasisPoints: number;
  vaultFitBasisPoints: number;
  balancedScoreNumerator: number;
  balancedScoreDenominator: 10_000;
}>;

export type BreedingPairRankingResult = Readonly<{
  rankingId: string;
  evaluatedAt: string;
  dataCurrentThrough: string;
  lastImported: string;
  freshness: BreedingPairRankingInput["freshness"];
  eliteUpsideRanking: readonly RankedBreedingPair[];
  vaultGapRanking: readonly RankedBreedingPair[];
  balancedRanking: readonly RankedBreedingPair[];
  heldPairs: readonly Readonly<{
    pairId: string;
    reasons: readonly string[];
  }>[];
  eliteRankingUsesVaultFit: false;
  vaultSaturationCanSuppressEliteUpside: false;
  rankingsRemainSeparate: true;
  recommendationAllowed: false;
  breedingExecutionAllowed: false;
  gateEPassed: false;
}>;

const modes: readonly BreedingRankingMode[] = ["Bike", "Car", "Horse"];
const sources: readonly BreedingPairSource[] = [
  "owned_owned",
  "owned_arena",
  "arena_arena",
];
const confidenceOrder: Readonly<Record<BreedingEvidenceConfidence, number>> = {
  high: 3,
  moderate: 2,
  low: 1,
};

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

function ranked(
  candidates: readonly BreedingRankingCandidateInput[],
  eliteWeightBasisPoints: number,
  vaultFitWeightBasisPoints: number,
  compare: (
    left: BreedingRankingCandidateInput,
    right: BreedingRankingCandidateInput,
  ) => number,
): readonly RankedBreedingPair[] {
  return [...candidates].sort(compare).map((candidate, index) => ({
    rank: index + 1,
    pairId: candidate.pairId,
    parentCoreIds: candidate.parentCoreIds,
    source: candidate.source,
    mode: candidate.mode,
    exactDistanceM: candidate.exactDistanceM,
    evidenceConfidence: candidate.evidenceConfidence,
    exceptionalUpsideBasisPoints: candidate.exceptionalUpsideBasisPoints,
    strongerOrExceptionalBasisPoints:
      candidate.strongerOrExceptionalBasisPoints,
    vaultFitBasisPoints: candidate.vaultFitBasisPoints,
    balancedScoreNumerator:
      candidate.strongerOrExceptionalBasisPoints * eliteWeightBasisPoints +
      candidate.vaultFitBasisPoints * vaultFitWeightBasisPoints,
    balancedScoreDenominator: 10_000,
  }));
}

export function rankBreedingPairs(
  input: BreedingPairRankingInput,
): BreedingPairRankingResult {
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
    throw new Error("Evaluation cannot predate the imported evidence.");
  }
  if (!["current", "ageing", "stale", "unknown"].includes(input.freshness)) {
    throw new Error("Ranking freshness is invalid.");
  }
  basisPoints(input.eliteWeightBasisPoints, "Elite weight");
  basisPoints(input.vaultFitWeightBasisPoints, "Vault-fit weight");
  if (
    input.eliteWeightBasisPoints + input.vaultFitWeightBasisPoints !==
    10_000
  ) {
    throw new Error("Balanced ranking weights must total 10000 basis points.");
  }

  const pairIds = new Set<string>();
  const parentPairs = new Set<string>();
  const eligible: BreedingRankingCandidateInput[] = [];
  const heldPairs: { pairId: string; reasons: string[] }[] = [];

  for (const candidateInput of input.candidates) {
    const pairId = required(candidateInput.pairId, "Pair ID");
    const parentCoreIds = candidateInput.parentCoreIds.map((coreId) =>
      required(coreId, "Parent core ID"),
    ) as [string, string];
    if (parentCoreIds[0] === parentCoreIds[1]) {
      throw new Error("A breeding pair requires two distinct parents.");
    }
    if (pairIds.has(pairId)) throw new Error("Pair IDs must be unique.");
    pairIds.add(pairId);
    const pairKey = [...parentCoreIds].sort().join("\u0000");
    if (parentPairs.has(pairKey)) {
      throw new Error("The same parent pair cannot appear more than once.");
    }
    parentPairs.add(pairKey);
    if (!sources.includes(candidateInput.source)) {
      throw new Error("Breeding pair source is invalid.");
    }
    if (!modes.includes(candidateInput.mode)) {
      throw new Error("Breeding ranking mode is invalid.");
    }
    if (
      !Number.isSafeInteger(candidateInput.exactDistanceM) ||
      candidateInput.exactDistanceM <= 0
    ) {
      throw new Error("Breeding ranking distance must be a positive integer.");
    }
    if (
      !["low", "moderate", "high"].includes(candidateInput.evidenceConfidence)
    ) {
      throw new Error("Breeding evidence confidence is invalid.");
    }
    basisPoints(
      candidateInput.exceptionalUpsideBasisPoints,
      "Exceptional-upside score",
    );
    basisPoints(
      candidateInput.strongerOrExceptionalBasisPoints,
      "Broader quality score",
    );
    basisPoints(candidateInput.vaultFitBasisPoints, "Vault-fit score");
    if (
      candidateInput.exceptionalUpsideBasisPoints >
      candidateInput.strongerOrExceptionalBasisPoints
    ) {
      throw new Error(
        "Exceptional upside cannot exceed stronger-or-exceptional probability.",
      );
    }

    const candidate: BreedingRankingCandidateInput = {
      ...candidateInput,
      pairId,
      parentCoreIds,
    };
    const reasons: string[] = [];
    if (input.freshness === "stale" || input.freshness === "unknown") {
      reasons.push("Imported evidence is not current enough for ranking.");
    }
    if (candidate.ruleStatus !== "eligible") {
      reasons.push("Pair rules are not confirmed eligible.");
    }
    if (
      candidate.source !== "owned_owned" &&
      candidate.availabilityStatus !== "confirmed"
    ) {
      reasons.push("External-parent availability is not confirmed.");
    }
    if (candidate.distributionStatus !== "supported") {
      reasons.push("Offspring outcome distribution is not supported.");
    }
    if (
      candidate.usesStarFeatures &&
      candidate.starLiftStatus !== "supported"
    ) {
      reasons.push("Star features lack supported incremental holdout lift.");
    }
    if (reasons.length > 0) heldPairs.push({ pairId, reasons });
    else eligible.push(candidate);
  }

  const byPairId = (
    left: BreedingRankingCandidateInput,
    right: BreedingRankingCandidateInput,
  ): number => left.pairId.localeCompare(right.pairId);
  const byConfidence = (
    left: BreedingRankingCandidateInput,
    right: BreedingRankingCandidateInput,
  ): number =>
    confidenceOrder[right.evidenceConfidence] -
    confidenceOrder[left.evidenceConfidence];

  const eliteUpsideRanking = ranked(
    eligible,
    input.eliteWeightBasisPoints,
    input.vaultFitWeightBasisPoints,
    (left, right) =>
      right.exceptionalUpsideBasisPoints - left.exceptionalUpsideBasisPoints ||
      right.strongerOrExceptionalBasisPoints -
        left.strongerOrExceptionalBasisPoints ||
      byConfidence(left, right) ||
      byPairId(left, right),
  );
  const vaultGapRanking = ranked(
    eligible,
    input.eliteWeightBasisPoints,
    input.vaultFitWeightBasisPoints,
    (left, right) =>
      right.vaultFitBasisPoints - left.vaultFitBasisPoints ||
      right.strongerOrExceptionalBasisPoints -
        left.strongerOrExceptionalBasisPoints ||
      byConfidence(left, right) ||
      byPairId(left, right),
  );
  const balancedRanking = ranked(
    eligible,
    input.eliteWeightBasisPoints,
    input.vaultFitWeightBasisPoints,
    (left, right) => {
      const leftScore =
        left.strongerOrExceptionalBasisPoints * input.eliteWeightBasisPoints +
        left.vaultFitBasisPoints * input.vaultFitWeightBasisPoints;
      const rightScore =
        right.strongerOrExceptionalBasisPoints * input.eliteWeightBasisPoints +
        right.vaultFitBasisPoints * input.vaultFitWeightBasisPoints;
      return (
        rightScore - leftScore ||
        right.exceptionalUpsideBasisPoints -
          left.exceptionalUpsideBasisPoints ||
        byConfidence(left, right) ||
        byPairId(left, right)
      );
    },
  );

  return {
    rankingId,
    evaluatedAt,
    dataCurrentThrough,
    lastImported,
    freshness: input.freshness,
    eliteUpsideRanking,
    vaultGapRanking,
    balancedRanking,
    heldPairs,
    eliteRankingUsesVaultFit: false,
    vaultSaturationCanSuppressEliteUpside: false,
    rankingsRemainSeparate: true,
    recommendationAllowed: false,
    breedingExecutionAllowed: false,
    gateEPassed: false,
  };
}
