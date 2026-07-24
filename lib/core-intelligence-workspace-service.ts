import {
  raceModes,
  type CorePerformanceProfile,
} from "@/domain/core-performance";

export type CorePerformanceProfileRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      listProfilesByOwner: (ownerId: string) => Promise<
        Readonly<{
          profiles: readonly CorePerformanceProfile[];
          lastImportedAt: string | null;
        }>
      >;
    }>;

export type CoreIntelligenceConnectionStatus =
  | "identity_not_connected"
  | "persistence_not_configured"
  | "read_model_connected";

export type CoreIntelligencePageState = Readonly<{
  profiles: readonly CorePerformanceProfile[];
  lastImportedAt: string | null;
  connectionStatus: CoreIntelligenceConnectionStatus;
}>;

export const unavailableCorePerformanceProfileRepository: CorePerformanceProfileRepository =
  Object.freeze({ status: "not_configured" });

const freshnessStates = new Set(["current", "ageing", "stale", "unknown"]);

function normalizedIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function isTimestamp(value: string): boolean {
  return value.trim() !== "" && !Number.isNaN(Date.parse(value));
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function assertProfile(profile: CorePerformanceProfile): void {
  const elapsed = profile.elapsedTime;
  const speed = profile.speed;
  const sampleStatus =
    profile.raceCount >= 10 ? "minimally_analytical" : "hypothesis_only";

  if (
    profile.coreId.trim() === "" ||
    !raceModes.includes(profile.mode) ||
    !Number.isSafeInteger(profile.distance) ||
    profile.distance <= 0 ||
    !isTimestamp(profile.dataCurrentThrough) ||
    !freshnessStates.has(profile.freshness) ||
    !Number.isSafeInteger(profile.raceCount) ||
    profile.raceCount <= 0 ||
    profile.sampleStatus !== sampleStatus ||
    profile.analyticalStatus !== "experimental" ||
    !isPositiveFinite(elapsed.bestMilliseconds) ||
    !isPositiveFinite(elapsed.medianMilliseconds) ||
    !isPositiveFinite(elapsed.meanMilliseconds) ||
    !isPositiveFinite(elapsed.trimmedMeanMilliseconds) ||
    !Number.isFinite(elapsed.standardDeviationMilliseconds) ||
    elapsed.standardDeviationMilliseconds < 0 ||
    !Number.isFinite(elapsed.interquartileRangeMilliseconds) ||
    elapsed.interquartileRangeMilliseconds < 0 ||
    !isPositiveFinite(speed.bestMetresPerSecond) ||
    !isPositiveFinite(speed.medianMetresPerSecond) ||
    (profile.starProfile !== null &&
      (profile.starProfile.coreId !== profile.coreId ||
        profile.starProfile.mode !== profile.mode ||
        profile.starProfile.distance !== profile.distance))
  ) {
    throw new Error("Invalid Core Intelligence read-model profile.");
  }
}

function validateProjection(
  projection: Readonly<{
    profiles: readonly CorePerformanceProfile[];
    lastImportedAt: string | null;
  }>,
): void {
  if (
    projection.lastImportedAt !== null &&
    !isTimestamp(projection.lastImportedAt)
  ) {
    throw new Error("Invalid Core Intelligence import timestamp.");
  }

  const profileKeys = new Set<string>();
  for (const profile of projection.profiles) {
    assertProfile(profile);
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
}

export async function loadCoreIntelligencePageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: CorePerformanceProfileRepository;
  }>,
): Promise<CoreIntelligencePageState> {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);

  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return {
      profiles: [],
      lastImportedAt: null,
      connectionStatus: "identity_not_connected",
    };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Core Intelligence workspace access denied.");
  }
  if (input.repository.status === "not_configured") {
    return {
      profiles: [],
      lastImportedAt: null,
      connectionStatus: "persistence_not_configured",
    };
  }

  const projection =
    await input.repository.listProfilesByOwner(authenticatedOwnerId);
  validateProjection(projection);

  return {
    ...projection,
    connectionStatus: "read_model_connected",
  };
}
