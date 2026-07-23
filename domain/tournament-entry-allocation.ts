export type EntryAllocationCandidateInput = Readonly<{
  coreId: string;
  leaderboardGroupId: string;
  configuredMetricRank: number;
  disposition: "review_candidate" | "hold" | "preserve_me" | "ineligible";
  requestedInitialRaces: number;
}>;

export type QualificationRacePlanInput = Readonly<{
  racePlanId: string;
  gateCount: number;
  existingPlannedOwnedCoreIds: readonly string[];
}>;

export type TournamentEntryAllocationInput = Readonly<{
  tournamentId: string;
  bracketId: string;
  candidates: readonly EntryAllocationCandidateInput[];
  racePlans: readonly QualificationRacePlanInput[];
}>;

export type TournamentEntryAllocationWarning =
  | "FIFTY_PERCENT_OWNED_GATE_CAP"
  | "CAP_IS_NOT_A_TARGET"
  | "CURRENT_FIELD_RECONFIRMATION_REQUIRED"
  | "GATE_C_NOT_PASSED"
  | "CANDIDATE_HELD"
  | "PRESERVE_ME"
  | "CANDIDATE_INELIGIBLE"
  | "REQUEST_EXCEEDS_PLANNED_CAPACITY"
  | "NO_REQUESTED_INITIAL_RACES";

export type PlannedRaceAllocation = Readonly<{
  racePlanId: string;
  gateCount: number;
  maximumOwnedEntries: number;
  existingPlannedOwnedCoreIds: readonly string[];
  suggestedCoreIds: readonly string[];
  totalPlannedOwnedEntries: number;
  spareOwnedCapacity: number;
  spareCapacityDeliberatelyUnfilled: boolean;
  requiresLiveFieldConfirmation: true;
}>;

export type CandidateEntryAllocation = Readonly<{
  coreId: string;
  leaderboardGroupId: string;
  configuredMetricRank: number;
  disposition: EntryAllocationCandidateInput["disposition"];
  requestedInitialRaces: number;
  allocatedInitialRaces: number;
  unallocatedInitialRaces: number;
  racePlanIds: readonly string[];
  warnings: readonly TournamentEntryAllocationWarning[];
  automaticEntryAllowed: false;
}>;

export type TournamentEntryAllocationResult = Readonly<{
  tournamentId: string;
  bracketId: string;
  races: readonly PlannedRaceAllocation[];
  candidates: readonly CandidateEntryAllocation[];
  capRule: "owned_entries_at_most_half_of_gates";
  allocationObjective: "requested_initial_evidence_only";
  capacityTarget: false;
  liveOccupancyAvailable: false;
  gateCRequired: true;
  actionableRecommendationAllowed: false;
  automaticEntryAllowed: false;
}>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

export function allocateTournamentEntries(
  input: TournamentEntryAllocationInput,
): TournamentEntryAllocationResult {
  const tournamentId = required(input.tournamentId, "Tournament ID");
  const bracketId = required(input.bracketId, "Bracket ID");

  const candidates = input.candidates.map((candidate) => {
    const coreId = required(candidate.coreId, "Core ID");
    const leaderboardGroupId = required(
      candidate.leaderboardGroupId,
      "Leaderboard group ID",
    );
    const configuredMetricRank = positiveInteger(
      candidate.configuredMetricRank,
      "Configured metric rank",
    );
    if (
      !["review_candidate", "hold", "preserve_me", "ineligible"].includes(
        candidate.disposition,
      )
    ) {
      throw new Error("Candidate disposition is invalid.");
    }
    return {
      ...candidate,
      coreId,
      leaderboardGroupId,
      configuredMetricRank,
      requestedInitialRaces: nonNegativeInteger(
        candidate.requestedInitialRaces,
        "Requested initial races",
      ),
    };
  });
  const coreIds = candidates.map((candidate) => candidate.coreId);
  if (new Set(coreIds).size !== coreIds.length) {
    throw new Error("Allocation candidate core IDs must be unique.");
  }
  const raceStates = input.racePlans.map((race) => {
    const racePlanId = required(race.racePlanId, "Race plan ID");
    const gateCount = positiveInteger(race.gateCount, "Gate count");
    if (gateCount < 2) {
      throw new Error("A qualification race plan requires at least two gates.");
    }
    const existingPlannedOwnedCoreIds = race.existingPlannedOwnedCoreIds.map(
      (coreId) => required(coreId, "Existing planned owned core ID"),
    );
    if (
      new Set(existingPlannedOwnedCoreIds).size !==
      existingPlannedOwnedCoreIds.length
    ) {
      throw new Error(
        "Existing planned owned core IDs must be unique within a race.",
      );
    }
    const maximumOwnedEntries = Math.floor(gateCount / 2);
    if (existingPlannedOwnedCoreIds.length > maximumOwnedEntries) {
      throw new Error(
        "Existing planned owned entries exceed the 50% gate cap.",
      );
    }
    return {
      racePlanId,
      gateCount,
      maximumOwnedEntries,
      existingPlannedOwnedCoreIds,
      suggestedCoreIds: [] as string[],
    };
  });
  const racePlanIds = raceStates.map((race) => race.racePlanId);
  if (new Set(racePlanIds).size !== racePlanIds.length) {
    throw new Error("Qualification race plan IDs must be unique.");
  }

  const knownCandidateIds = new Set(coreIds);
  for (const race of raceStates) {
    for (const coreId of race.existingPlannedOwnedCoreIds) {
      if (!knownCandidateIds.has(coreId)) {
        throw new Error(
          "Existing planned owned core must be present in the candidate set.",
        );
      }
    }
  }

  const allocatedByCore = new Map<string, string[]>(
    candidates.map((candidate) => [candidate.coreId, []]),
  );
  const eligible = candidates
    .filter(
      (candidate) =>
        candidate.disposition === "review_candidate" &&
        candidate.requestedInitialRaces > 0,
    )
    .sort(
      (left, right) =>
        left.leaderboardGroupId.localeCompare(right.leaderboardGroupId) ||
        left.configuredMetricRank - right.configuredMetricRank ||
        left.coreId.localeCompare(right.coreId),
    );

  for (const candidate of eligible) {
    const existingCount = raceStates.filter((race) =>
      race.existingPlannedOwnedCoreIds.includes(candidate.coreId),
    ).length;
    let remaining = Math.max(
      0,
      candidate.requestedInitialRaces - existingCount,
    );
    while (remaining > 0) {
      const race = raceStates.find(
        (item) =>
          item.existingPlannedOwnedCoreIds.length +
            item.suggestedCoreIds.length <
            item.maximumOwnedEntries &&
          !item.existingPlannedOwnedCoreIds.includes(candidate.coreId) &&
          !item.suggestedCoreIds.includes(candidate.coreId),
      );
      if (!race) break;
      race.suggestedCoreIds.push(candidate.coreId);
      allocatedByCore.get(candidate.coreId)!.push(race.racePlanId);
      remaining -= 1;
    }
  }

  const candidateResults: CandidateEntryAllocation[] = candidates
    .map((candidate) => {
      const existingRaceIds = raceStates
        .filter((race) =>
          race.existingPlannedOwnedCoreIds.includes(candidate.coreId),
        )
        .map((race) => race.racePlanId);
      const newRaceIds = allocatedByCore.get(candidate.coreId) ?? [];
      const racePlanIdsForCore = [...existingRaceIds, ...newRaceIds].sort();
      const allocatedInitialRaces = Math.min(
        candidate.requestedInitialRaces,
        racePlanIdsForCore.length,
      );
      const unallocatedInitialRaces =
        candidate.requestedInitialRaces - allocatedInitialRaces;
      const warnings = new Set<TournamentEntryAllocationWarning>();
      if (candidate.disposition === "hold") warnings.add("CANDIDATE_HELD");
      if (candidate.disposition === "preserve_me") warnings.add("PRESERVE_ME");
      if (candidate.disposition === "ineligible") {
        warnings.add("CANDIDATE_INELIGIBLE");
      }
      if (candidate.requestedInitialRaces === 0) {
        warnings.add("NO_REQUESTED_INITIAL_RACES");
      }
      if (unallocatedInitialRaces > 0) {
        warnings.add("REQUEST_EXCEEDS_PLANNED_CAPACITY");
      }
      return {
        coreId: candidate.coreId,
        leaderboardGroupId: candidate.leaderboardGroupId,
        configuredMetricRank: candidate.configuredMetricRank,
        disposition: candidate.disposition,
        requestedInitialRaces: candidate.requestedInitialRaces,
        allocatedInitialRaces,
        unallocatedInitialRaces,
        racePlanIds: racePlanIdsForCore,
        warnings: [...warnings].sort(),
        automaticEntryAllowed: false as const,
      };
    })
    .sort(
      (left, right) =>
        left.leaderboardGroupId.localeCompare(right.leaderboardGroupId) ||
        left.configuredMetricRank - right.configuredMetricRank ||
        left.coreId.localeCompare(right.coreId),
    );

  const races: PlannedRaceAllocation[] = raceStates.map((race) => {
    const totalPlannedOwnedEntries =
      race.existingPlannedOwnedCoreIds.length + race.suggestedCoreIds.length;
    const spareOwnedCapacity =
      race.maximumOwnedEntries - totalPlannedOwnedEntries;
    return {
      racePlanId: race.racePlanId,
      gateCount: race.gateCount,
      maximumOwnedEntries: race.maximumOwnedEntries,
      existingPlannedOwnedCoreIds: [...race.existingPlannedOwnedCoreIds].sort(),
      suggestedCoreIds: [...race.suggestedCoreIds],
      totalPlannedOwnedEntries,
      spareOwnedCapacity,
      spareCapacityDeliberatelyUnfilled: spareOwnedCapacity > 0,
      requiresLiveFieldConfirmation: true,
    };
  });

  return {
    tournamentId,
    bracketId,
    races,
    candidates: candidateResults,
    capRule: "owned_entries_at_most_half_of_gates",
    allocationObjective: "requested_initial_evidence_only",
    capacityTarget: false,
    liveOccupancyAvailable: false,
    gateCRequired: true,
    actionableRecommendationAllowed: false,
    automaticEntryAllowed: false,
  };
}
