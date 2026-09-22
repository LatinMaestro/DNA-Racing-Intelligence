import type {
  ProLeagueCandidateCellScore,
  ProLeagueDraftRosterRecommendation,
  ProLeagueRosterCandidateScore,
} from "@/domain/pro-league-roster-recommendation";
import {
  PRO_LEAGUE_OWNER_FINAL_PLAN_ID,
  normalizeProLeagueOwnerCoreName,
  ownerPlanEntryByName,
  proLeagueOwnerDistanceDepth,
  proLeagueOwnerMapStrategy,
} from "@/domain/pro-league-owner-final-plan";
import { proLeagueMaps, type ProLeagueMapId } from "@/domain/pro-league-maps";

export type ProLeagueOwnerRosterRow = Readonly<{
  coreId: string;
  displayName: string;
  element: string;
  fNumber: number;
  sex: "male" | "female";
  primaryDistances: readonly number[];
}>;

export type ProLeagueOwnerRaceMapping = Readonly<{
  raceNumber: number;
  first16: boolean;
  raceType: string;
  distanceMetres: number;
  totalGateEntries: number;
  ourSlots: number;
  coreIds: readonly string[];
  coreNames: readonly string[];
  evidenceBackedCount: number;
  allSlotsFilled: boolean;
}>;

export type ProLeagueOwnerMapMapping = Readonly<{
  mapId: ProLeagueMapId;
  name: string;
  requiredCoreEntries: number;
  assignedCoreEntries: number;
  allSlotsFilled: boolean;
  lines: readonly ProLeagueOwnerRaceMapping[];
}>;

export type ProLeagueOwnerCommissioningPlan = Readonly<{
  planId: typeof PRO_LEAGUE_OWNER_FINAL_PLAN_ID;
  roster: readonly ProLeagueOwnerRosterRow[];
  mapStrategy: Readonly<{
    homePick: string;
    homeDeny: string;
    awayPriority: readonly string[];
    contingencyMap: string;
  }>;
  maps: readonly ProLeagueOwnerMapMapping[];
  requiredCoreEntries: number;
  assignedCoreEntries: number;
  allSlotsFilled: boolean;
}>;

type SelectedCandidate = Readonly<{
  candidate: ProLeagueRosterCandidateScore;
  ownerDepthRank: number;
}>;

function evidenceFor(
  candidate: ProLeagueRosterCandidateScore,
  raceType: string,
  distanceMetres: number,
): ProLeagueCandidateCellScore | null {
  return (
    candidate.cells.find(
      (cell) =>
        cell.raceType.toLowerCase() === raceType.toLowerCase() &&
        cell.distanceMetres === distanceMetres,
    ) ?? null
  );
}

const assessmentPower = Object.freeze({
  winning_range: 3,
  top_three_range: 2,
  outside_top_three_range: 1,
});

function evidencePower(cell: ProLeagueCandidateCellScore | null): number {
  if (cell === null) return 0;
  if (cell.evidenceUse === "ranked") {
    return 10 + assessmentPower[cell.benchmarkAssessment];
  }
  if (cell.evidenceUse === "hypothesis_only") return 2;
  if (cell.evidenceUse === "stale_unavailable") return 1;
  return 0;
}

function compareForRace(
  left: SelectedCandidate,
  right: SelectedCandidate,
  raceType: string,
  distanceMetres: number,
): number {
  const a = evidenceFor(left.candidate, raceType, distanceMetres);
  const b = evidenceFor(right.candidate, raceType, distanceMetres);
  const aPower = evidencePower(a);
  const bPower = evidencePower(b);
  if (aPower !== bPower) return bPower - aPower;
  if (a?.evidenceUse === "ranked" && b?.evidenceUse === "ranked") {
    const margin =
      b.medianVersusTopThreeBasisPoints - a.medianVersusTopThreeBasisPoints;
    if (margin !== 0) return margin;
    const consistency =
      (a.consistencyVersusTopThreeBasisPoints ?? Number.MAX_SAFE_INTEGER) -
      (b.consistencyVersusTopThreeBasisPoints ?? Number.MAX_SAFE_INTEGER);
    if (consistency !== 0) return consistency;
    if (a.medianMilliseconds !== b.medianMilliseconds) {
      return a.medianMilliseconds - b.medianMilliseconds;
    }
    if (a.standardDeviationMilliseconds !== b.standardDeviationMilliseconds) {
      return a.standardDeviationMilliseconds - b.standardDeviationMilliseconds;
    }
    if (a.raceCount !== b.raceCount) return b.raceCount - a.raceCount;
    if (a.freshness !== b.freshness) {
      return (
        Number(b.freshness === "current") - Number(a.freshness === "current")
      );
    }
  }
  return (
    left.ownerDepthRank - right.ownerDepthRank ||
    left.candidate.core.coreId.localeCompare(right.candidate.core.coreId)
  );
}

function mapName(mapId: ProLeagueMapId): string {
  const map = proLeagueMaps.find((value) => value.mapId === mapId);
  if (map === undefined) throw new Error(`Unknown Pro League map ${mapId}.`);
  return map.name;
}

export function buildProLeagueOwnerCommissioningPlan(
  roster: ProLeagueDraftRosterRecommendation,
): ProLeagueOwnerCommissioningPlan {
  const draft = roster.draftRoster;
  if (draft === null || draft.audit.readiness !== "compliant") {
    throw new Error(
      "Owner Pro League commissioning plan requires the compliant final roster.",
    );
  }
  const selectedIds = new Set(draft.rosteredCoreIds);
  const selectedCandidates = roster.candidates.filter(({ core }) =>
    selectedIds.has(core.coreId),
  );
  if (selectedCandidates.length !== 25) {
    throw new Error(
      "Owner Pro League final roster must contain exactly 25 Cores.",
    );
  }

  const candidateByName = new Map(
    selectedCandidates.map((candidate) => [
      normalizeProLeagueOwnerCoreName(candidate.core.displayName),
      candidate,
    ]),
  );
  const rosterRows = draft.members
    .filter(({ disposition }) => disposition === "rostered")
    .map(({ core }) => {
      const planned = ownerPlanEntryByName(core.displayName);
      if (planned === null) {
        throw new Error(
          `Rostered Core ${core.displayName} is not in the final owner plan.`,
        );
      }
      return Object.freeze({
        coreId: core.coreId,
        displayName: core.displayName,
        element: core.element,
        fNumber: core.fNumber,
        sex: core.sex,
        primaryDistances: planned.primaryDistances,
      });
    });

  const maps = proLeagueMaps.map((map): ProLeagueOwnerMapMapping => {
    const lines = map.races.map((race): ProLeagueOwnerRaceMapping => {
      const depth = proLeagueOwnerDistanceDepth[race.distanceMetres];
      if (depth === undefined || depth.length < race.gateEntriesPerVault) {
        throw new Error(
          `Owner distance depth is incomplete at ${race.distanceMetres}m.`,
        );
      }
      const choices = depth.map((displayName, index): SelectedCandidate => {
        const candidate = candidateByName.get(
          normalizeProLeagueOwnerCoreName(displayName),
        );
        if (candidate === undefined) {
          throw new Error(
            `Owner distance depth references non-rostered Core ${displayName}.`,
          );
        }
        return Object.freeze({ candidate, ownerDepthRank: index });
      });
      choices.sort((left, right) =>
        compareForRace(left, right, race.raceType, race.distanceMetres),
      );
      const assigned = choices.slice(0, race.gateEntriesPerVault);
      const evidenceBackedCount = assigned.filter(({ candidate }) => {
        const evidence = evidenceFor(
          candidate,
          race.raceType,
          race.distanceMetres,
        );
        return (
          evidence?.evidenceUse === "ranked" &&
          (evidence.benchmarkAssessment === "winning_range" ||
            evidence.benchmarkAssessment === "top_three_range")
        );
      }).length;
      return Object.freeze({
        raceNumber: race.raceNumber,
        first16: race.raceNumber <= 16,
        raceType: race.raceType,
        distanceMetres: race.distanceMetres,
        totalGateEntries: race.totalGateEntries,
        ourSlots: race.gateEntriesPerVault,
        coreIds: Object.freeze(
          assigned.map(({ candidate }) => candidate.core.coreId),
        ),
        coreNames: Object.freeze(
          assigned.map(({ candidate }) => candidate.core.displayName),
        ),
        evidenceBackedCount,
        allSlotsFilled: assigned.length === race.gateEntriesPerVault,
      });
    });
    const requiredCoreEntries = lines.reduce(
      (sum, line) => sum + line.ourSlots,
      0,
    );
    const assignedCoreEntries = lines.reduce(
      (sum, line) => sum + line.coreIds.length,
      0,
    );
    return Object.freeze({
      mapId: map.mapId,
      name: map.name,
      requiredCoreEntries,
      assignedCoreEntries,
      allSlotsFilled: requiredCoreEntries === assignedCoreEntries,
      lines: Object.freeze(lines),
    });
  });
  const requiredCoreEntries = maps.reduce(
    (sum, map) => sum + map.requiredCoreEntries,
    0,
  );
  const assignedCoreEntries = maps.reduce(
    (sum, map) => sum + map.assignedCoreEntries,
    0,
  );
  return Object.freeze({
    planId: PRO_LEAGUE_OWNER_FINAL_PLAN_ID,
    roster: Object.freeze(rosterRows),
    mapStrategy: Object.freeze({
      homePick: mapName(proLeagueOwnerMapStrategy.homePick),
      homeDeny: mapName(proLeagueOwnerMapStrategy.homeDeny),
      awayPriority: Object.freeze(
        proLeagueOwnerMapStrategy.awayPriority.map(mapName),
      ),
      contingencyMap: mapName(proLeagueOwnerMapStrategy.contingencyMap),
    }),
    maps: Object.freeze(maps),
    requiredCoreEntries,
    assignedCoreEntries,
    allSlotsFilled: requiredCoreEntries === assignedCoreEntries,
  });
}
