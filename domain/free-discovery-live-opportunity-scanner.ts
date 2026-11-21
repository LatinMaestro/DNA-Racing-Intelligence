import { classifyDiscoveryEvidence } from "@/domain/discovery-study";
import {
  screenFreeDiscoveryOpportunities,
  type FreeDiscoveryCampaignCell,
  type FreeDiscoveryOpportunity,
  type FreeDiscoveryOpportunityExclusion,
  type FreeDiscoveryRaceCandidate,
} from "@/domain/race-entry-bot";
import type { DnaCurrentRaceMaterializationRow } from "@/lib/dna-open-lab-current-race-materialization";
import type {
  CanonicalActiveRaceSnapshot,
  CanonicalRaceDocumentMetadata,
  CanonicalRaceFillSnapshot,
} from "@/lib/dna-open-lab-v1-adapters";

type Observed<T> = DnaCurrentRaceMaterializationRow<T>;

export type FreeDiscoveryLiveScanExclusion =
  | FreeDiscoveryOpportunityExclusion
  | "missing_or_conflicting_fill"
  | "missing_or_incomplete_document";

function validTime(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function currentEvidence(
  observedAt: string,
  evaluatedAt: number,
  maximumAgeMilliseconds: number,
): boolean {
  const observed = validTime(observedAt);
  return (
    observed !== null &&
    observed <= evaluatedAt &&
    evaluatedAt - observed <= maximumAgeMilliseconds
  );
}

function indexed<T extends { sourceRaceId: string }>(
  rows: readonly T[],
): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    if (!row.sourceRaceId || result.has(row.sourceRaceId)) {
      throw new Error(
        "Free Discovery scanner received duplicate or invalid race identity.",
      );
    }
    result.set(row.sourceRaceId, row);
  }
  return result;
}

/**
 * Connects the canonical, read-only Open Lab active/fill/document observations
 * to the existing Free Discovery lane of the shared race-entry bot.
 *
 * The accepted Discovery authority identifies standalone Free races only from
 * the authoritative race-name token. Zero fees are never used as authority.
 * Unlike ordinary Open Race advisory scanning, this path deliberately does not
 * require a half-filled field. It cannot queue, reserve or enter a race.
 */
export function scanFreeDiscoveryLiveOpportunities(
  input: Readonly<{
    evaluatedAt: string;
    maximumAgeMinutes: number;
    campaign: FreeDiscoveryCampaignCell;
    currentOwnedCoreIds: readonly string[];
    activeRaces: readonly Observed<CanonicalActiveRaceSnapshot>[];
    fills: readonly Observed<CanonicalRaceFillSnapshot>[];
    documents: readonly Observed<CanonicalRaceDocumentMetadata>[];
  }>,
): Readonly<{
  opportunities: readonly FreeDiscoveryOpportunity[];
  excluded: readonly Readonly<{
    raceId: string;
    reason: FreeDiscoveryLiveScanExclusion;
  }>[];
  newRaceBudgetRemaining: number;
  queueAllowed: false;
  gameEntryAllowed: false;
}> {
  const evaluatedAt = validTime(input.evaluatedAt);
  if (
    evaluatedAt === null ||
    !Number.isSafeInteger(input.maximumAgeMinutes) ||
    input.maximumAgeMinutes < 1 ||
    input.maximumAgeMinutes > 60
  ) {
    throw new Error("Free Discovery scanner freshness limit is invalid.");
  }
  const maximumAgeMilliseconds = input.maximumAgeMinutes * 60_000;
  const fills = indexed(input.fills);
  const documents = indexed(input.documents);
  indexed(input.activeRaces);
  const races: FreeDiscoveryRaceCandidate[] = [];
  const excluded: {
    raceId: string;
    reason: FreeDiscoveryLiveScanExclusion;
  }[] = [];

  for (const active of input.activeRaces) {
    const raceId = active.sourceRaceId;
    const fill = fills.get(raceId);
    if (
      fill === undefined ||
      !currentEvidence(fill.observedAt, evaluatedAt, maximumAgeMilliseconds) ||
      fill.canonical.sourceRaceId !== raceId ||
      !["open", "filling"].includes(fill.canonical.status.toLowerCase()) ||
      fill.canonical.entrantCoreIds.length !== fill.canonical.filledGateCount ||
      new Set(fill.canonical.entrantCoreIds).size !==
        fill.canonical.entrantCoreIds.length
    ) {
      excluded.push({ raceId, reason: "missing_or_conflicting_fill" });
      continue;
    }
    const document = documents.get(raceId);
    if (
      document === undefined ||
      !currentEvidence(
        document.observedAt,
        evaluatedAt,
        maximumAgeMilliseconds,
      ) ||
      document.canonical.sourceRaceId !== raceId ||
      document.canonical.sourceType !== "race_document" ||
      document.canonical.mode !== active.canonical.mode ||
      document.canonical.format !== active.canonical.format ||
      document.canonical.raceClassSourceValue !==
        active.canonical.raceClassSourceValue ||
      document.canonical.distanceMetres === undefined ||
      document.canonical.gateCount !== fill.canonical.gateCount ||
      document.canonical.filledGateCount !== fill.canonical.filledGateCount ||
      document.canonical.entrantCoreIds === undefined ||
      !document.canonical.entrantCoreIds.every(
        (coreId, index) => coreId === fill.canonical.entrantCoreIds[index],
      ) ||
      document.canonical.entrantCoreIds.length !==
        fill.canonical.entrantCoreIds.length
    ) {
      excluded.push({ raceId, reason: "missing_or_incomplete_document" });
      continue;
    }
    races.push({
      raceId,
      status: active.canonical.status,
      raceTypeSourceValue:
        classifyDiscoveryEvidence({
          raceName: active.canonical.displayName,
        }) === "normal_free"
          ? "Free"
          : null,
      mode: active.canonical.mode,
      distanceMetres: document.canonical.distanceMetres,
      raceClassSourceValue: active.canonical.raceClassSourceValue,
      gateCount: fill.canonical.gateCount,
      filledGateCount: fill.canonical.filledGateCount,
      format: document.canonical.format ?? "",
      entrantCoreIds: [...fill.canonical.entrantCoreIds],
      observedAt: active.observedAt,
    });
  }

  const screened = screenFreeDiscoveryOpportunities({
    evaluatedAt: input.evaluatedAt,
    maximumAgeMinutes: input.maximumAgeMinutes,
    campaign: input.campaign,
    currentOwnedCoreIds: input.currentOwnedCoreIds,
    races,
  });
  return {
    ...screened,
    excluded: [...excluded, ...screened.excluded],
  };
}
