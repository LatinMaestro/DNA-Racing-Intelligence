import type { RaceMode } from "@/domain/import-contract";
import type { RaceArchiveCoreAnalyticalObservation } from "./race-archive-core-analytical-observations";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const RACE_MODES = new Set<RaceMode>(["bike", "car", "horse"]);

export type RaceArchiveCorePayoutFormatProfile = Readonly<{
  sourceCoreId: string;
  mode: RaceMode;
  payoutFormatKey: string;
  payoutFormatLabel: string;
  dataCurrentThrough: string;
  firstEventAt: string;
  raceCount: number;
  winCount: number;
  topThreeCount: number;
  exactDistanceCount: number;
  timedRaceCount: number;
  refreshedAt: string;
}>;

export type RaceArchiveCorePayoutFormatProfileSet = Readonly<{
  acceptedFormatEntryCount: number;
  profiles: readonly RaceArchiveCorePayoutFormatProfile[];
}>;

function positiveBound(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} is outside its bound`);
  }
  return value;
}

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value;
}

function safeText(value: string, field: string, maximumLength = 512): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function normalizedTimestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} must be a valid timestamp`);
  }
  return parsed.toISOString();
}

function payoutFormat(value: string | null): Readonly<{
  key: string;
  label: string;
}> | null {
  if (value === null) return null;
  const label = value.trim().replace(/\s+/gu, " ");
  if (label.length < 1 || label.length > 512 || CONTROL_CHARACTER_PATTERN.test(label)) {
    throw new Error("Archived payout-format label is invalid.");
  }
  return Object.freeze({ key: label.toLowerCase(), label });
}

export function corePayoutFormatProfilesFromRaceArchive(input: {
  observations: readonly RaceArchiveCoreAnalyticalObservation[];
  refreshedAt: string;
  maximumObservations: number;
  maximumProfiles: number;
}): RaceArchiveCorePayoutFormatProfileSet {
  const maximumObservations = positiveBound(
    input.maximumObservations,
    "maximumObservations",
    5_000_000,
  );
  const maximumProfiles = positiveBound(
    input.maximumProfiles,
    "maximumProfiles",
    500_000,
  );
  if (input.observations.length > maximumObservations) {
    throw new Error("Archive payout-format observation bound was exceeded.");
  }
  const refreshedAt = normalizedTimestamp(input.refreshedAt, "refreshedAt");

  const groups = new Map<
    string,
    {
      sourceCoreId: string;
      mode: RaceMode;
      payoutFormatKey: string;
      payoutFormatLabel: string;
      firstEventAt: string;
      dataCurrentThrough: string;
      raceCount: number;
      winCount: number;
      topThreeCount: number;
      timedRaceCount: number;
      distances: Set<number>;
    }
  >();
  const naturalKeys = new Set<string>();
  let acceptedFormatEntryCount = 0;

  for (const observation of input.observations) {
    const naturalKey = safeText(
      observation.naturalKey,
      "observation.naturalKey",
    );
    if (naturalKeys.has(naturalKey)) {
      throw new Error("Archive payout-format profiles contain duplicate Race evidence.");
    }
    naturalKeys.add(naturalKey);
    if (!RACE_MODES.has(observation.mode)) {
      throw new Error("Archive payout-format mode is invalid.");
    }
    const format = payoutFormat(observation.payoutMechanismSourceValue);
    if (format === null) continue;
    acceptedFormatEntryCount += 1;
    const sourceCoreId = safeText(observation.sourceCoreId, "observation.sourceCoreId", 256);
    const distance = positiveSafeInteger(
      observation.distance,
      "observation.distance",
    );
    const finishPosition = positiveSafeInteger(
      observation.finishPosition,
      "observation.finishPosition",
    );
    positiveSafeInteger(
      observation.elapsedMilliseconds,
      "observation.elapsedMilliseconds",
    );
    const eventAt = normalizedTimestamp(
      observation.eventAt,
      "observation.eventAt",
    );
    const key = JSON.stringify([sourceCoreId, observation.mode, format.key]);
    let group = groups.get(key);
    if (group === undefined) {
      if (groups.size >= maximumProfiles) {
        throw new Error("Archive payout-format profile bound was exceeded.");
      }
      group = {
        sourceCoreId,
        mode: observation.mode,
        payoutFormatKey: format.key,
        payoutFormatLabel: format.label,
        firstEventAt: eventAt,
        dataCurrentThrough: eventAt,
        raceCount: 0,
        winCount: 0,
        topThreeCount: 0,
        timedRaceCount: 0,
        distances: new Set<number>(),
      };
      groups.set(key, group);
    }
    if (format.label < group.payoutFormatLabel) {
      group.payoutFormatLabel = format.label;
    }
    if (eventAt < group.firstEventAt) group.firstEventAt = eventAt;
    if (eventAt > group.dataCurrentThrough) group.dataCurrentThrough = eventAt;
    group.raceCount += 1;
    group.timedRaceCount += 1;
    if (finishPosition === 1) group.winCount += 1;
    if (finishPosition <= 3) group.topThreeCount += 1;
    group.distances.add(distance);
  }

  const profiles = [...groups.values()]
    .sort(
      (left, right) =>
        left.sourceCoreId.localeCompare(right.sourceCoreId) ||
        left.mode.localeCompare(right.mode) ||
        left.payoutFormatKey.localeCompare(right.payoutFormatKey),
    )
    .map((group) =>
      Object.freeze({
        sourceCoreId: group.sourceCoreId,
        mode: group.mode,
        payoutFormatKey: group.payoutFormatKey,
        payoutFormatLabel: group.payoutFormatLabel,
        dataCurrentThrough: group.dataCurrentThrough,
        firstEventAt: group.firstEventAt,
        raceCount: group.raceCount,
        winCount: group.winCount,
        topThreeCount: group.topThreeCount,
        exactDistanceCount: group.distances.size,
        timedRaceCount: group.timedRaceCount,
        refreshedAt,
      }),
    );

  return Object.freeze({
    acceptedFormatEntryCount,
    profiles: Object.freeze(profiles),
  });
}
