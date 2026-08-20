import { raceModes, type RaceMode } from "@/domain/core-performance";
import type { FreshnessState } from "@/domain/freshness";
import { elements, type CoreClass, type Element } from "@/domain/game-rules";
import { proLeagueAnnouncementRules } from "@/domain/pro-league-roster";

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

export type ProLeaguePreparationCore = Readonly<{
  coreId: string;
  displayName: string;
  coreClass: CoreClass;
  element: Element;
  sex: "male" | "female";
  fNumber: number;
  performanceProfiles: readonly ProLeaguePerformanceProfile[];
}>;

export type ProLeaguePowerTier =
  | "multi_mode_winning_range"
  | "multi_mode_top_three_range"
  | "single_mode_winning_range"
  | "single_mode_top_three_range"
  | "unproven";

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
  multiModeStrongOwned: number;
  rosterFloorGap: number;
  nonGenesisDepthGap: number;
  powerDepthGap: number;
  breedingPriority: "critical" | "quality" | "maintain";
  breedingGuidance: string;
}>;

export type ProLeaguePreparation = Readonly<{
  rulesetId: string;
  evidenceStatus: "provisional";
  genesisInterpretationStatus: "working_interpretation";
  performanceAuthority: "shared_dna_racing_core_stats";
  selectionObjective: "most_powerful_overall_cross_mode_and_format";
  formatEvidenceStatus: "pending_bounded_rpayout_aggregate";
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
    f15PlusGap: number;
    minimumParentFSumForF15: 15;
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
  multi_mode_winning_range: 0,
  multi_mode_top_three_range: 1,
  single_mode_winning_range: 2,
  single_mode_top_three_range: 3,
  unproven: 4,
};

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
  winningRangeModes: readonly RaceMode[],
  topThreeOrBetterModes: readonly RaceMode[],
  winningRangeDistances: number,
  topThreeOrBetterDistances: number,
): ProLeaguePowerTier {
  if (winningRangeModes.length >= 2) return "multi_mode_winning_range";
  if (topThreeOrBetterModes.length >= 2) return "multi_mode_top_three_range";
  if (winningRangeDistances > 0) return "single_mode_winning_range";
  if (topThreeOrBetterDistances > 0) return "single_mode_top_three_range";
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
  const totalRaceCount = core.performanceProfiles.reduce(
    (total, profile) => total + profile.raceCount,
    0,
  );
  const modesObserved = modeList(core.performanceProfiles, () => true);
  const analyticalModes = modeList(
    core.performanceProfiles,
    ({ sampleStatus }) => sampleStatus === "minimally_analytical",
  );
  const analyticalDistances = core.performanceProfiles.filter(
    ({ sampleStatus }) => sampleStatus === "minimally_analytical",
  ).length;
  const winningRangeModes = modeList(
    core.performanceProfiles,
    ({ benchmarkAssessment }) => benchmarkAssessment === "winning_range",
  );
  const topThreeOrBetterModes = modeList(
    core.performanceProfiles,
    ({ benchmarkAssessment }) =>
      benchmarkAssessment === "winning_range" ||
      benchmarkAssessment === "top_three_range",
  );
  const winningRangeDistances = core.performanceProfiles.filter(
    ({ benchmarkAssessment }) => benchmarkAssessment === "winning_range",
  ).length;
  const topThreeOrBetterDistances = core.performanceProfiles.filter(
    ({ benchmarkAssessment }) =>
      benchmarkAssessment === "winning_range" ||
      benchmarkAssessment === "top_three_range",
  ).length;
  const tier = powerTier(
    winningRangeModes,
    topThreeOrBetterModes,
    winningRangeDistances,
    topThreeOrBetterDistances,
  );
  const missingAnalyticalModes = raceModes.length - analyticalModes.length;
  const positivePowerSignal = topThreeOrBetterDistances > 0;
  const scarceRole =
    needs.element[core.element] ||
    (needs.nonGenesis[core.element] && core.coreClass !== "Genesis") ||
    (needs.female && core.sex === "female") ||
    (needs.f15 && core.fNumber >= 15);
  const reasons: string[] = [];

  if (positivePowerSignal && missingAnalyticalModes > 0) {
    reasons.push(
      `Positive benchmark evidence exists, but only ${analyticalModes.length}/3 modes have minimally analytical exact-distance coverage; use lineage-informed Discovery to test the missing modes.`,
    );
  } else if (missingAnalyticalModes > 0) {
    reasons.push(
      `Only ${analyticalModes.length}/3 modes have minimally analytical exact-distance coverage; develop promising hypotheses without blanket testing every distance.`,
    );
  } else {
    reasons.push(
      "All three modes have at least one minimally analytical exact-distance sample; focus further Discovery on power gaps, adjacent distances and payout-format robustness.",
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
  if (core.fNumber >= 15) {
    reasons.push("Supports the published five-core F15+ roster floor.");
  }
  if (core.coreClass !== "Genesis") {
    reasons.push(
      "Non-Genesis depth preserves flexibility under the provisional per-element Genesis cap.",
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
    powerTier: tier,
    discoveryPriority:
      positivePowerSignal && missingAnalyticalModes > 0
        ? "high"
        : missingAnalyticalModes > 0 || scarceRole
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
    Number(b.fNumber >= 15) - Number(a.fNumber >= 15) ||
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
  const f15 = countByElement(input, ({ fNumber }) => fNumber >= 15);
  const femaleCount = input.filter(({ sex }) => sex === "female").length;
  const f15PlusCount = input.filter(({ fNumber }) => fNumber >= 15).length;
  const needs = {
    female: femaleCount < proLeagueAnnouncementRules.minimumFemales,
    f15: f15PlusCount < proLeagueAnnouncementRules.minimumF15Plus,
    element: Object.fromEntries(
      elements.map((element) => [
        element,
        totals[element] < proLeagueAnnouncementRules.minimumPerElement,
      ]),
    ) as Record<Element, boolean>,
    nonGenesis: Object.fromEntries(
      elements.map((element) => [
        element,
        nonGenesis[element] <
          proLeagueAnnouncementRules.minimumPerElement -
            proLeagueAnnouncementRules.maximumGenesisPerElement,
      ]),
    ) as Record<Element, boolean>,
  };
  const candidates = input.map((core) => assess(core, needs));
  const candidateById = new Map(
    candidates.map((candidate) => [candidate.coreId, candidate] as const),
  );

  const elementPreparation = elements.map(
    (element): ProLeagueElementPreparation => {
      const rosterFloorGap = Math.max(
        0,
        proLeagueAnnouncementRules.minimumPerElement - totals[element],
      );
      const nonGenesisDepthGap = Math.max(
        0,
        proLeagueAnnouncementRules.minimumPerElement -
          proLeagueAnnouncementRules.maximumGenesisPerElement -
          nonGenesis[element],
      );
      const multiModeStrongOwned = input.filter((core) => {
        if (core.element !== element) return false;
        const candidate = candidateById.get(core.coreId);
        return (
          candidate !== undefined && candidate.topThreeOrBetterModes.length >= 2
        );
      }).length;
      const powerDepthGap = Math.max(
        0,
        proLeagueAnnouncementRules.minimumPerElement - multiModeStrongOwned,
      );
      return {
        element,
        totalOwned: totals[element],
        genesisOwned: genesis[element],
        nonGenesisOwned: nonGenesis[element],
        femaleOwned: females[element],
        f15PlusOwned: f15[element],
        multiModeStrongOwned,
        rosterFloorGap,
        nonGenesisDepthGap,
        powerDepthGap,
        breedingPriority:
          rosterFloorGap > 0 || nonGenesisDepthGap > 0
            ? "critical"
            : powerDepthGap > 0
              ? "quality"
              : "maintain",
        breedingGuidance: offspringGuidance[element],
      };
    },
  );

  const selectableUnderGenesisCaps = elements.reduce(
    (total, element) =>
      total +
      nonGenesis[element] +
      Math.min(
        genesis[element],
        proLeagueAnnouncementRules.maximumGenesisPerElement,
      ),
    0,
  );
  const structuralIssues: string[] = [];
  for (const element of elementPreparation) {
    if (element.rosterFloorGap > 0) {
      structuralIssues.push(
        `${element.element} is short ${element.rosterFloorGap} core(s) against the five-core floor.`,
      );
    }
    if (element.nonGenesisDepthGap > 0) {
      structuralIssues.push(
        `${element.element} needs ${element.nonGenesisDepthGap} more non-Genesis core(s) to support five slots under the working two-Genesis cap.`,
      );
    }
  }
  if (femaleCount < proLeagueAnnouncementRules.minimumFemales) {
    structuralIssues.push(
      `Owned pool is short ${proLeagueAnnouncementRules.minimumFemales - femaleCount} female core(s).`,
    );
  }
  if (f15PlusCount < proLeagueAnnouncementRules.minimumF15Plus) {
    structuralIssues.push(
      `Owned pool is short ${proLeagueAnnouncementRules.minimumF15Plus - f15PlusCount} F15+ core(s).`,
    );
  }
  if (selectableUnderGenesisCaps < proLeagueAnnouncementRules.rosterSize) {
    structuralIssues.push(
      `Only ${selectableUnderGenesisCaps} owned cores remain selectable under the working Genesis caps, below 25.`,
    );
  }

  const priority = { high: 0, medium: 1, maintain: 2 } as const;
  const discoveryQueue = [...candidates].sort(
    (a, b) =>
      priority[a.discoveryPriority] - priority[b.discoveryPriority] ||
      comparePower(a, b),
  );
  const overallPowerPool = [...candidates].sort(comparePower);
  const teamCandidatePools = Object.fromEntries(
    elements.map((element) => [
      element,
      candidates.filter((core) => core.element === element).sort(comparePower),
    ]),
  ) as Record<Element, readonly ProLeagueCandidate[]>;

  return {
    rulesetId: proLeagueAnnouncementRules.rulesetId,
    evidenceStatus: "provisional",
    genesisInterpretationStatus: "working_interpretation",
    performanceAuthority: "shared_dna_racing_core_stats",
    selectionObjective: "most_powerful_overall_cross_mode_and_format",
    formatEvidenceStatus: "pending_bounded_rpayout_aggregate",
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
      femaleGap: Math.max(
        0,
        proLeagueAnnouncementRules.minimumFemales - femaleCount,
      ),
      femaleOutcomeTargetable: false,
      f15PlusGap: Math.max(
        0,
        proLeagueAnnouncementRules.minimumF15Plus - f15PlusCount,
      ),
      minimumParentFSumForF15: 15,
      genesisMintExcluded: true,
      qualityObjective: "elite_all_rounder_upside",
    },
    unresolvedRules: [
      "How the initial 12 Pro teams are selected versus entry through the lower league.",
      "Formal confirmation that the announcement shorthand 'gens' means Genesis cores.",
      "Exact Pro League map distances, track characteristics, roster lock/substitution and core-use rules.",
      "Exact payout/race-format mix used by Pro League matches.",
      "Registration dates, initial season timing and sponsorship administration details.",
    ],
  };
}
