import { probeModes, type ProbeMode } from "./discovery-probe-plan";

export const discoveryEvidenceClasses = [
  "normal_free",
  "competitive",
  "tournament",
  "esports",
  "unknown",
] as const;
export type DiscoveryEvidenceClass = (typeof discoveryEvidenceClasses)[number];

export const discoveryRecommendationTypes = [
  "preferred",
  "exploratory_fallback",
  "not_selected",
  "unknown",
] as const;
export type DiscoveryRecommendationType =
  (typeof discoveryRecommendationTypes)[number];

export type DiscoveryDistanceBand = "short" | "middle" | "long";

export type DiscoveryModeDistanceConfiguration = Readonly<{
  mode: ProbeMode;
  supportedDistancesMetres: readonly number[];
  bands: Readonly<Record<DiscoveryDistanceBand, readonly number[]>>;
  authority: string;
  reviewedAt: string;
}>;

export type DiscoveryRaceObservation = Readonly<{
  ownerId: string;
  coreId: string;
  coreName: string;
  raceId: string;
  raceName: string | null;
  mode: ProbeMode;
  distanceMetres: number;
  recordedTimeMilliseconds: number | null;
  position: number | null;
  gateOrFieldSize: number | null;
  evidenceClass: DiscoveryEvidenceClass;
  eventOrTournamentId: string | null;
  observedAt: string;
  retrievedAt: string;
  sourceAuthority: string;
}>;

export type DiscoveryNormalFreeMetrics = Readonly<{
  ownerId: string;
  coreId: string;
  mode: ProbeMode;
  distanceMetres: number;
  usableObservationCount: number;
  medianSpeedMetresPerSecond: number | null;
  meanSpeedMetresPerSecond: number | null;
  bestSpeedMetresPerSecond: number | null;
  worstSpeedMetresPerSecond: number | null;
  standardDeviationMetresPerSecond: number | null;
  coefficientOfVariation: number | null;
  speedRangeMetresPerSecond: number | null;
  targetSampleSize: number;
  completionPercentage: number;
  additionalObservationsNeeded: number;
  testStatus: "not_started" | "in_progress" | "complete";
}>;

export type DiscoveryDistanceSignal = Readonly<{
  distanceMetres: number;
  ownCompetitiveAssessment:
    "encouraging" | "clearly_negative" | "insufficient" | "unknown";
  ownCompetitiveObservations: number;
  normalFreeAssessment:
    "encouraging" | "clearly_negative" | "insufficient" | "unknown";
  normalFreeObservations: number;
  parentAssessment: "strong" | "negative" | "insufficient" | "unknown";
  parentObservations: number;
  familyDistanceRank: number | null;
  otherEvidenceAssessment: "encouraging" | "insufficient" | "unknown";
  preferredEvidenceGatePassed: boolean;
  screeningScore: number | null;
  evidenceBasis: readonly (
    | "own_competitive"
    | "normal_free_speed"
    | "parent_exact_distance"
    | "other_mode_appropriate"
    | "none"
  )[];
  reason: string;
}>;

export type DiscoveryDistanceRecommendation = Readonly<{
  mode: ProbeMode;
  distanceMetres: number;
  recommendationType: DiscoveryRecommendationType;
  displayLabel: "TEST" | "SCREEN" | "" | "UNKNOWN";
  evidenceBasis: DiscoveryDistanceSignal["evidenceBasis"];
  reason: string;
  uncertain: boolean;
}>;

const standaloneFree = /\bfree\b/i;

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

function canonicalTimestamp(value: string, label: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical timestamp.`);
  }
  return value;
}

export function classifyDiscoveryEvidence(
  input: Readonly<{
    raceName: string | null;
    explicitEventClass?: "competitive" | "tournament" | "esports" | null;
    entryPrice?: number | null;
  }>,
): DiscoveryEvidenceClass {
  const raceName = input.raceName?.trim() ?? "";
  if (raceName !== "" && standaloneFree.test(raceName)) return "normal_free";
  if (
    input.explicitEventClass !== null &&
    input.explicitEventClass !== undefined
  ) {
    return input.explicitEventClass;
  }
  return "unknown";
}

export function contributesToDisplayedProfile(
  evidenceClass: DiscoveryEvidenceClass,
): boolean {
  if (!discoveryEvidenceClasses.includes(evidenceClass)) {
    throw new Error("Discovery evidence class is invalid.");
  }
  return (
    evidenceClass === "competitive" ||
    evidenceClass === "tournament" ||
    evidenceClass === "esports"
  );
}

export function validateDiscoveryModeConfiguration(
  input: DiscoveryModeDistanceConfiguration,
): DiscoveryModeDistanceConfiguration {
  if (!probeModes.includes(input.mode)) {
    throw new Error("Discovery racing mode is invalid.");
  }
  const supportedDistancesMetres = input.supportedDistancesMetres.map(
    (distance) => positiveInteger(distance, "Supported distance"),
  );
  if (
    new Set(supportedDistancesMetres).size !== supportedDistancesMetres.length
  ) {
    throw new Error("Supported discovery distances must be unique.");
  }
  const supported = new Set(supportedDistancesMetres);
  const bands = Object.fromEntries(
    (["short", "middle", "long"] as const).map((band) => {
      const distances = input.bands[band].map((distance) =>
        positiveInteger(distance, `${band} distance`),
      );
      if (distances.length === 0) {
        throw new Error(`Discovery ${band} band must not be empty.`);
      }
      if (distances.some((distance) => !supported.has(distance))) {
        throw new Error(
          `Discovery ${band} band contains an unsupported exact distance.`,
        );
      }
      if (new Set(distances).size !== distances.length) {
        throw new Error(`Discovery ${band} distances must be unique.`);
      }
      return [band, Object.freeze([...distances].sort((a, b) => a - b))];
    }),
  ) as Record<DiscoveryDistanceBand, readonly number[]>;
  const bandDistances = Object.values(bands).flat();
  if (new Set(bandDistances).size !== bandDistances.length) {
    throw new Error("Discovery distance bands must not overlap.");
  }
  canonicalTimestamp(input.reviewedAt, "Distance configuration review time");
  return Object.freeze({
    mode: input.mode,
    supportedDistancesMetres: Object.freeze(
      [...supportedDistancesMetres].sort((a, b) => a - b),
    ),
    bands: Object.freeze(bands),
    authority: required(input.authority, "Distance configuration authority"),
    reviewedAt: input.reviewedAt,
  });
}

export const currentBikeDiscoveryDistanceConfiguration =
  validateDiscoveryModeConfiguration({
    mode: "bike",
    supportedDistancesMetres: [1_000, 1_200, 1_400, 1_600, 1_800, 2_000, 2_200],
    bands: {
      short: [1_000, 1_200, 1_400],
      middle: [1_600, 1_800],
      long: [2_000, 2_200],
    },
    authority: "owner clarification 2026-08-29",
    reviewedAt: "2026-08-29T00:00:00.000Z",
  });

function normalizedObservation(
  input: DiscoveryRaceObservation,
): DiscoveryRaceObservation {
  if (!probeModes.includes(input.mode)) {
    throw new Error("Discovery observation racing mode is invalid.");
  }
  if (!discoveryEvidenceClasses.includes(input.evidenceClass)) {
    throw new Error("Discovery observation evidence class is invalid.");
  }
  const nameClass = classifyDiscoveryEvidence({ raceName: input.raceName });
  if (
    (input.evidenceClass === "normal_free") !==
    (nameClass === "normal_free")
  ) {
    throw new Error(
      "Normal-Free observation class conflicts with its authoritative race name.",
    );
  }
  positiveInteger(input.distanceMetres, "Observation distance");
  if (
    input.recordedTimeMilliseconds !== null &&
    (!Number.isFinite(input.recordedTimeMilliseconds) ||
      input.recordedTimeMilliseconds <= 0)
  ) {
    throw new Error("Recorded time must be positive and finite when present.");
  }
  if (input.position !== null) positiveInteger(input.position, "Position");
  if (input.gateOrFieldSize !== null) {
    positiveInteger(input.gateOrFieldSize, "Gate or field size");
    if (input.position !== null && input.position > input.gateOrFieldSize) {
      throw new Error("Position cannot exceed gate or field size.");
    }
  }
  const observedAt = canonicalTimestamp(input.observedAt, "Observation time");
  const retrievedAt = canonicalTimestamp(input.retrievedAt, "Retrieval time");
  if (Date.parse(observedAt) > Date.parse(retrievedAt)) {
    throw new Error("Observation time cannot follow retrieval time.");
  }
  return Object.freeze({
    ...input,
    ownerId: required(input.ownerId, "Owner ID"),
    coreId: required(input.coreId, "Core ID"),
    coreName: required(input.coreName, "Core name"),
    raceId: required(input.raceId, "Race ID"),
    raceName:
      input.raceName === null ? null : required(input.raceName, "Race name"),
    eventOrTournamentId:
      input.eventOrTournamentId === null
        ? null
        : required(input.eventOrTournamentId, "Event or tournament ID"),
    observedAt,
    retrievedAt,
    sourceAuthority: required(input.sourceAuthority, "Source authority"),
  });
}

function observationIdentity(observation: DiscoveryRaceObservation): string {
  return JSON.stringify([
    observation.ownerId,
    observation.coreId,
    observation.mode,
    observation.raceId,
  ]);
}

function observationFingerprint(observation: DiscoveryRaceObservation): string {
  return JSON.stringify([
    observation.ownerId,
    observation.coreId,
    observation.coreName,
    observation.raceId,
    observation.raceName,
    observation.mode,
    observation.distanceMetres,
    observation.recordedTimeMilliseconds,
    observation.position,
    observation.gateOrFieldSize,
    observation.evidenceClass,
    observation.eventOrTournamentId,
    observation.observedAt,
    observation.retrievedAt,
    observation.sourceAuthority,
  ]);
}

export function deduplicateDiscoveryObservations(
  observations: readonly DiscoveryRaceObservation[],
): readonly DiscoveryRaceObservation[] {
  const deduplicated = new Map<string, DiscoveryRaceObservation>();
  for (const value of observations) {
    const observation = normalizedObservation(value);
    const key = observationIdentity(observation);
    const existing = deduplicated.get(key);
    if (existing !== undefined) {
      if (
        observationFingerprint(existing) !== observationFingerprint(observation)
      ) {
        throw new Error("Conflicting duplicate discovery race observation.");
      }
      continue;
    }
    deduplicated.set(key, observation);
  }
  return Object.freeze(
    [...deduplicated.values()].sort(
      (left, right) =>
        left.observedAt.localeCompare(right.observedAt) ||
        left.raceId.localeCompare(right.raceId),
    ),
  );
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

export function calculateNormalFreeMetrics(
  input: Readonly<{
    ownerId: string;
    coreId: string;
    mode: ProbeMode;
    distanceMetres: number;
    observations: readonly DiscoveryRaceObservation[];
    targetSampleSize?: number;
  }>,
): DiscoveryNormalFreeMetrics {
  const targetSampleSize = positiveInteger(
    input.targetSampleSize ?? 20,
    "Discovery target sample size",
  );
  if (!probeModes.includes(input.mode)) {
    throw new Error("Discovery metric racing mode is invalid.");
  }
  positiveInteger(input.distanceMetres, "Discovery metric distance");
  const observations = deduplicateDiscoveryObservations(input.observations);
  if (
    observations.some(
      (observation) =>
        observation.ownerId !== input.ownerId ||
        observation.coreId !== input.coreId ||
        observation.mode !== input.mode ||
        observation.distanceMetres !== input.distanceMetres,
    )
  ) {
    throw new Error(
      "Discovery samples must contain one owner, Core, mode and exact distance.",
    );
  }
  const speeds = observations
    .filter(
      (observation) =>
        observation.evidenceClass === "normal_free" &&
        observation.recordedTimeMilliseconds !== null,
    )
    .map(
      (observation) =>
        observation.distanceMetres /
        (observation.recordedTimeMilliseconds! / 1_000),
    );
  const usableObservationCount = speeds.length;
  const mean =
    usableObservationCount === 0
      ? null
      : speeds.reduce((sum, speed) => sum + speed, 0) / usableObservationCount;
  const standardDeviation =
    mean === null
      ? null
      : Math.sqrt(
          speeds.reduce((sum, speed) => sum + (speed - mean) ** 2, 0) /
            usableObservationCount,
        );
  const additionalObservationsNeeded = Math.max(
    0,
    targetSampleSize - usableObservationCount,
  );
  return Object.freeze({
    ownerId: required(input.ownerId, "Owner ID"),
    coreId: required(input.coreId, "Core ID"),
    mode: input.mode,
    distanceMetres: input.distanceMetres,
    usableObservationCount,
    medianSpeedMetresPerSecond:
      usableObservationCount === 0 ? null : median(speeds),
    meanSpeedMetresPerSecond: mean,
    bestSpeedMetresPerSecond:
      usableObservationCount === 0 ? null : Math.max(...speeds),
    worstSpeedMetresPerSecond:
      usableObservationCount === 0 ? null : Math.min(...speeds),
    standardDeviationMetresPerSecond: standardDeviation,
    coefficientOfVariation:
      mean === null || standardDeviation === null || mean === 0
        ? null
        : standardDeviation / mean,
    speedRangeMetresPerSecond:
      usableObservationCount === 0
        ? null
        : Math.max(...speeds) - Math.min(...speeds),
    targetSampleSize,
    completionPercentage: Math.min(
      100,
      (usableObservationCount / targetSampleSize) * 100,
    ),
    additionalObservationsNeeded,
    testStatus:
      usableObservationCount === 0
        ? "not_started"
        : additionalObservationsNeeded === 0
          ? "complete"
          : "in_progress",
  });
}

export function partitionDiscoveryObservations(
  observations: readonly DiscoveryRaceObservation[],
): ReadonlyMap<string, readonly DiscoveryRaceObservation[]> {
  const partitions = new Map<string, DiscoveryRaceObservation[]>();
  for (const observation of deduplicateDiscoveryObservations(observations)) {
    const key = JSON.stringify([
      observation.ownerId,
      observation.coreId,
      observation.mode,
      observation.distanceMetres,
      observation.evidenceClass,
    ]);
    const values = partitions.get(key) ?? [];
    values.push(observation);
    partitions.set(key, values);
  }
  return new Map(
    [...partitions].map(([key, values]) => [key, Object.freeze(values)]),
  );
}

function signalScore(signal: DiscoveryDistanceSignal): number {
  return signal.screeningScore ?? Number.NEGATIVE_INFINITY;
}

function parentOnly(signal: DiscoveryDistanceSignal): boolean {
  return (
    signal.evidenceBasis.includes("parent_exact_distance") &&
    !signal.evidenceBasis.some((basis) =>
      [
        "own_competitive",
        "normal_free_speed",
        "other_mode_appropriate",
      ].includes(basis),
    )
  );
}

function preferredIsValid(signal: DiscoveryDistanceSignal): boolean {
  if (!signal.preferredEvidenceGatePassed) return false;
  if (parentOnly(signal) && signal.parentObservations === 0) return false;
  if (
    parentOnly(signal) &&
    signal.ownCompetitiveAssessment === "clearly_negative"
  ) {
    return false;
  }
  return !signal.evidenceBasis.includes("none");
}

function fallbackForBand(
  band: DiscoveryDistanceBand,
  distances: readonly number[],
  signals: ReadonlyMap<number, DiscoveryDistanceSignal>,
): DiscoveryDistanceSignal {
  const candidates = distances.map((distance) => {
    const signal = signals.get(distance);
    if (signal !== undefined) return signal;
    return {
      distanceMetres: distance,
      ownCompetitiveAssessment: "unknown",
      ownCompetitiveObservations: 0,
      normalFreeAssessment: "unknown",
      normalFreeObservations: 0,
      parentAssessment: "unknown",
      parentObservations: 0,
      familyDistanceRank: null,
      otherEvidenceAssessment: "unknown",
      preferredEvidenceGatePassed: false,
      screeningScore: null,
      evidenceBasis: ["none"],
      reason: `No supporting ${band}-distance evidence is currently available.`,
    } satisfies DiscoveryDistanceSignal;
  });
  const notClearlyNegative = candidates.filter(
    (candidate) =>
      candidate.ownCompetitiveAssessment !== "clearly_negative" &&
      candidate.normalFreeAssessment !== "clearly_negative",
  );
  const eligible =
    notClearlyNegative.length > 0 ? notClearlyNegative : candidates;
  const scored = eligible.filter(
    (candidate) => candidate.screeningScore !== null,
  );
  if (scored.length > 0) {
    return [...scored].sort(
      (left, right) =>
        signalScore(right) - signalScore(left) ||
        left.distanceMetres - right.distanceMetres,
    )[0]!;
  }
  return eligible[Math.floor((eligible.length - 1) / 2)]!;
}

export function buildDiscoveryDistanceRecommendations(
  input: Readonly<{
    mode: ProbeMode;
    configuration: DiscoveryModeDistanceConfiguration;
    signals: readonly DiscoveryDistanceSignal[];
    historyComplete: boolean;
  }>,
): Readonly<{
  published: boolean;
  recommendations: readonly DiscoveryDistanceRecommendation[];
  blockedReason: string | null;
}> {
  const configuration = validateDiscoveryModeConfiguration(input.configuration);
  if (configuration.mode !== input.mode) {
    throw new Error(
      "Discovery recommendation mode does not match configuration.",
    );
  }
  if (!input.historyComplete) {
    return Object.freeze({
      published: false,
      recommendations: Object.freeze([]),
      blockedReason:
        "Complete paginated history is required before publication.",
    });
  }
  const supported = new Set(configuration.supportedDistancesMetres);
  const signals = new Map<number, DiscoveryDistanceSignal>();
  for (const signal of input.signals) {
    positiveInteger(signal.distanceMetres, "Discovery signal distance");
    if (!supported.has(signal.distanceMetres)) {
      throw new Error(
        "Discovery signal uses an invalid mode-specific distance.",
      );
    }
    if (signals.has(signal.distanceMetres)) {
      throw new Error("Discovery signals must be unique by exact distance.");
    }
    nonNegativeInteger(
      signal.ownCompetitiveObservations,
      "Own competitive observations",
    );
    nonNegativeInteger(
      signal.normalFreeObservations,
      "Normal-Free observations",
    );
    nonNegativeInteger(signal.parentObservations, "Parent observations");
    required(signal.reason, "Discovery signal reason");
    signals.set(signal.distanceMetres, signal);
  }

  const preferredDistances = new Set(
    [...signals.values()]
      .filter(preferredIsValid)
      .map((signal) => signal.distanceMetres),
  );
  const fallbackDistances = new Set<number>();
  if (preferredDistances.size === 0) {
    for (const band of ["short", "middle", "long"] as const) {
      fallbackDistances.add(
        fallbackForBand(band, configuration.bands[band], signals)
          .distanceMetres,
      );
    }
  }

  const recommendations = configuration.supportedDistancesMetres.map(
    (distanceMetres): DiscoveryDistanceRecommendation => {
      const signal = signals.get(distanceMetres);
      if (preferredDistances.has(distanceMetres)) {
        return Object.freeze({
          mode: input.mode,
          distanceMetres,
          recommendationType: "preferred",
          displayLabel: "TEST",
          evidenceBasis: signal!.evidenceBasis,
          reason: signal!.reason,
          uncertain:
            signal!.ownCompetitiveObservations < 10 &&
            signal!.normalFreeObservations < 20,
        });
      }
      if (fallbackDistances.has(distanceMetres)) {
        return Object.freeze({
          mode: input.mode,
          distanceMetres,
          recommendationType: "exploratory_fallback",
          displayLabel: "SCREEN",
          evidenceBasis: signal?.evidenceBasis ?? (["none"] as const),
          reason:
            signal?.reason ??
            "No supporting evidence exists; this is a neutral broad screen, not a predicted preference.",
          uncertain: true,
        });
      }
      return Object.freeze({
        mode: input.mode,
        distanceMetres,
        recommendationType: signal === undefined ? "unknown" : "not_selected",
        displayLabel: signal === undefined ? "UNKNOWN" : "",
        evidenceBasis: signal?.evidenceBasis ?? (["none"] as const),
        reason:
          signal?.reason ??
          "No complete evidence is available for this distance.",
        uncertain: true,
      });
    },
  );
  return Object.freeze({
    published: true,
    recommendations: Object.freeze(recommendations),
    blockedReason: null,
  });
}
