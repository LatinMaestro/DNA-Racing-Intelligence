import type { TournamentRuleConfiguration } from "@/domain/tournament-configuration";

export type TournamentEvidenceCandidate = Readonly<{
  coreId: string;
  eligibility: "eligible" | "ineligible" | "review_required";
}>;

export type TournamentEvidenceProfile = Readonly<{
  coreId: string;
  mode: string;
  distanceMetres: number;
  raceCount: number;
  bestMilliseconds: number;
  medianMilliseconds: number;
}>;

export type TournamentEvidenceBenchmark = Readonly<{
  mode: string;
  distanceMetres: number;
  dataCurrentThrough: string;
  raceEntryCount: number;
  winningEntryCount: number;
  topThreeEntryCount: number;
  winningP75Milliseconds: number;
  winningMedianMilliseconds: number;
  topThreeP75Milliseconds: number;
  topThreeMedianMilliseconds: number;
  refreshedAt: string;
}>;

export type TournamentEvidenceAuthority = Readonly<{
  timeEvidence: "strong" | "competitive" | "weak" | "unknown";
  evidenceConfidence: "high" | "medium" | "low" | "unknown";
}>;

function required(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is invalid.`);
  }
  return value.trim();
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function positiveNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function timestamp(value: string, label: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be canonical.`);
  }
  return value;
}

function key(coreId: string, mode: string, distanceMetres: number): string {
  return JSON.stringify([coreId, mode, distanceMetres]);
}

function benchmarkKey(mode: string, distanceMetres: number): string {
  return JSON.stringify([mode, distanceMetres]);
}

export function projectTournamentEvidenceAuthority(
  rule: Pick<
    TournamentRuleConfiguration,
    "mode" | "eligibleDistancesMetres" | "qualification"
  >,
  candidates: readonly TournamentEvidenceCandidate[],
  profiles: readonly TournamentEvidenceProfile[],
  benchmarks: readonly TournamentEvidenceBenchmark[],
): ReadonlyMap<string, TournamentEvidenceAuthority> {
  const candidateIds = candidates.map((candidate) =>
    required(candidate.coreId, "Tournament evidence candidate Core ID"),
  );
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new Error("Tournament evidence candidate Core IDs must be unique.");
  }

  const profilesByKey = new Map<string, TournamentEvidenceProfile>();
  for (const input of profiles) {
    const profile = {
      ...input,
      coreId: required(input.coreId, "Tournament evidence profile Core ID"),
      mode: required(input.mode, "Tournament evidence profile mode"),
      distanceMetres: positiveInteger(
        input.distanceMetres,
        "Tournament evidence profile distance",
      ),
      raceCount: positiveInteger(
        input.raceCount,
        "Tournament evidence profile race count",
      ),
      bestMilliseconds: positiveNumber(
        input.bestMilliseconds,
        "Tournament evidence profile best time",
      ),
      medianMilliseconds: positiveNumber(
        input.medianMilliseconds,
        "Tournament evidence profile median time",
      ),
    };
    const profileKey = key(
      profile.coreId,
      profile.mode,
      profile.distanceMetres,
    );
    if (profilesByKey.has(profileKey)) {
      throw new Error("Tournament evidence profile is duplicated.");
    }
    profilesByKey.set(profileKey, profile);
  }

  const benchmarksByKey = new Map<string, TournamentEvidenceBenchmark>();
  for (const input of benchmarks) {
    const benchmark = {
      ...input,
      mode: required(input.mode, "Tournament evidence benchmark mode"),
      distanceMetres: positiveInteger(
        input.distanceMetres,
        "Tournament evidence benchmark distance",
      ),
      dataCurrentThrough: timestamp(
        input.dataCurrentThrough,
        "Tournament evidence benchmark cutoff",
      ),
      raceEntryCount: positiveInteger(
        input.raceEntryCount,
        "Tournament evidence benchmark race entries",
      ),
      winningEntryCount: positiveInteger(
        input.winningEntryCount,
        "Tournament evidence benchmark winning entries",
      ),
      topThreeEntryCount: positiveInteger(
        input.topThreeEntryCount,
        "Tournament evidence benchmark top-three entries",
      ),
      winningP75Milliseconds: positiveNumber(
        input.winningP75Milliseconds,
        "Tournament evidence winning p75",
      ),
      winningMedianMilliseconds: positiveNumber(
        input.winningMedianMilliseconds,
        "Tournament evidence winning median",
      ),
      topThreeP75Milliseconds: positiveNumber(
        input.topThreeP75Milliseconds,
        "Tournament evidence top-three p75",
      ),
      topThreeMedianMilliseconds: positiveNumber(
        input.topThreeMedianMilliseconds,
        "Tournament evidence top-three median",
      ),
      refreshedAt: timestamp(
        input.refreshedAt,
        "Tournament evidence benchmark refresh",
      ),
    };
    if (
      benchmark.winningEntryCount > benchmark.topThreeEntryCount ||
      benchmark.topThreeEntryCount > benchmark.raceEntryCount ||
      benchmark.dataCurrentThrough > benchmark.refreshedAt
    ) {
      throw new Error("Tournament evidence benchmark is inconsistent.");
    }
    const evidenceKey = benchmarkKey(
      benchmark.mode,
      benchmark.distanceMetres,
    );
    if (benchmarksByKey.has(evidenceKey)) {
      throw new Error("Tournament evidence benchmark is duplicated.");
    }
    benchmarksByKey.set(evidenceKey, benchmark);
  }

  const minimumRaceCount = positiveInteger(
    rule.qualification.minimumRaceCount,
    "Tournament evidence minimum race count",
  );
  const exactDistance =
    rule.eligibleDistancesMetres.length === 1
      ? positiveInteger(
          rule.eligibleDistancesMetres[0]!,
          "Tournament evidence exact distance",
        )
      : null;
  const result = new Map<string, TournamentEvidenceAuthority>();

  for (const candidate of candidates) {
    const coreId = required(
      candidate.coreId,
      "Tournament evidence candidate Core ID",
    );
    if (candidate.eligibility !== "eligible" || exactDistance === null) {
      result.set(coreId, {
        timeEvidence: "unknown",
        evidenceConfidence: "unknown",
      });
      continue;
    }

    const profile = profilesByKey.get(key(coreId, rule.mode, exactDistance));
    if (profile === undefined) {
      result.set(coreId, {
        timeEvidence: "unknown",
        evidenceConfidence: "unknown",
      });
      continue;
    }

    const benchmark = benchmarksByKey.get(
      benchmarkKey(rule.mode, exactDistance),
    );
    if (benchmark === undefined) {
      result.set(coreId, {
        timeEvidence: "unknown",
        evidenceConfidence: "low",
      });
      continue;
    }

    const timeEvidence =
      profile.bestMilliseconds <= benchmark.winningP75Milliseconds ||
      profile.medianMilliseconds <= benchmark.winningMedianMilliseconds
        ? "strong"
        : profile.bestMilliseconds <= benchmark.topThreeP75Milliseconds ||
            profile.medianMilliseconds <= benchmark.topThreeMedianMilliseconds
          ? "competitive"
          : "weak";
    result.set(coreId, {
      timeEvidence,
      evidenceConfidence:
        profile.raceCount < minimumRaceCount ? "low" : "medium",
    });
  }

  return result;
}
