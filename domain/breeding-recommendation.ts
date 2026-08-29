import { probeModes, type ProbeMode } from "./discovery-probe-plan";

export const breedingRecommendationStatuses = ["target", "watch", "wait"] as const;
export type BreedingRecommendationStatus =
  (typeof breedingRecommendationStatuses)[number];

export const breedingConfidenceLevels = ["low", "moderate", "high"] as const;
export type BreedingConfidence = (typeof breedingConfidenceLevels)[number];

export type BreedingFreshness = "current" | "ageing" | "stale" | "unknown";
export type BreedingSource = "vault" | "arena";
export type BreedingSex = "male" | "female";

export type BreedingDistanceProfileEntry = Readonly<{
  distanceMetres: number;
  raceCount: number;
}>;

export type BreedingExactPerformanceEvidence = Readonly<{
  mode: ProbeMode;
  distanceMetres: number;
  sampleSize: number;
  medianElapsedTimeMilliseconds: number | null;
  medianSpeedMetresPerSecond: number | null;
  medianSpeedPercentile: number | null;
  upperTailSpeedPercentile: number | null;
  bestSpeedPercentile: number | null;
  benchmarkPopulationSize: number;
  latestObservedAt: string | null;
}>;

export type BreedingCurrentStrength = Readonly<{
  power: number | null;
  adjustedOdds: number | null;
  variance: number | null;
  observedAt: string | null;
}>;

export type BreedingLineage = Readonly<{
  parents: readonly string[];
  grandparents: readonly string[];
}>;

export type BreedingParentCandidate = Readonly<{
  coreId: string;
  coreName: string;
  sex: BreedingSex;
  source: BreedingSource;
  performance: readonly BreedingExactPerformanceEvidence[];
  currentStrength: BreedingCurrentStrength;
  distanceProfile: readonly BreedingDistanceProfileEntry[];
  lineage: BreedingLineage;
  freshness: BreedingFreshness;
  available: boolean;
  starEvidenceAuthority: "authoritative" | "unavailable" | "unvalidated";
}>;

export type BreedingPairInfo = Readonly<{
  element: string;
  fNumber: number;
  offspringType: string;
}>;

export type BreedingPairCandidate = Readonly<{
  father: BreedingParentCandidate;
  mother: BreedingParentCandidate;
  officialValidation: "valid" | "invalid" | "unknown";
  pairInfo: BreedingPairInfo | null;
}>;

export type EliteBreedingPolicy = Readonly<{
  eliteMedianPercentile: number;
  watchMedianPercentile: number;
  eliteUpperTailPercentile: number;
  eliteCeilingPercentile: number;
  minimumTargetSampleSize: number;
  minimumBenchmarkPopulationSize: number;
  minimumPower: number;
  minimumAdjustedOdds: number;
  highConfidenceSampleSize: number;
  moderateConfidenceSampleSize: number;
  lowTargetDistanceShareWarning: number;
}>;

export const defaultEliteBreedingPolicy: EliteBreedingPolicy = Object.freeze({
  eliteMedianPercentile: 95,
  watchMedianPercentile: 90,
  eliteUpperTailPercentile: 90,
  eliteCeilingPercentile: 98,
  minimumTargetSampleSize: 5,
  minimumBenchmarkPopulationSize: 25,
  minimumPower: 80,
  minimumAdjustedOdds: 75,
  highConfidenceSampleSize: 20,
  moderateConfidenceSampleSize: 10,
  lowTargetDistanceShareWarning: 0.15,
});

export type BreedingParentAssessment = Readonly<{
  coreId: string;
  coreName: string;
  mode: ProbeMode;
  distanceMetres: number;
  status: BreedingRecommendationStatus;
  confidence: BreedingConfidence;
  performanceScore: number | null;
  supportingStrengthScore: number | null;
  qualityScore: number | null;
  exactEvidence: BreedingExactPerformanceEvidence | null;
  targetDistanceRaceCount: number;
  totalProfileRaceCount: number;
  targetDistanceShare: number | null;
  dominantDistanceMetres: number | null;
  warnings: readonly string[];
  reasons: readonly string[];
}>;

export type BreedingPairAssessment = Readonly<{
  father: BreedingParentAssessment;
  mother: BreedingParentAssessment;
  status: BreedingRecommendationStatus;
  qualityScore: number | null;
  locallyEligible: boolean;
  localEligibilityReason: string | null;
  officialValidation: BreedingPairCandidate["officialValidation"];
  pairInfo: BreedingPairInfo | null;
  warnings: readonly string[];
  reasons: readonly string[];
}>;

export type BreedingRecommendationBoard = Readonly<{
  mode: ProbeMode;
  distanceMetres: number;
  action: "breed_candidate_available" | "wait";
  targets: readonly BreedingPairAssessment[];
  watches: readonly BreedingPairAssessment[];
  waits: readonly BreedingPairAssessment[];
}>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function finitePercent(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be between 0 and 100.`);
  }
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function optionalPositiveFinite(value: number | null, label: string): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be positive and finite when present.`);
  }
  return value;
}

function optionalPercent(value: number | null, label: string): number | null {
  return value === null ? null : finitePercent(value, label);
}

function canonicalTimestampOrNull(value: string | null, label: string): string | null {
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical timestamp when present.`);
  }
  return value;
}

function validatePolicy(policy: EliteBreedingPolicy): EliteBreedingPolicy {
  finitePercent(policy.eliteMedianPercentile, "Elite median percentile");
  finitePercent(policy.watchMedianPercentile, "Watch median percentile");
  finitePercent(policy.eliteUpperTailPercentile, "Elite upper-tail percentile");
  finitePercent(policy.eliteCeilingPercentile, "Elite ceiling percentile");
  finitePercent(policy.minimumPower, "Minimum power");
  finitePercent(policy.minimumAdjustedOdds, "Minimum adjusted odds");
  positiveInteger(policy.minimumTargetSampleSize, "Minimum target sample size");
  positiveInteger(
    policy.minimumBenchmarkPopulationSize,
    "Minimum benchmark population size",
  );
  positiveInteger(policy.highConfidenceSampleSize, "High-confidence sample size");
  positiveInteger(
    policy.moderateConfidenceSampleSize,
    "Moderate-confidence sample size",
  );
  if (policy.highConfidenceSampleSize < policy.moderateConfidenceSampleSize) {
    throw new Error(
      "High-confidence sample size cannot be lower than moderate-confidence sample size.",
    );
  }
  if (
    !Number.isFinite(policy.lowTargetDistanceShareWarning) ||
    policy.lowTargetDistanceShareWarning < 0 ||
    policy.lowTargetDistanceShareWarning > 1
  ) {
    throw new Error("Low target-distance share warning must be between 0 and 1.");
  }
  if (policy.watchMedianPercentile > policy.eliteMedianPercentile) {
    throw new Error("Watch median percentile cannot exceed elite median percentile.");
  }
  return policy;
}

function exactEvidenceFor(
  candidate: BreedingParentCandidate,
  mode: ProbeMode,
  distanceMetres: number,
): BreedingExactPerformanceEvidence | null {
  const matches = candidate.performance.filter(
    (evidence) =>
      evidence.mode === mode && evidence.distanceMetres === distanceMetres,
  );
  if (matches.length > 1) {
    throw new Error(
      "Breeding parent has duplicate exact mode-distance performance evidence.",
    );
  }
  return matches[0] ?? null;
}

function validateEvidence(
  evidence: BreedingExactPerformanceEvidence,
): BreedingExactPerformanceEvidence {
  if (!probeModes.includes(evidence.mode)) {
    throw new Error("Breeding performance mode is invalid.");
  }
  positiveInteger(evidence.distanceMetres, "Breeding performance distance");
  nonNegativeInteger(evidence.sampleSize, "Breeding performance sample size");
  nonNegativeInteger(
    evidence.benchmarkPopulationSize,
    "Breeding benchmark population size",
  );
  optionalPositiveFinite(
    evidence.medianElapsedTimeMilliseconds,
    "Median elapsed time",
  );
  optionalPositiveFinite(evidence.medianSpeedMetresPerSecond, "Median speed");
  optionalPercent(evidence.medianSpeedPercentile, "Median speed percentile");
  optionalPercent(
    evidence.upperTailSpeedPercentile,
    "Upper-tail speed percentile",
  );
  optionalPercent(evidence.bestSpeedPercentile, "Best speed percentile");
  canonicalTimestampOrNull(evidence.latestObservedAt, "Latest performance time");
  return evidence;
}

function validateCandidate(candidate: BreedingParentCandidate): void {
  required(candidate.coreId, "Core ID");
  required(candidate.coreName, "Core name");
  if (!candidate.performance.every((entry) => probeModes.includes(entry.mode))) {
    throw new Error("Breeding parent contains an invalid racing mode.");
  }
  for (const entry of candidate.performance) validateEvidence(entry);
  for (const entry of candidate.distanceProfile) {
    positiveInteger(entry.distanceMetres, "Distance-profile distance");
    nonNegativeInteger(entry.raceCount, "Distance-profile race count");
  }
  if (
    candidate.currentStrength.power !== null &&
    (candidate.currentStrength.power < 0 || candidate.currentStrength.power > 100)
  ) {
    throw new Error("Power must be between 0 and 100 when present.");
  }
  if (
    candidate.currentStrength.adjustedOdds !== null &&
    (candidate.currentStrength.adjustedOdds < 0 ||
      candidate.currentStrength.adjustedOdds > 100)
  ) {
    throw new Error("Adjusted odds must be between 0 and 100 when present.");
  }
  if (
    candidate.currentStrength.variance !== null &&
    (candidate.currentStrength.variance < 0 ||
      candidate.currentStrength.variance > 100)
  ) {
    throw new Error("Variance must be between 0 and 100 when present.");
  }
  canonicalTimestampOrNull(
    candidate.currentStrength.observedAt,
    "Current-strength observation time",
  );
  for (const id of candidate.lineage.parents) required(id, "Parent Core ID");
  for (const id of candidate.lineage.grandparents) {
    required(id, "Grandparent Core ID");
  }
}

function profileContext(
  candidate: BreedingParentCandidate,
  distanceMetres: number,
): Readonly<{
  targetDistanceRaceCount: number;
  totalProfileRaceCount: number;
  targetDistanceShare: number | null;
  dominantDistanceMetres: number | null;
}> {
  const byDistance = new Map<number, number>();
  for (const entry of candidate.distanceProfile) {
    byDistance.set(
      entry.distanceMetres,
      (byDistance.get(entry.distanceMetres) ?? 0) + entry.raceCount,
    );
  }
  const totalProfileRaceCount = [...byDistance.values()].reduce(
    (sum, count) => sum + count,
    0,
  );
  const targetDistanceRaceCount = byDistance.get(distanceMetres) ?? 0;
  const dominant = [...byDistance.entries()].sort(
    (left, right) => right[1] - left[1] || left[0] - right[0],
  )[0];
  return Object.freeze({
    targetDistanceRaceCount,
    totalProfileRaceCount,
    targetDistanceShare:
      totalProfileRaceCount === 0
        ? null
        : targetDistanceRaceCount / totalProfileRaceCount,
    dominantDistanceMetres: dominant?.[0] ?? null,
  });
}

function confidenceFor(
  sampleSize: number,
  freshness: BreedingFreshness,
  policy: EliteBreedingPolicy,
): BreedingConfidence {
  if (freshness === "stale" || freshness === "unknown") return "low";
  if (sampleSize >= policy.highConfidenceSampleSize && freshness === "current") {
    return "high";
  }
  if (sampleSize >= policy.moderateConfidenceSampleSize) return "moderate";
  return "low";
}

function performanceScore(evidence: BreedingExactPerformanceEvidence): number | null {
  if (evidence.medianSpeedPercentile === null) return null;
  if (evidence.upperTailSpeedPercentile === null) {
    return evidence.medianSpeedPercentile;
  }
  return (
    0.8 * evidence.medianSpeedPercentile +
    0.2 * evidence.upperTailSpeedPercentile
  );
}

function supportingStrengthScore(strength: BreedingCurrentStrength): number | null {
  if (strength.power === null || strength.adjustedOdds === null) return null;
  return 0.6 * strength.power + 0.4 * strength.adjustedOdds;
}

export function assessBreedingParent(
  candidate: BreedingParentCandidate,
  target: Readonly<{ mode: ProbeMode; distanceMetres: number }>,
  policy: EliteBreedingPolicy = defaultEliteBreedingPolicy,
): BreedingParentAssessment {
  validatePolicy(policy);
  validateCandidate(candidate);
  if (!probeModes.includes(target.mode)) {
    throw new Error("Breeding target mode is invalid.");
  }
  positiveInteger(target.distanceMetres, "Breeding target distance");

  const warnings: string[] = [];
  const reasons: string[] = [];
  const evidence = exactEvidenceFor(candidate, target.mode, target.distanceMetres);
  const context = profileContext(candidate, target.distanceMetres);

  if (
    context.targetDistanceShare !== null &&
    context.targetDistanceShare < policy.lowTargetDistanceShareWarning
  ) {
    warnings.push("TARGET_DISTANCE_IS_MINOR_PART_OF_CAREER_PROFILE");
    reasons.push(
      "The target distance is a minor part of the Core's observed career profile; this is context only and does not reduce an elite exact-distance score.",
    );
  }
  if (
    context.dominantDistanceMetres !== null &&
    context.dominantDistanceMetres !== target.distanceMetres
  ) {
    warnings.push("CAREER_PROFILE_DOMINATED_BY_ANOTHER_DISTANCE");
  }
  if (candidate.starEvidenceAuthority !== "authoritative") {
    warnings.push("STAR_EVIDENCE_NOT_USED_FOR_RANKING");
  }
  if (!candidate.available) {
    warnings.push("PARENT_CURRENTLY_UNAVAILABLE");
  }

  if (evidence === null) {
    reasons.push("No exact mode-distance performance evidence is available.");
    return Object.freeze({
      coreId: candidate.coreId,
      coreName: candidate.coreName,
      mode: target.mode,
      distanceMetres: target.distanceMetres,
      status: "wait",
      confidence: "low",
      performanceScore: null,
      supportingStrengthScore: supportingStrengthScore(candidate.currentStrength),
      qualityScore: null,
      exactEvidence: null,
      ...context,
      warnings: Object.freeze(warnings),
      reasons: Object.freeze(reasons),
    });
  }

  const primary = performanceScore(evidence);
  const strength = supportingStrengthScore(candidate.currentStrength);
  const quality =
    primary === null
      ? null
      : strength === null
        ? primary
        : 0.9 * primary + 0.1 * strength;
  const confidence = confidenceFor(evidence.sampleSize, candidate.freshness, policy);

  if (evidence.benchmarkPopulationSize < policy.minimumBenchmarkPopulationSize) {
    warnings.push("BENCHMARK_POPULATION_TOO_SMALL");
  }
  if (evidence.sampleSize < policy.minimumTargetSampleSize) {
    warnings.push("EXACT_DISTANCE_SAMPLE_TOO_SMALL_FOR_TARGET");
  }
  if (candidate.freshness === "stale" || candidate.freshness === "unknown") {
    warnings.push("PERFORMANCE_EVIDENCE_NOT_FRESH_ENOUGH_FOR_TARGET");
  }
  if (
    candidate.currentStrength.power === null ||
    candidate.currentStrength.adjustedOdds === null
  ) {
    warnings.push("SUPPORTING_STRENGTH_INCOMPLETE");
  }

  const eliteMedian =
    evidence.medianSpeedPercentile !== null &&
    evidence.medianSpeedPercentile >= policy.eliteMedianPercentile;
  const eliteUpperTail =
    evidence.upperTailSpeedPercentile !== null &&
    evidence.upperTailSpeedPercentile >= policy.eliteUpperTailPercentile;
  const eliteCeiling =
    evidence.bestSpeedPercentile !== null &&
    evidence.bestSpeedPercentile >= policy.eliteCeilingPercentile;
  const strongSupport =
    candidate.currentStrength.power !== null &&
    candidate.currentStrength.adjustedOdds !== null &&
    candidate.currentStrength.power >= policy.minimumPower &&
    candidate.currentStrength.adjustedOdds >= policy.minimumAdjustedOdds;
  const enoughEvidence =
    evidence.sampleSize >= policy.minimumTargetSampleSize &&
    evidence.benchmarkPopulationSize >= policy.minimumBenchmarkPopulationSize;
  const freshEnough =
    candidate.freshness === "current" || candidate.freshness === "ageing";

  let status: BreedingRecommendationStatus = "wait";
  if (
    eliteMedian &&
    eliteUpperTail &&
    strongSupport &&
    enoughEvidence &&
    freshEnough &&
    candidate.available
  ) {
    status = "target";
    reasons.push(
      "Repeatable exact-distance performance clears the elite median and upper-tail gates, with supporting Core strength.",
    );
  } else if (
    (eliteMedian ||
      eliteCeiling ||
      (evidence.medianSpeedPercentile !== null &&
        evidence.medianSpeedPercentile >= policy.watchMedianPercentile)) &&
    candidate.available
  ) {
    status = "watch";
    if (!eliteMedian && eliteCeiling) {
      reasons.push(
        "The Core has an elite ceiling but does not yet show an elite repeatable median; keep it on watch rather than promote it from isolated upside.",
      );
    } else {
      reasons.push(
        "The Core is promising but one or more elite-target gates remain unresolved.",
      );
    }
  } else {
    reasons.push(
      "The Core does not clear the elite exact-distance performance standard; race volume or profile fit cannot rescue average performance.",
    );
  }

  return Object.freeze({
    coreId: candidate.coreId,
    coreName: candidate.coreName,
    mode: target.mode,
    distanceMetres: target.distanceMetres,
    status,
    confidence,
    performanceScore: primary,
    supportingStrengthScore: strength,
    qualityScore: quality,
    exactEvidence: evidence,
    ...context,
    warnings: Object.freeze(warnings),
    reasons: Object.freeze(reasons),
  });
}

function sameParentSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== 2 || right.length !== 2) return false;
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === 2 && b.length === 2 && a[0] === b[0] && a[1] === b[1];
}

export function evaluateConfirmedFamilyRestriction(
  father: BreedingParentCandidate,
  mother: BreedingParentCandidate,
): Readonly<{ eligible: boolean; reason: string | null }> {
  validateCandidate(father);
  validateCandidate(mother);
  if (father.coreId === mother.coreId) {
    return Object.freeze({ eligible: false, reason: "same_core" });
  }
  if (
    father.lineage.parents.includes(mother.coreId) ||
    mother.lineage.parents.includes(father.coreId)
  ) {
    return Object.freeze({ eligible: false, reason: "parent_child" });
  }
  if (
    father.lineage.grandparents.includes(mother.coreId) ||
    mother.lineage.grandparents.includes(father.coreId)
  ) {
    return Object.freeze({ eligible: false, reason: "grandparent_grandchild" });
  }
  if (sameParentSet(father.lineage.parents, mother.lineage.parents)) {
    return Object.freeze({ eligible: false, reason: "full_siblings" });
  }
  return Object.freeze({ eligible: true, reason: null });
}

export function assessBreedingPair(
  candidate: BreedingPairCandidate,
  target: Readonly<{ mode: ProbeMode; distanceMetres: number }>,
  policy: EliteBreedingPolicy = defaultEliteBreedingPolicy,
): BreedingPairAssessment {
  if (candidate.father.sex !== "male" || candidate.mother.sex !== "female") {
    throw new Error("Breeding pair must provide a male father and female mother.");
  }
  const father = assessBreedingParent(candidate.father, target, policy);
  const mother = assessBreedingParent(candidate.mother, target, policy);
  const family = evaluateConfirmedFamilyRestriction(
    candidate.father,
    candidate.mother,
  );
  const warnings: string[] = [];
  const reasons: string[] = [];

  if (!family.eligible) {
    warnings.push("CONFIRMED_FAMILY_RESTRICTION");
    reasons.push("The pair is blocked by a confirmed family restriction.");
  }
  if (candidate.officialValidation === "invalid") {
    warnings.push("OFFICIAL_PAIR_VALIDATION_INVALID");
    reasons.push("Official pair validation rejects the pair.");
  } else if (candidate.officialValidation === "unknown") {
    warnings.push("OFFICIAL_PAIR_VALIDATION_PENDING");
  }

  const scores = [father.qualityScore, mother.qualityScore].filter(
    (value): value is number => value !== null,
  );
  const pairQuality =
    scores.length !== 2
      ? null
      : 0.6 * Math.min(scores[0]!, scores[1]!) +
        0.4 * Math.max(scores[0]!, scores[1]!);

  let status: BreedingRecommendationStatus = "wait";
  if (
    family.eligible &&
    candidate.officialValidation !== "invalid" &&
    father.status === "target" &&
    mother.status === "target"
  ) {
    status = "target";
    reasons.push(
      "Both parents independently clear the elite exact-distance gate; the pair is a breeding hypothesis, not a deterministic offspring guarantee.",
    );
  } else if (
    family.eligible &&
    candidate.officialValidation !== "invalid" &&
    father.status !== "wait" &&
    mother.status !== "wait"
  ) {
    status = "watch";
    reasons.push(
      "The pairing is interesting but at least one parent has not cleared every elite target gate.",
    );
  } else if (family.eligible && candidate.officialValidation !== "invalid") {
    reasons.push(
      "Do not force a best-available pairing: at least one parent fails the elite standard, so the correct action is to wait.",
    );
  }

  return Object.freeze({
    father,
    mother,
    status,
    qualityScore: pairQuality,
    locallyEligible: family.eligible,
    localEligibilityReason: family.reason,
    officialValidation: candidate.officialValidation,
    pairInfo: candidate.pairInfo,
    warnings: Object.freeze(warnings),
    reasons: Object.freeze(reasons),
  });
}

function statusOrder(status: BreedingRecommendationStatus): number {
  if (status === "target") return 0;
  if (status === "watch") return 1;
  return 2;
}

export function buildBreedingRecommendationBoard(
  input: Readonly<{
    mode: ProbeMode;
    distanceMetres: number;
    pairs: readonly BreedingPairCandidate[];
    policy?: EliteBreedingPolicy;
  }>,
): BreedingRecommendationBoard {
  if (!probeModes.includes(input.mode)) {
    throw new Error("Breeding board mode is invalid.");
  }
  positiveInteger(input.distanceMetres, "Breeding board distance");
  const policy = validatePolicy(input.policy ?? defaultEliteBreedingPolicy);
  const assessed = input.pairs
    .map((pair) =>
      assessBreedingPair(
        pair,
        { mode: input.mode, distanceMetres: input.distanceMetres },
        policy,
      ),
    )
    .sort(
      (left, right) =>
        statusOrder(left.status) - statusOrder(right.status) ||
        (right.qualityScore ?? -1) - (left.qualityScore ?? -1) ||
        left.father.coreId.localeCompare(right.father.coreId) ||
        left.mother.coreId.localeCompare(right.mother.coreId),
    );
  const targets = assessed.filter((pair) => pair.status === "target");
  const watches = assessed.filter((pair) => pair.status === "watch");
  const waits = assessed.filter((pair) => pair.status === "wait");
  return Object.freeze({
    mode: input.mode,
    distanceMetres: input.distanceMetres,
    action: targets.length > 0 ? "breed_candidate_available" : "wait",
    targets: Object.freeze(targets),
    watches: Object.freeze(watches),
    waits: Object.freeze(waits),
  });
}
