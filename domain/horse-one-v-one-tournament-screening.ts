import {
  calculatePairwiseRaceProbability,
  type EmpiricalRaceTimeObservation,
} from "@/domain/race-probability-baseline";

export const horseOneVOneTournamentDistances = [1000, 1400, 2200] as const;

export type HorseOneVOneCoreEvidence = Readonly<{
  coreId: string;
  name: string;
  owned: boolean;
  element: string;
  distanceMetres: (typeof horseOneVOneTournamentDistances)[number];
  observations: readonly EmpiricalRaceTimeObservation[];
}>;

export type HorseOneVOneScreeningGroup = Readonly<{
  element: string;
  distanceMetres: (typeof horseOneVOneTournamentDistances)[number];
  evidence: readonly HorseOneVOneCoreEvidence[];
  tournamentFieldOpponentCoreIds: readonly string[];
  topTenPercentOpponentCoreIds: readonly string[];
  opponentPoolStatus: "confirmed" | "review_required";
}>;

export type HorseOneVOneCandidateScreening = Readonly<{
  coreId: string;
  name: string;
  element: string;
  distanceMetres: number;
  status: "available" | "unavailable" | "review_required";
  disposition: "screened_candidate" | "best_shot" | "evidence_unavailable";
  expectedFieldPWinMillionths: number | null;
  topTenPercentStressPWinMillionths: number | null;
  candidateSampleCount: number;
  fieldOpponentCoreCount: number;
  stressOpponentCoreCount: number;
  economicStatus: "unavailable";
  economicReason: "CONFIRMED_FEE_PRIZE_RULE_NOT_SUPPLIED";
  reasons: readonly string[];
}>;

export type HorseOneVOneScreeningResult = Readonly<{
  modelVersion: "horse-1v1-empirical-pairwise-v1";
  evidenceCutoff: string;
  candidates: readonly HorseOneVOneCandidateScreening[];
}>;

const SCREENING_THRESHOLD_MILLIONTHS = 500_000;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function uniqueIds(
  values: readonly string[],
  label: string,
): readonly string[] {
  const normalized = values.map((value) => required(value, label));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} must be unique.`);
  }
  return normalized;
}

function average(values: readonly number[]): number {
  return Math.round(
    values.reduce((sum, value) => sum + value, 0) / values.length,
  );
}

function evaluatePool(
  input: Readonly<{
    candidate: HorseOneVOneCoreEvidence;
    opponents: readonly HorseOneVOneCoreEvidence[];
    evidenceCutoff: string;
    poolLabel: string;
  }>,
): Readonly<{
  status: "available" | "unavailable" | "review_required";
  probability: number | null;
  reasons: readonly string[];
}> {
  if (input.opponents.length === 0) {
    return {
      status: "unavailable",
      probability: null,
      reasons: [`${input.poolLabel}_OPPONENT_POOL_EMPTY`],
    };
  }
  const results = input.opponents.map((opponent) =>
    calculatePairwiseRaceProbability({
      baselineId: `horse-1v1:${input.candidate.element}:${input.candidate.distanceMetres}`,
      modelVersion: "horse-1v1-empirical-pairwise-v1",
      evidenceCutoff: input.evidenceCutoff,
      context: {
        mode: "horse",
        distanceMeters: input.candidate.distanceMetres,
        competition: "esports",
        format: "1v1",
        gateCount: 2,
        element: { status: "known", value: input.candidate.element },
      },
      candidateCoreId: input.candidate.coreId,
      opponentCoreId: opponent.coreId,
      candidateObservations: input.candidate.observations,
      opponentObservations: opponent.observations,
    }),
  );
  const reasons = [...new Set(results.flatMap((result) => result.reasons))];
  if (results.some((result) => result.status === "unavailable")) {
    return { status: "unavailable", probability: null, reasons };
  }
  if (results.some((result) => result.status === "review_required")) {
    return { status: "review_required", probability: null, reasons };
  }
  return {
    status: "available",
    probability: average(
      results.map((result) => {
        if (result.pWinMillionths === null) {
          throw new Error("Available pairwise probability is missing.");
        }
        return result.pWinMillionths;
      }),
    ),
    reasons,
  };
}

export function screenHorseOneVOneTournamentCandidates(
  input: Readonly<{
    evidenceCutoff: string;
    groups: readonly HorseOneVOneScreeningGroup[];
  }>,
): HorseOneVOneScreeningResult {
  const evidenceCutoff = new Date(
    required(input.evidenceCutoff, "Evidence cutoff"),
  );
  if (Number.isNaN(evidenceCutoff.getTime())) {
    throw new Error("Evidence cutoff must be valid.");
  }
  const groupKeys = new Set<string>();
  const candidates: HorseOneVOneCandidateScreening[] = [];

  for (const group of input.groups) {
    const element = required(group.element, "Element");
    if (!horseOneVOneTournamentDistances.includes(group.distanceMetres)) {
      throw new Error("Horse 1v1 distance must be 1000, 1400 or 2200 metres.");
    }
    const groupKey = `${element}\u0000${group.distanceMetres}`;
    if (groupKeys.has(groupKey))
      throw new Error("Horse 1v1 group is duplicated.");
    groupKeys.add(groupKey);

    const evidenceById = new Map<string, HorseOneVOneCoreEvidence>();
    for (const core of group.evidence) {
      const coreId = required(core.coreId, "Core ID");
      if (
        core.element !== element ||
        core.distanceMetres !== group.distanceMetres ||
        evidenceById.has(coreId)
      ) {
        throw new Error("Horse 1v1 evidence does not match its exact group.");
      }
      evidenceById.set(coreId, core);
    }
    const fieldIds = uniqueIds(
      group.tournamentFieldOpponentCoreIds,
      "Tournament-field opponent Core ID",
    );
    const stressIds = uniqueIds(
      group.topTenPercentOpponentCoreIds,
      "Top-10% opponent Core ID",
    );
    const resolvePool = (ids: readonly string[], candidateId: string) =>
      ids
        .filter((id) => id !== candidateId)
        .map((id) => {
          const evidence = evidenceById.get(id);
          if (!evidence) throw new Error("Opponent evidence is incomplete.");
          return evidence;
        });

    for (const candidate of [...group.evidence]
      .filter((core) => core.owned)
      .sort((left, right) => left.coreId.localeCompare(right.coreId))) {
      const field = evaluatePool({
        candidate,
        opponents: resolvePool(fieldIds, candidate.coreId),
        evidenceCutoff: evidenceCutoff.toISOString(),
        poolLabel: "FIELD",
      });
      const stress = evaluatePool({
        candidate,
        opponents: resolvePool(stressIds, candidate.coreId),
        evidenceCutoff: evidenceCutoff.toISOString(),
        poolLabel: "STRESS",
      });
      const reasons = [...new Set([...field.reasons, ...stress.reasons])];
      if (group.opponentPoolStatus !== "confirmed") {
        reasons.push("OPPONENT_POOL_REVIEW_REQUIRED");
      }
      const status =
        field.status === "unavailable" || stress.status === "unavailable"
          ? "unavailable"
          : field.status === "review_required" ||
              stress.status === "review_required" ||
              group.opponentPoolStatus !== "confirmed"
            ? "review_required"
            : "available";
      candidates.push({
        coreId: candidate.coreId,
        name: required(candidate.name, "Core name"),
        element,
        distanceMetres: group.distanceMetres,
        status,
        disposition:
          status !== "available" || field.probability === null
            ? "evidence_unavailable"
            : field.probability >= SCREENING_THRESHOLD_MILLIONTHS
              ? "screened_candidate"
              : "best_shot",
        expectedFieldPWinMillionths:
          status === "available" ? field.probability : null,
        topTenPercentStressPWinMillionths:
          status === "available" ? stress.probability : null,
        candidateSampleCount: candidate.observations.length,
        fieldOpponentCoreCount: resolvePool(fieldIds, candidate.coreId).length,
        stressOpponentCoreCount: resolvePool(stressIds, candidate.coreId)
          .length,
        economicStatus: "unavailable",
        economicReason: "CONFIRMED_FEE_PRIZE_RULE_NOT_SUPPLIED",
        reasons,
      });
    }
  }

  return {
    modelVersion: "horse-1v1-empirical-pairwise-v1",
    evidenceCutoff: evidenceCutoff.toISOString(),
    candidates: candidates.sort(
      (left, right) =>
        left.element.localeCompare(right.element) ||
        left.distanceMetres - right.distanceMetres ||
        (right.expectedFieldPWinMillionths ?? -1) -
          (left.expectedFieldPWinMillionths ?? -1) ||
        (right.topTenPercentStressPWinMillionths ?? -1) -
          (left.topTenPercentStressPWinMillionths ?? -1) ||
        left.coreId.localeCompare(right.coreId),
    ),
  };
}
