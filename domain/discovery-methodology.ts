import { probeModes, type ProbeMode } from "./discovery-probe-plan";
import type {
  DiscoveryDistanceBand,
  DiscoveryModeDistanceConfiguration,
} from "./discovery-study";

export const discoveryMethodologyClasses = [
  "promote",
  "confirm_side_distance",
  "variance_format",
  "rule_out",
  "settled",
] as const;
export type DiscoveryMethodologyClass =
  (typeof discoveryMethodologyClasses)[number];

export const discoveryRunnerArchetypes = [
  "repeatable_elite",
  "volatile_elite",
  "volatile_ceiling",
  "format_specialist_candidate",
  "high_upside_low_sample",
  "ordinary",
  "unresolved",
] as const;
export type DiscoveryRunnerArchetype =
  (typeof discoveryRunnerArchetypes)[number];

export type DiscoveryPaceAssessment =
  | "elite"
  | "strong"
  | "average"
  | "weak"
  | "unavailable";

export type DiscoveryRepeatabilityAssessment =
  | "tight"
  | "moderate"
  | "wide"
  | "very_wide"
  | "unknown_low_sample"
  | "unavailable";

export type DiscoverySupportAssessment =
  | "strong_support"
  | "supporting"
  | "neutral"
  | "caution"
  | "unavailable";

export type DiscoveryDistanceMethodologyEvidence = Readonly<{
  mode: ProbeMode;
  distanceMetres: number;
  usableObservationCount: number;
  centralPace: DiscoveryPaceAssessment;
  ceilingPace: DiscoveryPaceAssessment;
  repeatability: DiscoveryRepeatabilityAssessment;
  starSupport: DiscoverySupportAssessment;
  exactFormatSupport: DiscoverySupportAssessment;
}>;

export type DiscoveryCoreMethodologyInput = Readonly<{
  coreId: string;
  coreName: string;
  mode: ProbeMode;
  configuration: DiscoveryModeDistanceConfiguration;
  distanceEvidence: readonly DiscoveryDistanceMethodologyEvidence[];
  mainDistanceMetres: number | null;
  mainDistanceSettled: boolean;
  sideDistanceQuestionOpen: boolean;
  minimumAnalyticalSample?: number;
}>;

export type DiscoveryCoreMethodologyPlan = Readonly<{
  coreId: string;
  coreName: string;
  mode: ProbeMode;
  discoveryClass: DiscoveryMethodologyClass;
  archetypes: Readonly<Record<number, DiscoveryRunnerArchetype>>;
  recommendedTestBands: readonly DiscoveryDistanceBand[];
  recommendedTestDistancesMetres: readonly number[];
  excludeFromDiscoveryRoster: boolean;
  reasons: readonly (
    | "main_distance_settled"
    | "side_distance_question_open"
    | "elite_central_pace"
    | "elite_or_strong_ceiling"
    | "wide_variance_needs_repeatability"
    | "positive_star_or_format_support"
    | "two_band_rule_out_required"
    | "insufficient_evidence"
  )[];
  automaticPromotionAllowed: false;
  automaticBenchAllowed: false;
}>;

export type DiscoveryStarOpportunityEvidence = Readonly<{
  qualityKnownRaceCount: number;
  strongOrEliteOppositionOpportunityCount: number;
  blueOpportunityCount: number;
  blueReceivedCount: number;
  yellowOrGoldOpportunityCount: number;
  yellowOrGoldReceivedCount: number;
}>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function count(value: number, label: string): number {
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

function paceStrength(value: DiscoveryPaceAssessment): number {
  switch (value) {
    case "elite":
      return 4;
    case "strong":
      return 3;
    case "average":
      return 2;
    case "weak":
      return 1;
    case "unavailable":
      return 0;
  }
}

function supportStrength(value: DiscoverySupportAssessment): number {
  switch (value) {
    case "strong_support":
      return 4;
    case "supporting":
      return 3;
    case "neutral":
      return 2;
    case "caution":
      return 1;
    case "unavailable":
      return 0;
  }
}

function isWide(value: DiscoveryRepeatabilityAssessment): boolean {
  return value === "wide" || value === "very_wide";
}

function hasPositiveSupport(
  evidence: DiscoveryDistanceMethodologyEvidence,
): boolean {
  return (
    supportStrength(evidence.starSupport) >= 3 ||
    supportStrength(evidence.exactFormatSupport) >= 3
  );
}

export function classifyDiscoveryRunnerArchetype(
  evidence: DiscoveryDistanceMethodologyEvidence,
  minimumAnalyticalSample = 10,
): DiscoveryRunnerArchetype {
  if (!probeModes.includes(evidence.mode)) {
    throw new Error("Discovery methodology mode is invalid.");
  }
  positiveInteger(evidence.distanceMetres, "Discovery methodology distance");
  const sample = count(
    evidence.usableObservationCount,
    "Discovery methodology usable observation count",
  );
  positiveInteger(minimumAnalyticalSample, "Minimum analytical sample");

  const central = paceStrength(evidence.centralPace);
  const ceiling = paceStrength(evidence.ceilingPace);
  const supported = hasPositiveSupport(evidence);

  if (sample < minimumAnalyticalSample) {
    if (central >= 3 || ceiling >= 3 || supported) {
      return "high_upside_low_sample";
    }
    return "unresolved";
  }

  if (central >= 3) {
    return isWide(evidence.repeatability)
      ? "volatile_elite"
      : "repeatable_elite";
  }

  if (ceiling >= 3 && central <= 2) {
    return "volatile_ceiling";
  }

  if (supported && central <= 2) {
    return "format_specialist_candidate";
  }

  if (
    evidence.centralPace === "unavailable" ||
    evidence.repeatability === "unavailable"
  ) {
    return "unresolved";
  }

  return "ordinary";
}

function bandForDistance(
  configuration: DiscoveryModeDistanceConfiguration,
  distanceMetres: number,
): DiscoveryDistanceBand {
  for (const band of ["short", "middle", "long"] as const) {
    if (configuration.bands[band].includes(distanceMetres)) return band;
  }
  throw new Error("Discovery methodology distance is not in the mode configuration.");
}

function opportunityScore(
  evidence: DiscoveryDistanceMethodologyEvidence | undefined,
): number {
  if (evidence === undefined) return 0;
  return (
    paceStrength(evidence.centralPace) * 4 +
    paceStrength(evidence.ceilingPace) * 3 +
    supportStrength(evidence.starSupport) * 2 +
    supportStrength(evidence.exactFormatSupport) * 2 +
    (evidence.usableObservationCount < 10 ? 1 : 0)
  );
}

export function selectDiscoveryTwoBandTestPlan(input: Readonly<{
  configuration: DiscoveryModeDistanceConfiguration;
  anchorDistanceMetres: number;
  distanceEvidence: readonly DiscoveryDistanceMethodologyEvidence[];
}>): Readonly<{
  bands: readonly [DiscoveryDistanceBand, DiscoveryDistanceBand];
  distancesMetres: readonly number[];
}> {
  const anchorDistanceMetres = positiveInteger(
    input.anchorDistanceMetres,
    "Discovery anchor distance",
  );
  const anchorBand = bandForDistance(input.configuration, anchorDistanceMetres);
  const evidenceByDistance = new Map(
    input.distanceEvidence.map((evidence) => [evidence.distanceMetres, evidence]),
  );

  let bands: readonly [DiscoveryDistanceBand, DiscoveryDistanceBand];
  if (anchorBand === "short") {
    bands = ["short", "middle"];
  } else if (anchorBand === "long") {
    bands = ["middle", "long"];
  } else {
    const shortScore = Math.max(
      ...input.configuration.bands.short.map((distance) =>
        opportunityScore(evidenceByDistance.get(distance)),
      ),
    );
    const longScore = Math.max(
      ...input.configuration.bands.long.map((distance) =>
        opportunityScore(evidenceByDistance.get(distance)),
      ),
    );
    bands = longScore > shortScore ? ["middle", "long"] : ["short", "middle"];
  }

  const distancesMetres = [...new Set(bands.flatMap((band) => input.configuration.bands[band]))]
    .sort(
      (left, right) =>
        Math.abs(left - anchorDistanceMetres) - Math.abs(right - anchorDistanceMetres) ||
        left - right,
    );

  return Object.freeze({
    bands: Object.freeze([...bands]) as unknown as readonly [
      DiscoveryDistanceBand,
      DiscoveryDistanceBand,
    ],
    distancesMetres: Object.freeze(distancesMetres),
  });
}

function validateEvidence(
  input: DiscoveryCoreMethodologyInput,
): readonly DiscoveryDistanceMethodologyEvidence[] {
  if (!probeModes.includes(input.mode)) {
    throw new Error("Discovery methodology Core mode is invalid.");
  }
  if (input.configuration.mode !== input.mode) {
    throw new Error("Discovery methodology configuration mode does not match the Core mode.");
  }
  const supported = new Set(input.configuration.supportedDistancesMetres);
  const seen = new Set<number>();
  for (const evidence of input.distanceEvidence) {
    if (evidence.mode !== input.mode) {
      throw new Error("Discovery methodology evidence mode does not match the Core mode.");
    }
    if (!supported.has(evidence.distanceMetres)) {
      throw new Error("Discovery methodology evidence uses an unsupported exact distance.");
    }
    if (seen.has(evidence.distanceMetres)) {
      throw new Error("Discovery methodology evidence distances must be unique.");
    }
    seen.add(evidence.distanceMetres);
    count(
      evidence.usableObservationCount,
      "Discovery methodology usable observation count",
    );
  }
  return input.distanceEvidence;
}

function strongestAnchor(
  evidence: readonly DiscoveryDistanceMethodologyEvidence[],
): number | null {
  if (evidence.length === 0) return null;
  return [...evidence]
    .sort(
      (left, right) =>
        opportunityScore(right) - opportunityScore(left) ||
        left.distanceMetres - right.distanceMetres,
    )[0]!.distanceMetres;
}

export function buildDiscoveryCoreMethodologyPlan(
  input: DiscoveryCoreMethodologyInput,
): DiscoveryCoreMethodologyPlan {
  const coreId = required(input.coreId, "Discovery methodology Core ID");
  const coreName = required(input.coreName, "Discovery methodology Core name");
  const evidence = validateEvidence(input);
  const minimumAnalyticalSample = positiveInteger(
    input.minimumAnalyticalSample ?? 10,
    "Minimum analytical sample",
  );

  if (
    input.mainDistanceMetres !== null &&
    !input.configuration.supportedDistancesMetres.includes(input.mainDistanceMetres)
  ) {
    throw new Error("Discovery methodology main distance is unsupported.");
  }

  const archetypeEntries = evidence.map((value) => [
    value.distanceMetres,
    classifyDiscoveryRunnerArchetype(value, minimumAnalyticalSample),
  ] as const);
  const archetypes = Object.freeze(
    Object.fromEntries(archetypeEntries) as Record<number, DiscoveryRunnerArchetype>,
  );
  const reasons = new Set<DiscoveryCoreMethodologyPlan["reasons"][number]>();

  if (input.mainDistanceSettled && !input.sideDistanceQuestionOpen) {
    reasons.add("main_distance_settled");
    return Object.freeze({
      coreId,
      coreName,
      mode: input.mode,
      discoveryClass: "settled",
      archetypes,
      recommendedTestBands: Object.freeze([]),
      recommendedTestDistancesMetres: Object.freeze([]),
      excludeFromDiscoveryRoster: true,
      reasons: Object.freeze([...reasons]),
      automaticPromotionAllowed: false,
      automaticBenchAllowed: false,
    });
  }

  const anchorDistanceMetres =
    input.mainDistanceMetres ?? strongestAnchor(evidence);
  if (anchorDistanceMetres === null) {
    reasons.add("insufficient_evidence");
    return Object.freeze({
      coreId,
      coreName,
      mode: input.mode,
      discoveryClass: "rule_out",
      archetypes,
      recommendedTestBands: Object.freeze([]),
      recommendedTestDistancesMetres: Object.freeze([]),
      excludeFromDiscoveryRoster: false,
      reasons: Object.freeze([...reasons]),
      automaticPromotionAllowed: false,
      automaticBenchAllowed: false,
    });
  }

  const twoBandPlan = selectDiscoveryTwoBandTestPlan({
    configuration: input.configuration,
    anchorDistanceMetres,
    distanceEvidence: evidence,
  });

  if (input.mainDistanceSettled && input.sideDistanceQuestionOpen) {
    reasons.add("main_distance_settled");
    reasons.add("side_distance_question_open");
    return Object.freeze({
      coreId,
      coreName,
      mode: input.mode,
      discoveryClass: "confirm_side_distance",
      archetypes,
      recommendedTestBands: twoBandPlan.bands,
      recommendedTestDistancesMetres: Object.freeze(
        twoBandPlan.distancesMetres.filter(
          (distance) => distance !== input.mainDistanceMetres,
        ),
      ),
      excludeFromDiscoveryRoster: false,
      reasons: Object.freeze([...reasons]),
      automaticPromotionAllowed: false,
      automaticBenchAllowed: false,
    });
  }

  const archetypeValues = Object.values(archetypes);
  const hasVarianceOrFormat = archetypeValues.some((value) =>
    ["volatile_elite", "volatile_ceiling", "format_specialist_candidate"].includes(value),
  );
  const hasPromotionSignal = archetypeValues.some((value) =>
    ["repeatable_elite", "high_upside_low_sample"].includes(value),
  );

  if (hasVarianceOrFormat) {
    if (
      evidence.some((value) =>
        ["wide", "very_wide"].includes(value.repeatability),
      )
    ) {
      reasons.add("wide_variance_needs_repeatability");
    }
    if (evidence.some(hasPositiveSupport)) {
      reasons.add("positive_star_or_format_support");
    }
    if (evidence.some((value) => paceStrength(value.ceilingPace) >= 3)) {
      reasons.add("elite_or_strong_ceiling");
    }
    return Object.freeze({
      coreId,
      coreName,
      mode: input.mode,
      discoveryClass: "variance_format",
      archetypes,
      recommendedTestBands: twoBandPlan.bands,
      recommendedTestDistancesMetres: twoBandPlan.distancesMetres,
      excludeFromDiscoveryRoster: false,
      reasons: Object.freeze([...reasons]),
      automaticPromotionAllowed: false,
      automaticBenchAllowed: false,
    });
  }

  if (hasPromotionSignal) {
    if (evidence.some((value) => paceStrength(value.centralPace) >= 3)) {
      reasons.add("elite_central_pace");
    }
    if (evidence.some((value) => paceStrength(value.ceilingPace) >= 3)) {
      reasons.add("elite_or_strong_ceiling");
    }
    return Object.freeze({
      coreId,
      coreName,
      mode: input.mode,
      discoveryClass: "promote",
      archetypes,
      recommendedTestBands: twoBandPlan.bands,
      recommendedTestDistancesMetres: twoBandPlan.distancesMetres,
      excludeFromDiscoveryRoster: false,
      reasons: Object.freeze([...reasons]),
      automaticPromotionAllowed: false,
      automaticBenchAllowed: false,
    });
  }

  reasons.add("two_band_rule_out_required");
  return Object.freeze({
    coreId,
    coreName,
    mode: input.mode,
    discoveryClass: "rule_out",
    archetypes,
    recommendedTestBands: twoBandPlan.bands,
    recommendedTestDistancesMetres: twoBandPlan.distancesMetres,
    excludeFromDiscoveryRoster: false,
    reasons: Object.freeze([...reasons]),
    automaticPromotionAllowed: false,
    automaticBenchAllowed: false,
  });
}

export function noStarEvidenceSupportsCaution(
  input: DiscoveryStarOpportunityEvidence,
  minimumStrongOrEliteOpportunities = 5,
): boolean {
  positiveInteger(
    minimumStrongOrEliteOpportunities,
    "Minimum strong-or-elite star opportunities",
  );
  const qualityKnownRaceCount = count(
    input.qualityKnownRaceCount,
    "Quality-known star race count",
  );
  const strongOrEliteOppositionOpportunityCount = count(
    input.strongOrEliteOppositionOpportunityCount,
    "Strong-or-elite opposition star opportunity count",
  );
  const blueOpportunityCount = count(
    input.blueOpportunityCount,
    "Blue star opportunity count",
  );
  const blueReceivedCount = count(
    input.blueReceivedCount,
    "Blue stars received",
  );
  const yellowOrGoldOpportunityCount = count(
    input.yellowOrGoldOpportunityCount,
    "Yellow-or-Gold star opportunity count",
  );
  const yellowOrGoldReceivedCount = count(
    input.yellowOrGoldReceivedCount,
    "Yellow-or-Gold stars received",
  );

  if (
    strongOrEliteOppositionOpportunityCount > qualityKnownRaceCount ||
    blueOpportunityCount > qualityKnownRaceCount ||
    yellowOrGoldOpportunityCount > qualityKnownRaceCount ||
    blueReceivedCount > blueOpportunityCount ||
    yellowOrGoldReceivedCount > yellowOrGoldOpportunityCount
  ) {
    throw new Error("Discovery star opportunity evidence is inconsistent.");
  }

  return (
    strongOrEliteOppositionOpportunityCount >=
      minimumStrongOrEliteOpportunities &&
    blueReceivedCount === 0 &&
    yellowOrGoldReceivedCount === 0
  );
}
