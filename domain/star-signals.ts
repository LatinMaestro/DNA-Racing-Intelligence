import { isGoldStarEligible } from "@/domain/game-rules";

export type StarDataStatus = "complete" | "partial" | "missing" | "invalid";

export type NormalizedStar = {
  value: boolean | null;
  status: Exclude<StarDataStatus, "partial">;
  rawValue: unknown;
};

export function normalizeStarValue(rawValue: unknown): NormalizedStar {
  if (typeof rawValue === "boolean")
    return { value: rawValue, status: "complete", rawValue };

  if (typeof rawValue === "string") {
    const normalized = rawValue.trim().toLowerCase();
    if (normalized === "true")
      return { value: true, status: "complete", rawValue };
    if (normalized === "false")
      return { value: false, status: "complete", rawValue };
    if (normalized === "") return { value: null, status: "missing", rawValue };
  }

  if (rawValue === null || rawValue === undefined) {
    return { value: null, status: "missing", rawValue };
  }

  return { value: null, status: "invalid", rawValue };
}

export type EventStarEntry = {
  coreId: string;
  goldStar: boolean | null;
  blueStar: boolean | null;
  starDataStatus: StarDataStatus;
};

export type StarWarning =
  | "NO_EVENT_ENTRIES"
  | "DUPLICATE_CORE_ENTRY"
  | "GOLD_INELIGIBLE_ASSIGNMENT"
  | "MULTIPLE_GOLD_ASSIGNMENTS"
  | "MULTIPLE_BLUE_ASSIGNMENTS"
  | "INCOMPLETE_STAR_DATA"
  | "INVALID_STAR_DATA";

export type EventStarValidationStatus = "valid" | "warning" | "invalid";

export type EventStarValidation = {
  gateCount: number;
  goldStarEligible: boolean;
  entryCount: number;
  goldAssignmentCount: number;
  blueAssignmentCount: number;
  goldAssignedCoreIds: readonly string[];
  blueAssignedCoreIds: readonly string[];
  uniqueGoldCoreId: string | null;
  uniqueBlueCoreId: string | null;
  sameCoreReceivedBoth: boolean;
  goldAssignmentOpportunity: boolean;
  blueAssignmentOpportunity: boolean;
  starDataCounts: Readonly<Record<StarDataStatus, number>>;
  goldDataCounts: Readonly<Record<"complete" | "missing" | "invalid", number>>;
  blueDataCounts: Readonly<Record<"complete" | "missing" | "invalid", number>>;
  status: EventStarValidationStatus;
  warningCodes: readonly StarWarning[];
};

const invalidWarnings = new Set<StarWarning>([
  "NO_EVENT_ENTRIES",
  "DUPLICATE_CORE_ENTRY",
  "MULTIPLE_GOLD_ASSIGNMENTS",
  "MULTIPLE_BLUE_ASSIGNMENTS",
  "INVALID_STAR_DATA",
]);

function sortedAssignedCoreIds(
  entries: readonly EventStarEntry[],
  signal: "goldStar" | "blueStar",
): string[] {
  return entries
    .filter((entry) => entry[signal] === true)
    .map(({ coreId }) => coreId)
    .sort((left, right) => left.localeCompare(right));
}

export function validateEventStarAssignments(
  gateCount: number,
  entries: readonly EventStarEntry[],
): EventStarValidation {
  const goldStarEligible = isGoldStarEligible(gateCount);
  const goldAssignedCoreIds = sortedAssignedCoreIds(entries, "goldStar");
  const blueAssignedCoreIds = sortedAssignedCoreIds(entries, "blueStar");
  const uniqueCoreCount = new Set(entries.map(({ coreId }) => coreId)).size;
  const starDataCounts: Record<StarDataStatus, number> = {
    complete: 0,
    partial: 0,
    missing: 0,
    invalid: 0,
  };
  const goldDataCounts = { complete: 0, missing: 0, invalid: 0 };
  const blueDataCounts = { complete: 0, missing: 0, invalid: 0 };

  for (const entry of entries) {
    starDataCounts[entry.starDataStatus] += 1;
    const goldStatus =
      entry.goldStar !== null
        ? "complete"
        : entry.starDataStatus === "invalid"
          ? "invalid"
          : "missing";
    const blueStatus =
      entry.blueStar !== null
        ? "complete"
        : entry.starDataStatus === "invalid"
          ? "invalid"
          : "missing";
    goldDataCounts[goldStatus] += 1;
    blueDataCounts[blueStatus] += 1;
  }

  const warningCodes: StarWarning[] = [];
  if (entries.length === 0) warningCodes.push("NO_EVENT_ENTRIES");
  if (uniqueCoreCount !== entries.length)
    warningCodes.push("DUPLICATE_CORE_ENTRY");
  if (!goldStarEligible && goldAssignedCoreIds.length > 0)
    warningCodes.push("GOLD_INELIGIBLE_ASSIGNMENT");
  if (goldAssignedCoreIds.length > 1)
    warningCodes.push("MULTIPLE_GOLD_ASSIGNMENTS");
  if (blueAssignedCoreIds.length > 1)
    warningCodes.push("MULTIPLE_BLUE_ASSIGNMENTS");
  if (starDataCounts.invalid > 0) warningCodes.push("INVALID_STAR_DATA");
  if (starDataCounts.partial > 0 || starDataCounts.missing > 0)
    warningCodes.push("INCOMPLETE_STAR_DATA");

  const allGoldDataComplete = goldDataCounts.complete === entries.length;
  const allBlueDataComplete = blueDataCounts.complete === entries.length;
  const noDuplicateCore = uniqueCoreCount === entries.length;
  const uniqueGoldCoreId =
    goldAssignedCoreIds.length === 1 ? goldAssignedCoreIds[0]! : null;
  const uniqueBlueCoreId =
    blueAssignedCoreIds.length === 1 ? blueAssignedCoreIds[0]! : null;
  const status: EventStarValidationStatus = warningCodes.some((warning) =>
    invalidWarnings.has(warning),
  )
    ? "invalid"
    : warningCodes.length > 0
      ? "warning"
      : "valid";

  return {
    gateCount,
    goldStarEligible,
    entryCount: entries.length,
    goldAssignmentCount: goldAssignedCoreIds.length,
    blueAssignmentCount: blueAssignedCoreIds.length,
    goldAssignedCoreIds,
    blueAssignedCoreIds,
    uniqueGoldCoreId,
    uniqueBlueCoreId,
    sameCoreReceivedBoth:
      uniqueGoldCoreId !== null && uniqueGoldCoreId === uniqueBlueCoreId,
    goldAssignmentOpportunity:
      goldStarEligible &&
      uniqueGoldCoreId !== null &&
      allGoldDataComplete &&
      noDuplicateCore,
    blueAssignmentOpportunity:
      uniqueBlueCoreId !== null && allBlueDataComplete && noDuplicateCore,
    starDataCounts,
    goldDataCounts,
    blueDataCounts,
    status,
    warningCodes,
  };
}

export function validateEventStars(
  gateCount: number,
  entries: readonly EventStarEntry[],
): StarWarning[] {
  return [...validateEventStarAssignments(gateCount, entries).warningCodes];
}

export function isNegativeGoldOpportunity(input: {
  gateCount: number;
  eventAssignedGold: boolean;
  entryGoldStar: boolean | null;
}): boolean {
  return (
    isGoldStarEligible(input.gateCount) &&
    input.eventAssignedGold &&
    input.entryGoldStar === false
  );
}

export type StarProfileEvent = {
  eventId: string;
  eventAt: string;
  mode: "bike" | "car" | "horse";
  distance: number;
  gateCount: number;
  entries: readonly EventStarEntry[];
};

export type CountRatio = {
  numerator: number;
  denominator: number;
};

export type CoreStarProfile = {
  coreId: string;
  mode: StarProfileEvent["mode"];
  distance: number;
  dataCurrentThrough: string;
  raceCount: number;
  completeStarDataRaceCount: number;
  partialStarDataRaceCount: number;
  missingStarDataRaceCount: number;
  invalidStarDataRaceCount: number;
  goldEligibleRaceCount: number;
  goldAssignmentOpportunityCount: number;
  goldReceivedCount: number;
  goldNegativeOpportunityCount: number;
  goldEligibleNoAssignmentCount: number;
  goldIneligibleAssignmentCount: number;
  goldExcludedAnomalyCount: number;
  goldReceivedRate: CountRatio;
  blueAssignmentOpportunityCount: number;
  blueReceivedCount: number;
  blueNegativeOpportunityCount: number;
  blueNoAssignmentCount: number;
  blueExcludedAnomalyCount: number;
  blueReceivedRate: CountRatio;
  sameCoreReceivedBothCount: number;
};

export type StarProfileRefresh = {
  eventValidations: readonly (EventStarValidation & { eventId: string })[];
  profiles: readonly CoreStarProfile[];
};

type MutableProfile = Omit<
  CoreStarProfile,
  "goldReceivedRate" | "blueReceivedRate"
>;

function profileKey(event: StarProfileEvent, coreId: string): string {
  return JSON.stringify([coreId, event.mode, event.distance]);
}

function newProfile(event: StarProfileEvent, coreId: string): MutableProfile {
  return {
    coreId,
    mode: event.mode,
    distance: event.distance,
    dataCurrentThrough: event.eventAt,
    raceCount: 0,
    completeStarDataRaceCount: 0,
    partialStarDataRaceCount: 0,
    missingStarDataRaceCount: 0,
    invalidStarDataRaceCount: 0,
    goldEligibleRaceCount: 0,
    goldAssignmentOpportunityCount: 0,
    goldReceivedCount: 0,
    goldNegativeOpportunityCount: 0,
    goldEligibleNoAssignmentCount: 0,
    goldIneligibleAssignmentCount: 0,
    goldExcludedAnomalyCount: 0,
    blueAssignmentOpportunityCount: 0,
    blueReceivedCount: 0,
    blueNegativeOpportunityCount: 0,
    blueNoAssignmentCount: 0,
    blueExcludedAnomalyCount: 0,
    sameCoreReceivedBothCount: 0,
  };
}

function assertEventMetadata(event: StarProfileEvent): void {
  if (
    event.eventId.trim() === "" ||
    !Number.isInteger(event.distance) ||
    event.distance <= 0 ||
    !Number.isInteger(event.gateCount) ||
    event.gateCount <= 0 ||
    Number.isNaN(Date.parse(event.eventAt))
  ) {
    throw new Error(`Invalid star-profile event metadata: ${event.eventId}`);
  }
}

function worstStatus(entries: readonly EventStarEntry[]): StarDataStatus {
  const priority: readonly StarDataStatus[] = [
    "invalid",
    "missing",
    "partial",
    "complete",
  ];
  return priority.find((status) =>
    entries.some((entry) => entry.starDataStatus === status),
  )!;
}

export function refreshStarProfiles(
  events: readonly StarProfileEvent[],
): StarProfileRefresh {
  const eventIds = new Set<string>();
  const profiles = new Map<string, MutableProfile>();
  const eventValidations: (EventStarValidation & { eventId: string })[] = [];
  const sortedEvents = [...events].sort((left, right) =>
    left.eventId.localeCompare(right.eventId),
  );

  for (const event of sortedEvents) {
    assertEventMetadata(event);
    if (eventIds.has(event.eventId))
      throw new Error(
        `Duplicate event in star-profile refresh: ${event.eventId}`,
      );
    eventIds.add(event.eventId);

    const validation = validateEventStarAssignments(
      event.gateCount,
      event.entries,
    );
    eventValidations.push({ eventId: event.eventId, ...validation });

    const entriesByCore = new Map<string, EventStarEntry[]>();
    for (const entry of event.entries) {
      const existing = entriesByCore.get(entry.coreId) ?? [];
      existing.push(entry);
      entriesByCore.set(entry.coreId, existing);
    }

    for (const [coreId, coreEntries] of entriesByCore) {
      const key = profileKey(event, coreId);
      const profile = profiles.get(key) ?? newProfile(event, coreId);
      const status = worstStatus(coreEntries);
      const goldStar = coreEntries.some(({ goldStar }) => goldStar === true);
      const goldDataIsComplete =
        validation.goldDataCounts.complete === event.entries.length;
      const blueDataIsComplete =
        validation.blueDataCounts.complete === event.entries.length;

      profile.raceCount += 1;
      profile.dataCurrentThrough =
        Date.parse(event.eventAt) > Date.parse(profile.dataCurrentThrough)
          ? event.eventAt
          : profile.dataCurrentThrough;
      profile[`${status}StarDataRaceCount`] += 1;

      if (validation.goldStarEligible) profile.goldEligibleRaceCount += 1;
      if (!validation.goldStarEligible && goldStar)
        profile.goldIneligibleAssignmentCount += 1;

      if (validation.goldAssignmentOpportunity) {
        profile.goldAssignmentOpportunityCount += 1;
        if (validation.uniqueGoldCoreId === coreId)
          profile.goldReceivedCount += 1;
        else profile.goldNegativeOpportunityCount += 1;
      } else if (
        validation.goldStarEligible &&
        goldDataIsComplete &&
        validation.goldAssignmentCount === 0
      ) {
        profile.goldEligibleNoAssignmentCount += 1;
      } else if (validation.goldStarEligible) {
        profile.goldExcludedAnomalyCount += 1;
      }

      if (validation.blueAssignmentOpportunity) {
        profile.blueAssignmentOpportunityCount += 1;
        if (validation.uniqueBlueCoreId === coreId)
          profile.blueReceivedCount += 1;
        else profile.blueNegativeOpportunityCount += 1;
      } else if (blueDataIsComplete && validation.blueAssignmentCount === 0) {
        profile.blueNoAssignmentCount += 1;
      } else {
        profile.blueExcludedAnomalyCount += 1;
      }

      if (
        validation.goldAssignmentOpportunity &&
        validation.blueAssignmentOpportunity &&
        validation.sameCoreReceivedBoth &&
        validation.uniqueGoldCoreId === coreId
      ) {
        profile.sameCoreReceivedBothCount += 1;
      }

      profiles.set(key, profile);
    }
  }

  return {
    eventValidations,
    profiles: [...profiles.values()]
      .sort(
        (left, right) =>
          left.coreId.localeCompare(right.coreId) ||
          left.mode.localeCompare(right.mode) ||
          left.distance - right.distance,
      )
      .map((profile) => ({
        ...profile,
        goldReceivedRate: {
          numerator: profile.goldReceivedCount,
          denominator: profile.goldAssignmentOpportunityCount,
        },
        blueReceivedRate: {
          numerator: profile.blueReceivedCount,
          denominator: profile.blueAssignmentOpportunityCount,
        },
      })),
  };
}
