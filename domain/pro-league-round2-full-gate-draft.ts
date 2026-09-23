import {
  proLeagueMaps,
  buildProLeagueFullGateMapLineup,
  type ProLeagueFullGateAssignmentCommand,
  type ProLeagueMapId,
} from "@/domain/pro-league-maps";
import {
  requireCurrentBikeAgeingEvidence,
  requireCurrentBikeAgeingUpperBound,
  type OwnedBikeCellScreen,
} from "@/domain/pro-league-owned-bike-pace";
import {
  auditProLeagueRoster,
  type ProLeagueRosterCore,
} from "@/domain/pro-league-roster";

type AgeProof =
  | Readonly<{
      bikeAgeingBalance: number;
      verifiedBikeAgeingUsedUpperBound?: never;
      bikeAgeingProofSource?: never;
    }>
  | Readonly<{
      bikeAgeingBalance?: never;
      verifiedBikeAgeingUsedUpperBound: 300 | 400;
      bikeAgeingProofSource: "connected_owner_bike_balance";
    }>;

export type Round2VerifiedCandidate = Readonly<{
  core: ProLeagueRosterCore;
  bikeAgeingObservedAt: string;
  completeOwnedBikeHistory: true;
  cells: readonly OwnedBikeCellScreen[];
}> &
  AgeProof;

export function verifiedRound2BikeAgeing(
  candidate: Round2VerifiedCandidate,
  currentThrough: string,
): Readonly<{
  usedUpperBound: number;
  minimumRemaining: number;
  evidence: "exact_balance" | "verified_band";
}> {
  if (candidate.bikeAgeingBalance !== undefined) {
    const exact = requireCurrentBikeAgeingEvidence({
      balance: candidate.bikeAgeingBalance,
      observedAt: candidate.bikeAgeingObservedAt,
      currentThrough,
    });
    if (!exact.eligible)
      throw new Error("Round 2 Core exceeds the verified Bike ageing limit.");
    return Object.freeze({
      usedUpperBound: exact.used,
      minimumRemaining: exact.remaining,
      evidence: "exact_balance",
    });
  }
  const band = requireCurrentBikeAgeingUpperBound({
    usedUpperBound: candidate.verifiedBikeAgeingUsedUpperBound,
    observedAt: candidate.bikeAgeingObservedAt,
    currentThrough,
    source: candidate.bikeAgeingProofSource,
  });
  return Object.freeze({ ...band, evidence: "verified_band" });
}

export type Round2FullGateLine = Readonly<{
  mapId: ProLeagueMapId;
  raceNumber: number;
  first16: boolean;
  raceType: string;
  distanceMetres: number;
  coreIds: readonly string[];
  evidence: readonly Readonly<{
    coreId: string;
    status: OwnedBikeCellScreen["status"] | "unmeasured";
    intrinsicDistanceMedianMilliseconds: number | null;
    intrinsicDistanceStandardDeviationMilliseconds: number | null;
    distanceSampleCount: number;
    recentDistanceSampleCount: number;
    officialCellRaceCount: number;
    projectionOnly: true;
  }>[];
  status: "elite_covered" | "positive_covered" | "provisional_gap";
  provisionalCoreIds: readonly string[];
}>;

export type Round2FullGateDraft = Readonly<{
  authority: "advisory_complete_verified_roster";
  substitutionsUsed: 0;
  rosterCoreIds: readonly string[];
  lines: readonly Round2FullGateLine[];
  mapCapability: readonly Readonly<{
    mapId: ProLeagueMapId;
    first16EliteCovered: number;
    first16ProvisionalGaps: number;
    allLineProvisionalGaps: number;
  }>[];
  provisionalLineCount: number;
}>;

function normalizedType(value: string): string {
  return value.trim().toLowerCase().replaceAll("_", " ").replace(/\s+/gu, " ");
}

function key(
  raceType: string,
  distanceMetres: number,
  gateCount: number,
): string {
  return JSON.stringify([normalizedType(raceType), distanceMetres, gateCount]);
}

const power: Readonly<Record<OwnedBikeCellScreen["status"], number>> = {
  elite_range: 3,
  positive_range: 2,
  provisional: 1,
  outside: 0,
};

export function buildRound2FullGateDraft(input: {
  roster: readonly Round2VerifiedCandidate[];
  currentThrough: string;
}): Round2FullGateDraft {
  if (input.roster.length !== 25) {
    throw new Error("Round 2 full-gate draft requires exactly 25 Cores.");
  }
  const audit = auditProLeagueRoster(input.roster.map(({ core }) => core));
  if (audit.readiness !== "compliant" || audit.issues.length > 0) {
    throw new Error("Round 2 roster must pass every owner-confirmed rule.");
  }
  const byCore = new Map<string, Map<string, OwnedBikeCellScreen>>();
  for (const candidate of input.roster) {
    if (
      candidate.completeOwnedBikeHistory !== true ||
      candidate.core.coreClass === "Genesis" ||
      candidate.core.displayName.trim().toLowerCase() === "reese dylan" ||
      !candidate.core.inMyVault
    ) {
      throw new Error(
        "Round 2 Core has excluded class, owner or incomplete history.",
      );
    }
    verifiedRound2BikeAgeing(candidate, input.currentThrough);
    if (!candidate.cells.some(({ status }) => status === "elite_range")) {
      throw new Error(
        "Round 2 roster Core lacks repeated elite-range Bike pace.",
      );
    }
    const cells = new Map<string, OwnedBikeCellScreen>();
    for (const cell of candidate.cells) {
      const id = key(cell.raceType, cell.distanceMetres, cell.gateCount);
      if (cells.has(id) || cell.distanceOnlyProjection !== true) {
        throw new Error("Round 2 Core cell evidence is duplicate or invalid.");
      }
      if (
        (cell.status === "elite_range" || cell.status === "positive_range") &&
        (cell.sampleCount < 10 ||
          cell.recentSampleCount < 3 ||
          cell.officialRaceCount < 5 ||
          cell.medianMilliseconds === null ||
          cell.medianMilliseconds <= 0 ||
          !Number.isFinite(cell.medianMilliseconds) ||
          cell.standardDeviationMilliseconds === null ||
          !Number.isFinite(cell.standardDeviationMilliseconds) ||
          cell.standardDeviationMilliseconds < 0)
      ) {
        throw new Error(
          "Round 2 elite or positive cell lacks repeated current pace evidence.",
        );
      }
      cells.set(id, cell);
    }
    byCore.set(candidate.core.coreId, cells);
  }

  const rosterIds = input.roster.map(({ core }) => core.coreId);
  const usage = new Map<string, number>();
  const assignments: ProLeagueFullGateAssignmentCommand[] = [];
  const lineByKey = new Map<string, Round2FullGateLine>();
  // Resolve early lines first so equal-pace rotation cannot displace an early gate.
  const races = proLeagueMaps
    .flatMap((map) => map.races.map((race) => ({ map, race })))
    .sort(
      (a, b) =>
        Number(b.race.raceNumber <= 16) - Number(a.race.raceNumber <= 16) ||
        a.map.mapNumber - b.map.mapNumber ||
        a.race.raceNumber - b.race.raceNumber,
    );
  for (const { map, race } of races) {
    const cellId = key(
      race.raceType,
      race.distanceMetres,
      race.totalGateEntries,
    );
    const ranked = rosterIds
      .map((coreId) => ({
        coreId,
        cell: byCore.get(coreId)?.get(cellId) ?? null,
      }))
      .sort(
        (a, b) =>
          power[b.cell?.status ?? "outside"] -
            power[a.cell?.status ?? "outside"] ||
          (a.cell?.medianMilliseconds ?? Number.MAX_VALUE) -
            (b.cell?.medianMilliseconds ?? Number.MAX_VALUE) ||
          (a.cell?.standardDeviationMilliseconds ?? Number.MAX_VALUE) -
            (b.cell?.standardDeviationMilliseconds ?? Number.MAX_VALUE) ||
          (usage.get(a.coreId) ?? 0) - (usage.get(b.coreId) ?? 0) ||
          a.coreId.localeCompare(b.coreId),
      );
    const selected = ranked.slice(0, race.gateEntriesPerVault);
    if (selected.length !== race.gateEntriesPerVault) {
      throw new Error("Round 2 owner gate cannot be filled.");
    }
    for (const value of selected)
      usage.set(value.coreId, (usage.get(value.coreId) ?? 0) + 1);
    const provisionalCoreIds = selected
      .filter(
        ({ cell }) =>
          cell?.status !== "elite_range" && cell?.status !== "positive_range",
      )
      .map(({ coreId }) => coreId);
    const line: Round2FullGateLine = Object.freeze({
      mapId: map.mapId,
      raceNumber: race.raceNumber,
      first16: race.raceNumber <= 16,
      raceType: race.raceType,
      distanceMetres: race.distanceMetres,
      coreIds: Object.freeze(selected.map(({ coreId }) => coreId)),
      evidence: Object.freeze(
        selected.map(({ coreId, cell }) =>
          Object.freeze({
            coreId,
            status: cell?.status ?? "unmeasured",
            intrinsicDistanceMedianMilliseconds:
              cell?.medianMilliseconds ?? null,
            intrinsicDistanceStandardDeviationMilliseconds:
              cell?.standardDeviationMilliseconds ?? null,
            distanceSampleCount: cell?.sampleCount ?? 0,
            recentDistanceSampleCount: cell?.recentSampleCount ?? 0,
            officialCellRaceCount: cell?.officialRaceCount ?? 0,
            projectionOnly: true as const,
          }),
        ),
      ),
      status:
        provisionalCoreIds.length > 0
          ? "provisional_gap"
          : selected.every(({ cell }) => cell?.status === "elite_range")
            ? "elite_covered"
            : "positive_covered",
      provisionalCoreIds: Object.freeze(provisionalCoreIds),
    });
    lineByKey.set(`${map.mapId}/${race.raceNumber}`, line);
    assignments.push(
      Object.freeze({
        mapId: map.mapId,
        raceNumber: race.raceNumber,
        coreIds: line.coreIds,
        scope: "single_race" as const,
      }),
    );
  }
  const lines = proLeagueMaps.flatMap((map) =>
    map.races.map((race) => lineByKey.get(`${map.mapId}/${race.raceNumber}`)!),
  );
  for (const map of proLeagueMaps) {
    const result = buildProLeagueFullGateMapLineup({
      mapId: map.mapId,
      rosterCoreIds: rosterIds,
      assignments: assignments.filter((value) => value.mapId === map.mapId),
    });
    if (result.assignedRaceCount !== 42 || result.assignedFirst16Count !== 16) {
      throw new Error("Round 2 four-map lineup is incomplete.");
    }
  }
  if (lines.length !== 168) throw new Error("Round 2 needs 168 mapped lines.");
  return Object.freeze({
    authority: "advisory_complete_verified_roster",
    substitutionsUsed: 0,
    rosterCoreIds: Object.freeze(rosterIds),
    lines: Object.freeze(lines),
    mapCapability: Object.freeze(
      proLeagueMaps.map((map) => {
        const values = lines.filter(({ mapId }) => mapId === map.mapId);
        return Object.freeze({
          mapId: map.mapId,
          first16EliteCovered: values.filter(
            (line) => line.first16 && line.status === "elite_covered",
          ).length,
          first16ProvisionalGaps: values.filter(
            (line) => line.first16 && line.status === "provisional_gap",
          ).length,
          allLineProvisionalGaps: values.filter(
            (line) => line.status === "provisional_gap",
          ).length,
        });
      }),
    ),
    provisionalLineCount: lines.filter(
      ({ status }) => status === "provisional_gap",
    ).length,
  });
}
