import {
  coreClasses,
  elements,
  type CoreClass,
  type Element,
} from "@/domain/game-rules";
import type { FreshnessState } from "@/domain/freshness";

export const esportsProLeagueRulesetVersion =
  "dna-community-update-pro-esports-v1" as const;

export const esportsProLeagueRosterRequirements = Object.freeze({
  rosterSize: 25,
  minimumPerElement: Object.freeze({
    Metal: 5,
    Fire: 5,
    Earth: 5,
    Water: 5,
  }) satisfies Readonly<Record<Element, number>>,
  maximumGenesisPerElement: 2,
  minimumFemales: 8,
  minimumF15Plus: 5,
  currentMode: "bike" as const,
});

export type EsportsRosterSex = "male" | "female";

export type EsportsBikePriorProfile = Readonly<{
  distanceMetres: number;
  raceCount: number;
  sampleStatus: "hypothesis_only" | "minimally_analytical";
  freshness: FreshnessState;
  dataCurrentThrough: string;
}>;

export type EsportsRosterCandidateInput = Readonly<{
  coreId: string;
  displayName: string;
  coreClass: CoreClass;
  element: Element;
  fNumber: number;
  sex: EsportsRosterSex;
  bikeProfiles: readonly EsportsBikePriorProfile[];
}>;

export type EsportsBikePriorStatus =
  | "absent"
  | "developing"
  | "minimally_analytical";

export type EsportsCandidateAssessment = Readonly<{
  coreId: string;
  displayName: string;
  coreClass: CoreClass;
  element: Element;
  fNumber: number;
  sex: EsportsRosterSex;
  isGenesis: boolean;
  isFemale: boolean;
  isF15Plus: boolean;
  bikePriorStatus: EsportsBikePriorStatus;
  totalDnaRacingBikeRaces: number;
  bikeDistancesObserved: number;
  minimallyAnalyticalBikeDistances: number;
  underTestedBikeDistances: number;
  latestBikeDataCurrentThrough: string | null;
  discoveryPriority: "high" | "medium" | "maintain";
  discoveryReasons: readonly string[];
  teamSelectionTier:
    | "bike_prior_ready"
    | "bike_prior_developing"
    | "structural_depth_only";
}>;

export type EsportsElementPoolStatus = Readonly<{
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
  breedingPriority: "critical" | "development" | "maintain";
  deterministicOffspringElementGuidance: string;
}>;

export type EsportsRosterValidation = Readonly<{
  valid: boolean;
  selectedCount: number;
  femaleCount: number;
  f15PlusCount: number;
  elementCounts: Readonly<Record<Element, number>>;
  genesisCounts: Readonly<Record<Element, number>>;
  issues: readonly string[];
}>;

export type EsportsProLeaguePreparation = Readonly<{
  rulesetVersion: typeof esportsProLeagueRulesetVersion;
  announcementStatus: "published_initial_information_only";
  performanceEvidenceStatus: "dna_racing_bike_history_is_prior_only";
  ownerStrategy: Readonly<{
    specialGenesisMintPlanned: false;
    acquisitionStrategy: "existing_vault_plus_breeding";
  }>;
  requirements: typeof esportsProLeagueRosterRequirements;
  ownedCoreCount: number;
  femalePoolCount: number;
  f15PlusPoolCount: number;
  selectableCoreCountUnderGenesisCaps: number;
  structuralPoolChecksPass: boolean;
  structuralPoolIssues: readonly string[];
  elementPools: readonly EsportsElementPoolStatus[];
  candidates: readonly EsportsCandidateAssessment[];
  discoveryQueue: readonly EsportsCandidateAssessment[];
  teamCandidatePools: Readonly<
    Record<Element, readonly EsportsCandidateAssessment[]>
  >;
  breedingPlan: Readonly<{
    femaleRequirementGap: number;
    femaleOutcomeIsNotDeterministicallyTargetable: true;
    f15PlusRequirementGap: number;
    f15BreedingRule: "offspring_f_number_is_parent_sum";
    minimumParentFSumForF15Target: 15;
    genesisMintExcluded: true;
    elementTargets: readonly EsportsElementPoolStatus[];
  }>;
  unresolvedPublishedDetails: readonly string[];
}>;

const safeIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const discoveryPriorityOrder = Object.freeze({
  high: 0,
  medium: 1,
  maintain: 2,
});
const teamTierOrder = Object.freeze({
  bike_prior_ready: 0,
  bike_prior_developing: 1,
  structural_depth_only: 2,
});

const offspringElementGuidance: Readonly<Record<Element, string>> =
  Object.freeze({
    Metal:
      "Metal offspring require Metal × Metal because offspring takes the lower-ranked parent element.",
    Fire: "Fire offspring require Fire × Fire or Metal × Fire.",
    Earth:
      "Earth offspring require at least one Earth parent and no Water parent (Metal/Fire/Earth × Earth).",
    Water: "Any eligible pairing with a Water parent produces Water offspring.",
  });

function required(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required.`);
  }
  const normalized = value.trim();
  if (!safeIdPattern.test(normalized) && label === "Core ID") {
    throw new Error("Core ID is invalid.");
  }
  return normalized;
}

function positiveSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function canonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical timestamp.`);
  }
  return value;
}

function normalizeCandidate(
  input: EsportsRosterCandidateInput,
): EsportsRosterCandidateInput {
  const coreId = required(input.coreId, "Core ID");
  const displayName = required(input.displayName, "Core name");
  if (!coreClasses.includes(input.coreClass)) {
    throw new Error("Core class is invalid.");
  }
  if (!elements.includes(input.element)) {
    throw new Error("Core element is invalid.");
  }
  if (input.sex !== "male" && input.sex !== "female") {
    throw new Error("Core sex is invalid.");
  }
  const fNumber = positiveSafeInteger(input.fNumber, "Core F-number");
  if (!Array.isArray(input.bikeProfiles)) {
    throw new Error("Bike prior profiles must be an array.");
  }
  const seenDistances = new Set<number>();
  const bikeProfiles = input.bikeProfiles.map((profile) => {
    const distanceMetres = positiveSafeInteger(
      profile.distanceMetres,
      "Bike prior distance",
    );
    if (seenDistances.has(distanceMetres)) {
      throw new Error("Bike prior distances must be unique per core.");
    }
    seenDistances.add(distanceMetres);
    const raceCount = positiveSafeInteger(profile.raceCount, "Bike race count");
    const expectedSampleStatus =
      raceCount >= 10 ? "minimally_analytical" : "hypothesis_only";
    if (profile.sampleStatus !== expectedSampleStatus) {
      throw new Error("Bike prior sample status does not match race count.");
    }
    if (
      !["current", "ageing", "stale", "unknown"].includes(profile.freshness)
    ) {
      throw new Error("Bike prior freshness is invalid.");
    }
    return {
      ...profile,
      distanceMetres,
      raceCount,
      dataCurrentThrough: canonicalTimestamp(
        profile.dataCurrentThrough,
        "Bike data current through",
      ),
    };
  });
  return { ...input, coreId, displayName, fNumber, bikeProfiles };
}

function latestTimestamp(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  return values.reduce((latest, value) =>
    Date.parse(value) > Date.parse(latest) ? value : latest,
  );
}

type DiscoveryNeeds = Readonly<{
  femaleNeeded: boolean;
  f15PlusNeeded: boolean;
  elementRosterNeeded: Readonly<Record<Element, boolean>>;
  nonGenesisNeeded: Readonly<Record<Element, boolean>>;
  bikePriorNeeded: Readonly<Record<Element, boolean>>;
}>;

function assessment(
  candidate: EsportsRosterCandidateInput,
  needs: DiscoveryNeeds,
): EsportsCandidateAssessment {
  const totalDnaRacingBikeRaces = candidate.bikeProfiles.reduce(
    (total, profile) => total + profile.raceCount,
    0,
  );
  const minimallyAnalyticalBikeDistances = candidate.bikeProfiles.filter(
    ({ sampleStatus }) => sampleStatus === "minimally_analytical",
  ).length;
  const underTestedBikeDistances = candidate.bikeProfiles.filter(
    ({ sampleStatus }) => sampleStatus === "hypothesis_only",
  ).length;
  const bikePriorStatus: EsportsBikePriorStatus =
    minimallyAnalyticalBikeDistances > 0
      ? "minimally_analytical"
      : totalDnaRacingBikeRaces > 0
        ? "developing"
        : "absent";
  const discoveryReasons: string[] = [];
  const fillsScarceStructuralRole =
    needs.elementRosterNeeded[candidate.element] ||
    (needs.nonGenesisNeeded[candidate.element] &&
      candidate.coreClass !== "Genesis") ||
    (needs.femaleNeeded && candidate.sex === "female") ||
    (needs.f15PlusNeeded && candidate.fNumber >= 15);
  const fillsBikeEvidenceGap = needs.bikePriorNeeded[candidate.element];

  if (bikePriorStatus === "absent") {
    discoveryReasons.push(
      "No DNA Racing Bike exact-distance prior is available; establish only targeted hypotheses rather than random racing.",
    );
  } else if (bikePriorStatus === "developing") {
    discoveryReasons.push(
      "Bike evidence exists but no exact distance has reached the 10-race minimally analytical boundary.",
    );
  }
  if (fillsBikeEvidenceGap) {
    discoveryReasons.push(
      `${candidate.element} has fewer than five owned cores with a minimally analytical DNA Racing Bike prior.`,
    );
  }
  if (candidate.sex === "female") {
    discoveryReasons.push(
      needs.femaleNeeded
        ? "Female roster depth currently contributes to closing the published minimum of eight."
        : "Female roster depth is strategically useful for the published minimum of eight.",
    );
  }
  if (candidate.fNumber >= 15) {
    discoveryReasons.push(
      needs.f15PlusNeeded
        ? "F15+ roster depth currently contributes to closing the published minimum of five."
        : "F15+ roster depth is strategically useful for the published minimum of five.",
    );
  }
  if (candidate.coreClass !== "Genesis") {
    discoveryReasons.push(
      needs.nonGenesisNeeded[candidate.element]
        ? `Additional non-Genesis ${candidate.element} depth is currently needed to make a five-core element group possible under the provisional two-Genesis cap.`
        : "A bred/non-Genesis core preserves flexibility under the published two-Genesis-per-element cap.",
    );
  }
  const discoveryPriority =
    bikePriorStatus === "minimally_analytical"
      ? "maintain"
      : fillsScarceStructuralRole || fillsBikeEvidenceGap
        ? "high"
        : "medium";

  return {
    coreId: candidate.coreId,
    displayName: candidate.displayName,
    coreClass: candidate.coreClass,
    element: candidate.element,
    fNumber: candidate.fNumber,
    sex: candidate.sex,
    isGenesis: candidate.coreClass === "Genesis",
    isFemale: candidate.sex === "female",
    isF15Plus: candidate.fNumber >= 15,
    bikePriorStatus,
    totalDnaRacingBikeRaces,
    bikeDistancesObserved: candidate.bikeProfiles.length,
    minimallyAnalyticalBikeDistances,
    underTestedBikeDistances,
    latestBikeDataCurrentThrough: latestTimestamp(
      candidate.bikeProfiles.map(({ dataCurrentThrough }) => dataCurrentThrough),
    ),
    discoveryPriority,
    discoveryReasons,
    teamSelectionTier:
      bikePriorStatus === "minimally_analytical"
        ? "bike_prior_ready"
        : bikePriorStatus === "developing"
          ? "bike_prior_developing"
          : "structural_depth_only",
  };
}

function countsByElement(
  candidates: readonly EsportsRosterCandidateInput[],
  predicate: (candidate: EsportsRosterCandidateInput) => boolean = () => true,
): Record<Element, number> {
  return Object.fromEntries(
    elements.map((element) => [
      element,
      candidates.filter(
        (candidate) => candidate.element === element && predicate(candidate),
      ).length,
    ]),
  ) as Record<Element, number>;
}

export function validateSelectedEsportsRoster(
  input: readonly EsportsRosterCandidateInput[],
): EsportsRosterValidation {
  if (!Array.isArray(input)) throw new Error("Selected roster must be an array.");
  const candidates = input.map(normalizeCandidate);
  const ids = new Set(candidates.map(({ coreId }) => coreId));
  if (ids.size !== candidates.length) {
    throw new Error("Selected roster core IDs must be unique.");
  }
  const elementCounts = countsByElement(candidates);
  const genesisCounts = countsByElement(
    candidates,
    ({ coreClass }) => coreClass === "Genesis",
  );
  const femaleCount = candidates.filter(({ sex }) => sex === "female").length;
  const f15PlusCount = candidates.filter(({ fNumber }) => fNumber >= 15).length;
  const issues: string[] = [];
  if (candidates.length !== esportsProLeagueRosterRequirements.rosterSize) {
    issues.push(
      `Roster must contain exactly ${esportsProLeagueRosterRequirements.rosterSize} cores.`,
    );
  }
  for (const element of elements) {
    if (
      elementCounts[element] <
      esportsProLeagueRosterRequirements.minimumPerElement[element]
    ) {
      issues.push(
        `${element} roster count is below the published minimum of ${esportsProLeagueRosterRequirements.minimumPerElement[element]}.`,
      );
    }
    if (
      genesisCounts[element] >
      esportsProLeagueRosterRequirements.maximumGenesisPerElement
    ) {
      issues.push(
        `${element} Genesis count exceeds the working interpretation of the published maximum of ${esportsProLeagueRosterRequirements.maximumGenesisPerElement} gens per element.`,
      );
    }
  }
  if (femaleCount < esportsProLeagueRosterRequirements.minimumFemales) {
    issues.push(
      `Female roster count is below the published minimum of ${esportsProLeagueRosterRequirements.minimumFemales}.`,
    );
  }
  if (f15PlusCount < esportsProLeagueRosterRequirements.minimumF15Plus) {
    issues.push(
      `F15+ roster count is below the published minimum of ${esportsProLeagueRosterRequirements.minimumF15Plus}.`,
    );
  }
  return {
    valid: issues.length === 0,
    selectedCount: candidates.length,
    femaleCount,
    f15PlusCount,
    elementCounts,
    genesisCounts,
    issues,
  };
}

export function prepareEsportsProLeague(
  input: readonly EsportsRosterCandidateInput[],
): EsportsProLeaguePreparation {
  if (!Array.isArray(input)) {
    throw new Error("Esports candidate pool must be an array.");
  }
  const candidates = input.map(normalizeCandidate);
  const ids = new Set(candidates.map(({ coreId }) => coreId));
  if (ids.size !== candidates.length) {
    throw new Error("Esports candidate pool core IDs must be unique.");
  }

  const totalByElement = countsByElement(candidates);
  const genesisByElement = countsByElement(
    candidates,
    ({ coreClass }) => coreClass === "Genesis",
  );
  const nonGenesisByElement = countsByElement(
    candidates,
    ({ coreClass }) => coreClass !== "Genesis",
  );
  const femaleByElement = countsByElement(
    candidates,
    ({ sex }) => sex === "female",
  );
  const f15ByElement = countsByElement(
    candidates,
    ({ fNumber }) => fNumber >= 15,
  );
  const bikeReadyByElement = countsByElement(candidates, (candidate) =>
    candidate.bikeProfiles.some(
      ({ sampleStatus }) => sampleStatus === "minimally_analytical",
    ),
  );

  const elementPools = elements.map((element): EsportsElementPoolStatus => {
    const rosterFloorGap = Math.max(
      0,
      esportsProLeagueRosterRequirements.minimumPerElement[element] -
        totalByElement[element],
    );
    const nonGenesisDepthGap = Math.max(0, 3 - nonGenesisByElement[element]);
    const bikePriorDepthGap = Math.max(0, 5 - bikeReadyByElement[element]);
    return {
      element,
      totalOwned: totalByElement[element],
      genesisOwned: genesisByElement[element],
      nonGenesisOwned: nonGenesisByElement[element],
      femaleOwned: femaleByElement[element],
      f15PlusOwned: f15ByElement[element],
      bikePriorReady: bikeReadyByElement[element],
      rosterFloorGap,
      nonGenesisDepthGap,
      bikePriorDepthGap,
      breedingPriority:
        rosterFloorGap > 0 || nonGenesisDepthGap > 0 ? "critical" : "maintain",
      deterministicOffspringElementGuidance: offspringElementGuidance[element],
    };
  });

  const femalePoolCount = candidates.filter(({ sex }) => sex === "female").length;
  const f15PlusPoolCount = candidates.filter(({ fNumber }) => fNumber >= 15).length;
  const discoveryNeeds: DiscoveryNeeds = {
    femaleNeeded:
      femalePoolCount < esportsProLeagueRosterRequirements.minimumFemales,
    f15PlusNeeded:
      f15PlusPoolCount < esportsProLeagueRosterRequirements.minimumF15Plus,
    elementRosterNeeded: Object.fromEntries(
      elements.map((element) => [element, totalByElement[element] < 5]),
    ) as Record<Element, boolean>,
    nonGenesisNeeded: Object.fromEntries(
      elements.map((element) => [element, nonGenesisByElement[element] < 3]),
    ) as Record<Element, boolean>,
    bikePriorNeeded: Object.fromEntries(
      elements.map((element) => [element, bikeReadyByElement[element] < 5]),
    ) as Record<Element, boolean>,
  };

  const assessed = candidates.map((candidate) =>
    assessment(candidate, discoveryNeeds),
  );
  const teamCandidatePools = Object.fromEntries(
    elements.map((element) => [
      element,
      assessed
        .filter((candidate) => candidate.element === element)
        .sort(
          (left, right) =>
            teamTierOrder[left.teamSelectionTier] -
              teamTierOrder[right.teamSelectionTier] ||
            right.minimallyAnalyticalBikeDistances -
              left.minimallyAnalyticalBikeDistances ||
            right.totalDnaRacingBikeRaces - left.totalDnaRacingBikeRaces ||
            Number(right.isFemale) - Number(left.isFemale) ||
            Number(right.isF15Plus) - Number(left.isF15Plus) ||
            left.coreId.localeCompare(right.coreId),
        ),
    ]),
  ) as Record<Element, readonly EsportsCandidateAssessment[]>;

  const selectableCoreCountUnderGenesisCaps = elements.reduce(
    (total, element) =>
      total +
      nonGenesisByElement[element] +
      Math.min(
        genesisByElement[element],
        esportsProLeagueRosterRequirements.maximumGenesisPerElement,
      ),
    0,
  );
  const structuralPoolIssues: string[] = [];
  for (const pool of elementPools) {
    if (pool.rosterFloorGap > 0) {
      structuralPoolIssues.push(
        `${pool.element} is short ${pool.rosterFloorGap} core(s) against the published five-core element floor.`,
      );
    }
    if (pool.nonGenesisDepthGap > 0) {
      structuralPoolIssues.push(
        `${pool.element} needs at least ${pool.nonGenesisDepthGap} more non-Genesis core(s) to make a five-core element group possible while respecting a two-Genesis cap.`,
      );
    }
  }
  if (femalePoolCount < esportsProLeagueRosterRequirements.minimumFemales) {
    structuralPoolIssues.push(
      `The owned pool is short ${esportsProLeagueRosterRequirements.minimumFemales - femalePoolCount} female core(s).`,
    );
  }
  if (f15PlusPoolCount < esportsProLeagueRosterRequirements.minimumF15Plus) {
    structuralPoolIssues.push(
      `The owned pool is short ${esportsProLeagueRosterRequirements.minimumF15Plus - f15PlusPoolCount} F15+ core(s).`,
    );
  }
  if (
    selectableCoreCountUnderGenesisCaps < esportsProLeagueRosterRequirements.rosterSize
  ) {
    structuralPoolIssues.push(
      `Only ${selectableCoreCountUnderGenesisCaps} owned cores are selectable after applying the working Genesis-per-element caps, below the 25-core roster size.`,
    );
  }

  const discoveryQueue = [...assessed].sort(
    (left, right) =>
      discoveryPriorityOrder[left.discoveryPriority] -
        discoveryPriorityOrder[right.discoveryPriority] ||
      left.minimallyAnalyticalBikeDistances -
        right.minimallyAnalyticalBikeDistances ||
      left.totalDnaRacingBikeRaces - right.totalDnaRacingBikeRaces ||
      left.coreId.localeCompare(right.coreId),
  );

  return {
    rulesetVersion: esportsProLeagueRulesetVersion,
    announcementStatus: "published_initial_information_only",
    performanceEvidenceStatus: "dna_racing_bike_history_is_prior_only",
    ownerStrategy: {
      specialGenesisMintPlanned: false,
      acquisitionStrategy: "existing_vault_plus_breeding",
    },
    requirements: esportsProLeagueRosterRequirements,
    ownedCoreCount: candidates.length,
    femalePoolCount,
    f15PlusPoolCount,
    selectableCoreCountUnderGenesisCaps,
    structuralPoolChecksPass: structuralPoolIssues.length === 0,
    structuralPoolIssues,
    elementPools,
    candidates: assessed,
    discoveryQueue,
    teamCandidatePools,
    breedingPlan: {
      femaleRequirementGap: Math.max(
        0,
        esportsProLeagueRosterRequirements.minimumFemales - femalePoolCount,
      ),
      femaleOutcomeIsNotDeterministicallyTargetable: true,
      f15PlusRequirementGap: Math.max(
        0,
        esportsProLeagueRosterRequirements.minimumF15Plus - f15PlusPoolCount,
      ),
      f15BreedingRule: "offspring_f_number_is_parent_sum",
      minimumParentFSumForF15Target: 15,
      genesisMintExcluded: true,
      elementTargets: elementPools,
    },
    unresolvedPublishedDetails: [
      "The route into the initial 12 Pro teams versus starting in the open lower league has not been published.",
      "The announcement says maximum 2 gens per element; the preparation model currently interprets gens as Genesis cores and will remain labelled provisional until formally clarified.",
      "Esports map distances, track characteristics, roster lock/substitution rules and per-map core-use rules have not been published.",
      "No evidence yet establishes that DNA Racing Bike times, stars or distance strengths transfer to the separate Esports system.",
      "No Esports results export, API or supported data-ingestion contract has been published yet.",
      "The timing and method for team registration, sponsorship administration and initial Pro-team selection have not been published.",
    ],
  };
}
