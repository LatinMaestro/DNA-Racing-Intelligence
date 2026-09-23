import type { ProLeagueMapId } from "@/domain/pro-league-maps";

export const PRO_LEAGUE_OWNER_FINAL_PLAN_ID =
  "owner-final-roster/full-gate-win-first/2026-09-20" as const;

export type ProLeagueOwnerRosterPlanEntry = Readonly<{
  displayName: string;
  primaryDistances: readonly number[];
}>;

export const proLeagueOwnerFinalRosterPlan = Object.freeze([
  { displayName: "She’s Extreme", primaryDistances: [1000, 1400, 1600] },
  { displayName: "Swift Fist", primaryDistances: [1800, 2000] },
  { displayName: "Solar Surge", primaryDistances: [1000, 1200] },
  { displayName: "Phantom Panther", primaryDistances: [1400, 1600] },
  { displayName: "Scarlet Panther", primaryDistances: [1000, 1200, 1400] },
  { displayName: "Livid Jaguar", primaryDistances: [1200, 1400, 1600] },
  { displayName: "Zoey", primaryDistances: [1200, 1400, 1600, 1800] },
  { displayName: "Final Masquerade", primaryDistances: [2000, 2200] },
  {
    displayName: "Angry Dan isn't Fun",
    primaryDistances: [1400, 1600, 1800],
  },
  { displayName: "Frost Rocket", primaryDistances: [1000, 1200] },
  { displayName: "Legacy Runner", primaryDistances: [1800, 2200] },
  { displayName: "Nova Nectar", primaryDistances: [1600, 1800] },
  { displayName: "Flame Dash", primaryDistances: [1800, 2000, 2200] },
  { displayName: "Forge Serpent", primaryDistances: [2000, 2200] },
  { displayName: "Violet Jaguar", primaryDistances: [1800, 2000, 2200] },
  { displayName: "Drift Mirage", primaryDistances: [1000, 1400] },
  { displayName: "First Light", primaryDistances: [1600] },
  { displayName: "Flux Dagger", primaryDistances: [2000] },
  { displayName: "Better Luck Next Time", primaryDistances: [1600, 1800] },
  { displayName: "Grand Azula", primaryDistances: [1800, 2000, 2200] },
  { displayName: "Cursed Monolith", primaryDistances: [1600] },
  { displayName: "Spellbreaker", primaryDistances: [2200] },
  { displayName: "Peak Crown", primaryDistances: [2000, 2200] },
  { displayName: "Starline", primaryDistances: [1000, 1200, 1400] },
  { displayName: "Zero Mercy", primaryDistances: [2200] },
] as const satisfies readonly ProLeagueOwnerRosterPlanEntry[]);

// The owner confirmed this current exclusion during Preview review. It is
// independent of the still-unverified meaning of the API ageing source field.
export const proLeagueOwnerOverAgeingSubstitutionExclusions = Object.freeze([
  "Reese Dylan",
] as const);

export const PRO_LEAGUE_OWNER_DISTANCES = Object.freeze([
  1000, 1200, 1400, 1600, 1800, 2000, 2200,
] as const);
export type ProLeagueOwnerDistance =
  (typeof PRO_LEAGUE_OWNER_DISTANCES)[number];

export const proLeagueOwnerDistanceDepth: Readonly<
  Record<ProLeagueOwnerDistance, readonly string[]>
> = Object.freeze({
  1000: Object.freeze([
    "Solar Surge",
    "Frost Rocket",
    "Scarlet Panther",
    "Starline",
    "Drift Mirage",
    "Livid Jaguar",
    "Zoey",
    "Phantom Panther",
    "She’s Extreme",
    "Angry Dan isn't Fun",
    "Cursed Monolith",
    "First Light",
  ]),
  1200: Object.freeze([
    "Scarlet Panther",
    "Livid Jaguar",
    "Zoey",
    "Starline",
    "Solar Surge",
    "Frost Rocket",
    "Drift Mirage",
    "Phantom Panther",
    "She’s Extreme",
    "Angry Dan isn't Fun",
    "Cursed Monolith",
    "First Light",
  ]),
  1400: Object.freeze([
    "Phantom Panther",
    "Livid Jaguar",
    "Scarlet Panther",
    "Drift Mirage",
    "Zoey",
    "Angry Dan isn't Fun",
    "Starline",
    "She’s Extreme",
    "Cursed Monolith",
    "First Light",
    "Solar Surge",
    "Nova Nectar",
  ]),
  1600: Object.freeze([
    "Cursed Monolith",
    "Livid Jaguar",
    "Phantom Panther",
    "First Light",
    "She’s Extreme",
    "Zoey",
    "Angry Dan isn't Fun",
    "Nova Nectar",
    "Swift Fist",
    "Legacy Runner",
    "Scarlet Panther",
    "Starline",
  ]),
  1800: Object.freeze([
    "Swift Fist",
    "Zoey",
    "Angry Dan isn't Fun",
    "Nova Nectar",
    "Legacy Runner",
    "Grand Azula",
    "Better Luck Next Time",
    "Violet Jaguar",
    "Cursed Monolith",
    "Flame Dash",
    "Final Masquerade",
    "Forge Serpent",
  ]),
  2000: Object.freeze([
    "Final Masquerade",
    "Flame Dash",
    "Forge Serpent",
    "Flux Dagger",
    "Peak Crown",
    "Grand Azula",
    "Violet Jaguar",
    "Spellbreaker",
    "Zero Mercy",
    "Swift Fist",
    "Legacy Runner",
    "Nova Nectar",
  ]),
  2200: Object.freeze([
    "Final Masquerade",
    "Spellbreaker",
    "Forge Serpent",
    "Flame Dash",
    "Zero Mercy",
    "Peak Crown",
    "Grand Azula",
    "Legacy Runner",
    "Swift Fist",
    "Violet Jaguar",
    "Flux Dagger",
    "Zoey",
  ]),
});

export const proLeagueOwnerMapStrategy = Object.freeze({
  homePick: "map-1" as ProLeagueMapId,
  homeDeny: "map-4" as ProLeagueMapId,
  awayPriority: Object.freeze([
    "map-1",
    "map-3",
    "map-2",
    "map-4",
  ] as const satisfies readonly ProLeagueMapId[]),
  rosterDrivingMaps: Object.freeze([
    "map-1",
    "map-3",
    "map-2",
  ] as const satisfies readonly ProLeagueMapId[]),
  contingencyMap: "map-4" as ProLeagueMapId,
  first16Priority: true,
});

export function normalizeProLeagueOwnerCoreName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[’‘]/gu, "'")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en");
}

export function ownerPlanEntryByName(
  value: string,
): ProLeagueOwnerRosterPlanEntry | null {
  const normalized = normalizeProLeagueOwnerCoreName(value);
  return (
    proLeagueOwnerFinalRosterPlan.find(
      ({ displayName }) =>
        normalizeProLeagueOwnerCoreName(displayName) === normalized,
    ) ?? null
  );
}

export function ownerDistanceDepth(
  distanceMetres: number,
): readonly string[] | null {
  const distance = PRO_LEAGUE_OWNER_DISTANCES.find(
    (candidate) => candidate === distanceMetres,
  );
  return distance === undefined ? null : proLeagueOwnerDistanceDepth[distance];
}

export function ownerDistanceDepthRank(
  distanceMetres: number,
  displayName: string,
): number | null {
  const depth = ownerDistanceDepth(distanceMetres);
  if (depth === null) return null;
  const normalized = normalizeProLeagueOwnerCoreName(displayName);
  const index = depth.findIndex(
    (name) => normalizeProLeagueOwnerCoreName(name) === normalized,
  );
  return index < 0 ? null : index;
}
