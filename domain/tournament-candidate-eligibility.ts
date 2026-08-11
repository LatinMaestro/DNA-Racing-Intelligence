npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
import type {
  TournamentEligibilityGroup,
  TournamentRuleConfiguration,
} from "@/domain/tournament-configuration";

export type TournamentCandidateCoreIdentity = Readonly<{
  coreId: string;
  coreClass: string;
  element: string;
  fNumber: number;
}>;

export type TournamentCandidateEligibilityProjection = Readonly<{
  eligibility: "eligible" | "ineligible" | "review_required";
  leaderboardGroupId: string;
  leaderboardGroupLabel: string;
}>;

const UNASSIGNED = {
  leaderboardGroupId: "unassigned",
  leaderboardGroupLabel: "Eligibility review required",
} as const;

function key(value: string): string {
  return value.trim().toLocaleLowerCase("en-AU");
}

function stringMatches(values: readonly string[], candidate: string): boolean {
  return (
    values.length === 0 || values.some((value) => key(value) === key(candidate))
  );
}

function fNumberMatches(
  exact: readonly number[],
  ranges: readonly Readonly<{ minimum: number; maximum: number }>[],
  candidate: number,
): boolean {
  return (
    (exact.length === 0 && ranges.length === 0) ||
    exact.includes(candidate) ||
    ranges.some(
      ({ minimum, maximum }) => candidate >= minimum && candidate <= maximum,
    )
  );
}

function classOrBreedMatches(
  breeds: readonly string[],
  classes: readonly string[],
  candidate: string,
): boolean {
  const configured = [...breeds, ...classes];
  return stringMatches(configured, candidate);
}

function groupMatches(
  group: TournamentEligibilityGroup,
  core: TournamentCandidateCoreIdentity,
): boolean {
  return (
    classOrBreedMatches(group.breeds, group.classes, core.coreClass) &&
    stringMatches(group.elements, core.element) &&
    fNumberMatches(group.fNumbers, group.fNumberRanges, core.fNumber)
  );
}

function configuredGroupMatchesValue(
  group: Readonly<{ id: string; label: string }>,
  value: string,
  alternatives: readonly string[] = [],
): boolean {
  const candidates = [value, ...alternatives].map(key);
  return (
    candidates.includes(key(group.id)) || candidates.includes(key(group.label))
  );
}

export function projectTournamentCandidateEligibility(
  rule: Pick<
    TournamentRuleConfiguration,
    "bracketId" | "splitLabel" | "eligibility" | "leaderboard"
  >,
  core: TournamentCandidateCoreIdentity,
): TournamentCandidateEligibilityProjection {
  if (
    core.coreId.trim() === "" ||
    core.coreClass.trim() === "" ||
    core.element.trim() === "" ||
    !Number.isSafeInteger(core.fNumber) ||
    core.fNumber <= 0
  ) {
    throw new Error("Tournament candidate Core identity is invalid.");
  }

  const globallyEligible =
    classOrBreedMatches(
      rule.eligibility.breeds,
      rule.eligibility.classes,
      core.coreClass,
    ) &&
    stringMatches(rule.eligibility.elements, core.element) &&
    fNumberMatches(
      rule.eligibility.fNumbers,
      rule.eligibility.fNumberRanges,
      core.fNumber,
    );
  if (!globallyEligible) {
    return {
      eligibility: "ineligible",
      leaderboardGroupId: "ineligible",
      leaderboardGroupLabel: "Ineligible for configured bracket",
    };
  }

  if (rule.eligibility.groups.length > 0) {
    const matchingGroups = rule.eligibility.groups.filter((group) =>
      groupMatches(group, core),
    );
    if (matchingGroups.length === 0) {
      return {
        eligibility: "ineligible",
        leaderboardGroupId: "ineligible",
        leaderboardGroupLabel: "Ineligible for configured groups",
      };
    }
    if (matchingGroups.length !== 1) {
      return { eligibility: "review_required", ...UNASSIGNED };
    }
    const eligibilityGroup = matchingGroups[0]!;
    const leaderboardGroup = rule.leaderboard.groups.find(
      (group) => group.id === eligibilityGroup.id,
    );
    if (leaderboardGroup === undefined) {
      return { eligibility: "review_required", ...UNASSIGNED };
    }
    return {
      eligibility: "eligible",
      leaderboardGroupId: leaderboardGroup.id,
      leaderboardGroupLabel: leaderboardGroup.label,
    };
  }

  const splitDimension = key(rule.leaderboard.splitDimension);
  if (splitDimension === "none") {
    if (rule.leaderboard.groups.length > 1) {
      return { eligibility: "review_required", ...UNASSIGNED };
    }
    const group = rule.leaderboard.groups[0];
    return group === undefined
      ? {
          eligibility: "eligible",
          leaderboardGroupId: rule.bracketId,
          leaderboardGroupLabel: rule.splitLabel,
        }
      : {
          eligibility: "eligible",
          leaderboardGroupId: group.id,
          leaderboardGroupLabel: group.label,
        };
  }

  const value =
    splitDimension === "element"
      ? core.element
      : ["breed", "class", "breed/class", "breed_class"].includes(
            splitDimension,
          )
        ? core.coreClass
        : ["f", "f-number", "f_number", "fnumber"].includes(splitDimension)
          ? String(core.fNumber)
          : null;
  if (value === null) {
    return { eligibility: "review_required", ...UNASSIGNED };
  }
  const alternatives =
    splitDimension === "f" ||
    splitDimension === "f-number" ||
    splitDimension === "f_number" ||
    splitDimension === "fnumber"
      ? [`F${core.fNumber}`]
      : [];
  const matches = rule.leaderboard.groups.filter((group) =>
    configuredGroupMatchesValue(group, value, alternatives),
  );
  if (matches.length !== 1) {
    return { eligibility: "review_required", ...UNASSIGNED };
  }
  return {
    eligibility: "eligible",
    leaderboardGroupId: matches[0]!.id,
    leaderboardGroupLabel: matches[0]!.label,
  };
}
npm notice
npm notice New minor version of npm available! 11.9.0 -> 11.19.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v11.19.0
npm notice To update run: npm install -g npm@11.19.0
npm notice
