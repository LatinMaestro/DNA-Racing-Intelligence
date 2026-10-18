import {
  calculateEmpiricalPairwiseElapsedTimeOutperformance,
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
  /** Every accepted Horse observation at this exact distance, across formats. */
  distanceObservations: readonly EmpiricalRaceTimeObservation[];
  /** The exact 1v1/two-gate subset, retained as a separate direct-evidence lane. */
  directOneVOneObservations: readonly EmpiricalRaceTimeObservation[];
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
  disposition:
    | "screened_candidate"
    | "inferred_candidate"
    | "best_shot"
    | "evidence_unavailable";
  expectedFieldPWinMillionths: number | null;
  topTenPercentStressPWinMillionths: number | null;
  projectedFieldOutperformanceMillionths: number | null;
  projectedTopTenPercentOutperformanceMillionths: number | null;
  candidateSampleCount: number;
  candidateDirectOneVOneSampleCount: number;
  fieldOpponentCoreCount: number;
  stressOpponentCoreCount: number;
  evidenceBasis: "same_mode_exact_distance_all_accepted_races";
  formatTransferStatus: "direct" | "inference_only" | "unavailable";
  provenOneVOneSpecialist: false;
  analyticalStatus: "experimental";
  decisionUseAllowed: false;
  economicStatus: "unavailable";
  economicReason: "CONFIRMED_FEE_PRIZE_RULE_NOT_SUPPLIED";
  reasons: readonly string[];
}>;

export type HorseOneVOneScreeningResult = Readonly<{
  modelVersion: "horse-1v1-exact-distance-transfer-v2";
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

type PoolEvaluation = Readonly<{
  status: "available" | "unavailable" | "review_required";
  probability: number | null;
  reasons: readonly string[];
}>;

function evaluatePool(
  input: Readonly<{
    candidate: HorseOneVOneCoreEvidence;
    opponents: readonly HorseOneVOneCoreEvidence[];
    evidenceCutoff: string;
    poolLabel: string;
    evidenceLane: "distance_transfer" | "direct_one_v_one";
  }>,
): PoolEvaluation {
  if (input.opponents.length === 0) {
    return {
      status: "unavailable",
      probability: null,
      reasons: [`${input.poolLabel}_OPPONENT_POOL_EMPTY`],
    };
  }
  const prefix =
    input.evidenceLane === "distance_transfer"
      ? "DISTANCE_TRANSFER"
      : "DIRECT_1V1";
  const results = input.opponents.map((opponent) => {
    if (input.evidenceLane === "distance_transfer") {
      return calculateEmpiricalPairwiseElapsedTimeOutperformance({
        evidenceCutoff: input.evidenceCutoff,
        candidateCoreId: input.candidate.coreId,
        opponentCoreId: opponent.coreId,
        candidateObservations: input.candidate.distanceObservations,
        opponentObservations: opponent.distanceObservations,
      });
    }
    const direct = calculatePairwiseRaceProbability({
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
      candidateObservations: input.candidate.directOneVOneObservations,
      opponentObservations: opponent.directOneVOneObservations,
    });
    return {
      ...direct,
      outperformanceMillionths: direct.pWinMillionths,
    };
  });
  const reasons = [
    ...new Set(
      results.flatMap((result) =>
        result.reasons.map((reason) => `${prefix}_${reason}`),
      ),
    ),
  ];
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
        if (result.outperformanceMillionths === null) {
          throw new Error("Available pairwise comparison is missing.");
        }
        return result.outperformanceMillionths;
      }),
    ),
    reasons,
  };
}

function validateDirectSubset(core: HorseOneVOneCoreEvidence): void {
  const distanceEvents = new Map(
    core.distanceObservations.map((observation) => [
      observation.eventId,
      observation,
    ]),
  );
  if (
    core.directOneVOneObservations.some((observation) => {
      const accepted = distanceEvents.get(observation.eventId);
      return (
        accepted === undefined ||
        accepted.eventAt !== observation.eventAt ||
        accepted.elapsedTimeMilliseconds !== observation.elapsedTimeMilliseconds
      );
    })
  ) {
    throw new Error(
      "Horse direct 1v1 evidence must be a subset of exact-distance evidence.",
    );
  }
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
    if (groupKeys.has(groupKey)) {
      throw new Error("Horse 1v1 group is duplicated.");
    }
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
      validateDirectSubset(core);
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
      const fieldOpponents = resolvePool(fieldIds, candidate.coreId);
      const stressOpponents = resolvePool(stressIds, candidate.coreId);
      const transferField = evaluatePool({
        candidate,
        opponents: fieldOpponents,
        evidenceCutoff: evidenceCutoff.toISOString(),
        poolLabel: "FIELD",
        evidenceLane: "distance_transfer",
      });
      const transferStress = evaluatePool({
        candidate,
        opponents: stressOpponents,
        evidenceCutoff: evidenceCutoff.toISOString(),
        poolLabel: "STRESS",
        evidenceLane: "distance_transfer",
      });
      const directField = evaluatePool({
        candidate,
        opponents: fieldOpponents,
        evidenceCutoff: evidenceCutoff.toISOString(),
        poolLabel: "FIELD",
        evidenceLane: "direct_one_v_one",
      });
      const directStress = evaluatePool({
        candidate,
        opponents: stressOpponents,
        evidenceCutoff: evidenceCutoff.toISOString(),
        poolLabel: "STRESS",
        evidenceLane: "direct_one_v_one",
      });
      const reasons = [
        ...new Set([
          ...transferField.reasons,
          ...transferStress.reasons,
          ...directField.reasons,
          ...directStress.reasons,
        ]),
      ];
      if (group.opponentPoolStatus !== "confirmed") {
        reasons.push("OPPONENT_POOL_REVIEW_REQUIRED");
      }

      const directAvailable =
        directField.status === "available" &&
        directStress.status === "available" &&
        group.opponentPoolStatus === "confirmed";
      const transferAvailable =
        transferField.status === "available" &&
        transferStress.status === "available" &&
        group.opponentPoolStatus === "confirmed";
      const status = directAvailable
        ? "available"
        : transferAvailable
          ? "review_required"
          : "unavailable";
      const formatTransferStatus = directAvailable
        ? "direct"
        : transferAvailable
          ? "inference_only"
          : "unavailable";
      const directFieldProbability = directAvailable
        ? directField.probability
        : null;
      const transferFieldProbability = transferAvailable
        ? transferField.probability
        : null;

      candidates.push({
        coreId: candidate.coreId,
        name: required(candidate.name, "Core name"),
        element,
        distanceMetres: group.distanceMetres,
        status,
        disposition:
          directAvailable && directFieldProbability !== null
            ? directFieldProbability >= SCREENING_THRESHOLD_MILLIONTHS
              ? "screened_candidate"
              : "best_shot"
            : transferAvailable && transferFieldProbability !== null
              ? transferFieldProbability >= SCREENING_THRESHOLD_MILLIONTHS
                ? "inferred_candidate"
                : "best_shot"
              : "evidence_unavailable",
        expectedFieldPWinMillionths: directFieldProbability,
        topTenPercentStressPWinMillionths: directAvailable
          ? directStress.probability
          : null,
        projectedFieldOutperformanceMillionths: transferFieldProbability,
        projectedTopTenPercentOutperformanceMillionths: transferAvailable
          ? transferStress.probability
          : null,
        candidateSampleCount: candidate.distanceObservations.length,
        candidateDirectOneVOneSampleCount:
          candidate.directOneVOneObservations.length,
        fieldOpponentCoreCount: fieldOpponents.length,
        stressOpponentCoreCount: stressOpponents.length,
        evidenceBasis: "same_mode_exact_distance_all_accepted_races",
        formatTransferStatus,
        provenOneVOneSpecialist: false,
        analyticalStatus: "experimental",
        decisionUseAllowed: false,
        economicStatus: "unavailable",
        economicReason: "CONFIRMED_FEE_PRIZE_RULE_NOT_SUPPLIED",
        reasons,
      });
    }
  }

  return {
    modelVersion: "horse-1v1-exact-distance-transfer-v2",
    evidenceCutoff: evidenceCutoff.toISOString(),
    candidates: candidates.sort(
      (left, right) =>
        left.element.localeCompare(right.element) ||
        left.distanceMetres - right.distanceMetres ||
        (right.projectedFieldOutperformanceMillionths ?? -1) -
          (left.projectedFieldOutperformanceMillionths ?? -1) ||
        (right.expectedFieldPWinMillionths ?? -1) -
          (left.expectedFieldPWinMillionths ?? -1) ||
        left.coreId.localeCompare(right.coreId),
    ),
  };
}
