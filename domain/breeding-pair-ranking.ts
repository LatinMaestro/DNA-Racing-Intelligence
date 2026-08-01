import {
  coreClasses,
  elements,
  offspringClass,
  offspringElement,
  offspringFNumber,
  type CoreClass,
  type Element,
} from "@/domain/game-rules";

export type BreedingRankingMode = "Bike" | "Car" | "Horse";
export type BreedingEvidenceConfidence = "low" | "moderate" | "high";
export type BreedingPairSource = "owned_owned" | "owned_arena" | "arena_arena";

export type BreedingParentEvidence = Readonly<{
  coreId: string;
  ownership: "owned" | "arena";
  coreClass: CoreClass;
  element: Element;
  fNumber: number;
}>;

export type BreedingRankingCandidateInput = Readonly<{
  pairId: string;
  parents: readonly [BreedingParentEvidence, BreedingParentEvidence];
  source: BreedingPairSource;
  mode: BreedingRankingMode;
  exactDistanceM: number;
  rulesetVersion: string;
  candidateSnapshotVersion: string;
  projectionVersion: string;
  arenaSnapshotVersion: string | null;
  ruleStatus: "eligible" | "ineligible" | "review_required";
  familyStatus: "eligible" | "ineligible" | "review_required";
  sexCompatibilityStatus: "compatible" | "incompatible" | "unknown";
  cycleStatus: "available" | "unavailable" | "unknown";
  spliceCapacityStatus: "available" | "exhausted" | "unknown";
  availabilityStatus:
    "confirmed" | "marked_unavailable" | "expired" | "unknown";
  arenaListingExpiresAt: string | null;
  evidenceConfidence: BreedingEvidenceConfidence;
  distributionStatus:
    "supported" | "insufficient" | "uncalibrated" | "not_evaluated";
  chronologicalValidationStatus: "supported" | "insufficient" | "not_evaluated";
  usesStarFeatures: boolean;
  starLiftStatus:
    "supported" | "not_supported" | "insufficient" | "not_evaluated";
  exceptionalUpsideBasisPoints: number;
  strongerOrExceptionalBasisPoints: number;
  vaultFitBasisPoints: number;
}>;

export type BreedingPairRankingInput = Readonly<{
  rankingId: string;
  rankingLabel: string;
  rulesetVersion: string;
  candidateSnapshotVersion: string;
  projectionVersion: string;
  arenaSnapshotVersion: string | null;
  evaluatedAt: string;
  dataCurrentThrough: string | null;
  lastImported: string | null;
  freshness: "current" | "ageing" | "stale" | "unknown";
  arenaDataCurrentThrough: string | null;
  arenaLastImported: string | null;
  arenaFreshness: "current" | "ageing" | "stale" | "unknown";
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
  predictedOffspringClass: CoreClass;
  predictedOffspringElement: Element;
  predictedOffspringFNumber: number;
  arenaListingExpiresAt: string | null;
  exceptionalUpsideBasisPoints: number;
  strongerOrExceptionalBasisPoints: number;
  vaultFitBasisPoints: number;
  balancedScoreNumerator: number;
  balancedScoreDenominator: 10_000;
}>;

export type BreedingPairRankingResult = Readonly<{
  rankingId: string;
  rankingLabel: string;
  rulesetVersion: string;
  candidateSnapshotVersion: string;
  projectionVersion: string;
  arenaSnapshotVersion: string | null;
  evaluatedAt: string;
  dataCurrentThrough: string | null;
  lastImported: string | null;
  freshness: BreedingPairRankingInput["freshness"];
  arenaDataCurrentThrough: string | null;
  arenaLastImported: string | null;
  arenaFreshness: BreedingPairRankingInput["arenaFreshness"];
  eliteUpsideRanking: readonly RankedBreedingPair[];
  vaultGapRanking: readonly RankedBreedingPair[];
  balancedRanking: readonly RankedBreedingPair[];
  heldPairs: readonly Readonly<{
    pairId: string;
    parentCoreIds: readonly [string, string];
    reasons: readonly string[];
  }>[];
  eliteRankingUsesVaultFit: false;
  vaultSaturationCanSuppressEliteUpside: false;
  rankingsRemainSeparate: true;
  importedHistoricalEvidence: true;
  arenaListingsAreLive: false;
  arenaListingsCreateTransactions: false;
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
const versionPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function required(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function version(value: unknown, label: string): string {
  const normalized = required(value, label);
  if (!versionPattern.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function timestamp(value: string | null, label: string): string | null {
  if (value === null) return null;
  const normalized = required(value, label);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    throw new Error(`${label} must be a canonical timestamp.`);
  }
  return normalized;
}

function basisPoints(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`${label} must be an integer from 0 to 10,000.`);
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

type NormalizedCandidate = BreedingRankingCandidateInput & {
  parents: readonly [BreedingParentEvidence, BreedingParentEvidence];
  arenaListingExpiresAt: string | null;
};

function ranked(
  candidates: readonly NormalizedCandidate[],
  eliteWeightBasisPoints: number,
  vaultFitWeightBasisPoints: number,
  compare: (left: NormalizedCandidate, right: NormalizedCandidate) => number,
): readonly RankedBreedingPair[] {
  return [...candidates].sort(compare).map((candidate, index) => ({
    rank: index + 1,
    pairId: candidate.pairId,
    parentCoreIds: [candidate.parents[0].coreId, candidate.parents[1].coreId],
    source: candidate.source,
    mode: candidate.mode,
    exactDistanceM: candidate.exactDistanceM,
    evidenceConfidence: candidate.evidenceConfidence,
    predictedOffspringClass: offspringClass(
      candidate.parents[0].coreClass,
      candidate.parents[1].coreClass,
    ),
    predictedOffspringElement: offspringElement(
      candidate.parents[0].element,
      candidate.parents[1].element,
    ),
    predictedOffspringFNumber: offspringFNumber(
      candidate.parents[0].fNumber,
      candidate.parents[1].fNumber,
    ),
    arenaListingExpiresAt: candidate.arenaListingExpiresAt,
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
  if (typeof input !== "object" || input === null) {
    throw new Error("Breeding ranking input is invalid.");
  }
  const rankingId = required(input.rankingId, "Ranking ID");
  const rankingLabel = required(input.rankingLabel, "Ranking label");
  const rulesetVersion = version(
    input.rulesetVersion,
    "Breeding ruleset version",
  );
  const candidateSnapshotVersion = version(
    input.candidateSnapshotVersion,
    "Breeding candidate snapshot version",
  );
  const projectionVersion = version(
    input.projectionVersion,
    "Breeding projection version",
  );
  const arenaSnapshotVersion =
    input.arenaSnapshotVersion === null
      ? null
      : version(input.arenaSnapshotVersion, "Arena snapshot version");
  const evaluatedAt = timestamp(input.evaluatedAt, "Evaluation time")!;
  const dataCurrentThrough = timestamp(
    input.dataCurrentThrough,
    "Data current through",
  );
  const lastImported = timestamp(input.lastImported, "Last imported");
  const arenaDataCurrentThrough = timestamp(
    input.arenaDataCurrentThrough,
    "Arena data current through",
  );
  const arenaLastImported = timestamp(
    input.arenaLastImported,
    "Arena last imported",
  );
  if (
    dataCurrentThrough !== null &&
    lastImported !== null &&
    Date.parse(lastImported) < Date.parse(dataCurrentThrough)
  ) {
    throw new Error("Last imported cannot precede data current through.");
  }
  if (
    arenaDataCurrentThrough !== null &&
    arenaLastImported !== null &&
    Date.parse(arenaLastImported) < Date.parse(arenaDataCurrentThrough)
  ) {
    throw new Error("Arena import cannot precede its data current through.");
  }
  for (const importedAt of [lastImported, arenaLastImported]) {
    if (
      importedAt !== null &&
      Date.parse(evaluatedAt) < Date.parse(importedAt)
    ) {
      throw new Error("Evaluation cannot predate accepted import evidence.");
    }
  }
  if (!Array.isArray(input.candidates)) {
    throw new Error("Breeding ranking candidates must be an array.");
  }
  if (!["current", "ageing", "stale", "unknown"].includes(input.freshness)) {
    throw new Error("Ranking freshness is invalid.");
  }
  if (
    !["current", "ageing", "stale", "unknown"].includes(input.arenaFreshness)
  ) {
    throw new Error("Arena freshness is invalid.");
  }
  basisPoints(input.eliteWeightBasisPoints, "Elite weight");
  basisPoints(input.vaultFitWeightBasisPoints, "Vault-fit weight");
  if (
    input.eliteWeightBasisPoints + input.vaultFitWeightBasisPoints !==
    10_000
  ) {
    throw new Error("Balanced ranking weights must total 10,000 basis points.");
  }

  const pairIds = new Set<string>();
  const parentPairs = new Set<string>();
  const eligible: NormalizedCandidate[] = [];
  const heldPairs: {
    pairId: string;
    parentCoreIds: [string, string];
    reasons: string[];
  }[] = [];

  for (const candidateInput of input.candidates) {
    if (typeof candidateInput !== "object" || candidateInput === null) {
      throw new Error("Breeding pair evidence is invalid.");
    }
    if (
      !Array.isArray(candidateInput.parents) ||
      candidateInput.parents.length !== 2
    ) {
      throw new Error("A breeding pair requires exactly two parents.");
    }
    const parents = candidateInput.parents.map(
      (parent: BreedingParentEvidence) => {
        if (typeof parent !== "object" || parent === null) {
          throw new Error("Breeding parent evidence is invalid.");
        }
        const coreId = required(parent.coreId, "Parent core ID");
        if (!["owned", "arena"].includes(parent.ownership)) {
          throw new Error("Breeding parent ownership is invalid.");
        }
        if (!coreClasses.includes(parent.coreClass)) {
          throw new Error("Breeding parent class is invalid.");
        }
        if (!elements.includes(parent.element)) {
          throw new Error("Breeding parent element is invalid.");
        }
        return {
          ...parent,
          coreId,
          fNumber: positiveInteger(parent.fNumber, "Parent F-number"),
        };
      },
    ) as [BreedingParentEvidence, BreedingParentEvidence];
    if (parents[0].coreId === parents[1].coreId) {
      throw new Error("A breeding pair requires two distinct parents.");
    }
    const pairId = required(candidateInput.pairId, "Pair ID");
    if (pairIds.has(pairId)) throw new Error("Pair IDs must be unique.");
    pairIds.add(pairId);
    const pairKey = parents
      .map(({ coreId }) => coreId)
      .sort()
      .join("\u0000");
    if (parentPairs.has(pairKey)) {
      throw new Error("The same parent pair cannot appear more than once.");
    }
    parentPairs.add(pairKey);
    if (!sources.includes(candidateInput.source)) {
      throw new Error("Breeding pair source is invalid.");
    }
    const ownershipKey = parents
      .map(({ ownership }) => ownership)
      .sort()
      .join("_");
    const expectedSource =
      ownershipKey === "owned_owned"
        ? "owned_owned"
        : ownershipKey === "arena_owned"
          ? "owned_arena"
          : "arena_arena";
    if (candidateInput.source !== expectedSource) {
      throw new Error("Breeding pair source must match parent ownership.");
    }
    if (!modes.includes(candidateInput.mode)) {
      throw new Error("Breeding ranking mode is invalid.");
    }
    positiveInteger(candidateInput.exactDistanceM, "Breeding ranking distance");
    const expectedArenaSnapshotVersion =
      candidateInput.source === "owned_owned" ? null : arenaSnapshotVersion;
    if (
      candidateInput.rulesetVersion !== rulesetVersion ||
      candidateInput.candidateSnapshotVersion !== candidateSnapshotVersion ||
      candidateInput.projectionVersion !== projectionVersion ||
      candidateInput.arenaSnapshotVersion !== expectedArenaSnapshotVersion
    ) {
      throw new Error(
        "Breeding candidate must match the exact active versions.",
      );
    }
    version(candidateInput.rulesetVersion, "Breeding ruleset version");
    version(
      candidateInput.candidateSnapshotVersion,
      "Breeding candidate snapshot version",
    );
    version(candidateInput.projectionVersion, "Breeding projection version");
    const arenaListingExpiresAt = timestamp(
      candidateInput.arenaListingExpiresAt,
      "Arena listing expiry",
    );
    if (
      !["low", "moderate", "high"].includes(candidateInput.evidenceConfidence)
    ) {
      throw new Error("Breeding evidence confidence is invalid.");
    }
    for (const [value, allowed, label] of [
      [
        candidateInput.ruleStatus,
        ["eligible", "ineligible", "review_required"],
        "rule status",
      ],
      [
        candidateInput.familyStatus,
        ["eligible", "ineligible", "review_required"],
        "family status",
      ],
      [
        candidateInput.sexCompatibilityStatus,
        ["compatible", "incompatible", "unknown"],
        "sex compatibility",
      ],
      [
        candidateInput.cycleStatus,
        ["available", "unavailable", "unknown"],
        "cycle status",
      ],
      [
        candidateInput.spliceCapacityStatus,
        ["available", "exhausted", "unknown"],
        "splice capacity status",
      ],
      [
        candidateInput.availabilityStatus,
        ["confirmed", "marked_unavailable", "expired", "unknown"],
        "availability status",
      ],
      [
        candidateInput.distributionStatus,
        ["supported", "insufficient", "uncalibrated", "not_evaluated"],
        "distribution status",
      ],
      [
        candidateInput.chronologicalValidationStatus,
        ["supported", "insufficient", "not_evaluated"],
        "chronological validation status",
      ],
      [
        candidateInput.starLiftStatus,
        ["supported", "not_supported", "insufficient", "not_evaluated"],
        "star lift status",
      ],
    ] as const) {
      if (!(allowed as readonly string[]).includes(value)) {
        throw new Error(`Breeding ${label} is invalid.`);
      }
    }
    if (typeof candidateInput.usesStarFeatures !== "boolean") {
      throw new Error("Breeding star-feature use must be Boolean.");
    }
    basisPoints(
      candidateInput.exceptionalUpsideBasisPoints,
      "Exceptional-upside estimate",
    );
    basisPoints(
      candidateInput.strongerOrExceptionalBasisPoints,
      "Broader-quality estimate",
    );
    basisPoints(candidateInput.vaultFitBasisPoints, "Vault-fit estimate");
    if (
      candidateInput.exceptionalUpsideBasisPoints >
      candidateInput.strongerOrExceptionalBasisPoints
    ) {
      throw new Error(
        "Exceptional upside cannot exceed stronger-or-exceptional probability.",
      );
    }

    const candidate: NormalizedCandidate = {
      ...candidateInput,
      pairId,
      parents,
      arenaListingExpiresAt,
    };
    const reasons: string[] = [];
    if (
      input.freshness === "stale" ||
      input.freshness === "unknown" ||
      dataCurrentThrough === null ||
      lastImported === null
    ) {
      reasons.push("Imported performance evidence is incomplete or stale.");
    }
    if (candidate.ruleStatus !== "eligible") {
      reasons.push("Pair rules are not confirmed eligible.");
    }
    if (candidate.familyStatus !== "eligible") {
      reasons.push("Confirmed family restrictions are not cleared.");
    }
    if (candidate.sexCompatibilityStatus !== "compatible") {
      reasons.push("Sex compatibility is not confirmed.");
    }
    if (candidate.cycleStatus !== "available") {
      reasons.push("Breed-cycle availability is not confirmed.");
    }
    if (candidate.spliceCapacityStatus !== "available") {
      reasons.push("Lifetime splice capacity is not confirmed.");
    }
    if (candidate.availabilityStatus !== "confirmed") {
      reasons.push("Parent availability is not confirmed.");
    }
    if (candidate.source !== "owned_owned") {
      if (
        arenaSnapshotVersion === null ||
        arenaDataCurrentThrough === null ||
        arenaLastImported === null ||
        !["current", "ageing"].includes(input.arenaFreshness)
      ) {
        reasons.push("Accepted Arena evidence is incomplete or stale.");
      }
      if (arenaListingExpiresAt === null) {
        reasons.push("External-parent listing expiry is unavailable.");
      } else if (Date.parse(arenaListingExpiresAt) <= Date.parse(evaluatedAt)) {
        reasons.push("External-parent listing was expired at evaluation.");
      }
    } else if (arenaListingExpiresAt !== null) {
      throw new Error("Owned-only pairs cannot bind Arena listing evidence.");
    }
    if (candidate.distributionStatus !== "supported") {
      reasons.push("Offspring outcome distribution is not supported.");
    }
    if (candidate.chronologicalValidationStatus !== "supported") {
      reasons.push(
        "Chronological parent-offspring validation is not supported.",
      );
    }
    if (
      candidate.usesStarFeatures &&
      candidate.starLiftStatus !== "supported"
    ) {
      reasons.push("Star features lack supported incremental holdout lift.");
    }
    if (reasons.length > 0) {
      heldPairs.push({
        pairId,
        parentCoreIds: [parents[0].coreId, parents[1].coreId],
        reasons,
      });
    } else {
      eligible.push(candidate);
    }
  }

  const byPairId = (left: NormalizedCandidate, right: NormalizedCandidate) =>
    left.pairId.localeCompare(right.pairId);
  const byConfidence = (
    left: NormalizedCandidate,
    right: NormalizedCandidate,
  ) =>
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
    rankingLabel,
    rulesetVersion,
    candidateSnapshotVersion,
    projectionVersion,
    arenaSnapshotVersion,
    evaluatedAt,
    dataCurrentThrough,
    lastImported,
    freshness: input.freshness,
    arenaDataCurrentThrough,
    arenaLastImported,
    arenaFreshness: input.arenaFreshness,
    eliteUpsideRanking,
    vaultGapRanking,
    balancedRanking,
    heldPairs,
    eliteRankingUsesVaultFit: false,
    vaultSaturationCanSuppressEliteUpside: false,
    rankingsRemainSeparate: true,
    importedHistoricalEvidence: true,
    arenaListingsAreLive: false,
    arenaListingsCreateTransactions: false,
    recommendationAllowed: false,
    breedingExecutionAllowed: false,
    gateEPassed: false,
  };
}
