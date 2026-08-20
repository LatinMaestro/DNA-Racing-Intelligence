import type { FreshnessState } from "@/domain/freshness";
import { elements, type CoreClass, type Element } from "@/domain/game-rules";
import { proLeagueAnnouncementRules } from "@/domain/pro-league-roster";

export type ProLeagueBikePrior = Readonly<{
  distanceMetres: number;
  raceCount: number;
  sampleStatus: "hypothesis_only" | "minimally_analytical";
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
  bikeProfiles: readonly ProLeagueBikePrior[];
}>;

export type ProLeagueCandidate = Readonly<{
  coreId: string;
  displayName: string;
  coreClass: CoreClass;
  element: Element;
  sex: "male" | "female";
  fNumber: number;
  bikeRaceCount: number;
  analyticalBikeDistances: number;
  bikePriorStatus: "absent" | "developing" | "minimally_analytical";
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
  bikePriorReady: number;
  rosterFloorGap: number;
  nonGenesisDepthGap: number;
  bikePriorDepthGap: number;
  breedingPriority: "critical" | "maintain";
  breedingGuidance: string;
}>;

export type ProLeaguePreparation = Readonly<{
  rulesetId: string;
  evidenceStatus: "provisional";
  genesisInterpretationStatus: "working_interpretation";
  dnaRacingBikeEvidenceStatus: "prior_only_not_esports_performance";
  mintStrategy: "no_additional_genesis_mint";
  ownedCoreCount: number;
  femaleCount: number;
  f15PlusCount: number;
  selectableUnderGenesisCaps: number;
  structuralPoolReady: boolean;
  structuralIssues: readonly string[];
  elements: readonly ProLeagueElementPreparation[];
  discoveryQueue: readonly ProLeagueCandidate[];
  teamCandidatePools: Readonly<Record<Element, readonly ProLeagueCandidate[]>>;
  breeding: Readonly<{
    femaleGap: number;
    femaleOutcomeTargetable: false;
    f15PlusGap: number;
    minimumParentFSumForF15: 15;
    genesisMintExcluded: true;
  }>;
  unresolvedRules: readonly string[];
}>;

const offspringGuidance: Readonly<Record<Element, string>> = {
  Metal: "Metal target: use an otherwise eligible Metal × Metal pairing.",
  Fire: "Fire target: use Fire × Fire or Metal × Fire.",
  Earth: "Earth target: use an Earth parent with Metal, Fire or Earth; avoid Water if Earth is the target.",
  Water: "Water target: any otherwise eligible pairing with a Water parent produces Water.",
};

function countByElement(
  cores: readonly ProLeaguePreparationCore[],
  predicate: (core: ProLeaguePreparationCore) => boolean = () => true,
): Record<Element, number> {
  return Object.fromEntries(
    elements.map((element) => [
      element,
      cores.filter((core) => core.element === element && predicate(core)).length,
    ]),
  ) as Record<Element, number>;
}

function assess(
  core: ProLeaguePreparationCore,
  needs: Readonly<{
    female: boolean;
    f15: boolean;
    element: Readonly<Record<Element, boolean>>;
    nonGenesis: Readonly<Record<Element, boolean>>;
    bike: Readonly<Record<Element, boolean>>;
  }>,
): ProLeagueCandidate {
  const bikeRaceCount = core.bikeProfiles.reduce(
    (total, profile) => total + profile.raceCount,
    0,
  );
  const analyticalBikeDistances = core.bikeProfiles.filter(
    ({ sampleStatus }) => sampleStatus === "minimally_analytical",
  ).length;
  const bikePriorStatus =
    analyticalBikeDistances > 0
      ? "minimally_analytical"
      : bikeRaceCount > 0
        ? "developing"
        : "absent";
  const reasons: string[] = [];
  const scarceRole =
    needs.element[core.element] ||
    (needs.nonGenesis[core.element] && core.coreClass !== "Genesis") ||
    (needs.female && core.sex === "female") ||
    (needs.f15 && core.fNumber >= 15) ||
    needs.bike[core.element];

  if (bikePriorStatus === "absent") {
    reasons.push("No DNA Racing Bike prior; use targeted Discovery rather than random racing.");
  } else if (bikePriorStatus === "developing") {
    reasons.push("Bike evidence exists but no exact distance has reached the 10-race analytical minimum.");
  }
  if (needs.bike[core.element]) {
    reasons.push(`${core.element} needs deeper Bike-prior coverage for team selection.`);
  }
  if (core.sex === "female") reasons.push("Supports the published eight-female roster floor.");
  if (core.fNumber >= 15) reasons.push("Supports the published five-core F15+ roster floor.");
  if (core.coreClass !== "Genesis") {
    reasons.push("Non-Genesis depth preserves flexibility under the provisional per-element Genesis cap.");
  }

  return {
    coreId: core.coreId,
    displayName: core.displayName,
    coreClass: core.coreClass,
    element: core.element,
    sex: core.sex,
    fNumber: core.fNumber,
    bikeRaceCount,
    analyticalBikeDistances,
    bikePriorStatus,
    discoveryPriority:
      bikePriorStatus === "minimally_analytical"
        ? "maintain"
        : scarceRole
          ? "high"
          : "medium",
    reasons,
  };
}

export function buildProLeaguePreparation(
  input: readonly ProLeaguePreparationCore[],
): ProLeaguePreparation {
  if (!Array.isArray(input)) throw new Error("Pro League preparation pool must be an array.");
  const ids = new Set<string>();
  for (const core of input) {
    if (core.coreId.trim() === "" || core.displayName.trim() === "") {
      throw new Error("Pro League preparation core identity is invalid.");
    }
    if (ids.has(core.coreId)) throw new Error("Pro League preparation core IDs must be unique.");
    ids.add(core.coreId);
    if (!elements.includes(core.element)) throw new Error("Pro League preparation element is invalid.");
    if (!Number.isSafeInteger(core.fNumber) || core.fNumber <= 0) {
      throw new Error("Pro League preparation F-number is invalid.");
    }
  }

  const totals = countByElement(input);
  const genesis = countByElement(input, ({ coreClass }) => coreClass === "Genesis");
  const nonGenesis = countByElement(input, ({ coreClass }) => coreClass !== "Genesis");
  const females = countByElement(input, ({ sex }) => sex === "female");
  const f15 = countByElement(input, ({ fNumber }) => fNumber >= 15);
  const bikeReady = countByElement(input, (core) =>
    core.bikeProfiles.some(({ sampleStatus }) => sampleStatus === "minimally_analytical"),
  );
  const femaleCount = input.filter(({ sex }) => sex === "female").length;
  const f15PlusCount = input.filter(({ fNumber }) => fNumber >= 15).length;

  const elementPreparation = elements.map((element): ProLeagueElementPreparation => {
    const rosterFloorGap = Math.max(0, proLeagueAnnouncementRules.minimumPerElement - totals[element]);
    const nonGenesisDepthGap = Math.max(
      0,
      proLeagueAnnouncementRules.minimumPerElement -
        proLeagueAnnouncementRules.maximumGenesisPerElement -
        nonGenesis[element],
    );
    const bikePriorDepthGap = Math.max(0, 5 - bikeReady[element]);
    return {
      element,
      totalOwned: totals[element],
      genesisOwned: genesis[element],
      nonGenesisOwned: nonGenesis[element],
      femaleOwned: females[element],
      f15PlusOwned: f15[element],
      bikePriorReady: bikeReady[element],
      rosterFloorGap,
      nonGenesisDepthGap,
      bikePriorDepthGap,
      breedingPriority:
        rosterFloorGap > 0 || nonGenesisDepthGap > 0 ? "critical" : "maintain",
      breedingGuidance: offspringGuidance[element],
    };
  });

  const selectableUnderGenesisCaps = elements.reduce(
    (total, element) =>
      total +
      nonGenesis[element] +
      Math.min(genesis[element], proLeagueAnnouncementRules.maximumGenesisPerElement),
    0,
  );
  const structuralIssues: string[] = [];
  for (const element of elementPreparation) {
    if (element.rosterFloorGap > 0) {
      structuralIssues.push(`${element.element} is short ${element.rosterFloorGap} core(s) against the five-core floor.`);
    }
    if (element.nonGenesisDepthGap > 0) {
      structuralIssues.push(`${element.element} needs ${element.nonGenesisDepthGap} more non-Genesis core(s) to support five slots under the working two-Genesis cap.`);
    }
  }
  if (femaleCount < proLeagueAnnouncementRules.minimumFemales) {
    structuralIssues.push(`Owned pool is short ${proLeagueAnnouncementRules.minimumFemales - femaleCount} female core(s).`);
  }
  if (f15PlusCount < proLeagueAnnouncementRules.minimumF15Plus) {
    structuralIssues.push(`Owned pool is short ${proLeagueAnnouncementRules.minimumF15Plus - f15PlusCount} F15+ core(s).`);
  }
  if (selectableUnderGenesisCaps < proLeagueAnnouncementRules.rosterSize) {
    structuralIssues.push(`Only ${selectableUnderGenesisCaps} owned cores remain selectable under the working Genesis caps, below 25.`);
  }

  const needs = {
    female: femaleCount < proLeagueAnnouncementRules.minimumFemales,
    f15: f15PlusCount < proLeagueAnnouncementRules.minimumF15Plus,
    element: Object.fromEntries(elements.map((element) => [element, totals[element] < 5])) as Record<Element, boolean>,
    nonGenesis: Object.fromEntries(elements.map((element) => [element, nonGenesis[element] < 3])) as Record<Element, boolean>,
    bike: Object.fromEntries(elements.map((element) => [element, bikeReady[element] < 5])) as Record<Element, boolean>,
  };
  const candidates = input.map((core) => assess(core, needs));
  const priority = { high: 0, medium: 1, maintain: 2 } as const;
  const tier = { minimally_analytical: 0, developing: 1, absent: 2 } as const;
  const discoveryQueue = [...candidates].sort(
    (a, b) =>
      priority[a.discoveryPriority] - priority[b.discoveryPriority] ||
      a.analyticalBikeDistances - b.analyticalBikeDistances ||
      a.bikeRaceCount - b.bikeRaceCount ||
      a.coreId.localeCompare(b.coreId),
  );
  const teamCandidatePools = Object.fromEntries(
    elements.map((element) => [
      element,
      candidates
        .filter((core) => core.element === element)
        .sort(
          (a, b) =>
            tier[a.bikePriorStatus] - tier[b.bikePriorStatus] ||
            b.analyticalBikeDistances - a.analyticalBikeDistances ||
            b.bikeRaceCount - a.bikeRaceCount ||
            Number(b.sex === "female") - Number(a.sex === "female") ||
            Number(b.fNumber >= 15) - Number(a.fNumber >= 15) ||
            a.coreId.localeCompare(b.coreId),
        ),
    ]),
  ) as Record<Element, readonly ProLeagueCandidate[]>;

  return {
    rulesetId: proLeagueAnnouncementRules.rulesetId,
    evidenceStatus: "provisional",
    genesisInterpretationStatus: "working_interpretation",
    dnaRacingBikeEvidenceStatus: "prior_only_not_esports_performance",
    mintStrategy: "no_additional_genesis_mint",
    ownedCoreCount: input.length,
    femaleCount,
    f15PlusCount,
    selectableUnderGenesisCaps,
    structuralPoolReady: structuralIssues.length === 0,
    structuralIssues,
    elements: elementPreparation,
    discoveryQueue,
    teamCandidatePools,
    breeding: {
      femaleGap: Math.max(0, proLeagueAnnouncementRules.minimumFemales - femaleCount),
      femaleOutcomeTargetable: false,
      f15PlusGap: Math.max(0, proLeagueAnnouncementRules.minimumF15Plus - f15PlusCount),
      minimumParentFSumForF15: 15,
      genesisMintExcluded: true,
    },
    unresolvedRules: [
      "How the initial 12 Pro teams are selected versus entry through the lower league.",
      "Formal confirmation that the announcement shorthand 'gens' means Genesis cores.",
      "Map distances, track characteristics, roster lock/substitution and core-use rules.",
      "Whether DNA Racing Bike performance predicts the separate Esports system.",
      "An authoritative Esports results export, API or other ingestion source.",
      "Registration dates, initial season timing and sponsorship administration details.",
    ],
  };
}
