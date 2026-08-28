import {
  inspectDnaCurrentStateCandidate,
  type DnaCurrentStateCandidate,
} from "./dna-open-lab-last-good-publication";
import type {
  CanonicalActiveRaceSnapshot,
  CanonicalRaceFillSnapshot,
  DnaOpenLabEvidence,
} from "./dna-open-lab-v1-adapters";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export type DnaCurrentRaceMaterializationRow<T> = Readonly<{
  sourceRaceId: string;
  observedAt: string;
  rawEvidenceSha256: string;
  canonical: T;
}>;

export type DnaCurrentRaceMaterialization = Readonly<{
  generationId: string;
  generationObservedAt: string;
  activeRaces: readonly DnaCurrentRaceMaterializationRow<CanonicalActiveRaceSnapshot>[];
  raceFills: readonly DnaCurrentRaceMaterializationRow<CanonicalRaceFillSnapshot>[];
}>;

function materializationError(message: string): never {
  throw new Error(`DNA Open Lab current-race materialization: ${message}`);
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 512) {
    materializationError(`${field} is invalid`);
  }
  return normalized;
}

function timestamp(value: string, field: string): string {
  const normalized = requiredText(value, field);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      normalized,
    )
  ) {
    materializationError(`${field} must be timezone-qualified`);
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    materializationError(`${field} is invalid`);
  }
  return parsed.toISOString();
}

function checksum(value: string, field: string): string {
  if (!SHA256_PATTERN.test(value)) {
    materializationError(`${field} must be a lowercase SHA-256 value`);
  }
  return value;
}

function chronology(input: {
  observedAt: string;
  generationObservedAt: string;
  field: string;
}): void {
  if (Date.parse(input.observedAt) > Date.parse(input.generationObservedAt)) {
    materializationError(
      `${input.field} cannot follow the generation observation`,
    );
  }
}

function raceWindow(input: {
  startAt: string | null;
  endAt: string | null;
  field: string;
}): void {
  const startAt =
    input.startAt === null
      ? null
      : timestamp(input.startAt, `${input.field}.startAt`);
  const endAt =
    input.endAt === null
      ? null
      : timestamp(input.endAt, `${input.field}.endAt`);
  if (
    startAt !== null &&
    endAt !== null &&
    Date.parse(endAt) < Date.parse(startAt)
  ) {
    materializationError(`${input.field} endAt cannot precede startAt`);
  }
}

function activeRaceRow(input: {
  evidence: DnaOpenLabEvidence<CanonicalActiveRaceSnapshot>;
  generationObservedAt: string;
}): DnaCurrentRaceMaterializationRow<CanonicalActiveRaceSnapshot> {
  const evidence = input.evidence;
  if (
    evidence.source !== "dna_open_lab" ||
    evidence.sourceVersion !== "v1" ||
    evidence.scope !== "races" ||
    evidence.endpoint !== "races.active" ||
    evidence.canonical.sourceType !== "active_race_snapshot"
  ) {
    materializationError("active-race evidence authority is invalid");
  }
  const sourceRaceId = requiredText(
    evidence.canonical.sourceRaceId,
    "activeRace.sourceRaceId",
  );
  if (evidence.entityKey !== `race:${sourceRaceId}`) {
    materializationError("active-race entity key is invalid");
  }
  const observedAt = timestamp(evidence.observedAt, "activeRace.observedAt");
  chronology({
    observedAt,
    generationObservedAt: input.generationObservedAt,
    field: "activeRace.observedAt",
  });
  raceWindow({
    startAt: evidence.canonical.startAt,
    endAt: evidence.canonical.endAt,
    field: `activeRace.${sourceRaceId}`,
  });
  return Object.freeze({
    sourceRaceId,
    observedAt,
    rawEvidenceSha256: checksum(
      evidence.rawEvidenceSha256,
      "activeRace.rawEvidenceSha256",
    ),
    canonical: evidence.canonical,
  });
}

function raceFillRow(input: {
  evidence: DnaOpenLabEvidence<CanonicalRaceFillSnapshot>;
  generationObservedAt: string;
}): DnaCurrentRaceMaterializationRow<CanonicalRaceFillSnapshot> {
  const evidence = input.evidence;
  if (
    evidence.source !== "dna_open_lab" ||
    evidence.sourceVersion !== "v1" ||
    evidence.scope !== "races" ||
    evidence.endpoint !== "races.fills" ||
    evidence.canonical.sourceType !== "race_fill_snapshot"
  ) {
    materializationError("race-fill evidence authority is invalid");
  }
  const sourceRaceId = requiredText(
    evidence.canonical.sourceRaceId,
    "raceFill.sourceRaceId",
  );
  if (evidence.entityKey !== `race:${sourceRaceId}`) {
    materializationError("race-fill entity key is invalid");
  }
  if (
    evidence.canonical.filledGateCount > evidence.canonical.gateCount ||
    evidence.canonical.entrantCoreIds.length !==
      evidence.canonical.filledGateCount
  ) {
    materializationError(`race-fill ${sourceRaceId} coverage is invalid`);
  }
  const observedAt = timestamp(evidence.observedAt, "raceFill.observedAt");
  chronology({
    observedAt,
    generationObservedAt: input.generationObservedAt,
    field: "raceFill.observedAt",
  });
  return Object.freeze({
    sourceRaceId,
    observedAt,
    rawEvidenceSha256: checksum(
      evidence.rawEvidenceSha256,
      "raceFill.rawEvidenceSha256",
    ),
    canonical: evidence.canonical,
  });
}

function uniqueSortedRows<T extends { sourceRaceId: string }>(input: {
  rows: readonly T[];
  family: string;
}): readonly T[] {
  const sorted = [...input.rows].sort((left, right) =>
    left.sourceRaceId.localeCompare(right.sourceRaceId),
  );
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1]!.sourceRaceId === sorted[index]!.sourceRaceId) {
      materializationError(`${input.family} contains duplicate race IDs`);
    }
  }
  return Object.freeze(sorted);
}

/**
 * Produces the exact compact current-race payload that a generation-bound Neon
 * transaction may persist. It deliberately carries only canonical adapter
 * output plus observation/checksum provenance; raw DNA responses remain in the
 * private evidence boundary.
 */
export function createDnaCurrentRaceMaterialization(input: {
  candidate: DnaCurrentStateCandidate;
  activeRaces: readonly DnaOpenLabEvidence<CanonicalActiveRaceSnapshot>[];
  raceFills: readonly DnaOpenLabEvidence<CanonicalRaceFillSnapshot>[];
}): DnaCurrentRaceMaterialization {
  const readiness = inspectDnaCurrentStateCandidate(input.candidate);
  if (!readiness.ready) {
    materializationError(
      `generation is incomplete: ${readiness.incompleteFamilies.join(", ")}`,
    );
  }
  const generationId = requiredText(
    input.candidate.generationId,
    "generationId",
  );
  const generationObservedAt = timestamp(
    input.candidate.observedAt,
    "generationObservedAt",
  );
  if (
    input.activeRaces.length !== input.candidate.families.active_races.itemCount
  ) {
    materializationError(
      "active-race count must match the complete family receipt",
    );
  }
  if (
    input.raceFills.length !== input.candidate.families.race_fills.itemCount
  ) {
    materializationError(
      "race-fill count must match the complete family receipt",
    );
  }

  const activeRaces = uniqueSortedRows({
    family: "active-race materialization",
    rows: input.activeRaces.map((evidence) =>
      activeRaceRow({ evidence, generationObservedAt }),
    ),
  });
  const raceFills = uniqueSortedRows({
    family: "race-fill materialization",
    rows: input.raceFills.map((evidence) =>
      raceFillRow({ evidence, generationObservedAt }),
    ),
  });
  const activeRaceIds = new Set(activeRaces.map((row) => row.sourceRaceId));
  const orphanFill = raceFills.find(
    (row) => !activeRaceIds.has(row.sourceRaceId),
  );
  if (orphanFill !== undefined) {
    materializationError(
      `race-fill ${orphanFill.sourceRaceId} has no active-race observation`,
    );
  }

  return Object.freeze({
    generationId,
    generationObservedAt,
    activeRaces,
    raceFills,
  });
}
