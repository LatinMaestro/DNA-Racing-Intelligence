import { isGoldStarEligible } from "@/domain/game-rules";
import type { RaceMode } from "@/domain/import-contract";
import type { StarDataStatus } from "@/domain/star-signals";

export const runnerStarEvaluationPolicy = Object.freeze({
  minimumOpponentExactDistanceRaces: 10,
  weakOpponentMaximumPercentile: 50,
  strongOpponentMinimumPercentile: 75,
  eliteOpponentMinimumPercentile: 90,
  repeatedNegativeOpportunityMinimum: 3,
});

export type RunnerStarSupport =
  "strong_support" | "supporting" | "neutral" | "caution" | "unavailable";

export type RunnerStarOpponentEvidence = Readonly<{
  coreId: string;
  exactDistanceRaceCountBeforeEvent: number;
  performancePercentileBeforeEvent: number | null;
  evidenceCurrentThrough: string | null;
}>;

export type RunnerStarRaceEvidence = Readonly<{
  eventId: string;
  eventAt: string;
  coreId: string;
  mode: RaceMode;
  distanceMetres: number;
  gateCount: number;
  /** The visible Yellow star, stored by the historical source as `gold_star`. */
  yellowStar: boolean | null;
  blueStar: boolean | null;
  eventYellowStarAssigned: boolean;
  eventBlueStarAssigned: boolean;
  starDataStatus: StarDataStatus;
  finishPosition: number | null;
  opponents: readonly RunnerStarOpponentEvidence[];
}>;

export type RunnerStarSignalEvaluation = Readonly<{
  assignmentOpportunityCount: number;
  receivedCount: number;
  conversionCount: number;
  conversionOpportunityCount: number;
  rawAssignmentRate: number | null;
  rawConversionRate: number | null;
  qualityKnownOpportunityCount: number;
  strongFieldOpportunityCount: number;
  strongFieldReceivedCount: number;
  eliteOpponentReceivedCount: number;
  weakFieldReceivedCount: number;
  weakFieldNoStarOpportunityCount: number;
  fieldAdjustedReceivedPoints: number;
  fieldAdjustedOpportunityPoints: number;
  fieldAdjustedIndex: number | null;
  rawAssignmentMayRank: false;
  rawConversionMayRank: false;
}>;

export type RunnerStarOpponentHighlight = Readonly<{
  eventId: string;
  eventAt: string;
  signal: "yellow" | "blue";
  opponentCoreId: string;
  opponentPerformancePercentile: number;
  opponentExactDistanceRaceCount: number;
}>;

export type RunnerStarEvaluation = Readonly<{
  coreId: string;
  mode: RaceMode;
  distanceMetres: number;
  dataCurrentThrough: string;
  raceCount: number;
  oppositionQualityKnownRaceCount: number;
  oppositionQualityCoverage: number;
  yellowSourceField: "gold_star";
  yellow: RunnerStarSignalEvaluation;
  blue: RunnerStarSignalEvaluation;
  strongestStarredOpponents: readonly RunnerStarOpponentHighlight[];
  support: RunnerStarSupport;
  performanceRole: "supporting_only";
  breederRole: "research_feature_until_chronological_lift";
  reasons: readonly string[];
}>;

type MutableSignal = {
  assignmentOpportunityCount: number;
  receivedCount: number;
  conversionCount: number;
  conversionOpportunityCount: number;
  qualityKnownOpportunityCount: number;
  strongFieldOpportunityCount: number;
  strongFieldReceivedCount: number;
  eliteOpponentReceivedCount: number;
  weakFieldReceivedCount: number;
  weakFieldNoStarOpportunityCount: number;
  fieldAdjustedReceivedPoints: number;
  fieldAdjustedOpportunityPoints: number;
};

function emptySignal(): MutableSignal {
  return {
    assignmentOpportunityCount: 0,
    receivedCount: 0,
    conversionCount: 0,
    conversionOpportunityCount: 0,
    qualityKnownOpportunityCount: 0,
    strongFieldOpportunityCount: 0,
    strongFieldReceivedCount: 0,
    eliteOpponentReceivedCount: 0,
    weakFieldReceivedCount: 0,
    weakFieldNoStarOpportunityCount: 0,
    fieldAdjustedReceivedPoints: 0,
    fieldAdjustedOpportunityPoints: 0,
  };
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function timestamp(value: string, label: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical timestamp.`);
  }
  return value;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function validateRace(race: RunnerStarRaceEvidence): void {
  required(race.eventId, "Star event ID");
  required(race.coreId, "Star Core ID");
  timestamp(race.eventAt, "Star event time");
  if (!(["bike", "car", "horse"] as const).includes(race.mode)) {
    throw new Error("Runner-star mode is invalid.");
  }
  positiveInteger(race.distanceMetres, "Runner-star distance");
  positiveInteger(race.gateCount, "Runner-star gate count");
  if (
    (race.yellowStar !== null && typeof race.yellowStar !== "boolean") ||
    (race.blueStar !== null && typeof race.blueStar !== "boolean") ||
    typeof race.eventYellowStarAssigned !== "boolean" ||
    typeof race.eventBlueStarAssigned !== "boolean"
  ) {
    throw new Error("Runner-star assignment evidence is invalid.");
  }
  if (
    !(["complete", "partial", "missing", "invalid"] as const).includes(
      race.starDataStatus,
    )
  ) {
    throw new Error("Runner-star data status is invalid.");
  }
  if (
    race.finishPosition !== null &&
    (!Number.isSafeInteger(race.finishPosition) ||
      race.finishPosition <= 0 ||
      race.finishPosition > race.gateCount)
  ) {
    throw new Error("Runner-star finish position is invalid.");
  }
  if (race.yellowStar === true && !race.eventYellowStarAssigned) {
    throw new Error("A received Yellow star requires an event assignment.");
  }
  if (race.blueStar === true && !race.eventBlueStarAssigned) {
    throw new Error("A received Blue star requires an event assignment.");
  }

  const opponentIds = new Set<string>();
  for (const opponent of race.opponents) {
    const opponentCoreId = required(opponent.coreId, "Opponent Core ID");
    if (opponentCoreId === race.coreId) {
      throw new Error("Runner-star opposition cannot include the target Core.");
    }
    if (opponentIds.has(opponentCoreId)) {
      throw new Error("Runner-star opposition must be unique per event.");
    }
    opponentIds.add(opponentCoreId);
    nonNegativeInteger(
      opponent.exactDistanceRaceCountBeforeEvent,
      "Opponent pre-race sample",
    );
    if (opponent.performancePercentileBeforeEvent !== null) {
      if (
        !Number.isFinite(opponent.performancePercentileBeforeEvent) ||
        opponent.performancePercentileBeforeEvent < 0 ||
        opponent.performancePercentileBeforeEvent > 100
      ) {
        throw new Error(
          "Opponent pre-race percentile must be between 0 and 100.",
        );
      }
      if (
        opponent.exactDistanceRaceCountBeforeEvent <
        runnerStarEvaluationPolicy.minimumOpponentExactDistanceRaces
      ) {
        throw new Error(
          "Opponent quality requires a minimally analytical pre-race sample.",
        );
      }
      if (opponent.evidenceCurrentThrough === null) {
        throw new Error("Opponent quality requires a pre-race cutoff.");
      }
      const cutoff = timestamp(
        opponent.evidenceCurrentThrough,
        "Opponent quality cutoff",
      );
      if (Date.parse(cutoff) >= Date.parse(race.eventAt)) {
        throw new Error(
          "Opponent quality must use evidence strictly before the event.",
        );
      }
    }
  }
}

function qualifiedOpponents(race: RunnerStarRaceEvidence) {
  return race.opponents.filter(
    (opponent) =>
      opponent.performancePercentileBeforeEvent !== null &&
      opponent.exactDistanceRaceCountBeforeEvent >=
        runnerStarEvaluationPolicy.minimumOpponentExactDistanceRaces,
  );
}

function applySignal(input: {
  signal: MutableSignal;
  received: boolean | null;
  eventAssigned: boolean;
  eligible: boolean;
  conversion: boolean;
  finishKnown: boolean;
  strongestOpponentPercentile: number | null;
  allOpponentsKnown: boolean;
}): void {
  if (!input.eligible || !input.eventAssigned || input.received === null)
    return;

  input.signal.assignmentOpportunityCount += 1;
  if (input.received) {
    input.signal.receivedCount += 1;
    if (input.finishKnown) {
      input.signal.conversionOpportunityCount += 1;
      if (input.conversion) input.signal.conversionCount += 1;
    }
  }

  if (input.strongestOpponentPercentile === null) return;
  input.signal.qualityKnownOpportunityCount += 1;
  const percentile = input.strongestOpponentPercentile;
  const strong =
    percentile >= runnerStarEvaluationPolicy.strongOpponentMinimumPercentile;
  const elite =
    percentile >= runnerStarEvaluationPolicy.eliteOpponentMinimumPercentile;
  const weak =
    input.allOpponentsKnown &&
    percentile <= runnerStarEvaluationPolicy.weakOpponentMaximumPercentile;

  if (strong) input.signal.strongFieldOpportunityCount += 1;
  if (input.received && strong) input.signal.strongFieldReceivedCount += 1;
  if (input.received && elite) input.signal.eliteOpponentReceivedCount += 1;
  if (input.received && weak) input.signal.weakFieldReceivedCount += 1;
  if (!input.received && weak)
    input.signal.weakFieldNoStarOpportunityCount += 1;

  const weight = Math.max(0, (percentile - 50) / 50);
  input.signal.fieldAdjustedOpportunityPoints += weight;
  if (input.received) input.signal.fieldAdjustedReceivedPoints += weight;
}

function finalizeSignal(signal: MutableSignal): RunnerStarSignalEvaluation {
  return Object.freeze({
    ...signal,
    fieldAdjustedReceivedPoints: round(signal.fieldAdjustedReceivedPoints),
    fieldAdjustedOpportunityPoints: round(
      signal.fieldAdjustedOpportunityPoints,
    ),
    rawAssignmentRate: rate(
      signal.receivedCount,
      signal.assignmentOpportunityCount,
    ),
    rawConversionRate: rate(
      signal.conversionCount,
      signal.conversionOpportunityCount,
    ),
    fieldAdjustedIndex: rate(
      signal.fieldAdjustedReceivedPoints,
      signal.fieldAdjustedOpportunityPoints,
    ),
    rawAssignmentMayRank: false,
    rawConversionMayRank: false,
  });
}

function supportFor(
  yellow: RunnerStarSignalEvaluation,
  blue: RunnerStarSignalEvaluation,
): RunnerStarSupport {
  if (
    yellow.qualityKnownOpportunityCount + blue.qualityKnownOpportunityCount ===
    0
  ) {
    return "unavailable";
  }
  if (yellow.eliteOpponentReceivedCount + blue.eliteOpponentReceivedCount > 0) {
    return "strong_support";
  }
  if (yellow.strongFieldReceivedCount + blue.strongFieldReceivedCount > 0) {
    return "supporting";
  }
  if (
    yellow.weakFieldNoStarOpportunityCount +
      blue.weakFieldNoStarOpportunityCount >=
    runnerStarEvaluationPolicy.repeatedNegativeOpportunityMinimum
  ) {
    return "caution";
  }
  return "neutral";
}

export function evaluateRunnerStars(
  races: readonly RunnerStarRaceEvidence[],
): RunnerStarEvaluation {
  if (races.length === 0) {
    throw new Error("Runner-star evaluation requires at least one race.");
  }
  for (const race of races) validateRace(race);

  const first = races[0]!;
  if (
    races.some(
      (race) =>
        race.coreId !== first.coreId ||
        race.mode !== first.mode ||
        race.distanceMetres !== first.distanceMetres,
    )
  ) {
    throw new Error(
      "Runner-star evaluation must contain one Core, mode and exact distance.",
    );
  }
  const eventIds = new Set(races.map(({ eventId }) => eventId));
  if (eventIds.size !== races.length) {
    throw new Error("Runner-star evaluation contains duplicate events.");
  }

  const yellow = emptySignal();
  const blue = emptySignal();
  const highlights: RunnerStarOpponentHighlight[] = [];
  let oppositionQualityKnownRaceCount = 0;

  for (const race of [...races].sort(
    (left, right) =>
      left.eventAt.localeCompare(right.eventAt) ||
      left.eventId.localeCompare(right.eventId),
  )) {
    const opponents = qualifiedOpponents(race);
    const strongest = [...opponents].sort(
      (left, right) =>
        right.performancePercentileBeforeEvent! -
          left.performancePercentileBeforeEvent! ||
        right.exactDistanceRaceCountBeforeEvent -
          left.exactDistanceRaceCountBeforeEvent ||
        left.coreId.localeCompare(right.coreId),
    )[0];
    const strongestPercentile =
      strongest?.performancePercentileBeforeEvent ?? null;
    const allOpponentsKnown =
      race.opponents.length > 0 && opponents.length === race.opponents.length;
    if (strongestPercentile !== null) oppositionQualityKnownRaceCount += 1;

    const complete = race.starDataStatus === "complete";
    const yellowEligible = isGoldStarEligible(race.gateCount);
    applySignal({
      signal: yellow,
      received: complete ? race.yellowStar : null,
      eventAssigned: race.eventYellowStarAssigned,
      eligible: yellowEligible,
      conversion: race.finishPosition !== null && race.finishPosition <= 3,
      finishKnown: race.finishPosition !== null,
      strongestOpponentPercentile: strongestPercentile,
      allOpponentsKnown,
    });
    applySignal({
      signal: blue,
      received: complete ? race.blueStar : null,
      eventAssigned: race.eventBlueStarAssigned,
      eligible: true,
      conversion: race.finishPosition === 1,
      finishKnown: race.finishPosition !== null,
      strongestOpponentPercentile: strongestPercentile,
      allOpponentsKnown,
    });

    if (strongest !== undefined) {
      for (const [signal, received] of [
        ["yellow", complete && yellowEligible && race.yellowStar === true],
        ["blue", complete && race.blueStar === true],
      ] as const) {
        if (!received) continue;
        highlights.push(
          Object.freeze({
            eventId: race.eventId,
            eventAt: race.eventAt,
            signal,
            opponentCoreId: strongest.coreId,
            opponentPerformancePercentile:
              strongest.performancePercentileBeforeEvent!,
            opponentExactDistanceRaceCount:
              strongest.exactDistanceRaceCountBeforeEvent,
          }),
        );
      }
    }
  }

  const yellowEvaluation = finalizeSignal(yellow);
  const blueEvaluation = finalizeSignal(blue);
  const support = supportFor(yellowEvaluation, blueEvaluation);
  const reasons: string[] = [
    "Blue means the highest assessed first-place chance in the entered field.",
    "Yellow is the visible top-three signal stored by the historical source as gold_star.",
    "Raw assignment and conversion rates are diagnostic only; positive performance credit requires pre-race evidence that the opposition was strong.",
  ];
  if (support === "strong_support") {
    reasons.push(
      "At least one star was received over a pre-race elite exact-distance opponent.",
    );
  } else if (support === "supporting") {
    reasons.push(
      "At least one star was received in a field containing a pre-race strong exact-distance opponent.",
    );
  } else if (support === "caution") {
    reasons.push(
      "Repeated available stars were missed in fully known weak fields; this is cautionary support only and cannot override direct time evidence.",
    );
  } else if (support === "unavailable") {
    reasons.push(
      "Opponent quality was unavailable, so raw star success receives no positive ranking weight.",
    );
  } else {
    reasons.push(
      "The opposition-adjusted star record is presently neutral and does not change the performance assessment.",
    );
  }

  return Object.freeze({
    coreId: first.coreId,
    mode: first.mode,
    distanceMetres: first.distanceMetres,
    dataCurrentThrough: [...races]
      .map(({ eventAt }) => eventAt)
      .sort()
      .at(-1)!,
    raceCount: races.length,
    oppositionQualityKnownRaceCount,
    oppositionQualityCoverage: oppositionQualityKnownRaceCount / races.length,
    yellowSourceField: "gold_star",
    yellow: yellowEvaluation,
    blue: blueEvaluation,
    strongestStarredOpponents: Object.freeze(
      highlights
        .sort(
          (left, right) =>
            right.opponentPerformancePercentile -
              left.opponentPerformancePercentile ||
            right.opponentExactDistanceRaceCount -
              left.opponentExactDistanceRaceCount ||
            right.eventAt.localeCompare(left.eventAt) ||
            left.eventId.localeCompare(right.eventId),
        )
        .slice(0, 10),
    ),
    support,
    performanceRole: "supporting_only",
    breederRole: "research_feature_until_chronological_lift",
    reasons: Object.freeze(reasons),
  });
}
