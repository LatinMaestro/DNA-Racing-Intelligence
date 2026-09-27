import type { CanonicalCoreRaceHistoryResult } from "./dna-core-race-history-adapter";
import {
  replayDnaPopulationEntrantAuthority,
  type DnaPopulationEntrantAuthorityReplay,
} from "./dna-population-entrant-authority-replay";
import {
  isDnaPopulationEntrantAuthorityQuarantineRecord,
  type DnaPopulationEntrantAuthorityRecord,
} from "./dna-population-entrant-authority-record";
import {
  dnaOpenLabRawEvidenceCanonicalJson,
  type CanonicalRaceDocumentMetadata,
} from "./dna-open-lab-v1-adapters";

export type DnaPopulationEntrantAuthorityAcceptanceCheck = "PASS" | "FAIL";

export type DnaPopulationEntrantAuthorityFirstCohortAcceptance = Readonly<{
  verdict: DnaPopulationEntrantAuthorityAcceptanceCheck;
  singleRaceAuthority: DnaPopulationEntrantAuthorityAcceptanceCheck;
  availableCanonicalRaceFieldsPreserved: DnaPopulationEntrantAuthorityAcceptanceCheck;
  completeCoreOutcomeIdentityJoins: DnaPopulationEntrantAuthorityAcceptanceCheck;
  exactReplayAndConflictSafety: DnaPopulationEntrantAuthorityAcceptanceCheck;
  compactStorageAttribution: DnaPopulationEntrantAuthorityAcceptanceCheck;
  expectedCoreOutcomeCount: number;
  verifiedCoreOutcomeCount: number;
  exactCoreOutcomeReplayCount: number;
}>;

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/u;

function acceptanceError(message: string): never {
  throw new Error(`Population entrant first-cohort acceptance: ${message}`);
}

function validElapsedTime(value: string): boolean {
  if (typeof value !== "string" || value.trim() !== value) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function raceDocumentMap(input: {
  raceDocuments: readonly CanonicalRaceDocumentMetadata[];
  records: readonly DnaPopulationEntrantAuthorityRecord[];
}): ReadonlyMap<string, CanonicalRaceDocumentMetadata> {
  const selected = new Set(input.records.map((record) => record.sourceRaceId));
  const result = new Map<string, CanonicalRaceDocumentMetadata>();
  for (const document of input.raceDocuments) {
    if (!selected.has(document.sourceRaceId)) continue;
    if (result.has(document.sourceRaceId)) {
      acceptanceError("canonical Race authority is duplicated");
    }
    result.set(document.sourceRaceId, document);
  }
  if (result.size !== selected.size) {
    acceptanceError("canonical Race authority is incomplete");
  }
  return result;
}

function sameValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function mergePopulationAuthority(input: {
  document: CanonicalRaceDocumentMetadata;
  record: Exclude<
    DnaPopulationEntrantAuthorityRecord,
    { quarantineReason: unknown }
  >;
}): CanonicalRaceDocumentMetadata | null {
  const mode = input.record.mode;
  const entrants = input.record.entrantCoreIds;
  if (mode === undefined || entrants === undefined || entrants.length < 1) {
    return null;
  }
  if (
    (input.document.mode !== undefined && input.document.mode !== mode) ||
    (input.document.entrantCoreIds !== undefined &&
      !sameValues(input.document.entrantCoreIds, entrants))
  ) {
    acceptanceError("compact authority conflicts with canonical Race evidence");
  }

  return Object.freeze({
    ...input.document,
    mode,
    entrantCoreIds: Object.freeze([...entrants]),
  });
}

function outcomeKey(sourceRaceId: string, sourceCoreId: string): string {
  return `${sourceRaceId}\u0000${sourceCoreId}`;
}

function validateOutcome(input: {
  outcome: CanonicalCoreRaceHistoryResult;
  raceDocuments: ReadonlyMap<string, CanonicalRaceDocumentMetadata>;
}): string {
  const outcome = input.outcome;
  if (
    outcome.sourceType !== "core_race_history_result" ||
    !POSITIVE_INTEGER_PATTERN.test(outcome.sourceCoreId) ||
    !Number.isSafeInteger(Number(outcome.sourceCoreId)) ||
    (outcome.mode !== "bike" &&
      outcome.mode !== "car" &&
      outcome.mode !== "horse") ||
    !Number.isSafeInteger(outcome.distance) ||
    outcome.distance < 100 ||
    !validElapsedTime(outcome.elapsedTimeSourceValue) ||
    !Number.isSafeInteger(outcome.finishPosition) ||
    outcome.finishPosition < 1
  ) {
    acceptanceError("Core outcome evidence is invalid");
  }

  const race = input.raceDocuments.get(outcome.sourceRaceId);
  if (
    race === undefined ||
    race.mode !== outcome.mode ||
    race.distanceMetres !== outcome.distance ||
    race.entrantCoreIds === undefined ||
    !race.entrantCoreIds.includes(outcome.sourceCoreId) ||
    outcome.finishPosition > race.entrantCoreIds.length
  ) {
    acceptanceError("Core outcome identity join is invalid");
  }
  return outcomeKey(outcome.sourceRaceId, outcome.sourceCoreId);
}

function outcomeCounts(input: {
  outcomes: readonly CanonicalCoreRaceHistoryResult[];
  raceDocuments: ReadonlyMap<string, CanonicalRaceDocumentMetadata>;
}): Readonly<{ unique: number; exactReplays: number }> {
  const seen = new Map<string, string>();
  let exactReplays = 0;
  for (const outcome of input.outcomes) {
    const key = validateOutcome({
      outcome,
      raceDocuments: input.raceDocuments,
    });
    const canonical = dnaOpenLabRawEvidenceCanonicalJson(outcome);
    const existing = seen.get(key);
    if (existing === undefined) {
      seen.set(key, canonical);
    } else if (existing === canonical) {
      exactReplays += 1;
    } else {
      acceptanceError("conflicting Core outcome replay detected");
    }
  }
  return Object.freeze({ unique: seen.size, exactReplays });
}

function replay(input: {
  records: readonly DnaPopulationEntrantAuthorityRecord[];
  raceSetSha256: string;
  recordSetSha256: string;
}): DnaPopulationEntrantAuthorityReplay {
  const result = replayDnaPopulationEntrantAuthority({
    records: input.records,
    expectedUnresolvedRaceCount: input.records.length,
    expectedUnresolvedRaceSetSha256: input.raceSetSha256,
  });
  if (
    result.recordSetSha256 !== input.recordSetSha256 ||
    result.exactReplayDuplicateCount !== 0
  ) {
    acceptanceError("compact Race replay disagrees with durable receipt");
  }
  return result;
}

/**
 * Produces one identity-free owner verdict for a durable first cohort.
 *
 * The proof deliberately distinguishes compact entrant authority from the
 * single canonical Race authority. It preserves every canonical Race field
 * already present, requires complete Race/Core/distance/mode joins for durable
 * Core outcomes, accepts only exact outcome replay, and rejects conflicting
 * identities. Missing outcome evidence returns FAIL rather than inventing
 * completeness.
 */
export function assessDnaPopulationEntrantAuthorityFirstCohortAcceptance(input: {
  raceDocuments: readonly CanonicalRaceDocumentMetadata[];
  records: readonly DnaPopulationEntrantAuthorityRecord[];
  raceSetSha256: string;
  recordSetSha256: string;
  coreOutcomes: readonly CanonicalCoreRaceHistoryResult[];
}): DnaPopulationEntrantAuthorityFirstCohortAcceptance {
  if (input.records.length < 1) {
    acceptanceError("compact entrant cohort is empty");
  }
  const compactReplay = replay(input);
  const canonicalByRace = raceDocumentMap(input);
  const reconstructed = new Map<string, CanonicalRaceDocumentMetadata>();
  let expectedCoreOutcomeCount = 0;
  let reconstructable = true;

  for (const record of input.records) {
    const source = canonicalByRace.get(record.sourceRaceId)!;
    if (isDnaPopulationEntrantAuthorityQuarantineRecord(record)) {
      reconstructable = false;
      continue;
    }
    const merged = mergePopulationAuthority({ document: source, record });
    if (merged === null || merged.distanceMetres === undefined) {
      reconstructable = false;
      continue;
    }
    reconstructed.set(record.sourceRaceId, merged);
    expectedCoreOutcomeCount += merged.entrantCoreIds!.length;
    if (!Number.isSafeInteger(expectedCoreOutcomeCount)) {
      acceptanceError("Core outcome count exceeds safe integer capacity");
    }
  }

  const counts = outcomeCounts({
    outcomes: input.coreOutcomes,
    raceDocuments: reconstructed,
  });
  const completeJoins =
    reconstructable &&
    expectedCoreOutcomeCount > 0 &&
    counts.unique === expectedCoreOutcomeCount;
  const singleRaceAuthority =
    compactReplay.authority.replayedUniqueRaceCount === input.records.length;
  const replaySafety =
    compactReplay.replayIntegrityStatus ===
    "proven_compact_population_authority_replay";
  const storageAttribution =
    compactReplay.resolvedRaceCount + compactReplay.quarantinedRaceCount ===
    input.records.length;

  const report = Object.freeze({
    verdict:
      singleRaceAuthority &&
      reconstructable &&
      completeJoins &&
      replaySafety &&
      storageAttribution
        ? ("PASS" as const)
        : ("FAIL" as const),
    singleRaceAuthority: singleRaceAuthority
      ? ("PASS" as const)
      : ("FAIL" as const),
    availableCanonicalRaceFieldsPreserved: reconstructable
      ? ("PASS" as const)
      : ("FAIL" as const),
    completeCoreOutcomeIdentityJoins: completeJoins
      ? ("PASS" as const)
      : ("FAIL" as const),
    exactReplayAndConflictSafety: replaySafety
      ? ("PASS" as const)
      : ("FAIL" as const),
    compactStorageAttribution: storageAttribution
      ? ("PASS" as const)
      : ("FAIL" as const),
    expectedCoreOutcomeCount,
    verifiedCoreOutcomeCount: counts.unique,
    exactCoreOutcomeReplayCount: counts.exactReplays,
  });
  return report;
}
