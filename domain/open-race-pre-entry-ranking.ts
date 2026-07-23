export type OpenRaceHistoricalStarSupport = Readonly<{
  goldReceived: number;
  goldOpportunities: number;
  blueReceived: number;
  blueOpportunities: number;
  evidenceStatus: "complete" | "partial";
  rationale: readonly string[];
}>;

export type OpenRaceTimeProfile = Readonly<{
  optimisticTimeMs: number;
  medianTimeMs: number;
  conservativeTimeMs: number;
  sampleCount: number;
  sampleStatus: "minimally_analytical" | "hypothesis_only";
}>;

export type OpenRaceRankedCandidate = Readonly<{
  coreId: string;
  eligibilityStatus: "eligible";
  mode: "bike" | "car" | "horse";
  distanceMeters: number;
  profile: OpenRaceTimeProfile;
  historicalStars: OpenRaceHistoricalStarSupport;
}>;

export type OpenRaceRankedOpponent = Readonly<{
  coreId: string;
  identityStatus: "confirmed" | "unresolved";
  mode: "bike" | "car" | "horse";
  distanceMeters: number;
  profile: OpenRaceTimeProfile | null;
}>;

export type OpenRacePreEntryRankingInput = Readonly<{
  rankingId: string;
  evaluatedAt: string;
  dataCurrentThrough: string;
  freshness: "current" | "ageing" | "stale" | "unknown";
  fieldStage: "forming";
  mode: "bike" | "car" | "horse";
  distanceMeters: number;
  materialGapMs: number;
  candidates: readonly OpenRaceRankedCandidate[];
  opponents: readonly OpenRaceRankedOpponent[];
}>;

export type OpenRacePreEntryRankingResult = Readonly<{
  rankingId: string;
  evaluatedAt: string;
  dataCurrentThrough: string;
  freshness: OpenRacePreEntryRankingInput["freshness"];
  status: "provisional" | "insufficient_evidence";
  provisionalRecommendedCoreId: string | null;
  rankedCandidates: readonly Readonly<{
    rank: number;
    coreId: string;
    medianTimeMs: number;
    marginToStrongestOpponentMs: number | null;
    sampleStatus: OpenRaceTimeProfile["sampleStatus"];
    historicalStarRationale: readonly string[];
    starsAffectedRank: false;
  }>[];
  strongestOpponentCoreId: string | null;
  avoidSignal: boolean;
  reviewReasons: readonly string[];
  warnings: readonly string[];
  currentRaceStarsUsed: false;
  replacementRecommendationAllowed: false;
  raceEntryAllowed: false;
  finalActionableRecommendationAllowed: false;
}>;

const modes: readonly OpenRacePreEntryRankingInput["mode"][] = [
  "bike",
  "car",
  "horse",
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

function positiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}

function nonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

function validateProfile(profile: OpenRaceTimeProfile, label: string): void {
  positiveSafeInteger(profile.optimisticTimeMs, `${label} optimistic time`);
  positiveSafeInteger(profile.medianTimeMs, `${label} median time`);
  positiveSafeInteger(profile.conservativeTimeMs, `${label} conservative time`);
  positiveSafeInteger(profile.sampleCount, `${label} sample count`);
  if (
    !["minimally_analytical", "hypothesis_only"].includes(profile.sampleStatus)
  ) {
    throw new Error(`${label} sample status is invalid.`);
  }
  if (
    profile.optimisticTimeMs > profile.medianTimeMs ||
    profile.medianTimeMs > profile.conservativeTimeMs
  ) {
    throw new Error(`${label} time distribution must be ordered.`);
  }
  if (
    (profile.sampleStatus === "minimally_analytical" &&
      profile.sampleCount < 10) ||
    (profile.sampleStatus === "hypothesis_only" && profile.sampleCount >= 10)
  ) {
    throw new Error(`${label} sample status does not match sample count.`);
  }
}

function validateStarSupport(
  stars: OpenRaceHistoricalStarSupport,
  coreId: string,
): void {
  nonNegativeSafeInteger(stars.goldReceived, `Gold received for ${coreId}`);
  nonNegativeSafeInteger(
    stars.goldOpportunities,
    `Gold opportunities for ${coreId}`,
  );
  nonNegativeSafeInteger(stars.blueReceived, `Blue received for ${coreId}`);
  nonNegativeSafeInteger(
    stars.blueOpportunities,
    `Blue opportunities for ${coreId}`,
  );
  if (
    stars.goldReceived > stars.goldOpportunities ||
    stars.blueReceived > stars.blueOpportunities
  ) {
    throw new Error(
      `Star numerators cannot exceed denominators for ${coreId}.`,
    );
  }
  if (!["complete", "partial"].includes(stars.evidenceStatus)) {
    throw new Error(
      `Historical star evidence status is invalid for ${coreId}.`,
    );
  }
  if (
    stars.rationale.length === 0 ||
    stars.rationale.some((reason) => reason.trim() === "")
  ) {
    throw new Error(`Historical star rationale is required for ${coreId}.`);
  }
}

function rejectTopLevelCurrentRaceStars(value: object): void {
  const forbiddenKey = Object.keys(value).find((key) =>
    /(gold|blue|star)/i.test(key),
  );
  if (forbiddenKey !== undefined) {
    throw new Error(
      "Pre-entry ranking cannot contain current-race star input.",
    );
  }
}

export function rankOpenRacePreEntry(
  input: OpenRacePreEntryRankingInput,
): OpenRacePreEntryRankingResult {
  rejectTopLevelCurrentRaceStars(input);
  const rankingId = required(input.rankingId, "Ranking ID");
  const evaluatedAt = timestamp(input.evaluatedAt, "Evaluation time");
  const dataCurrentThrough = timestamp(
    input.dataCurrentThrough,
    "Data current through",
  );
  if (Date.parse(evaluatedAt) < Date.parse(dataCurrentThrough)) {
    throw new Error("Evaluation cannot predate historical evidence.");
  }
  if (!["current", "ageing", "stale", "unknown"].includes(input.freshness)) {
    throw new Error("Historical freshness is invalid.");
  }
  if (input.fieldStage !== "forming") {
    throw new Error(
      "Pre-entry ranking is allowed only while the field is forming.",
    );
  }
  if (!modes.includes(input.mode)) {
    throw new Error("Open Race mode is invalid.");
  }
  positiveSafeInteger(input.distanceMeters, "Distance metres");
  nonNegativeSafeInteger(input.materialGapMs, "Material gap");
  if (input.candidates.length === 0) {
    throw new Error("At least one eligible candidate is required.");
  }

  const allIds = [
    ...input.candidates.map(({ coreId }) =>
      required(coreId, "Candidate core ID"),
    ),
    ...input.opponents.map(({ coreId }) =>
      required(coreId, "Opponent core ID"),
    ),
  ];
  if (new Set(allIds).size !== allIds.length) {
    throw new Error("Candidate and opponent core IDs must be unique.");
  }

  for (const candidate of input.candidates) {
    if (candidate.eligibilityStatus !== "eligible") {
      throw new Error(
        `Candidate ${candidate.coreId} is not confirmed eligible.`,
      );
    }
    if (
      candidate.mode !== input.mode ||
      candidate.distanceMeters !== input.distanceMeters
    ) {
      throw new Error(
        `Candidate ${candidate.coreId} does not match mode and exact distance.`,
      );
    }
    validateProfile(candidate.profile, `Candidate ${candidate.coreId}`);
    validateStarSupport(candidate.historicalStars, candidate.coreId);
  }
  for (const opponent of input.opponents) {
    if (!["confirmed", "unresolved"].includes(opponent.identityStatus)) {
      throw new Error(
        `Opponent identity status is invalid for ${opponent.coreId}.`,
      );
    }
    if (
      opponent.mode !== input.mode ||
      opponent.distanceMeters !== input.distanceMeters
    ) {
      throw new Error(
        `Opponent ${opponent.coreId} does not match mode and exact distance.`,
      );
    }
    if (opponent.profile !== null) {
      validateProfile(opponent.profile, `Opponent ${opponent.coreId}`);
    }
  }

  const reviewReasons: string[] = [];
  const warnings: string[] = [];
  if (input.freshness === "stale" || input.freshness === "unknown") {
    reviewReasons.push("Historical evidence is stale or freshness is unknown.");
  }
  if (
    input.opponents.some(
      ({ identityStatus, profile }) =>
        identityStatus !== "confirmed" || profile === null,
    )
  ) {
    reviewReasons.push(
      "One or more entered opponents lack confirmed identity and exact-distance history.",
    );
  }
  if (
    input.candidates.some(
      ({ historicalStars }) => historicalStars.evidenceStatus === "partial",
    )
  ) {
    warnings.push(
      "Partial historical star evidence is disclosed but does not alter the time rank.",
    );
  }

  const sortedCandidates = [...input.candidates].sort(
    (left, right) =>
      left.profile.medianTimeMs - right.profile.medianTimeMs ||
      left.coreId.localeCompare(right.coreId),
  );
  const strongestOpponent = [...input.opponents]
    .filter(
      (
        opponent,
      ): opponent is OpenRaceRankedOpponent & {
        profile: OpenRaceTimeProfile;
      } => opponent.identityStatus === "confirmed" && opponent.profile !== null,
    )
    .sort(
      (left, right) =>
        left.profile.medianTimeMs - right.profile.medianTimeMs ||
        left.coreId.localeCompare(right.coreId),
    )[0];
  const rankedCandidates = sortedCandidates.map((candidate, index) => {
    const prior = sortedCandidates[index - 1];
    const rank =
      prior !== undefined &&
      candidate.profile.medianTimeMs - prior.profile.medianTimeMs <=
        input.materialGapMs
        ? index
        : index + 1;
    return {
      rank,
      coreId: candidate.coreId,
      medianTimeMs: candidate.profile.medianTimeMs,
      marginToStrongestOpponentMs:
        strongestOpponent === undefined
          ? null
          : strongestOpponent.profile.medianTimeMs -
            candidate.profile.medianTimeMs,
      sampleStatus: candidate.profile.sampleStatus,
      historicalStarRationale: candidate.historicalStars.rationale,
      starsAffectedRank: false as const,
    };
  });
  const leaders = rankedCandidates.filter(({ rank }) => rank === 1);
  if (leaders.length !== 1) {
    reviewReasons.push("Leading candidate times are within the material gap.");
  }
  if (sortedCandidates[0]?.profile.sampleStatus === "hypothesis_only") {
    reviewReasons.push(
      "The leading candidate has hypothesis-only time evidence.",
    );
  }

  const bestCandidate = sortedCandidates[0]!;
  const avoidSignal =
    strongestOpponent !== undefined &&
    bestCandidate.profile.optimisticTimeMs >
      strongestOpponent.profile.conservativeTimeMs;
  const status =
    reviewReasons.length === 0 ? "provisional" : "insufficient_evidence";

  return {
    rankingId,
    evaluatedAt,
    dataCurrentThrough,
    freshness: input.freshness,
    status,
    provisionalRecommendedCoreId:
      status === "provisional" ? (leaders[0]?.coreId ?? null) : null,
    rankedCandidates,
    strongestOpponentCoreId: strongestOpponent?.coreId ?? null,
    avoidSignal,
    reviewReasons,
    warnings,
    currentRaceStarsUsed: false,
    replacementRecommendationAllowed: false,
    raceEntryAllowed: false,
    finalActionableRecommendationAllowed: false,
  };
}
