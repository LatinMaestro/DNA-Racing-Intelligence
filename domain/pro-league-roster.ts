import type { CoreClass, CoreElement, CoreSex } from "@/domain/source-adapters";

export const proLeagueCurrentRules = Object.freeze({
  rulesetId: "dna-pro-league/owner-confirmed-2026-08-29",
  evidenceStatus: "owner_confirmed" as const,
  sourceLabel:
    "Owner-confirmed DNA Pro League rules, Bike-only, matchup and female-percentage clarification",
  raceMode: "bike" as const,
  receivedAt: "2026-08-29",
  matchup: Object.freeze({
    vaultsPerMatch: 2,
    gateAllocation: "equal_halves" as const,
    homeVaultAction: "pick_map_1_and_deny_one_map" as const,
    awayVaultAction: "pick_map_2_after_home_action" as const,
    thirdMapPolicy: "match_ruleset_required" as const,
    mappedCoresMustComeFromRoster: true,
  }),
  minimumRosterSize: 12,
  maximumRosterSize: 25,
  maximumSubstitutionsPerYear: 10,
  initialRosterCountsAsSubstitutions: "unresolved" as const,
  maximumPerElement: Object.freeze({
    Metal: 7,
    Fire: 8,
    Earth: 10,
    Water: null,
  }) satisfies Readonly<Record<CoreElement, number | null>>,
  maximumGenesisPerElement: 2,
  maximumF5OrBelow: 5,
  maximumF10OrBelow: 12,
  minimumAboveF15: 2,
  femaleMinimum: Object.freeze({
    kind: "percentage_rounded_up" as const,
    percentage: 32,
  }),
  namesRequired: true,
});

export const proLeagueTrialObservedRosterRules = Object.freeze({
  rulesetId: "dna-pro-league/live-trial-observed-2026-08-29",
  evidenceStatus: "official_live_trial_observation" as const,
  appliesTo: "trial_only" as const,
  controlsCurrentValidation: false,
  femaleRulePromotedToCurrentAuthority: true,
  ageing: "disabled_for_practice" as const,
  rosterChanges: "unlimited_for_practice_before_match_lock" as const,
  femaleRuleStatus:
    "The observed 32%-rounded-up rule is now owner-confirmed current validation authority.",
});

export function requiredProLeagueFemaleCount(rosterSize: number): number {
  if (
    !Number.isSafeInteger(rosterSize) ||
    rosterSize < 0 ||
    rosterSize > 1_000_000
  ) {
    throw new Error("Pro League roster size must be a non-negative integer.");
  }
  return Math.ceil(
    (rosterSize * proLeagueCurrentRules.femaleMinimum.percentage) / 100,
  );
}

export type ProLeagueRosterCore = Readonly<{
  coreId: string;
  displayName: string;
  element: CoreElement;
  coreClass: CoreClass;
  sex: CoreSex;
  fNumber: number;
  inMyVault: boolean;
}>;

export type ProLeagueRosterIssue =
  | Readonly<{
      code: "DUPLICATE_CORE" | "NOT_IN_MY_VAULT" | "CORE_NAME_REQUIRED";
      coreId: string;
      detail: string;
    }>
  | Readonly<{
      code:
        | "ROSTER_MINIMUM"
        | "ROSTER_MAXIMUM"
        | "ELEMENT_MAXIMUM"
        | "GENESIS_ELEMENT_CAP"
        | "F5_OR_BELOW_MAXIMUM"
        | "F10_OR_BELOW_MAXIMUM"
        | "ABOVE_F15_MINIMUM"
        | "FEMALE_MINIMUM";
      element: CoreElement | null;
      actual: number;
      required: number;
      detail: string;
    }>;

export type ProLeagueRosterAudit = Readonly<{
  rulesetId: string;
  evidenceStatus: "owner_confirmed";
  readiness: "compliant" | "incomplete";
  selectedCoreCount: number;
  elementCounts: Readonly<Record<CoreElement, number>>;
  genesisCounts: Readonly<Record<CoreElement, number>>;
  femaleCount: number;
  f5OrBelowCount: number;
  f10OrBelowCount: number;
  aboveF15Count: number;
  issues: readonly ProLeagueRosterIssue[];
}>;

const elements = ["Metal", "Fire", "Earth", "Water"] as const;

function blankElementCounts(): Record<CoreElement, number> {
  return { Metal: 0, Fire: 0, Earth: 0, Water: 0 };
}

function normalizedCore(core: ProLeagueRosterCore): ProLeagueRosterCore {
  const coreId = core.coreId.trim();
  if (coreId === "") {
    throw new Error("Pro League roster Core ID must not be blank.");
  }
  if (!elements.includes(core.element)) {
    throw new Error("Pro League roster element is unsupported.");
  }
  if (
    !Number.isSafeInteger(core.fNumber) ||
    core.fNumber < 1 ||
    core.fNumber > 1_000_000
  ) {
    throw new Error("Pro League roster F-number is invalid.");
  }
  return { ...core, coreId, displayName: core.displayName.trim() };
}

export function auditProLeagueRoster(
  roster: readonly ProLeagueRosterCore[],
): ProLeagueRosterAudit {
  if (!Array.isArray(roster)) {
    throw new Error("Pro League roster must be an array.");
  }
  const normalized = roster.map(normalizedCore);
  const elementCounts = blankElementCounts();
  const genesisCounts = blankElementCounts();
  const issues: ProLeagueRosterIssue[] = [];
  const seen = new Set<string>();
  let selectedCoreCount = 0;
  let femaleCount = 0;
  let f5OrBelowCount = 0;
  let f10OrBelowCount = 0;
  let aboveF15Count = 0;

  for (const core of normalized) {
    if (seen.has(core.coreId)) {
      issues.push({
        code: "DUPLICATE_CORE",
        coreId: core.coreId,
        detail: `Core ${core.coreId} is selected more than once.`,
      });
      continue;
    }
    seen.add(core.coreId);
    if (!core.inMyVault) {
      issues.push({
        code: "NOT_IN_MY_VAULT",
        coreId: core.coreId,
        detail: `Core ${core.coreId} is not in My Vault.`,
      });
      continue;
    }
    selectedCoreCount += 1;
    if (core.displayName === "") {
      issues.push({
        code: "CORE_NAME_REQUIRED",
        coreId: core.coreId,
        detail: `Core ${core.coreId} must be named before it can join the roster.`,
      });
    }
    elementCounts[core.element] += 1;
    if (core.coreClass === "Genesis") genesisCounts[core.element] += 1;
    if (core.sex === "female") femaleCount += 1;
    if (core.fNumber <= 5) f5OrBelowCount += 1;
    if (core.fNumber <= 10) f10OrBelowCount += 1;
    if (core.fNumber > 15) aboveF15Count += 1;
  }

  if (selectedCoreCount < proLeagueCurrentRules.minimumRosterSize) {
    issues.push({
      code: "ROSTER_MINIMUM",
      element: null,
      actual: selectedCoreCount,
      required: proLeagueCurrentRules.minimumRosterSize,
      detail: `Select at least ${proLeagueCurrentRules.minimumRosterSize} unique owned Cores.`,
    });
  }
  if (selectedCoreCount > proLeagueCurrentRules.maximumRosterSize) {
    issues.push({
      code: "ROSTER_MAXIMUM",
      element: null,
      actual: selectedCoreCount,
      required: proLeagueCurrentRules.maximumRosterSize,
      detail: `Select no more than ${proLeagueCurrentRules.maximumRosterSize} unique owned Cores.`,
    });
  }
  for (const element of elements) {
    const maximum = proLeagueCurrentRules.maximumPerElement[element];
    if (maximum !== null && elementCounts[element] > maximum) {
      issues.push({
        code: "ELEMENT_MAXIMUM",
        element,
        actual: elementCounts[element],
        required: maximum,
        detail: `${element} exceeds its ${maximum}-Core roster ceiling.`,
      });
    }
    if (
      genesisCounts[element] > proLeagueCurrentRules.maximumGenesisPerElement
    ) {
      issues.push({
        code: "GENESIS_ELEMENT_CAP",
        element,
        actual: genesisCounts[element],
        required: proLeagueCurrentRules.maximumGenesisPerElement,
        detail: `${element} exceeds the two-Genesis-per-element ceiling.`,
      });
    }
  }
  if (f5OrBelowCount > proLeagueCurrentRules.maximumF5OrBelow) {
    issues.push({
      code: "F5_OR_BELOW_MAXIMUM",
      element: null,
      actual: f5OrBelowCount,
      required: proLeagueCurrentRules.maximumF5OrBelow,
      detail: `The roster may contain at most ${proLeagueCurrentRules.maximumF5OrBelow} Cores at F5 or below.`,
    });
  }
  if (f10OrBelowCount > proLeagueCurrentRules.maximumF10OrBelow) {
    issues.push({
      code: "F10_OR_BELOW_MAXIMUM",
      element: null,
      actual: f10OrBelowCount,
      required: proLeagueCurrentRules.maximumF10OrBelow,
      detail: `The roster may contain at most ${proLeagueCurrentRules.maximumF10OrBelow} Cores at F10 or below.`,
    });
  }
  if (aboveF15Count < proLeagueCurrentRules.minimumAboveF15) {
    issues.push({
      code: "ABOVE_F15_MINIMUM",
      element: null,
      actual: aboveF15Count,
      required: proLeagueCurrentRules.minimumAboveF15,
      detail: `The roster requires at least ${proLeagueCurrentRules.minimumAboveF15} Cores above F15.`,
    });
  }
  const requiredFemaleCount = requiredProLeagueFemaleCount(selectedCoreCount);
  if (femaleCount < requiredFemaleCount) {
    issues.push({
      code: "FEMALE_MINIMUM",
      element: null,
      actual: femaleCount,
      required: requiredFemaleCount,
      detail: `At least ${proLeagueCurrentRules.femaleMinimum.percentage}% of the roster must be female, rounded up: ${requiredFemaleCount} female Cores for ${selectedCoreCount} rostered Cores.`,
    });
  }

  return {
    rulesetId: proLeagueCurrentRules.rulesetId,
    evidenceStatus: "owner_confirmed",
    readiness: issues.length === 0 ? "compliant" : "incomplete",
    selectedCoreCount,
    elementCounts,
    genesisCounts,
    femaleCount,
    f5OrBelowCount,
    f10OrBelowCount,
    aboveF15Count,
    issues,
  };
}
