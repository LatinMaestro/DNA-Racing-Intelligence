import { raceModes, type RaceMode } from "@/domain/core-performance";
import type { FreshnessState } from "@/domain/freshness";
import { elements, type CoreClass, type Element } from "@/domain/game-rules";
import {
  proLeagueCurrentRules,
  requiredProLeagueFemaleCount,
} from "@/domain/pro-league-roster";

export type ProLeagueBenchmarkAssessment =
  | "winning_range"
  | "top_three_range"
  | "outside_top_three_range"
  | "not_available";

export type ProLeaguePerformanceProfile = Readonly<{
  mode: RaceMode;
  distanceMetres: number;
  raceCount: number;
  sampleStatus: "hypothesis_only" | "minimally_analytical";
  freshness: FreshnessState;
  dataCurrentThrough: string;
  benchmarkAssessment: ProLeagueBenchmarkAssessment;
}>;

export type ProLeaguePayoutFormatProfile = Readonly<{
  mode: RaceMode;
  payoutFormatKey: string;
  payoutFormatLabel: string;
  raceCount: number;
  winCount: number;
  topThreeCount: number;
  exactDistanceCount: number;
  timedRaceCount: number;
  sampleStatus: "hypothesis_only" | "minimally_supported";
  freshness: FreshnessState;
  dataCurrentThrough: string;
}>;

export type ProLeaguePreparationCore = Readonly<{
  coreId: string;
  displayName: string;
  coreClass: CoreClass;
  element: Element;
  sex: "male" | "female";
  fNumber: number;
  performanceProfiles: readonly ProLeaguePerformanceProfile[];
  payoutFormatProfiles: readonly ProLeaguePayoutFormatProfile[];
}>;

export type ProLeaguePowerTier =
  "bike_winning_range" | "bike_top_three_range" | "unproven";

export type ProLeagueCandidate = Readonly<{
  coreId: string;
  displayName: string;
  coreClass: CoreClass;
  element: Element;
  sex: "male" | "female";
  fNumber: number;
  totalRaceCount: number;
  modesObserved: readonly RaceMode[];
  analyticalModes: readonly RaceMode[];
  analyticalDistances: number;
  winningRangeModes: readonly RaceMode[];
  topThreeOrBetterModes: readonly RaceMode[];
  winningRangeDistances: number;
  topThreeOrBetterDistances: number;
  evidenceFreshness: FreshnessState;
  dataCurrentThrough: string | null;
  payoutFormatProfiles: readonly ProLeaguePayoutFormatProfile[];
  supportedPayoutFormatCount: number;
  powerTier: ProLeaguePowerTier;
  discoveryPriority: "high" | "medium" | "maintain";
  reasons: readonly string[];
}>;

export type ProLeagueElementPreparation = Readonly<{
  element: Element;
  totalOwned: number;
  genesisOwned: number;
  nonGenesisOwned: number;
  femaleOwned: number;
  f15PlusOwned: number;
  bikeStrongOwned: number;
  rosterFloorGap: number;
  nonGenesisDepthGap: number;
  powerDepthGap: number;
  breedingPriority: "critical" | "quality" | "maintain";
  breedingGuidance: string;
}>;

export type ProLeaguePreparation = Readonly<{
  rulesetId: string;
  evidenceStatus: "owner_confirmed";
  genesisInterpretationStatus: "confirmed";
  performanceAuthority: "shared_dna_racing_core_stats";
  raceMode: "bike";
  selectionObjective: "most_powerful_bike_exact_distance_and_format";
  formatEvidenceStatus: "descriptive_context_connected";
  mintStrategy: "no_additional_genesis_mint";
  ownedCoreCount: number;
  femaleCount: number;
  f15PlusCount: number;
  selectableUnderGenesisCaps: number;
  structuralPoolReady: boolean;
  structuralIssues: readonly string[];
  elements: readonly ProLeagueElementPreparation[];
  discoveryQueue: readonly ProLeagueCandidate[];
  overallPowerPool: readonly ProLeagueCandidate[];
  teamCandidatePools: Readonly<Record<Element, readonly ProLeagueCandidate[]>>;
  breeding: Readonly<{
    femaleGap: number;
    femaleOutcomeTargetable: false;
    aboveF15Gap: number;
    minimumParentFSumForAboveF15: 16;
    genesisMintExcluded: true;
    qualityObjective: "elite_all_rounder_upside";
  }>;
  unresolvedRules: readonly string[];
}>;

const offspringGuidance: Readonly<Record<Element, string>> = {
  Metal: "Metal target: use an otherwise eligible Metal × Metal pairing.",
  Fire: "Fire target: use Fire × Fire or Metal × Fire.",
  Earth:
    "Earth target: use an Earth parent with Metal, Fire or Earth; avoid Water if Earth is the target.",
  Water:
    "Water target: any otherwise eligible pairing with a Water parent produces Water.",
};

const powerTierOrder: Readonly<Record<ProLeaguePowerTier, number>> = {
  bike_winning_range: 0,
  bike_top_three_range: 1,
  unproven: 2,
};

const freshnessRisk: Readonly<Record<FreshnessState, number>> = {
  current: 0,
  ageing: 1,
  stale: 2,
  unknown: 3,
};

function rankingEligible(profile: ProLeaguePerformanceProfile): boolean {
  return (
    profile.sampleStatus === "minimally_analytical" &&
    (profile.freshness === "current" || profile.freshness === "ageing")
  );
}

function formatEvidenceEligible(
  profile: ProLeaguePayoutFormatProfile,
): boolean {
  return (
    profile.sampleStatus === "minimally_supported" &&
    (profile.freshness === "current" || profile.freshness === "ageing")
  );
}

function conservativeFreshness(
  profiles: readonly ProLeaguePerformanceProfile[],
): FreshnessState {
  if (profiles.length === 0) return "unknown";
  return profiles.reduce<FreshnessState>(
    (worst, profile) =>
      freshnessRisk[profile.freshness] > freshnessRisk[worst]
        ? profile.freshness
        : worst,
    "current",
  );
}

function countByElement(
  cores: readonly ProLeaguePreparationCore[],
  predicate: (core: ProLeaguePreparationCore) => boolean = () => true,
): Record<Element, number> {
  return Object.fromEntries(
    elements.map((element) => [
      element,
      cores.filter((core) => core.element === element && predicate(core))
        .length,
    ]),
  ) as Record<Element, number>;
}

function modeList(
  profiles: readonly ProLeaguePerformanceProfile[],
  predicate: (profile: ProLeaguePerformanceProfile) => boolean,
): readonly RaceMode[] {
  return raceModes.filter((mode) =>
    profiles.some((profile) => profile.mode === mode && predicate(profile)),
  );
}

function powerTier(
  winningRangeDistances: number,
  topThreeOrBetterDistances: number,
): ProLeaguePowerTier {
  if (winningRangeDistances > 0) return "bike_winning_range";
  if (topThreeOrBetterDistances > 0) return "bike_top_three_range";
  return "unproven";
}

function assess(
  core: ProLeaguePreparationCore,
  needs: Readonly<{
    female: boolean;
    f15: boolean;
    element: Readonly<Record<Element, boolean>>;
    nonGenesis: Readonly<Record<Element, boolean>>;
  }>,
): ProLeagueCandidate {
  const performanceProfiles = core.performanceProfiles.filter(
    ({ mode }) => mode === proLeagueCurrentRules.raceMode,
  );
  const totalRaceCount = performanceProfiles.reduce(
    (total, profile) => total + profile.raceCount,
    0,
  );
  const modesObserved = modeList(performanceProfiles, () => true);
  const analyticalModes = modeList(
    performanceProfiles,
    ({ sampleStatus }) => sampleStatus === "minimally_analytical",
  );
  const analyticalDistances = performanceProfiles.filter(
    ({ sampleStatus }) => sampleStatus === "minimally_analytical",
  ).length;
  const winningRangeModes = modeList(
    performanceProfiles,
    (profile) =>
      rankingEligible(profile) &&
      profile.benchmarkAssessment === "winning_range",
  );
  const topThreeOrBetterModes = modeList(
    performanceProfiles,
    (profile) =>
      rankingEligible(profile) &&
      (profile.benchmarkAssessment === "winning_range" ||
        profile.benchmarkAssessment === "top_three_range"),
  );
  const winningRangeDistances = performanceProfiles.filter(
    (profile) =>
      rankingEligible(profile) &&
      profile.benchmarkAssessment === "winning_range",
  ).length;
  const topThreeOrBetterDistances = performanceProfiles.filter(
    (profile) =>
      rankingEligible(profile) &&
      (profile.benchmarkAssessment === "winning_range" ||
        profile.benchmarkAssessment === "top_three_range"),
  ).length;
  const evidenceFreshness = conservativeFreshness(performanceProfiles);
  const payoutFormatProfiles = core.payoutFormatProfiles
    .filter(({ mode }) => mode === proLeagueCurrentRules.raceMode)
    .sort(
      (a, b) =>
        a.mode.localeCompare(b.mode) ||
        a.payoutFormatLabel.localeCompare(b.payoutFormatLabel),
    );
  const supportedPayoutFormatCount = payoutFormatProfiles.filter(
    formatEvidenceEligible,
  ).length;
  const dataCurrentThrough =
    performanceProfiles.length === 0
      ? null
      : [...performanceProfiles]
          .map((profile) => profile.dataCurrentThrough)
          .sort()[0]!;
  const tier = powerTier(winningRangeDistances, topThreeOrBetterDistances);
  const missingBikeEvidence = analyticalModes.length === 0;
  const positivePowerSignal = topThreeOrBetterDistances > 0;
  const promisingHypothesis = performanceProfiles.some(
    ({ benchmarkAssessment }) =>
      benchmarkAssessment === "winning_range" ||
      benchmarkAssessment === "top_three_range",
  );
  const scarceRole =
    needs.element[core.element] ||
    (needs.nonGenesis[core.element] && core.coreClass !== "Genesis") ||
    (needs.female && core.sex === "female") ||
    (needs.f15 && core.fNumber >= 15);
  const reasons: string[] = [];

  if (positivePowerSignal && missingBikeEvidence) {
    reasons.push(
      "Positive Bike benchmark evidence exists, but no exact distance has a minimally analytical sample; use lineage-informed Bike Discovery to deepen the best hypotheses.",
    );
  } else if (missingBikeEvidence) {
    reasons.push(
      "No Bike distance has a minimally analytical sample; develop promising Bike hypotheses without blanket testing every distance.",
    );
  } else {
    reasons.push(
      "Bike has minimally analytical exact-distance evidence; focus further Discovery on Bike power gaps, adjacent distances and payout-format robustness.",
    );
  }
  if (winningRangeModes.length > 0) {
    reasons.push(
      `Winning-range evidence is present in ${winningRangeModes.join(", ")}.`,
    );
  } else if (topThreeOrBetterModes.length > 0) {
    reasons.push(
      `Top-three-range evidence is present in ${topThreeOrBetterModes.join(", ")}.`,
    );
  }
  if (core.sex === "female") {
    reasons.push("Supports the published eight-female roster floor.");
  }
  if (core.fNumber > 15) {
    reasons.push(
      "Supports the owner-confirmed two-Core above-F15 roster floor.",
    );
  }
  if (core.coreClass !== "Genesis") {
    reasons.push(
      "Non-Genesis depth preserves flexibility under the confirmed per-element Genesis cap.",
    );
  }
  if (supportedPayoutFormatCount > 0) {
    reasons.push(
      `${supportedPayoutFormatCount} fresh payout-format profile(s) have at least 10 accepted races; treat their win and Top-3 rates as descriptive context only.`,
    );
  } else if (payoutFormatProfiles.length > 0) {
    reasons.push(
      "Payout-format history exists but is too small or stale for supported format context; keep it hypothesis-only.",
    );
  }

  return {
    coreId: core.coreId,
    displayName: core.displayName,
    coreClass: core.coreClass,
    element: core.element,
    sex: core.sex,
    fNumber: core.fNumber,
    totalRaceCount,
    modesObserved,
    analyticalModes,
    analyticalDistances,
    winningRangeModes,
    topThreeOrBetterModes,
    winningRangeDistances,
    topThreeOrBetterDistances,
    evidenceFreshness,
    dataCurrentThrough,
    payoutFormatProfiles,
    supportedPayoutFormatCount,
    powerTier: tier,
    discoveryPriority:
      (positivePowerSignal || promisingHypothesis) && missingBikeEvidence
        ? "high"
        : missingBikeEvidence || scarceRole
          ? "medium"
          : "maintain",
    reasons,
  };
}

function comparePower(a: ProLeagueCandidate, b: ProLeagueCandidate): number {
  return (
    powerTierOrder[a.powerTier] - powerTierOrder[b.powerTier] ||
    b.winningRangeModes.length - a.winningRangeModes.length ||
    b.topThreeOrBetterModes.length - a.topThreeOrBetterModes.length ||
    b.winningRangeDistances - a.winningRangeDistances ||
    b.topThreeOrBetterDistances - a.topThreeOrBetterDistances ||
    b.analyticalModes.length - a.analyticalModes.length ||
    b.analyticalDistances - a.analyticalDistances ||
    b.totalRaceCount - a.totalRaceCount ||
    Number(b.sex === "female") - Number(a.sex === "female") ||
    Number(b.fNumber > 15) - Number(a.fNumber > 15) ||
    a.coreId.localeCompare(b.coreId)
  );
}

export function buildProLeaguePreparation(
  input: readonly ProLeaguePreparationCore[],
): ProLeaguePreparation {
  if (!Array.isArray(input)) {
    throw new Error("Pro League preparation pool must be an array.");
  }
  const ids = new Set<string>();
  for (const core of input) {
    if (core.coreId.trim() === "" || core.displayName.trim() === "") {
      throw new Error("Pro League preparation core identity is invalid.");
    }
    if (ids.has(core.coreId)) {
      throw new Error("Pro League preparation core IDs must be unique.");
    }
    ids.add(core.coreId);
    if (!elements.includes(core.element)) {
      throw new Error("Pro League preparation element is invalid.");
    }
    if (!Number.isSafeInteger(core.fNumber) || core.fNumber <= 0) {
      throw new Error("Pro League preparation F-number is invalid.");
    }
    if (!Array.isArray(core.performanceProfiles)) {
      throw new Error("Pro League performance profiles must be an array.");
    }
    if (!Array.isArray(core.payoutFormatProfiles)) {
      throw new Error("Pro League payout-format profiles must be an array.");
    }
  }

  const totals = countByElement(input);
  const genesis = countByElement(
    input,
    ({ coreClass }) => coreClass === "Genesis",
  );
  const nonGenesis = countByElement(
    input,
    ({ coreClass }) => coreClass !== "Genesis",
  );
  const females = countByElement(input, ({ sex }) => sex === "female");
  const f15 = countByElement(input, ({ fNumber }) => fNumber > 15);
  const femaleCount = input.filter(({ sex }) => sex === "female").length;
  const f15PlusCount = input.filter(({ fNumber }) => fNumber > 15).length;
  const minimumViableFemaleCount = requiredProLeagueFemaleCount(
    proLeagueCurrentRules.minimumRosterSize,
  );
  const needs = {
    female: femaleCount < minimumViableFemaleCount,
    f15: f15PlusCount < proLeagueCurrentRules.minimumAboveF15,
    element: Object.fromEntries(
      elements.map((element) => [element, false]),
    ) as Record<Element, boolean>,
    nonGenesis: Object.fromEntries(
      elements.map((element) => [element, false]),
    ) as Record<Element, boolean>,
  };
  const candidates = input.map((core) => assess(core, needs));
  const candidateById = new Map(
    candidates.map((candidate) => [candidate.coreId, candidate] as const),
  );

  const elementPreparation = elements.map(
    (element): ProLeagueElementPreparation => {
      const rosterFloorGap = 0;
      const nonGenesisDepthGap = 0;
      const bikeStrongOwned = input.filter((core) => {
        if (core.element !== element) return false;
        const candidate = candidateById.get(core.coreId);
        return (
          candidate !== undefined && candidate.topThreeOrBetterDistances > 0
        );
      }).length;
      const powerDepthGap = Math.max(0, 1 - bikeStrongOwned);
      return {
        element,
        totalOwned: totals[element],
        genesisOwned: genesis[element],
        nonGenesisOwned: nonGenesis[element],
        femaleOwned: females[element],
        f15PlusOwned: f15[element],
        bikeStrongOwned,
        rosterFloorGap,
        nonGenesisDepthGap,
        powerDepthGap,
        breedingPriority: powerDepthGap > 0 ? "quality" : "maintain",
        breedingGuidance: offspringGuidance[element],
      };
    },
  );

  const selectableUnderGenesisCaps = elements.reduce((total, element) => {
    const withinGenesisCap =
      nonGenesis[element] +
      Math.min(
        genesis[element],
        proLeagueCurrentRules.maximumGenesisPerElement,
      );
    return (
      total +
      Math.min(
        withinGenesisCap,
        proLeagueCurrentRules.maximumPerElement[element] ??
          proLeagueCurrentRules.maximumRosterSize,
      )
    );
  }, 0);
  const structuralIssues: string[] = [];
  if (femaleCount < minimumViableFemaleCount) {
    structuralIssues.push(
      `Owned pool is short ${minimumViableFemaleCount - femaleCount} female Core(s) for a minimum-size roster under the 32%-rounded-up rule.`,
    );
  }
  if (f15PlusCount < proLeagueCurrentRules.minimumAboveF15) {
    structuralIssues.push(
      `Owned pool is short ${proLeagueCurrentRules.minimumAboveF15 - f15PlusCount} Core(s) above F15.`,
    );
  }
  if (selectableUnderGenesisCaps < proLeagueCurrentRules.minimumRosterSize) {
    structuralIssues.push(
      `Only ${selectableUnderGenesisCaps} owned Cores remain selectable under the current element and Genesis ceilings, below the 12-Core roster floor.`,
    );
  }

  const priority = { high: 0, medium: 1, maintain: 2 } as const;
  const discoveryQueue = [...candidates].sort(
    (a, b) =>
      priority[a.discoveryPriority] - priority[b.discoveryPriority] ||
      comparePower(a, b),
  );
  const overallPowerPool = [...candidates].sort(comparePower);
  const teamCandidatePools: Record<Element, readonly ProLeagueCandidate[]> = {
    Metal: candidates
      .filter((core) => core.element === "Metal")
      .sort(comparePower),
    Fire: candidates
      .filter((core) => core.element === "Fire")
      .sort(comparePower),
    Earth: candidates
      .filter((core) => core.element === "Earth")
      .sort(comparePower),
    Water: candidates
      .filter((core) => core.element === "Water")
      .sort(comparePower),
  };

  return {
    rulesetId: proLeagueCurrentRules.rulesetId,
    evidenceStatus: "owner_confirmed",
    genesisInterpretationStatus: "confirmed",
    performanceAuthority: "shared_dna_racing_core_stats",
    raceMode: "bike",
    selectionObjective: "most_powerful_bike_exact_distance_and_format",
    formatEvidenceStatus: "descriptive_context_connected",
    mintStrategy: "no_additional_genesis_mint",
    ownedCoreCount: input.length,
    femaleCount,
    f15PlusCount,
    selectableUnderGenesisCaps,
    structuralPoolReady: structuralIssues.length === 0,
    structuralIssues,
    elements: elementPreparation,
    discoveryQueue,
    overallPowerPool,
    teamCandidatePools,
    breeding: {
      femaleGap: Math.max(0, minimumViableFemaleCount - femaleCount),
      femaleOutcomeTargetable: false,
      aboveF15Gap: Math.max(
        0,
        proLeagueCurrentRules.minimumAboveF15 - f15PlusCount,
      ),
      minimumParentFSumForAboveF15: 16,
      genesisMintExcluded: true,
      qualityObjective: "elite_all_rounder_upside",
    },
    unresolvedRules: [
      "Only four maps are currently published; no additional map is configured or assumed.",
      "The trial exposes conflicting third-map treatment after a home denial, so the actual match ruleset must be retained.",
      "Whether initial roster selection consumes the annual substitution allowance.",
      "Exact roster-lock and match-day Core replacement rules.",
      "Exact payout/race-format mix used by Pro League matches.",
      "Exact season schedule and promotion/relegation administration details.",
    ],
  };
}
