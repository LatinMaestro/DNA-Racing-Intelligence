import { raceModes, type RaceMode } from "@/domain/core-performance";

export type ExactRaceProbabilityContext = Readonly<{
  mode: RaceMode;
  distanceMeters: number;
  competition: "normal" | "esports";
  format: string;
  gateCount: number;
  element:
    | Readonly<{ status: "known"; value: string }>
    | Readonly<{ status: "not_applicable" | "unknown"; value: null }>;
}>;

export type EmpiricalRaceTimeObservation = Readonly<{
  eventId: string;
  eventAt: string;
  elapsedTimeMilliseconds: number;
}>;

export type PairwiseRaceProbabilityInput = Readonly<{
  baselineId: string;
  modelVersion: string;
  evidenceCutoff: string;
  context: ExactRaceProbabilityContext;
  candidateCoreId: string;
  opponentCoreId: string;
  candidateObservations: readonly EmpiricalRaceTimeObservation[];
  opponentObservations: readonly EmpiricalRaceTimeObservation[];
}>;

export type PairwiseRaceProbabilityReason =
  | "INSUFFICIENT_CANDIDATE_SAMPLE"
  | "INSUFFICIENT_OPPONENT_SAMPLE"
  | "TIE_POLICY_UNRESOLVED";

export type PairwiseRaceProbabilityResult = Readonly<{
  baselineId: string;
  modelVersion: string;
  evidenceCutoff: string;
  dataCurrentThrough: string | null;
  context: ExactRaceProbabilityContext;
  candidateCoreId: string;
  opponentCoreId: string;
  status: "available" | "unavailable" | "review_required";
  pWinMillionths: number | null;
  candidateSampleCount: number;
  opponentSampleCount: number;
  outcomePairCount: number;
  candidateWinPairCount: number;
  candidateLossPairCount: number;
  tiedPairCount: number;
  reasons: readonly PairwiseRaceProbabilityReason[];
  probabilityBasis: "empirical_cartesian_pairwise_elapsed_time";
  uncertaintyStatus: "sample_counts_only";
  calibrationStatus: "not_evaluated";
  analyticalStatus: "experimental";
  decisionUseAllowed: false;
  economicUseAllowed: false;
}>;

const MINIMUM_ANALYTICAL_RACES = 10;

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

function positiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}

export function normalizeExactRaceProbabilityContext(
  context: ExactRaceProbabilityContext,
): ExactRaceProbabilityContext {
  if (!raceModes.includes(context.mode)) {
    throw new Error("Race mode is invalid.");
  }
  positiveSafeInteger(context.distanceMeters, "Distance metres");
  positiveSafeInteger(context.gateCount, "Gate count");
  if (!(["normal", "esports"] as const).includes(context.competition)) {
    throw new Error("Competition is invalid.");
  }
  const format = required(context.format, "Race format");
  if (
    !["known", "not_applicable", "unknown"].includes(context.element.status)
  ) {
    throw new Error("Element status is invalid.");
  }
  const element =
    context.element.status === "known"
      ? {
          status: "known" as const,
          value: required(context.element.value, "Element"),
        }
      : { status: context.element.status, value: null };
  return { ...context, format, element };
}

export function normalizeEmpiricalRaceTimeObservations(input: {
  observations: readonly EmpiricalRaceTimeObservation[];
  label: string;
  evidenceCutoff: string;
}): readonly Readonly<{
  eventId: string;
  eventAt: string;
  elapsedTimeMilliseconds: number;
}>[] {
  const { observations, label, evidenceCutoff } = input;
  const seenEventIds = new Set<string>();
  return observations.map((observation) => {
    const eventId = required(observation.eventId, `${label} event ID`);
    if (seenEventIds.has(eventId)) {
      throw new Error(`Duplicate ${label.toLowerCase()} event: ${eventId}`);
    }
    seenEventIds.add(eventId);
    const eventAt = timestamp(observation.eventAt, `${label} event time`);
    if (Date.parse(eventAt) >= Date.parse(evidenceCutoff)) {
      throw new Error(`${label} evidence must predate the evidence cutoff.`);
    }
    positiveSafeInteger(
      observation.elapsedTimeMilliseconds,
      `${label} elapsed time`,
    );
    return {
      eventId,
      eventAt,
      elapsedTimeMilliseconds: observation.elapsedTimeMilliseconds,
    };
  });
}

function lowerBound(sortedValues: readonly number[], target: number): number {
  let lower = 0;
  let upper = sortedValues.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (sortedValues[middle]! < target) lower = middle + 1;
    else upper = middle;
  }
  return lower;
}

function upperBound(sortedValues: readonly number[], target: number): number {
  let lower = 0;
  let upper = sortedValues.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (sortedValues[middle]! <= target) lower = middle + 1;
    else upper = middle;
  }
  return lower;
}

export function calculatePairwiseRaceProbability(
  input: PairwiseRaceProbabilityInput,
): PairwiseRaceProbabilityResult {
  const baselineId = required(input.baselineId, "Baseline ID");
  const modelVersion = required(input.modelVersion, "Model version");
  const evidenceCutoff = timestamp(input.evidenceCutoff, "Evidence cutoff");
  const context = normalizeExactRaceProbabilityContext(input.context);
  const candidateCoreId = required(input.candidateCoreId, "Candidate Core ID");
  const opponentCoreId = required(input.opponentCoreId, "Opponent Core ID");
  if (candidateCoreId === opponentCoreId) {
    throw new Error("Candidate and opponent Core IDs must differ.");
  }

  const candidateObservations = normalizeEmpiricalRaceTimeObservations({
    observations: input.candidateObservations,
    label: "Candidate",
    evidenceCutoff,
  });
  const opponentObservations = normalizeEmpiricalRaceTimeObservations({
    observations: input.opponentObservations,
    label: "Opponent",
    evidenceCutoff,
  });
  const outcomePairCount =
    candidateObservations.length * opponentObservations.length;
  if (!Number.isSafeInteger(outcomePairCount)) {
    throw new Error("Pairwise outcome count exceeds safe integer range.");
  }

  const opponentTimes = opponentObservations
    .map(({ elapsedTimeMilliseconds }) => elapsedTimeMilliseconds)
    .sort((left, right) => left - right);
  let candidateWinPairCount = 0;
  let candidateLossPairCount = 0;
  let tiedPairCount = 0;
  for (const { elapsedTimeMilliseconds } of candidateObservations) {
    const firstEqual = lowerBound(opponentTimes, elapsedTimeMilliseconds);
    const firstGreater = upperBound(opponentTimes, elapsedTimeMilliseconds);
    candidateLossPairCount += firstEqual;
    tiedPairCount += firstGreater - firstEqual;
    candidateWinPairCount += opponentTimes.length - firstGreater;
  }

  const reasons: PairwiseRaceProbabilityReason[] = [];
  if (candidateObservations.length < MINIMUM_ANALYTICAL_RACES) {
    reasons.push("INSUFFICIENT_CANDIDATE_SAMPLE");
  }
  if (opponentObservations.length < MINIMUM_ANALYTICAL_RACES) {
    reasons.push("INSUFFICIENT_OPPONENT_SAMPLE");
  }
  if (tiedPairCount > 0) reasons.push("TIE_POLICY_UNRESOLVED");

  const hasInsufficientSample = reasons.some((reason) =>
    reason.startsWith("INSUFFICIENT_"),
  );
  const status = hasInsufficientSample
    ? "unavailable"
    : tiedPairCount > 0
      ? "review_required"
      : "available";
  const latestEvidenceAt = [...candidateObservations, ...opponentObservations]
    .map(({ eventAt }) => eventAt)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];

  return {
    baselineId,
    modelVersion,
    evidenceCutoff,
    dataCurrentThrough: latestEvidenceAt ?? null,
    context,
    candidateCoreId,
    opponentCoreId,
    status,
    pWinMillionths:
      status === "available"
        ? Math.round((candidateWinPairCount / outcomePairCount) * 1_000_000)
        : null,
    candidateSampleCount: candidateObservations.length,
    opponentSampleCount: opponentObservations.length,
    outcomePairCount,
    candidateWinPairCount,
    candidateLossPairCount,
    tiedPairCount,
    reasons,
    probabilityBasis: "empirical_cartesian_pairwise_elapsed_time",
    uncertaintyStatus: "sample_counts_only",
    calibrationStatus: "not_evaluated",
    analyticalStatus: "experimental",
    decisionUseAllowed: false,
    economicUseAllowed: false,
  };
}
