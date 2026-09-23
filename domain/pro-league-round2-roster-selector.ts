import { proLeagueMaps } from "@/domain/pro-league-maps";
import { type OwnedBikeCellScreen } from "@/domain/pro-league-owned-bike-pace";
import {
  auditProLeagueRoster,
  type ProLeagueRosterCore,
} from "@/domain/pro-league-roster";
import {
  buildRound2FullGateDraft,
  verifiedRound2BikeAgeing,
  type Round2FullGateDraft,
  type Round2VerifiedCandidate,
} from "@/domain/pro-league-round2-full-gate-draft";

type SelectedExplanation = Readonly<{
  coreId: string;
  displayName: string;
  eliteCellCount: number;
  weightedMarginalGain: number;
  bikeAgeingUsedUpperBound: number;
  ageingEvidence: "exact_balance" | "verified_band";
}>;

export type Round2RebuildDraft = Readonly<{
  authority: "advisory_complete_owned_pool_and_official_pace";
  selectionMethod: "weighted_distance_projection_gate_depth_with_first16_priority";
  inspectedOwnedCoreCount: number;
  excludedCandidateCount: number;
  selected: readonly SelectedExplanation[];
  lineup: Round2FullGateDraft;
}>;

function key(
  cell: Pick<OwnedBikeCellScreen, "raceType" | "distanceMetres" | "gateCount">,
): string {
  return JSON.stringify([
    cell.raceType
      .trim()
      .toLowerCase()
      .replaceAll("_", " ")
      .replace(/\s+/gu, " "),
    cell.distanceMetres,
    cell.gateCount,
  ]);
}

const demands = proLeagueMaps.flatMap((map) =>
  map.races.map((race) => ({
    key: key({
      raceType: race.raceType,
      distanceMetres: race.distanceMetres,
      gateCount: race.totalGateEntries,
    }),
    gateEntriesPerVault: race.gateEntriesPerVault,
    weight: race.raceNumber <= 16 ? 4 : 1,
  })),
);

const power: Readonly<Record<OwnedBikeCellScreen["status"], number>> = {
  elite_range: 3,
  positive_range: 1,
  provisional: 0,
  outside: 0,
};

function candidatePower(
  candidate: Round2VerifiedCandidate,
): ReadonlyMap<string, number> {
  const values = new Map<string, number>();
  for (const cell of candidate.cells) {
    const id = key(cell);
    if (values.has(id))
      throw new Error("Round 2 candidate has duplicate official cells.");
    values.set(id, power[cell.status]);
  }
  return values;
}

function potentialCore(
  candidate: Round2VerifiedCandidate,
  currentThrough: string,
): {
  ageingUsedUpperBound: number;
  ageingEvidence: "exact_balance" | "verified_band";
  power: ReadonlyMap<string, number>;
} | null {
  const core = candidate.core;
  if (
    candidate.completeOwnedBikeHistory !== true ||
    core.coreClass === "Genesis" ||
    core.displayName.trim().toLowerCase() === "reese dylan" ||
    !core.inMyVault ||
    !core.displayName.trim()
  )
    return null;
  let ageing;
  try {
    ageing = verifiedRound2BikeAgeing(candidate, currentThrough);
  } catch {
    return null;
  }
  if (!candidate.cells.some((cell) => cell.status === "elite_range"))
    return null;
  return {
    ageingUsedUpperBound: ageing.usedUpperBound,
    ageingEvidence: ageing.evidence,
    power: candidatePower(candidate),
  };
}

function withinCaps(
  selected: readonly ProLeagueRosterCore[],
  next: ProLeagueRosterCore,
): boolean {
  const joined = [...selected, next];
  const audit = auditProLeagueRoster(joined);
  // A partial roster legitimately has minimum-size and minimum-female issues.
  return !audit.issues.some(
    (issue) =>
      issue.code !== "ROSTER_MINIMUM" &&
      issue.code !== "FEMALE_MINIMUM" &&
      issue.code !== "ABOVE_F15_MINIMUM",
  );
}

function marginalGain(
  selected: readonly ReadonlyMap<string, number>[],
  addition: ReadonlyMap<string, number>,
): number {
  let gain = 0;
  for (const demand of demands) {
    const values = selected
      .map((value) => value.get(demand.key) ?? 0)
      .sort((left, right) => right - left)
      .slice(0, demand.gateEntriesPerVault);
    const threshold =
      values.length < demand.gateEntriesPerVault ? 0 : values.at(-1)!;
    gain +=
      demand.weight * Math.max(0, (addition.get(demand.key) ?? 0) - threshold);
  }
  return gain;
}

/** No fixed owner roster, write path or game action is involved. */
export function buildRound2NewRosterAndLineup(input: {
  completeOwnedPool: true;
  ownerVaultCoreCount: number;
  owned: readonly Round2VerifiedCandidate[];
  currentThrough: string;
}): Round2RebuildDraft {
  if (
    input.completeOwnedPool !== true ||
    !Number.isSafeInteger(input.ownerVaultCoreCount) ||
    input.ownerVaultCoreCount !== input.owned.length ||
    input.owned.length < 25 ||
    input.owned.length > 500
  ) {
    throw new Error("Complete bounded owned Bike pool is required.");
  }
  const seen = new Set<string>();
  for (const { core } of input.owned) {
    if (seen.has(core.coreId))
      throw new Error("Owned Bike pool has duplicate Core identities.");
    seen.add(core.coreId);
  }
  if (
    input.owned.some((candidate) => candidate.completeOwnedBikeHistory !== true)
  ) {
    throw new Error(
      "Every owned Bike history must be complete before ranking the pool.",
    );
  }
  const qualified = input.owned.flatMap((candidate) => {
    const evidence = potentialCore(candidate, input.currentThrough);
    return evidence === null ? [] : [{ candidate, ...evidence }];
  });
  if (qualified.length < 25) {
    throw new Error(
      "Fewer than 25 current elite, legal owned Bike Cores are verified.",
    );
  }
  const selected: typeof qualified = [];
  const explanations: SelectedExplanation[] = [];
  while (selected.length < 25) {
    const remainingSlots = 25 - selected.length;
    const neededFemale = Math.max(
      0,
      8 -
        selected.filter(({ candidate }) => candidate.core.sex === "female")
          .length,
    );
    const neededHighF = Math.max(
      0,
      2 -
        selected.filter(({ candidate }) => candidate.core.fNumber > 15).length,
    );
    const choices = qualified
      .filter(
        ({ candidate }) =>
          !selected.some(
            (value) => value.candidate.core.coreId === candidate.core.coreId,
          ) &&
          withinCaps(
            selected.map((value) => value.candidate.core),
            candidate.core,
          ) &&
          (remainingSlots > neededFemale || candidate.core.sex === "female") &&
          (remainingSlots > neededHighF || candidate.core.fNumber > 15),
      )
      .map((value) => ({
        ...value,
        gain: marginalGain(
          selected.map(({ power }) => power),
          value.power,
        ),
      }))
      .sort(
        (a, b) =>
          b.gain - a.gain ||
          b.candidate.cells.filter(({ status }) => status === "elite_range")
            .length -
            a.candidate.cells.filter(({ status }) => status === "elite_range")
              .length ||
          a.ageingUsedUpperBound - b.ageingUsedUpperBound ||
          a.candidate.core.coreId.localeCompare(b.candidate.core.coreId),
      );
    const winner = choices[0];
    if (winner === undefined)
      throw new Error(
        "Greedy selection could not complete a legal 25-Core roster from the verified pool.",
      );
    selected.push(winner);
    explanations.push(
      Object.freeze({
        coreId: winner.candidate.core.coreId,
        displayName: winner.candidate.core.displayName,
        eliteCellCount: winner.candidate.cells.filter(
          ({ status }) => status === "elite_range",
        ).length,
        weightedMarginalGain: winner.gain,
        bikeAgeingUsedUpperBound: winner.ageingUsedUpperBound,
        ageingEvidence: winner.ageingEvidence,
      }),
    );
  }
  if (
    auditProLeagueRoster(selected.map(({ candidate }) => candidate.core))
      .readiness !== "compliant"
  ) {
    throw new Error(
      "Round 2 selected roster failed the complete owner rules audit.",
    );
  }
  return Object.freeze({
    authority: "advisory_complete_owned_pool_and_official_pace",
    selectionMethod:
      "weighted_distance_projection_gate_depth_with_first16_priority",
    inspectedOwnedCoreCount: input.owned.length,
    excludedCandidateCount: input.owned.length - qualified.length,
    selected: Object.freeze(explanations),
    lineup: buildRound2FullGateDraft({
      roster: selected.map(({ candidate }) => candidate),
      currentThrough: input.currentThrough,
    }),
  });
}
