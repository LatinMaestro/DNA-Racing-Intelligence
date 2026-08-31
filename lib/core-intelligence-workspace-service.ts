import {
  raceModes,
  type CorePerformanceProfile,
  type RaceMode,
} from "@/domain/core-performance";
import {
  buildCoreEsportsPerformanceProfiles,
  type CoreEsportsPerformanceProfile,
  type CoreEsportsRaceObservation,
} from "@/domain/core-esports-performance";
import { deriveFreshness } from "@/domain/freshness";
import type { CoreStarProfile, CountRatio } from "@/domain/star-signals";

type CorePerformanceProjection = Readonly<{
  profiles: readonly CorePerformanceProfile[];
  lastImportedAt: string | null;
}>;

type CoreEsportsProjection = Readonly<{
  observations: readonly CoreEsportsRaceObservation[];
  lastSyncedAt: string | null;
}>;

export type CorePerformanceProfileRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      listProfilesByOwner: (
        ownerId: string,
        coreId?: string | null,
      ) => Promise<CorePerformanceProjection>;
    }>;

export type CoreEsportsRaceRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      listRaceObservationsByOwner: (
        ownerId: string,
        coreId?: string | null,
      ) => Promise<CoreEsportsProjection>;
    }>;

export type CoreIntelligenceConnectionStatus =
  | "identity_not_connected"
  | "persistence_not_configured"
  | "read_model_connected";

export type CoreIntelligencePageState = Readonly<{
  profiles: readonly CorePerformanceProfile[];
  lastImportedAt: string | null;
  connectionStatus: CoreIntelligenceConnectionStatus;
  esportsProfiles: readonly CoreEsportsPerformanceProfile[];
  esportsLastSyncedAt: string | null;
  esportsConnectionStatus: "not_configured" | "connected";
}>;

export const unavailableCorePerformanceProfileRepository: CorePerformanceProfileRepository =
  Object.freeze({ status: "not_configured" });

export const unavailableCoreEsportsRaceRepository: CoreEsportsRaceRepository =
  Object.freeze({ status: "not_configured" });

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid Core Intelligence ${field}.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid Core Intelligence ${field}.`);
  }
  return value;
}

function safeIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid Core Intelligence ${field}.`);
  }
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`Invalid Core Intelligence ${field}.`);
  }
  return normalized;
}

function canonicalTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid Core Intelligence ${field}.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`Invalid Core Intelligence ${field}.`);
  }
  return value;
}

function positiveSafeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid Core Intelligence ${field}.`);
  }
  return value as number;
}

function nonNegativeSafeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid Core Intelligence ${field}.`);
  }
  return value as number;
}

function positiveFinite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid Core Intelligence ${field}.`);
  }
  return value;
}

function nonNegativeFinite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid Core Intelligence ${field}.`);
  }
  return value;
}

function raceMode(value: unknown, field: string): RaceMode {
  if (
    typeof value !== "string" ||
    !raceModes.some((candidate) => candidate === value)
  ) {
    throw new Error(`Invalid Core Intelligence ${field}.`);
  }
  return value as RaceMode;
}

function countRatio(value: unknown, field: string): CountRatio {
  const ratio = object(value, field);
  const numerator = nonNegativeSafeInteger(
    ratio.numerator,
    `${field} numerator`,
  );
  const denominator = nonNegativeSafeInteger(
    ratio.denominator,
    `${field} denominator`,
  );
  if (numerator > denominator) {
    throw new Error(`Invalid Core Intelligence ${field}.`);
  }
  return { numerator, denominator };
}

function normalizeStarProfile(
  value: unknown,
  expected: Readonly<{ coreId: string; mode: RaceMode; distance: number }>,
): CoreStarProfile | null {
  if (value === null) return null;
  const star = object(value, "star profile");
  const normalized: CoreStarProfile = {
    coreId: safeIdentifier(star.coreId, "star coreId"),
    mode: raceMode(star.mode, "star mode"),
    distance: positiveSafeInteger(star.distance, "star distance"),
    dataCurrentThrough: canonicalTimestamp(
      star.dataCurrentThrough,
      "star current-through timestamp",
    ),
    raceCount: positiveSafeInteger(star.raceCount, "star race count"),
    completeStarDataRaceCount: nonNegativeSafeInteger(
      star.completeStarDataRaceCount,
      "complete star-data count",
    ),
    partialStarDataRaceCount: nonNegativeSafeInteger(
      star.partialStarDataRaceCount,
      "partial star-data count",
    ),
    missingStarDataRaceCount: nonNegativeSafeInteger(
      star.missingStarDataRaceCount,
      "missing star-data count",
    ),
    invalidStarDataRaceCount: nonNegativeSafeInteger(
      star.invalidStarDataRaceCount,
      "invalid star-data count",
    ),
    goldEligibleRaceCount: nonNegativeSafeInteger(
      star.goldEligibleRaceCount,
      "Gold-eligible count",
    ),
    goldAssignmentOpportunityCount: nonNegativeSafeInteger(
      star.goldAssignmentOpportunityCount,
      "Gold opportunity count",
    ),
    goldReceivedCount: nonNegativeSafeInteger(
      star.goldReceivedCount,
      "Gold received count",
    ),
    goldNegativeOpportunityCount: nonNegativeSafeInteger(
      star.goldNegativeOpportunityCount,
      "Gold negative-opportunity count",
    ),
    goldEligibleNoAssignmentCount: nonNegativeSafeInteger(
      star.goldEligibleNoAssignmentCount,
      "Gold eligible-no-assignment count",
    ),
    goldIneligibleAssignmentCount: nonNegativeSafeInteger(
      star.goldIneligibleAssignmentCount,
      "Gold ineligible-assignment count",
    ),
    goldExcludedAnomalyCount: nonNegativeSafeInteger(
      star.goldExcludedAnomalyCount,
      "Gold excluded-anomaly count",
    ),
    goldReceivedRate: countRatio(star.goldReceivedRate, "Gold received rate"),
    blueAssignmentOpportunityCount: nonNegativeSafeInteger(
      star.blueAssignmentOpportunityCount,
      "Blue opportunity count",
    ),
    blueReceivedCount: nonNegativeSafeInteger(
      star.blueReceivedCount,
      "Blue received count",
    ),
    blueNegativeOpportunityCount: nonNegativeSafeInteger(
      star.blueNegativeOpportunityCount,
      "Blue negative-opportunity count",
    ),
    blueNoAssignmentCount: nonNegativeSafeInteger(
      star.blueNoAssignmentCount,
      "Blue no-assignment count",
    ),
    blueExcludedAnomalyCount: nonNegativeSafeInteger(
      star.blueExcludedAnomalyCount,
      "Blue excluded-anomaly count",
    ),
    blueReceivedRate: countRatio(star.blueReceivedRate, "Blue received rate"),
    sameCoreReceivedBothCount: nonNegativeSafeInteger(
      star.sameCoreReceivedBothCount,
      "same-core both-star count",
    ),
  };

  const starDataTotal =
    normalized.completeStarDataRaceCount +
    normalized.partialStarDataRaceCount +
    normalized.missingStarDataRaceCount +
    normalized.invalidStarDataRaceCount;
  const counts = [
    normalized.goldEligibleRaceCount,
    normalized.goldAssignmentOpportunityCount,
    normalized.goldReceivedCount,
    normalized.goldNegativeOpportunityCount,
    normalized.goldEligibleNoAssignmentCount,
    normalized.goldIneligibleAssignmentCount,
    normalized.goldExcludedAnomalyCount,
    normalized.blueAssignmentOpportunityCount,
    normalized.blueReceivedCount,
    normalized.blueNegativeOpportunityCount,
    normalized.blueNoAssignmentCount,
    normalized.blueExcludedAnomalyCount,
    normalized.sameCoreReceivedBothCount,
  ];
  if (
    normalized.coreId !== expected.coreId ||
    normalized.mode !== expected.mode ||
    normalized.distance !== expected.distance ||
    !Number.isSafeInteger(starDataTotal) ||
    starDataTotal !== normalized.raceCount ||
    counts.some((count) => count > normalized.raceCount) ||
    normalized.goldReceivedRate.numerator !== normalized.goldReceivedCount ||
    normalized.goldReceivedRate.denominator !==
      normalized.goldAssignmentOpportunityCount ||
    normalized.blueReceivedRate.numerator !== normalized.blueReceivedCount ||
    normalized.blueReceivedRate.denominator !==
      normalized.blueAssignmentOpportunityCount ||
    normalized.sameCoreReceivedBothCount > normalized.goldReceivedCount ||
    normalized.sameCoreReceivedBothCount > normalized.blueReceivedCount
  ) {
    throw new Error("Invalid Core Intelligence star profile.");
  }
  return normalized;
}

function normalizeProfile(value: unknown, now: Date): CorePerformanceProfile {
  const profile = object(value, "read-model profile");
  const coreId = safeIdentifier(profile.coreId, "coreId");
  const mode = raceMode(profile.mode, "mode");
  const distance = positiveSafeInteger(profile.distance, "distance");
  const dataCurrentThrough = canonicalTimestamp(
    profile.dataCurrentThrough,
    "current-through timestamp",
  );
  const raceCount = positiveSafeInteger(profile.raceCount, "race count");
  const elapsed = object(profile.elapsedTime, "elapsed-time metrics");
  const speed = object(profile.speed, "speed metrics");
  const bestMilliseconds = positiveFinite(
    elapsed.bestMilliseconds,
    "best elapsed time",
  );
  const medianMilliseconds = positiveFinite(
    elapsed.medianMilliseconds,
    "median elapsed time",
  );
  const bestMetresPerSecond = positiveFinite(
    speed.bestMetresPerSecond,
    "best speed",
  );
  const medianMetresPerSecond = positiveFinite(
    speed.medianMetresPerSecond,
    "median speed",
  );
  const meanMilliseconds = positiveFinite(
    elapsed.meanMilliseconds,
    "mean elapsed time",
  );
  const trimmedMeanMilliseconds = positiveFinite(
    elapsed.trimmedMeanMilliseconds,
    "trimmed mean elapsed time",
  );
  const standardDeviationMilliseconds = nonNegativeFinite(
    elapsed.standardDeviationMilliseconds,
    "elapsed standard deviation",
  );
  const interquartileRangeMilliseconds = nonNegativeFinite(
    elapsed.interquartileRangeMilliseconds,
    "elapsed interquartile range",
  );
  const expectedSampleStatus =
    raceCount >= 10 ? "minimally_analytical" : "hypothesis_only";
  const expectedBestSpeed =
    Math.round((distance / (bestMilliseconds / 1_000)) * 1_000) / 1_000;
  const expectedMedianSpeed =
    Math.round((distance / (medianMilliseconds / 1_000)) * 1_000) / 1_000;

  if (
    profile.sampleStatus !== expectedSampleStatus ||
    profile.analyticalStatus !== "experimental" ||
    bestMilliseconds > medianMilliseconds ||
    bestMilliseconds > meanMilliseconds ||
    bestMilliseconds > trimmedMeanMilliseconds ||
    bestMetresPerSecond !== expectedBestSpeed ||
    medianMetresPerSecond !== expectedMedianSpeed
  ) {
    throw new Error("Invalid Core Intelligence read-model profile.");
  }

  return {
    coreId,
    mode,
    distance,
    dataCurrentThrough,
    freshness: deriveFreshness(new Date(dataCurrentThrough), now),
    raceCount,
    sampleStatus: expectedSampleStatus,
    elapsedTime: {
      bestMilliseconds,
      medianMilliseconds,
      meanMilliseconds,
      trimmedMeanMilliseconds,
      standardDeviationMilliseconds,
      interquartileRangeMilliseconds,
    },
    speed: { bestMetresPerSecond, medianMetresPerSecond },
    starProfile: normalizeStarProfile(profile.starProfile, {
      coreId,
      mode,
      distance,
    }),
    analyticalStatus: "experimental",
  };
}

function validNow(value: unknown): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("Core Intelligence now must be valid.");
  }
  return value;
}

function normalizeProjection(
  value: unknown,
  now: Date,
): CorePerformanceProjection {
  const projection = object(value, "repository projection");
  const lastImportedAt =
    projection.lastImportedAt === null
      ? null
      : canonicalTimestamp(projection.lastImportedAt, "import timestamp");
  const profiles = array(projection.profiles, "profile list")
    .map((profile) => normalizeProfile(profile, now))
    .sort(
      (left, right) =>
        left.coreId.localeCompare(right.coreId) ||
        left.mode.localeCompare(right.mode) ||
        left.distance - right.distance,
    );

  if (profiles.length > 0 && lastImportedAt === null) {
    throw new Error("Invalid Core Intelligence import timestamp.");
  }
  if (
    lastImportedAt !== null &&
    profiles.some(
      ({ dataCurrentThrough }) =>
        Date.parse(dataCurrentThrough) > Date.parse(lastImportedAt),
    )
  ) {
    throw new Error("Core Intelligence evidence cannot follow its import.");
  }

  const profileKeys = new Set<string>();
  for (const profile of profiles) {
    const key = JSON.stringify([
      profile.coreId,
      profile.mode,
      profile.distance,
    ]);
    if (profileKeys.has(key)) {
      throw new Error("Duplicate Core Intelligence read-model profile.");
    }
    profileKeys.add(key);
  }
  return { profiles, lastImportedAt };
}

export async function loadCoreIntelligencePageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: CorePerformanceProfileRepository;
    esportsRepository?: CoreEsportsRaceRepository;
    now: Date;
  }>,
): Promise<CoreIntelligencePageState> {
  const now = validNow(input.now);
  const authenticatedOwnerId =
    input.authenticatedOwnerId === null
      ? null
      : safeIdentifier(input.authenticatedOwnerId, "owner identity");
  const configuredOwnerId =
    input.configuredOwnerId === null
      ? null
      : safeIdentifier(input.configuredOwnerId, "configured owner identity");

  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return {
      profiles: [],
      lastImportedAt: null,
      connectionStatus: "identity_not_connected",
      esportsProfiles: [],
      esportsLastSyncedAt: null,
      esportsConnectionStatus: "not_configured",
    };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Core Intelligence workspace access denied.");
  }
  if (input.repository.status === "not_configured") {
    const esports = await loadCoreEsportsProjection({
      ownerId: authenticatedOwnerId,
      repository:
        input.esportsRepository ?? unavailableCoreEsportsRaceRepository,
      now,
    });
    return {
      profiles: [],
      lastImportedAt: null,
      connectionStatus: "persistence_not_configured",
      ...esports,
    };
  }
  if (
    input.repository.status !== "ready" ||
    typeof input.repository.listProfilesByOwner !== "function"
  ) {
    throw new Error("Invalid Core Intelligence repository.");
  }

  const projection = normalizeProjection(
    await input.repository.listProfilesByOwner(authenticatedOwnerId),
    now,
  );
  const esports = await loadCoreEsportsProjection({
    ownerId: authenticatedOwnerId,
    repository: input.esportsRepository ?? unavailableCoreEsportsRaceRepository,
    now,
  });
  return {
    ...projection,
    connectionStatus: "read_model_connected",
    ...esports,
  };
}

async function loadCoreEsportsProjection(input: {
  ownerId: string;
  repository: CoreEsportsRaceRepository;
  now: Date;
}): Promise<
  Pick<
    CoreIntelligencePageState,
    "esportsProfiles" | "esportsLastSyncedAt" | "esportsConnectionStatus"
  >
> {
  if (input.repository.status === "not_configured") {
    return {
      esportsProfiles: [],
      esportsLastSyncedAt: null,
      esportsConnectionStatus: "not_configured",
    };
  }
  if (
    input.repository.status !== "ready" ||
    typeof input.repository.listRaceObservationsByOwner !== "function"
  ) {
    throw new Error("Invalid Core Intelligence Esports repository.");
  }
  const projection = object(
    await input.repository.listRaceObservationsByOwner(input.ownerId),
    "Esports repository projection",
  );
  const lastSyncedAt =
    projection.lastSyncedAt === null
      ? null
      : canonicalTimestamp(
          projection.lastSyncedAt,
          "Esports last-synced timestamp",
        );
  const observations = array(
    projection.observations,
    "Esports observation list",
  ) as readonly CoreEsportsRaceObservation[];
  if (observations.length > 0 && lastSyncedAt === null) {
    throw new Error("Esports observations require a last-synced timestamp.");
  }
  if (
    lastSyncedAt !== null &&
    observations.some(
      ({ observedAt }) => Date.parse(observedAt) > Date.parse(lastSyncedAt),
    )
  ) {
    throw new Error("Esports evidence cannot follow its sync timestamp.");
  }
  return {
    esportsProfiles: buildCoreEsportsPerformanceProfiles({
      observations,
      now: input.now,
    }),
    esportsLastSyncedAt: lastSyncedAt,
    esportsConnectionStatus: "connected",
  };
}
