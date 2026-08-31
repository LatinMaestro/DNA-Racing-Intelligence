import type { CorePerformanceProfile } from "@/domain/core-performance";
import { deriveFreshness, type FreshnessState } from "@/domain/freshness";

export const coreEsportsProfileAuthority = Object.freeze({
  authorityId: "owner-confirmed-core-esports-history-2026-08-31",
  competition: "pro_league_esports" as const,
  mode: "bike" as const,
  publicCoreProfileCoverage: "omitted" as const,
  apiHistoryRequirement: "complete_available_history_at_cutoff" as const,
  traitsSharedWithNormalRacing: true,
  combinedAnalysisPolicy:
    "include_intrinsic_evidence_keep_competition_and_exact_format_auditable" as const,
});

export type CoreEsportsRaceStatus = "scheduled" | "running" | "completed";

export type CoreEsportsRaceObservation = Readonly<{
  sourceRaceId: string;
  sourceCoreId: string;
  status: CoreEsportsRaceStatus;
  raceType: string;
  distanceMetres: number;
  gateCount: number;
  completedAt: string | null;
  finishPosition: number | null;
  elapsedTimeMilliseconds: number | null;
  matchId: string | null;
  mapId: string | null;
  observedAt: string;
  sourceAuthority: string;
}>;

export type CoreEsportsResultRule = "first_place" | "top_three" | "unknown";

export type CoreEsportsPerformanceProfile = Readonly<{
  sourceCoreId: string;
  mode: "bike";
  competition: "pro_league_esports";
  raceType: string;
  distanceMetres: number;
  resultRule: CoreEsportsResultRule;
  raceCount: number;
  knownFinishCount: number;
  successCount: number;
  timedRaceCount: number;
  dataCurrentThrough: string;
  freshness: FreshnessState;
  elapsedTime: Readonly<{
    bestMilliseconds: number;
    medianMilliseconds: number;
    meanMilliseconds: number;
    standardDeviationMilliseconds: number;
  }> | null;
  sourceAuthorities: readonly string[];
  publicCoreProfileCoverage: "omitted";
  analyticalStatus: "experimental";
}>;

export type CoreAnalysisEvidenceCoverage = Readonly<{
  sourceCoreId: string;
  normalRaceCount: number;
  esportsRaceCount: number;
  allAnalysedRaceCount: number;
  intrinsicEvidenceScope: "normal_only" | "esports_only" | "normal_and_esports";
  esportsPublicProfileCoverage: "omitted";
}>;

const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

function text(value: string, field: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 512 ||
    CONTROL_PATTERN.test(normalized)
  ) {
    throw new Error(`${field} is invalid.`);
  }
  return normalized;
}

function optionalText(value: string | null, field: string): string | null {
  return value === null ? null : text(value, field);
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer.`);
  }
  return value;
}

function canonicalTimestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical timestamp.`);
  }
  return value;
}

function canonicalRaceType(value: string): string {
  return text(value, "Esports race type").toLowerCase().replace(/\s+/gu, " ");
}

export function coreEsportsResultRule(raceType: string): CoreEsportsResultRule {
  const normalized = canonicalRaceType(raceType);
  if (normalized === "1v1" || /\bwta\b/iu.test(normalized)) {
    return "first_place";
  }
  if (/\bmadness\b/iu.test(normalized)) return "top_three";
  return "unknown";
}

function normalizeObservation(
  input: CoreEsportsRaceObservation,
): CoreEsportsRaceObservation {
  if (
    !(["scheduled", "running", "completed"] as const).includes(input.status)
  ) {
    throw new Error("Esports race status is invalid.");
  }
  const distanceMetres = positiveInteger(
    input.distanceMetres,
    "Esports distance",
  );
  const gateCount = positiveInteger(input.gateCount, "Esports gate count");
  if (input.finishPosition !== null) {
    positiveInteger(input.finishPosition, "Esports finish position");
    if (input.finishPosition > gateCount) {
      throw new Error("Esports finish position cannot exceed its gate count.");
    }
  }
  if (
    input.elapsedTimeMilliseconds !== null &&
    (!Number.isSafeInteger(input.elapsedTimeMilliseconds) ||
      input.elapsedTimeMilliseconds <= 0)
  ) {
    throw new Error(
      "Esports elapsed time must be positive integer milliseconds.",
    );
  }
  const observedAt = canonicalTimestamp(
    input.observedAt,
    "Esports observation time",
  );
  const completedAt =
    input.completedAt === null
      ? null
      : canonicalTimestamp(input.completedAt, "Esports completion time");
  if (input.status === "completed" && completedAt === null) {
    throw new Error("A completed Esports race requires a completion time.");
  }
  if (input.status !== "completed" && completedAt !== null) {
    throw new Error(
      "An uncompleted Esports race cannot have a completion time.",
    );
  }
  if (
    completedAt !== null &&
    Date.parse(completedAt) > Date.parse(observedAt)
  ) {
    throw new Error("Esports completion time cannot follow its observation.");
  }
  return Object.freeze({
    sourceRaceId: text(input.sourceRaceId, "Esports race ID"),
    sourceCoreId: text(input.sourceCoreId, "Esports Core ID"),
    status: input.status,
    raceType: canonicalRaceType(input.raceType),
    distanceMetres,
    gateCount,
    completedAt,
    finishPosition: input.finishPosition,
    elapsedTimeMilliseconds: input.elapsedTimeMilliseconds,
    matchId: optionalText(input.matchId, "Esports match ID"),
    mapId: optionalText(input.mapId, "Esports map ID"),
    observedAt,
    sourceAuthority: text(input.sourceAuthority, "Esports source authority"),
  });
}

function fingerprint(value: CoreEsportsRaceObservation): string {
  return JSON.stringify(value);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function elapsedSummary(values: readonly number[]) {
  if (values.length === 0) return null;
  const mean =
    values.reduce((total, value) => total + value, 0) / values.length;
  const standardDeviation = Math.sqrt(
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
      values.length,
  );
  return Object.freeze({
    bestMilliseconds: Math.min(...values),
    medianMilliseconds: rounded(median(values)),
    meanMilliseconds: rounded(mean),
    standardDeviationMilliseconds: rounded(standardDeviation),
  });
}

function profileKey(
  observation: Pick<
    CoreEsportsRaceObservation,
    "sourceCoreId" | "raceType" | "distanceMetres"
  >,
): string {
  return JSON.stringify([
    observation.sourceCoreId,
    observation.raceType,
    observation.distanceMetres,
  ]);
}

export function buildCoreEsportsPerformanceProfiles(input: {
  observations: readonly CoreEsportsRaceObservation[];
  now: Date;
}): readonly CoreEsportsPerformanceProfile[] {
  if (Number.isNaN(input.now.getTime())) {
    throw new Error("A valid Esports profile time is required.");
  }
  const byRaceEntry = new Map<string, CoreEsportsRaceObservation>();
  for (const value of input.observations) {
    const observation = normalizeObservation(value);
    const key = JSON.stringify([
      observation.sourceRaceId,
      observation.sourceCoreId,
    ]);
    const existing = byRaceEntry.get(key);
    if (
      existing !== undefined &&
      fingerprint(existing) !== fingerprint(observation)
    ) {
      throw new Error("Conflicting duplicate Esports race evidence.");
    }
    byRaceEntry.set(key, existing ?? observation);
  }

  const groups = new Map<string, CoreEsportsRaceObservation[]>();
  for (const observation of byRaceEntry.values()) {
    if (observation.status !== "completed") continue;
    const key = profileKey(observation);
    const group = groups.get(key) ?? [];
    group.push(observation);
    groups.set(key, group);
  }

  return Object.freeze(
    [...groups.values()]
      .map((observations): CoreEsportsPerformanceProfile => {
        const first = observations[0]!;
        const resultRule = coreEsportsResultRule(first.raceType);
        const knownFinishes = observations.filter(
          ({ finishPosition }) => finishPosition !== null,
        );
        const successCount = knownFinishes.filter(({ finishPosition }) =>
          resultRule === "first_place"
            ? finishPosition === 1
            : resultRule === "top_three"
              ? finishPosition! <= 3
              : false,
        ).length;
        const timed = observations.flatMap(({ elapsedTimeMilliseconds }) =>
          elapsedTimeMilliseconds === null ? [] : [elapsedTimeMilliseconds],
        );
        const dataCurrentThrough = observations.reduce(
          (latest, observation) =>
            observation.completedAt! > latest
              ? observation.completedAt!
              : latest,
          first.completedAt!,
        );
        return Object.freeze({
          sourceCoreId: first.sourceCoreId,
          mode: "bike" as const,
          competition: "pro_league_esports" as const,
          raceType: first.raceType,
          distanceMetres: first.distanceMetres,
          resultRule,
          raceCount: observations.length,
          knownFinishCount: knownFinishes.length,
          successCount,
          timedRaceCount: timed.length,
          dataCurrentThrough,
          freshness: deriveFreshness(new Date(dataCurrentThrough), input.now),
          elapsedTime: elapsedSummary(timed),
          sourceAuthorities: Object.freeze(
            [
              ...new Set(
                observations.map(({ sourceAuthority }) => sourceAuthority),
              ),
            ].sort(),
          ),
          publicCoreProfileCoverage: "omitted" as const,
          analyticalStatus: "experimental" as const,
        });
      })
      .sort(
        (left, right) =>
          left.sourceCoreId.localeCompare(right.sourceCoreId) ||
          left.raceType.localeCompare(right.raceType) ||
          left.distanceMetres - right.distanceMetres,
      ),
  );
}

export function buildCoreAnalysisEvidenceCoverage(input: {
  normalProfiles: readonly CorePerformanceProfile[];
  esportsProfiles: readonly CoreEsportsPerformanceProfile[];
}): readonly CoreAnalysisEvidenceCoverage[] {
  const counts = new Map<
    string,
    { normalRaceCount: number; esportsRaceCount: number }
  >();
  for (const profile of input.normalProfiles) {
    const current = counts.get(profile.coreId) ?? {
      normalRaceCount: 0,
      esportsRaceCount: 0,
    };
    current.normalRaceCount += profile.raceCount;
    counts.set(profile.coreId, current);
  }
  for (const profile of input.esportsProfiles) {
    const current = counts.get(profile.sourceCoreId) ?? {
      normalRaceCount: 0,
      esportsRaceCount: 0,
    };
    current.esportsRaceCount += profile.raceCount;
    counts.set(profile.sourceCoreId, current);
  }
  return Object.freeze(
    [...counts.entries()]
      .map(([sourceCoreId, value]) =>
        Object.freeze({
          sourceCoreId,
          ...value,
          allAnalysedRaceCount: value.normalRaceCount + value.esportsRaceCount,
          intrinsicEvidenceScope:
            value.normalRaceCount > 0 && value.esportsRaceCount > 0
              ? ("normal_and_esports" as const)
              : value.esportsRaceCount > 0
                ? ("esports_only" as const)
                : ("normal_only" as const),
          esportsPublicProfileCoverage: "omitted" as const,
        }),
      )
      .sort((left, right) =>
        left.sourceCoreId.localeCompare(right.sourceCoreId),
      ),
  );
}
