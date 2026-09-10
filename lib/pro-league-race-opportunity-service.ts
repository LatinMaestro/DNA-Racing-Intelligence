import { deriveFreshness, type FreshnessState } from "@/domain/freshness";
import type {
  DnaOpenLabCurrentRaceReadRepository,
  DnaOpenLabServingCurrentRaces,
} from "@/lib/neon-dna-open-lab-sync-publication";

const MAXIMUM_ACTIVE_RACES = 2_000;

export type ProLeagueRaceOpportunity = Readonly<{
  sourceRaceId: string;
  displayName: string;
  status: "filling";
  observedAt: string;
  gateCount: number;
  filledGateCount: number;
  availableGateCount: number;
  fillPercentage: number;
  formatSourceValue: string | null;
  raceClassSourceValue: string | number | null;
  entryFeeUsd: number;
  paymentAsset: string;
  fixedFeesByAsset: Readonly<Record<string, number>>;
  startAt: string | null;
  entrantCount: number;
  gapMatchStatus: "exact_type_and_distance_unavailable";
}>;

export type ProLeagueRaceOpportunityState = Readonly<{
  status:
    | "not_configured"
    | "active_generation_unavailable"
    | "invalid_generation"
    | "connected";
  observedAt: string | null;
  freshness: FreshnessState;
  scannedRaceCount: number;
  qualifyingRaceCount: number;
  priorityGapCount: number;
  opportunities: readonly ProLeagueRaceOpportunity[];
  exactGapMatchingAvailable: false;
  raceEntryAllowed: false;
  directRaceLinkAvailable: false;
}>;

function unavailable(
  status:
    "not_configured" | "active_generation_unavailable" | "invalid_generation",
  priorityGapCount: number,
): ProLeagueRaceOpportunityState {
  return Object.freeze({
    status,
    observedAt: null,
    freshness: "unknown",
    scannedRaceCount: 0,
    qualifyingRaceCount: 0,
    priorityGapCount,
    opportunities: Object.freeze([]),
    exactGapMatchingAvailable: false,
    raceEntryAllowed: false,
    directRaceLinkAvailable: false,
  });
}

export function invalidProLeagueRaceOpportunityState(
  priorityGapCount: number,
): ProLeagueRaceOpportunityState {
  return unavailable("invalid_generation", priorityGapCount);
}

function timestamp(value: string, label: string, now: Date): string {
  const parsed = new Date(value);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== value ||
    parsed.getTime() > now.getTime()
  ) {
    throw new Error(`Pro League race opportunity ${label} is invalid.`);
  }
  return value;
}

function verifyGeneration(serving: DnaOpenLabServingCurrentRaces): void {
  if (
    serving.activeRaces.length > MAXIMUM_ACTIVE_RACES ||
    serving.raceFills.length > MAXIMUM_ACTIVE_RACES ||
    serving.activeRaces.length !== serving.raceFills.length
  ) {
    throw new Error("Pro League current-race generation coverage is invalid.");
  }
  const activeIds = serving.activeRaces.map(({ sourceRaceId }) => sourceRaceId);
  const fillIds = serving.raceFills.map(({ sourceRaceId }) => sourceRaceId);
  if (
    new Set(activeIds).size !== activeIds.length ||
    new Set(fillIds).size !== fillIds.length ||
    activeIds.some((value) => !fillIds.includes(value))
  ) {
    throw new Error(
      "Pro League current-race generation identities are invalid.",
    );
  }
}

function opportunity(
  active: DnaOpenLabServingCurrentRaces["activeRaces"][number],
  fill: DnaOpenLabServingCurrentRaces["raceFills"][number],
  now: Date,
): ProLeagueRaceOpportunity | null {
  if (
    active.canonical.sourceRaceId !== fill.canonical.sourceRaceId ||
    active.sourceRaceId !== fill.sourceRaceId
  ) {
    throw new Error("Pro League active-race and fill identities changed.");
  }
  const activeObservedAt = timestamp(
    active.observedAt,
    "active observation",
    now,
  );
  const fillObservedAt = timestamp(fill.observedAt, "fill observation", now);
  if (
    active.canonical.mode !== "bike" ||
    active.canonical.status.trim().toLowerCase() !== "filling" ||
    fill.canonical.status.trim().toLowerCase() !== "filling" ||
    active.canonical.fixedFeesByAsset === undefined
  ) {
    return null;
  }
  const { gateCount, filledGateCount, entrantCoreIds } = fill.canonical;
  if (
    !Number.isSafeInteger(gateCount) ||
    gateCount <= 0 ||
    !Number.isSafeInteger(filledGateCount) ||
    filledGateCount < 0 ||
    filledGateCount > gateCount ||
    entrantCoreIds.length !== filledGateCount
  ) {
    throw new Error("Pro League race fill authority is invalid.");
  }
  const availableGateCount = gateCount - filledGateCount;
  if (availableGateCount < 1 || filledGateCount < Math.ceil(gateCount / 2)) {
    return null;
  }
  return Object.freeze({
    sourceRaceId: active.sourceRaceId,
    displayName: active.canonical.displayName,
    status: "filling",
    observedAt:
      Date.parse(activeObservedAt) < Date.parse(fillObservedAt)
        ? activeObservedAt
        : fillObservedAt,
    gateCount,
    filledGateCount,
    availableGateCount,
    fillPercentage: Math.round((filledGateCount / gateCount) * 100),
    formatSourceValue: active.canonical.format,
    raceClassSourceValue: active.canonical.raceClassSourceValue,
    entryFeeUsd: active.canonical.entryFeeUsd,
    paymentAsset: active.canonical.paymentAsset,
    fixedFeesByAsset: active.canonical.fixedFeesByAsset,
    startAt: active.canonical.startAt,
    entrantCount: entrantCoreIds.length,
    gapMatchStatus: "exact_type_and_distance_unavailable",
  });
}

export async function loadProLeagueRaceOpportunities(
  input: Readonly<{
    ownerId: string;
    priorityGapCount: number;
    repository: DnaOpenLabCurrentRaceReadRepository | null;
    now?: Date;
  }>,
): Promise<ProLeagueRaceOpportunityState> {
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error("Pro League race opportunity freshness time is invalid.");
  }
  if (
    !Number.isSafeInteger(input.priorityGapCount) ||
    input.priorityGapCount < 0
  ) {
    throw new Error("Pro League priority gap count is invalid.");
  }
  if (input.repository === null) {
    return unavailable("not_configured", input.priorityGapCount);
  }
  const serving = await input.repository.readServingCurrentRaces({
    ownerId: input.ownerId,
  });
  if (serving.generationId === null) {
    if (serving.activeRaces.length !== 0 || serving.raceFills.length !== 0) {
      throw new Error("Pro League current races exist without a generation.");
    }
    return unavailable("active_generation_unavailable", input.priorityGapCount);
  }
  verifyGeneration(serving);
  const fills = new Map(
    serving.raceFills.map((value) => [value.sourceRaceId, value]),
  );
  const opportunities = serving.activeRaces
    .map((active) => {
      const fill = fills.get(active.sourceRaceId);
      if (fill === undefined) {
        throw new Error("Pro League active race has no fill observation.");
      }
      return opportunity(active, fill, now);
    })
    .filter((value): value is ProLeagueRaceOpportunity => value !== null)
    .sort(
      (left, right) =>
        right.fillPercentage - left.fillPercentage ||
        right.filledGateCount - left.filledGateCount ||
        (left.startAt ?? "9999").localeCompare(right.startAt ?? "9999") ||
        left.displayName.localeCompare(right.displayName) ||
        left.sourceRaceId.localeCompare(right.sourceRaceId),
    );
  const observedAt = serving.activeRaces
    .flatMap((value) => [value.observedAt])
    .concat(serving.raceFills.map((value) => value.observedAt))
    .map((value) => timestamp(value, "observation", now))
    .sort()
    .at(0);
  return Object.freeze({
    status: "connected",
    observedAt: observedAt ?? null,
    freshness: deriveFreshness(
      observedAt === undefined ? null : new Date(observedAt),
      now,
    ),
    scannedRaceCount: serving.activeRaces.length,
    qualifyingRaceCount: opportunities.length,
    priorityGapCount: input.priorityGapCount,
    opportunities: Object.freeze(opportunities),
    exactGapMatchingAvailable: false,
    raceEntryAllowed: false,
    directRaceLinkAvailable: false,
  });
}
