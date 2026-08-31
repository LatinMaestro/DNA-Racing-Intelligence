import { proLeagueMaps, type ProLeagueMapId } from "@/domain/pro-league-maps";

export type ProLeagueTeamSide = "home" | "away";

export type ProLeagueThirdMapPolicy =
  "denied_map_excluded" | "denied_map_returns_to_random_pool";

export const proLeagueTrialOperationsAuthority = Object.freeze({
  authorityId: "dna-esports/trial-operations-observed-2026-08-29",
  evidenceStatus: "official_live_trial_and_owner_supplied_discord" as const,
  observedAt: "2026-08-29",
  appliesTo: "trial_only" as const,
  sources: Object.freeze({
    website: "https://esports.dnaracing.run/",
    pages: Object.freeze([
      "/",
      "/standings",
      "/maps",
      "/schedule",
      "/teams",
      "/all_teams",
      "/cores",
      "/legal",
      "/match/:matchId",
    ]),
    announcements: "owner_supplied_discord_posts",
  }),
  setup: Object.freeze({
    createTeamManually: true,
    setRosterManually: true,
    minimumRosterSize: 12,
    maximumRosterSize: 25,
    configureAllPublishedMaps: true,
    lineupsPersistAcrossMatches: true,
    lineupsEditableUntilMatchLock: true,
    lineupsLockedWhileMatchIsRunning: true,
    assignmentScopes: Object.freeze(["single_race", "same_type_and_distance"]),
  }),
  scheduling: Object.freeze({
    expectedNotice: "about_one_day" as const,
    trialDayPresentation: "one_week_tab_per_practice_day" as const,
    observedStates: Object.freeze([
      "scheduled",
      "awaiting_home_pick",
      "awaiting_away_pick",
      "maps_set",
      "locked",
      "live",
      "finished",
    ]),
  }),
  mapSelection: Object.freeze({
    homeAction: "pick_map_1_and_deny_one_map" as const,
    awayAction: "pick_map_2_after_home_action" as const,
    thirdMapPolicy: "match_ruleset_required" as const,
    missedHomeAction:
      "trial_observation_only_away_may_pick_when_home_deadline_is_missed" as const,
  }),
  standings: Object.freeze({
    winPoints: 3,
    drawPoints: 1,
    lossPoints: 0,
    tieBreakOrder: Object.freeze([
      "league_points",
      "event_wins",
      "race_point_differential",
      "race_points_won",
    ]),
    includesProAndLowerLeague: true,
  }),
  practiceOverrides: Object.freeze({
    ageing: "disabled" as const,
    rosterChanges: "unlimited_before_match_lock" as const,
    prizes: "trial_specific_not_permanent_league_authority" as const,
  }),
  unresolved: Object.freeze([
    "The live trial exposes both denied-map-excluded and denied-map-returned third-map wording; each match must retain the ruleset actually applied.",
    "The missed-pick fallback and exact deadline remain trial administration observations, not a permanent deterministic rule.",
    "The live trial female rule differs from the current owner-confirmed validator and does not supersede it without explicit authority.",
    "Real-league mapped race participation is ageing-bearing, while roster membership alone is not; exact increments, thresholds, roster-lock, substitution-counting and final administration rules remain versioned or unresolved.",
  ]),
});

export const proLeagueTrialMapGuidance = Object.freeze({
  evidenceStatus: "organizer_trial_guidance_not_predictive_authority" as const,
  Anchor:
    "Presented as suitable for smaller Vaults with a few strong Cores; shorter early lines and described as mostly power-related.",
  Glory:
    "Presented as the variance map; all Winner Take All formats and described as requiring win ability.",
  Measure:
    "Presented as the balanced map for rounded Vaults with depth across formats.",
  Miracles:
    "Presented as the depth-heavy map for large Vaults with strength across the full lineup.",
});

export type ProLeagueMapSelectionInput = Readonly<{
  policy: ProLeagueThirdMapPolicy;
  homeMapPick: ProLeagueMapId;
  homeDeniedMap: ProLeagueMapId;
  awayMapPick: ProLeagueMapId;
  thirdMap?: ProLeagueMapId;
}>;

export type ProLeagueMapSelection = Readonly<{
  policy: ProLeagueThirdMapPolicy;
  map1: ProLeagueMapId;
  map2: ProLeagueMapId;
  deniedMap: ProLeagueMapId;
  thirdMapCandidates: readonly ProLeagueMapId[];
  thirdMap: ProLeagueMapId | null;
  thirdMapResolution: "fixed_remaining_map" | "random_draw_required";
}>;

const publishedMapIds = Object.freeze(
  proLeagueMaps.map(({ mapId }) => mapId),
) as readonly ProLeagueMapId[];

function assertPublishedMap(mapId: ProLeagueMapId, label: string): void {
  if (!publishedMapIds.includes(mapId)) {
    throw new Error(`${label} must be one of the published Pro League maps.`);
  }
}

export function resolveProLeagueMapSelection(
  input: ProLeagueMapSelectionInput,
): ProLeagueMapSelection {
  assertPublishedMap(input.homeMapPick, "Home map pick");
  assertPublishedMap(input.homeDeniedMap, "Home denied map");
  assertPublishedMap(input.awayMapPick, "Away map pick");
  if (input.thirdMap !== undefined) {
    assertPublishedMap(input.thirdMap, "Third map");
  }
  if (input.homeMapPick === input.homeDeniedMap) {
    throw new Error("The home Vault cannot deny its selected first map.");
  }
  if (
    input.awayMapPick === input.homeMapPick ||
    input.awayMapPick === input.homeDeniedMap
  ) {
    throw new Error(
      "The away Vault must select its second map from the two maps left after the home pick and denial.",
    );
  }
  if (
    input.policy !== "denied_map_excluded" &&
    input.policy !== "denied_map_returns_to_random_pool"
  ) {
    throw new Error("The Pro League third-map policy is unsupported.");
  }

  const thirdMapCandidates = publishedMapIds.filter(
    (mapId) =>
      mapId !== input.homeMapPick &&
      mapId !== input.awayMapPick &&
      (input.policy === "denied_map_returns_to_random_pool" ||
        mapId !== input.homeDeniedMap),
  );
  if (
    input.thirdMap !== undefined &&
    !thirdMapCandidates.includes(input.thirdMap)
  ) {
    throw new Error("The third map is not allowed by this match ruleset.");
  }

  return Object.freeze({
    policy: input.policy,
    map1: input.homeMapPick,
    map2: input.awayMapPick,
    deniedMap: input.homeDeniedMap,
    thirdMapCandidates: Object.freeze(thirdMapCandidates),
    thirdMap: input.thirdMap ?? null,
    thirdMapResolution:
      thirdMapCandidates.length === 1
        ? "fixed_remaining_map"
        : "random_draw_required",
  });
}

export type ProLeagueMapScore = Readonly<{
  state: "in_progress" | "complete" | "catalogue_exhausted_without_winner";
  homeRacePoints: number;
  awayRacePoints: number;
  racesRun: number;
  winner: ProLeagueTeamSide | null;
  decidingRaceNumber: number | null;
}>;

function assertTeamSide(side: ProLeagueTeamSide): void {
  if (side !== "home" && side !== "away") {
    throw new Error("A Pro League race point must belong to home or away.");
  }
}

export function scoreProLeagueMap(
  racePointWinners: readonly ProLeagueTeamSide[],
): ProLeagueMapScore {
  if (!Array.isArray(racePointWinners) || racePointWinners.length > 42) {
    throw new Error("A Pro League map contains at most 42 race points.");
  }
  let homeRacePoints = 0;
  let awayRacePoints = 0;
  let winner: ProLeagueTeamSide | null = null;
  let decidingRaceNumber: number | null = null;

  racePointWinners.forEach((side, index) => {
    assertTeamSide(side);
    if (winner !== null) {
      throw new Error("A Pro League map cannot continue after it is won.");
    }
    if (side === "home") homeRacePoints += 1;
    else awayRacePoints += 1;
    if (
      Math.max(homeRacePoints, awayRacePoints) >= 16 &&
      Math.abs(homeRacePoints - awayRacePoints) >= 2
    ) {
      winner = homeRacePoints > awayRacePoints ? "home" : "away";
      decidingRaceNumber = index + 1;
    }
  });

  return Object.freeze({
    state:
      winner !== null
        ? "complete"
        : racePointWinners.length === 42
          ? "catalogue_exhausted_without_winner"
          : "in_progress",
    homeRacePoints,
    awayRacePoints,
    racesRun: racePointWinners.length,
    winner,
    decidingRaceNumber,
  });
}

export type ProLeagueMatchScore = Readonly<{
  state: "in_progress" | "complete";
  homeMapWins: number;
  awayMapWins: number;
  mapsRun: number;
  winner: ProLeagueTeamSide | null;
}>;

export function scoreProLeagueMatch(
  mapWinners: readonly ProLeagueTeamSide[],
): ProLeagueMatchScore {
  if (!Array.isArray(mapWinners) || mapWinners.length > 3) {
    throw new Error(
      "A best-of-three Pro League match contains at most 3 maps.",
    );
  }
  let homeMapWins = 0;
  let awayMapWins = 0;
  let winner: ProLeagueTeamSide | null = null;
  for (const side of mapWinners) {
    assertTeamSide(side);
    if (winner !== null) {
      throw new Error("A Pro League match cannot continue after two map wins.");
    }
    if (side === "home") homeMapWins += 1;
    else awayMapWins += 1;
    if (homeMapWins === 2 || awayMapWins === 2) {
      winner = homeMapWins === 2 ? "home" : "away";
    }
  }
  return Object.freeze({
    state: winner === null ? "in_progress" : "complete",
    homeMapWins,
    awayMapWins,
    mapsRun: mapWinners.length,
    winner,
  });
}
