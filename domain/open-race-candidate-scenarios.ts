import {
  calculatePairwiseRaceProbability,
  normalizeEmpiricalRaceTimeObservations,
  normalizeExactRaceProbabilityContext,
  type EmpiricalRaceTimeObservation,
  type ExactRaceProbabilityContext,
  type PairwiseRaceProbabilityReason,
  type PairwiseRaceProbabilityResult,
} from "@/domain/race-probability-baseline";

export type OpenRaceScenarioOpponent = Readonly<{
  entryId: string;
  identityStatus: "confirmed" | "unresolved";
  coreId: string | null;
  observations: readonly EmpiricalRaceTimeObservation[] | null;
}>;

export type OpenRaceScenarioCandidate = Readonly<{
  coreId: string;
  eligibilityStatus: "eligible";
  observations: readonly EmpiricalRaceTimeObservation[];
}>;

export type OpenRaceCandidateScenarioInput = Readonly<{
  scenarioId: string;
  modelVersion: string;
  evaluatedAt: string;
  evidenceCutoff: string;
  context: ExactRaceProbabilityContext;
  field: Readonly<{
    fieldVersion: string;
    fieldCapturedAt: string;
    stage: "forming";
    enteredOpponents: readonly OpenRaceScenarioOpponent[];
  }>;
  candidates: readonly OpenRaceScenarioCandidate[];
}>;

export type OpenRaceCandidateScenarioReason =
  | "NO_ENTERED_OPPONENTS"
  | "UNRESOLVED_OPPONENT_IDENTITY"
  | PairwiseRaceProbabilityReason;

export type OpenRaceCandidateScenario = Readonly<{
  coreId: string;
  status: "available" | "unavailable" | "review_required";
  comparisons: readonly Readonly<{
    entryId: string;
    opponentCoreId: string;
    probability: PairwiseRaceProbabilityResult;
  }>[];
  enteredOpponentCount: number;
  comparableOpponentCount: number;
  availableComparisonCount: number;
  unavailableComparisonCount: number;
  reviewRequiredComparisonCount: number;
  reasons: readonly OpenRaceCandidateScenarioReason[];
  combinedFieldWinProbabilityMillionths: null;
  combinedFieldProbabilityStatus: "not_calculated_unapproved_combination";
  recommendationAllowed: false;
}>;

export type OpenRaceCandidateScenarioResult = Readonly<{
  scenarioId: string;
  modelVersion: string;
  evaluatedAt: string;
  evidenceCutoff: string;
  context: ExactRaceProbabilityContext;
  field: Readonly<{
    fieldVersion: string;
    fieldCapturedAt: string;
    stage: "forming";
    enteredOpponentCount: number;
    emptyGateCount: number;
    unresolvedOpponentCount: number;
  }>;
  status: "available" | "unavailable" | "review_required";
  candidates: readonly OpenRaceCandidateScenario[];
  probabilityBasis: "per_opponent_empirical_pairwise_only";
  combinedFieldProbabilityStatus: "not_calculated_unapproved_combination";
  currentRaceStarsUsed: false;
  fairExOddsUsed: false;
  raceEntryAllowed: false;
  gameActionAllowed: false;
  analyticalStatus: "experimental";
}>;

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

function rejectForbiddenEvidence(value: object, label: string): void {
  const forbiddenKey = Object.keys(value).find((key) =>
    /^(actual|observedResult|result|winner|finish|revealed|gold|blue|star|fairEx|odds|fee|payout)/i.test(
      key,
    ),
  );
  if (forbiddenKey !== undefined) {
    throw new Error(
      `${label} cannot contain current-race results, stars, odds or economics.`,
    );
  }
}

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must be unique.`);
  }
}

function scenarioStatus(
  comparisons: readonly PairwiseRaceProbabilityResult[],
  unresolvedOpponentCount: number,
  enteredOpponentCount: number,
): OpenRaceCandidateScenario["status"] {
  if (
    unresolvedOpponentCount > 0 ||
    comparisons.some(({ status }) => status === "review_required")
  ) {
    return "review_required";
  }
  if (
    enteredOpponentCount === 0 ||
    comparisons.some(({ status }) => status === "unavailable")
  ) {
    return "unavailable";
  }
  return "available";
}

function distinctReasons(
  comparisons: readonly PairwiseRaceProbabilityResult[],
  unresolvedOpponentCount: number,
  enteredOpponentCount: number,
): readonly OpenRaceCandidateScenarioReason[] {
  const reasons = new Set<OpenRaceCandidateScenarioReason>();
  if (enteredOpponentCount === 0) reasons.add("NO_ENTERED_OPPONENTS");
  if (unresolvedOpponentCount > 0) {
    reasons.add("UNRESOLVED_OPPONENT_IDENTITY");
  }
  for (const comparison of comparisons) {
    for (const reason of comparison.reasons) reasons.add(reason);
  }
  return [...reasons];
}

/**
 * Builds auditable candidate-versus-entered-opponent evidence without inventing
 * a multi-runner combination rule. Each comparison reuses the approved exact-
 * context empirical pairwise baseline; no recommendation or game action follows.
 */
export function evaluateOpenRaceCandidateScenarios(
  input: OpenRaceCandidateScenarioInput,
): OpenRaceCandidateScenarioResult {
  rejectForbiddenEvidence(input, "Open Race candidate scenario");
  rejectForbiddenEvidence(input.field, "Open Race field");
  const scenarioId = required(input.scenarioId, "Scenario ID");
  const modelVersion = required(input.modelVersion, "Model version");
  const evaluatedAt = timestamp(input.evaluatedAt, "Evaluation time");
  const evidenceCutoff = timestamp(input.evidenceCutoff, "Evidence cutoff");
  const fieldVersion = required(input.field.fieldVersion, "Field version");
  const fieldCapturedAt = timestamp(
    input.field.fieldCapturedAt,
    "Field capture time",
  );
  const context = normalizeExactRaceProbabilityContext(input.context);
  if (Date.parse(evidenceCutoff) > Date.parse(evaluatedAt)) {
    throw new Error("Evidence cutoff cannot follow evaluation time.");
  }
  if (Date.parse(fieldCapturedAt) > Date.parse(evaluatedAt)) {
    throw new Error("Field capture cannot follow evaluation time.");
  }
  if (input.field.stage !== "forming") {
    throw new Error("Candidate scenarios require a forming Open Race field.");
  }
  if (input.candidates.length === 0) {
    throw new Error("At least one eligible candidate is required.");
  }
  if (input.field.enteredOpponents.length >= context.gateCount) {
    throw new Error("Candidate scenarios require at least one empty gate.");
  }

  const entryIds = input.field.enteredOpponents.map((opponent) =>
    required(opponent.entryId, "Opponent entry ID"),
  );
  unique(entryIds, "Opponent entry IDs");
  const confirmedOpponentCoreIds: string[] = [];
  const opponentObservationsByEntryId = new Map<
    string,
    readonly EmpiricalRaceTimeObservation[]
  >();
  for (const opponent of input.field.enteredOpponents) {
    rejectForbiddenEvidence(opponent, `Opponent ${opponent.entryId}`);
    if (opponent.identityStatus === "confirmed") {
      if (opponent.coreId === null || opponent.observations === null) {
        throw new Error(
          "Confirmed opponents require a Core ID and explicit observations.",
        );
      }
      confirmedOpponentCoreIds.push(
        required(opponent.coreId, "Opponent Core ID"),
      );
      opponentObservationsByEntryId.set(
        required(opponent.entryId, "Opponent entry ID"),
        normalizeEmpiricalRaceTimeObservations({
          observations: opponent.observations,
          label: `Opponent ${opponent.entryId}`,
          evidenceCutoff,
        }),
      );
    } else if (opponent.identityStatus === "unresolved") {
      if (opponent.coreId !== null || opponent.observations !== null) {
        throw new Error(
          "Unresolved opponents cannot carry an assumed Core ID or history.",
        );
      }
    } else {
      throw new Error("Opponent identity status is invalid.");
    }
  }
  unique(confirmedOpponentCoreIds, "Confirmed opponent Core IDs");

  const candidateCoreIds = input.candidates.map((candidate) =>
    required(candidate.coreId, "Candidate Core ID"),
  );
  unique(candidateCoreIds, "Candidate Core IDs");
  if (
    candidateCoreIds.some((coreId) => confirmedOpponentCoreIds.includes(coreId))
  ) {
    throw new Error("A candidate cannot already be entered as an opponent.");
  }

  const unresolvedOpponentCount = input.field.enteredOpponents.filter(
    ({ identityStatus }) => identityStatus === "unresolved",
  ).length;
  const candidates = input.candidates.map((candidate) => {
    rejectForbiddenEvidence(candidate, `Candidate ${candidate.coreId}`);
    const candidateCoreId = required(candidate.coreId, "Candidate Core ID");
    const candidateObservations = normalizeEmpiricalRaceTimeObservations({
      observations: candidate.observations,
      label: `Candidate ${candidateCoreId}`,
      evidenceCutoff,
    });
    if (candidate.eligibilityStatus !== "eligible") {
      throw new Error(`Candidate ${candidate.coreId} is not eligible.`);
    }
    const comparisons = input.field.enteredOpponents.flatMap((opponent) => {
      if (
        opponent.identityStatus !== "confirmed" ||
        opponent.coreId === null ||
        opponent.observations === null
      ) {
        return [];
      }
      const entryId = required(opponent.entryId, "Opponent entry ID");
      const opponentCoreId = required(opponent.coreId, "Opponent Core ID");
      const opponentObservations = opponentObservationsByEntryId.get(entryId);
      if (opponentObservations === undefined) {
        throw new Error("Confirmed opponent history is unavailable.");
      }
      const probability = calculatePairwiseRaceProbability({
        baselineId: JSON.stringify([
          scenarioId,
          candidateCoreId,
          opponentCoreId,
        ]),
        modelVersion,
        evidenceCutoff,
        context,
        candidateCoreId,
        opponentCoreId,
        candidateObservations,
        opponentObservations,
      });
      return [
        {
          entryId,
          opponentCoreId,
          probability,
        },
      ];
    });
    const probabilities = comparisons.map(({ probability }) => probability);
    return Object.freeze({
      coreId: candidateCoreId,
      status: scenarioStatus(
        probabilities,
        unresolvedOpponentCount,
        input.field.enteredOpponents.length,
      ),
      comparisons: Object.freeze(comparisons),
      enteredOpponentCount: input.field.enteredOpponents.length,
      comparableOpponentCount: comparisons.length,
      availableComparisonCount: probabilities.filter(
        ({ status }) => status === "available",
      ).length,
      unavailableComparisonCount: probabilities.filter(
        ({ status }) => status === "unavailable",
      ).length,
      reviewRequiredComparisonCount: probabilities.filter(
        ({ status }) => status === "review_required",
      ).length,
      reasons: distinctReasons(
        probabilities,
        unresolvedOpponentCount,
        input.field.enteredOpponents.length,
      ),
      combinedFieldWinProbabilityMillionths: null,
      combinedFieldProbabilityStatus:
        "not_calculated_unapproved_combination" as const,
      recommendationAllowed: false as const,
    });
  });
  const status = candidates.some(
    (candidate) => candidate.status === "review_required",
  )
    ? "review_required"
    : candidates.every((candidate) => candidate.status === "unavailable")
      ? "unavailable"
      : candidates.some((candidate) => candidate.status === "unavailable")
        ? "review_required"
        : "available";

  return Object.freeze({
    scenarioId,
    modelVersion,
    evaluatedAt,
    evidenceCutoff,
    context,
    field: Object.freeze({
      fieldVersion,
      fieldCapturedAt,
      stage: "forming" as const,
      enteredOpponentCount: input.field.enteredOpponents.length,
      emptyGateCount: context.gateCount - input.field.enteredOpponents.length,
      unresolvedOpponentCount,
    }),
    status,
    candidates: Object.freeze(candidates),
    probabilityBasis: "per_opponent_empirical_pairwise_only" as const,
    combinedFieldProbabilityStatus:
      "not_calculated_unapproved_combination" as const,
    currentRaceStarsUsed: false as const,
    fairExOddsUsed: false as const,
    raceEntryAllowed: false as const,
    gameActionAllowed: false as const,
    analyticalStatus: "experimental" as const,
  });
}
