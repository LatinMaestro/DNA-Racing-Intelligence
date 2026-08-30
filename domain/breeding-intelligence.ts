import {
  assessBreedingParent,
  evaluateConfirmedFamilyRestriction,
  type BreedingPairInfo,
  type BreedingParentAssessment,
  type BreedingParentCandidate,
  type BreedingRecommendationStatus,
} from "./breeding-recommendation";
import type {
  BreederQualityAssessment,
  BreederQualityBenchmark,
} from "./breeder-quality";
import { findBreederAssessment } from "./breeder-quality";
import { probeModes, type ProbeMode } from "./discovery-probe-plan";

export const breedingQualificationPaths = [
  "elite_racer",
  "elite_breeder",
  "dual",
  "watch",
  "none",
] as const;
export type BreedingQualificationPath =
  (typeof breedingQualificationPaths)[number];

export const breedingPairStrategies = [
  "racer_x_racer",
  "racer_x_breeder",
  "breeder_x_breeder",
  "dual_strength",
  "mixed_watch",
] as const;
export type BreedingPairStrategy = (typeof breedingPairStrategies)[number];

export type BreedingIntelligenceParentCandidate = Readonly<{
  racing: BreedingParentCandidate;
  breederBenchmarks: readonly BreederQualityBenchmark[];
}>;

export type BreedingIntelligenceParentAssessment = Readonly<{
  coreId: string;
  coreName: string;
  mode: ProbeMode;
  distanceMetres: number;
  status: BreedingRecommendationStatus;
  qualificationPath: BreedingQualificationPath;
  racer: BreedingParentAssessment;
  breeder: BreederQualityAssessment | null;
  breederScopeSource: "exact_distance" | "mode_wide" | "unavailable";
  opportunityScore: number | null;
  warnings: readonly string[];
  reasons: readonly string[];
}>;

export type BreedingIntelligencePairCandidate = Readonly<{
  father: BreedingIntelligenceParentCandidate;
  mother: BreedingIntelligenceParentCandidate;
  officialValidation: "valid" | "invalid" | "unknown";
  pairInfo: BreedingPairInfo | null;
}>;

export type BreedingIntelligencePairAssessment = Readonly<{
  father: BreedingIntelligenceParentAssessment;
  mother: BreedingIntelligenceParentAssessment;
  status: BreedingRecommendationStatus;
  pairingStrategy: BreedingPairStrategy;
  opportunityScore: number | null;
  locallyEligible: boolean;
  localEligibilityReason: string | null;
  officialValidation: BreedingIntelligencePairCandidate["officialValidation"];
  pairInfo: BreedingPairInfo | null;
  warnings: readonly string[];
  reasons: readonly string[];
}>;

export type BreedingIntelligenceBoard = Readonly<{
  mode: ProbeMode;
  distanceMetres: number;
  action: "breed_candidate_available" | "wait";
  targets: readonly BreedingIntelligencePairAssessment[];
  watches: readonly BreedingIntelligencePairAssessment[];
  waits: readonly BreedingIntelligencePairAssessment[];
}>;

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function selectBreederAssessment(
  candidate: BreedingIntelligenceParentCandidate,
  target: Readonly<{ mode: ProbeMode; distanceMetres: number }>,
): Readonly<{
  assessment: BreederQualityAssessment | null;
  source: "exact_distance" | "mode_wide" | "unavailable";
}> {
  const sameMode = candidate.breederBenchmarks.filter(
    (benchmark) => benchmark.scope.mode === target.mode,
  );
  const exact = sameMode.filter(
    (benchmark) => benchmark.scope.distanceMetres === target.distanceMetres,
  );
  if (exact.length > 1) {
    throw new Error("Duplicate exact-distance breeder benchmark supplied.");
  }
  const exactAssessment =
    exact.length === 1
      ? findBreederAssessment(exact[0]!, candidate.racing.coreId)
      : null;
  if (exactAssessment !== null && exactAssessment.qualifiedOffspringCount > 0) {
    return Object.freeze({
      assessment: exactAssessment,
      source: "exact_distance",
    });
  }

  const modeWide = sameMode.filter(
    (benchmark) => benchmark.scope.distanceMetres === null,
  );
  if (modeWide.length > 1) {
    throw new Error("Duplicate mode-wide breeder benchmark supplied.");
  }
  const modeWideAssessment =
    modeWide.length === 1
      ? findBreederAssessment(modeWide[0]!, candidate.racing.coreId)
      : null;
  if (modeWideAssessment !== null) {
    return Object.freeze({
      assessment: modeWideAssessment,
      source: "mode_wide",
    });
  }
  if (exactAssessment !== null) {
    return Object.freeze({
      assessment: exactAssessment,
      source: "exact_distance",
    });
  }
  return Object.freeze({ assessment: null, source: "unavailable" });
}

function opportunityScore(
  racer: BreedingParentAssessment,
  breeder: BreederQualityAssessment | null,
): number | null {
  const scores = [racer.qualityScore, breeder?.breederScore ?? null].filter(
    (value): value is number => value !== null,
  );
  return scores.length === 0 ? null : Math.max(...scores);
}

export function assessBreedingIntelligenceParent(
  candidate: BreedingIntelligenceParentCandidate,
  target: Readonly<{ mode: ProbeMode; distanceMetres: number }>,
): BreedingIntelligenceParentAssessment {
  if (!probeModes.includes(target.mode)) {
    throw new Error("Breeding-intelligence target mode is invalid.");
  }
  positiveInteger(
    target.distanceMetres,
    "Breeding-intelligence target distance",
  );
  const racer = assessBreedingParent(candidate.racing, target);
  const selectedBreeder = selectBreederAssessment(candidate, target);
  const breeder = selectedBreeder.assessment;
  const racerTarget = racer.status === "target";
  const breederTarget = breeder?.status === "target";
  const racerWatch = racer.status === "watch";
  const breederWatch = breeder?.status === "watch";
  const warnings: string[] = [];
  const reasons: string[] = [];

  if (breeder === null) {
    warnings.push("BREEDER_QUALITY_EVIDENCE_UNAVAILABLE");
  } else if (selectedBreeder.source === "mode_wide") {
    warnings.push("BREEDER_QUALITY_IS_MODE_WIDE_NOT_EXACT_DISTANCE");
  }
  if (!candidate.racing.available) {
    warnings.push("PARENT_CURRENTLY_UNAVAILABLE");
  }

  let status: BreedingRecommendationStatus = "wait";
  let qualificationPath: BreedingQualificationPath = "none";
  if (!candidate.racing.available) {
    reasons.push("The parent is not currently available for breeding.");
  } else if (racerTarget && breederTarget) {
    status = "target";
    qualificationPath = "dual";
    reasons.push(
      "The Core independently qualifies as both an elite racer and an elite historical breeder.",
    );
  } else if (racerTarget) {
    status = "target";
    qualificationPath = "elite_racer";
    reasons.push(
      "The Core qualifies through elite direct racing performance even without proven breeder lift.",
    );
  } else if (breederTarget) {
    status = "target";
    qualificationPath = "elite_breeder";
    reasons.push(
      "The Core qualifies through repeatable positive offspring lift even though its own racing performance does not clear the elite racer gate.",
    );
  } else if (racerWatch || breederWatch) {
    status = "watch";
    qualificationPath = "watch";
    reasons.push(
      "The Core has promising racer or breeder evidence but has not cleared an elite qualification path.",
    );
  } else {
    reasons.push(
      "Neither the direct-racer evidence nor the offspring breeder evidence currently clears the required standard.",
    );
  }

  return Object.freeze({
    coreId: candidate.racing.coreId,
    coreName: candidate.racing.coreName,
    mode: target.mode,
    distanceMetres: target.distanceMetres,
    status,
    qualificationPath,
    racer,
    breeder,
    breederScopeSource: selectedBreeder.source,
    opportunityScore: opportunityScore(racer, breeder),
    warnings: Object.freeze(warnings),
    reasons: Object.freeze(reasons),
  });
}

function pairStrategy(
  father: BreedingIntelligenceParentAssessment,
  mother: BreedingIntelligenceParentAssessment,
): BreedingPairStrategy {
  if (father.status !== "target" || mother.status !== "target") {
    return "mixed_watch";
  }
  const fatherRacer =
    father.qualificationPath === "elite_racer" ||
    father.qualificationPath === "dual";
  const motherRacer =
    mother.qualificationPath === "elite_racer" ||
    mother.qualificationPath === "dual";
  const fatherBreeder =
    father.qualificationPath === "elite_breeder" ||
    father.qualificationPath === "dual";
  const motherBreeder =
    mother.qualificationPath === "elite_breeder" ||
    mother.qualificationPath === "dual";
  if (
    father.qualificationPath === "dual" &&
    mother.qualificationPath === "dual"
  ) {
    return "dual_strength";
  }
  if (fatherBreeder && motherBreeder) return "breeder_x_breeder";
  if (fatherRacer && motherRacer) return "racer_x_racer";
  return "racer_x_breeder";
}

export function assessBreedingIntelligencePair(
  candidate: BreedingIntelligencePairCandidate,
  target: Readonly<{ mode: ProbeMode; distanceMetres: number }>,
): BreedingIntelligencePairAssessment {
  if (
    candidate.father.racing.sex !== "male" ||
    candidate.mother.racing.sex !== "female"
  ) {
    throw new Error(
      "Breeding-intelligence pair must provide a male father and female mother.",
    );
  }
  const father = assessBreedingIntelligenceParent(candidate.father, target);
  const mother = assessBreedingIntelligenceParent(candidate.mother, target);
  const family = evaluateConfirmedFamilyRestriction(
    candidate.father.racing,
    candidate.mother.racing,
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

  const scores = [father.opportunityScore, mother.opportunityScore].filter(
    (value): value is number => value !== null,
  );
  const pairOpportunityScore =
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
      "Both parents independently clear at least one elite qualification path: direct racer quality, historical breeder quality, or both.",
    );
  } else if (
    family.eligible &&
    candidate.officialValidation !== "invalid" &&
    father.status !== "wait" &&
    mother.status !== "wait"
  ) {
    status = "watch";
    reasons.push(
      "The pairing is interesting, but at least one parent remains WATCH rather than an elite-qualified parent.",
    );
  } else if (family.eligible && candidate.officialValidation !== "invalid") {
    reasons.push(
      "Do not force the pairing: at least one parent lacks both elite racer and elite breeder qualification.",
    );
  }

  return Object.freeze({
    father,
    mother,
    status,
    pairingStrategy: pairStrategy(father, mother),
    opportunityScore: pairOpportunityScore,
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

export function buildBreedingIntelligenceBoard(
  input: Readonly<{
    mode: ProbeMode;
    distanceMetres: number;
    pairs: readonly BreedingIntelligencePairCandidate[];
  }>,
): BreedingIntelligenceBoard {
  if (!probeModes.includes(input.mode)) {
    throw new Error("Breeding-intelligence board mode is invalid.");
  }
  positiveInteger(input.distanceMetres, "Breeding-intelligence board distance");
  const assessed = input.pairs
    .map((pair) =>
      assessBreedingIntelligencePair(pair, {
        mode: input.mode,
        distanceMetres: input.distanceMetres,
      }),
    )
    .sort(
      (left, right) =>
        statusOrder(left.status) - statusOrder(right.status) ||
        (right.opportunityScore ?? -1) - (left.opportunityScore ?? -1) ||
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
