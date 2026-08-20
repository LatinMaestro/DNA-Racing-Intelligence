import type { CoreClass, CoreElement, CoreSex } from "@/domain/source-adapters";

export const proLeagueAnnouncementRules = Object.freeze({
  rulesetId: "dna-pro-league/community-update-2026-08-20",
  evidenceStatus: "provisional" as const,
  sourceLabel: "DNA Community Update supplied by the owner",
  receivedAt: "2026-08-20",
  publicAccessEstimate: "2026-09-01",
  primaryMode: "bike" as const,
  rosterSize: 25,
  minimumPerElement: 5,
  maximumGenesisPerElement: 2,
  minimumFemales: 8,
  minimumF15Plus: 5,
});

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
      code: "DUPLICATE_CORE" | "NOT_IN_MY_VAULT";
      coreId: string;
      detail: string;
    }>
  | Readonly<{
      code:
        | "ROSTER_SIZE"
        | "ELEMENT_MINIMUM"
        | "GENESIS_ELEMENT_CAP"
        | "FEMALE_MINIMUM"
        | "F15_PLUS_MINIMUM";
      element: CoreElement | null;
      actual: number;
      required: number;
      detail: string;
    }>;

export type ProLeagueBreedingPriority = Readonly<{
  priorityId: string;
  target: "element" | "female" | "f15_plus";
  element: CoreElement | null;
  remaining: number;
  guidance: string;
}>;

export type ProLeagueRosterAudit = Readonly<{
  rulesetId: string;
  evidenceStatus: "provisional";
  readiness: "compliant" | "incomplete";
  selectedCoreCount: number;
  elementCounts: Readonly<Record<CoreElement, number>>;
  genesisCounts: Readonly<Record<CoreElement, number>>;
  femaleCount: number;
  f15PlusCount: number;
  issues: readonly ProLeagueRosterIssue[];
  breedingPriorities: readonly ProLeagueBreedingPriority[];
}>;

const elements = ["Metal", "Fire", "Earth", "Water"] as const;

function blankElementCounts(): Record<CoreElement, number> {
  return { Metal: 0, Fire: 0, Earth: 0, Water: 0 };
}

function normalizedCore(core: ProLeagueRosterCore): ProLeagueRosterCore {
  const coreId = core.coreId.trim();
  const displayName = core.displayName.trim();
  if (coreId === "" || displayName === "") {
    throw new Error("Pro League roster identity must not be blank.");
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
  return { ...core, coreId, displayName };
}

function breedingPriorities(input: {
  elementCounts: Readonly<Record<CoreElement, number>>;
  femaleCount: number;
  f15PlusCount: number;
}): readonly ProLeagueBreedingPriority[] {
  const priorities: ProLeagueBreedingPriority[] = [];
  for (const element of elements) {
    const remaining = Math.max(
      0,
      proLeagueAnnouncementRules.minimumPerElement -
        input.elementCounts[element],
    );
    if (remaining > 0) {
      priorities.push({
        priorityId: "element-" + element.toLowerCase(),
        target: "element",
        element,
        remaining,
        guidance:
          "Review owned breeding pairs with evidence relevant to " +
          element +
          " outcomes. Element inheritance has not been confirmed by this announcement, so treat every outcome as uncertain until supported by game evidence.",
      });
    }
  }
  const femaleRemaining = Math.max(
    0,
    proLeagueAnnouncementRules.minimumFemales - input.femaleCount,
  );
  if (femaleRemaining > 0) {
    priorities.push({
      priorityId: "female",
      target: "female",
      element: null,
      remaining: femaleRemaining,
      guidance:
        "Prioritise review of breeding evidence that could improve the female roster pool. Sex outcome is not guaranteed by the announcement.",
    });
  }
  const f15Remaining = Math.max(
    0,
    proLeagueAnnouncementRules.minimumF15Plus - input.f15PlusCount,
  );
  if (f15Remaining > 0) {
    priorities.push({
      priorityId: "f15-plus",
      target: "f15_plus",
      element: null,
      remaining: f15Remaining,
      guidance:
        "Prioritise review of owned pairings with supported F-number evidence that could expand the F15+ pool. Do not infer offspring F-number rules from this announcement.",
    });
  }
  return priorities;
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
  let ownedSelectedCount = 0;
  let femaleCount = 0;
  let f15PlusCount = 0;

  for (const core of normalized) {
    if (seen.has(core.coreId)) {
      issues.push({
        code: "DUPLICATE_CORE",
        coreId: core.coreId,
        detail: "Core " + core.coreId + " is selected more than once.",
      });
      continue;
    }
    seen.add(core.coreId);
    if (!core.inMyVault) {
      issues.push({
        code: "NOT_IN_MY_VAULT",
        coreId: core.coreId,
        detail:
          "Core " +
          core.coreId +
          " is not in the owner-maintained My Vault registry.",
      });
      continue;
    }
    ownedSelectedCount += 1;
    elementCounts[core.element] += 1;
    if (core.coreClass === "Genesis") genesisCounts[core.element] += 1;
    if (core.sex === "female") femaleCount += 1;
    if (core.fNumber >= 15) f15PlusCount += 1;
  }

  if (ownedSelectedCount !== proLeagueAnnouncementRules.rosterSize) {
    issues.push({
      code: "ROSTER_SIZE",
      element: null,
      actual: ownedSelectedCount,
      required: proLeagueAnnouncementRules.rosterSize,
      detail:
        "Select exactly " +
        proLeagueAnnouncementRules.rosterSize +
        " unique owned cores.",
    });
  }
  for (const element of elements) {
    if (elementCounts[element] < proLeagueAnnouncementRules.minimumPerElement) {
      issues.push({
        code: "ELEMENT_MINIMUM",
        element,
        actual: elementCounts[element],
        required: proLeagueAnnouncementRules.minimumPerElement,
        detail:
          element +
          " requires at least " +
          proLeagueAnnouncementRules.minimumPerElement +
          " roster cores.",
      });
    }
    if (
      genesisCounts[element] >
      proLeagueAnnouncementRules.maximumGenesisPerElement
    ) {
      issues.push({
        code: "GENESIS_ELEMENT_CAP",
        element,
        actual: genesisCounts[element],
        required: proLeagueAnnouncementRules.maximumGenesisPerElement,
        detail: element + " exceeds the provisional two-Genesis hard cap.",
      });
    }
  }
  if (femaleCount < proLeagueAnnouncementRules.minimumFemales) {
    issues.push({
      code: "FEMALE_MINIMUM",
      element: null,
      actual: femaleCount,
      required: proLeagueAnnouncementRules.minimumFemales,
      detail:
        "The roster requires at least " +
        proLeagueAnnouncementRules.minimumFemales +
        " females.",
    });
  }
  if (f15PlusCount < proLeagueAnnouncementRules.minimumF15Plus) {
    issues.push({
      code: "F15_PLUS_MINIMUM",
      element: null,
      actual: f15PlusCount,
      required: proLeagueAnnouncementRules.minimumF15Plus,
      detail:
        "The roster requires at least " +
        proLeagueAnnouncementRules.minimumF15Plus +
        " F15+ cores.",
    });
  }

  return {
    rulesetId: proLeagueAnnouncementRules.rulesetId,
    evidenceStatus: "provisional",
    readiness: issues.length === 0 ? "compliant" : "incomplete",
    selectedCoreCount: ownedSelectedCount,
    elementCounts,
    genesisCounts,
    femaleCount,
    f15PlusCount,
    issues,
    breedingPriorities: breedingPriorities({
      elementCounts,
      femaleCount,
      f15PlusCount,
    }),
  };
}
