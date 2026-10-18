import { describe, expect, it } from "vitest";

import {
  screenHorseOneVOneTournamentCandidates,
  type HorseOneVOneCoreEvidence,
} from "@/domain/horse-one-v-one-tournament-screening";

function evidence(input: {
  coreId: string;
  name: string;
  owned: boolean;
  element: string;
  distanceMetres: 1000 | 1400 | 2200;
  elapsed: readonly number[];
  directOneVOneElapsed?: readonly number[];
}): HorseOneVOneCoreEvidence {
  const distanceObservations = input.elapsed.map(
    (elapsedTimeMilliseconds, index) => ({
      eventId: `${input.coreId}-${index}`,
      eventAt: `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      elapsedTimeMilliseconds,
    }),
  );
  const directCount = input.directOneVOneElapsed?.length ?? 0;
  if (directCount > distanceObservations.length) {
    throw new Error("Fixture direct sample exceeds its distance sample.");
  }
  return {
    coreId: input.coreId,
    name: input.name,
    owned: input.owned,
    element: input.element,
    distanceMetres: input.distanceMetres,
    distanceObservations,
    directOneVOneObservations: distanceObservations
      .slice(0, directCount)
      .map((observation, index) => ({
        ...observation,
        elapsedTimeMilliseconds: input.directOneVOneElapsed![index]!,
      })),
  };
}

describe("Horse 1v1 tournament screening", () => {
  it("ranks every owned Core within exact distance and element using the approved 50% screen", () => {
    const fast = evidence({
      coreId: "101",
      name: "Fast Horse",
      owned: true,
      element: "Fire",
      distanceMetres: 1000,
      elapsed: Array.from({ length: 10 }, (_, index) => 50_000 + index),
      directOneVOneElapsed: Array.from(
        { length: 10 },
        (_, index) => 50_000 + index,
      ),
    });
    const slow = evidence({
      coreId: "102",
      name: "Slow Horse",
      owned: true,
      element: "Fire",
      distanceMetres: 1000,
      elapsed: Array.from({ length: 10 }, (_, index) => 60_000 + index),
      directOneVOneElapsed: Array.from(
        { length: 10 },
        (_, index) => 60_000 + index,
      ),
    });
    const field = evidence({
      coreId: "201",
      name: "Field Horse",
      owned: false,
      element: "Fire",
      distanceMetres: 1000,
      elapsed: Array.from({ length: 10 }, (_, index) => 55_000 + index),
      directOneVOneElapsed: Array.from(
        { length: 10 },
        (_, index) => 55_000 + index,
      ),
    });

    const result = screenHorseOneVOneTournamentCandidates({
      evidenceCutoff: "2026-10-18T00:00:00.000Z",
      groups: [
        {
          element: "Fire",
          distanceMetres: 1000,
          evidence: [slow, field, fast],
          tournamentFieldOpponentCoreIds: ["201"],
          topTenPercentOpponentCoreIds: ["201"],
          opponentPoolStatus: "confirmed",
        },
      ],
    });

    expect(result.candidates.map(({ coreId }) => coreId)).toEqual([
      "101",
      "102",
    ]);
    expect(result.candidates[0]).toMatchObject({
      disposition: "screened_candidate",
      expectedFieldPWinMillionths: 1_000_000,
      topTenPercentStressPWinMillionths: 1_000_000,
      projectedFieldOutperformanceMillionths: 1_000_000,
      formatTransferStatus: "direct",
      provenOneVOneSpecialist: false,
      economicStatus: "unavailable",
    });
    expect(result.candidates[1]).toMatchObject({
      disposition: "best_shot",
      expectedFieldPWinMillionths: 0,
      topTenPercentStressPWinMillionths: 0,
      projectedFieldOutperformanceMillionths: 0,
    });
  });

  it("ranks a Core with no 1v1 starts from all accepted exact-distance Horse races without claiming direct proof", () => {
    const candidate = evidence({
      coreId: "210",
      name: "Untested 1v1 Horse",
      owned: true,
      element: "Earth",
      distanceMetres: 1400,
      elapsed: Array.from({ length: 12 }, (_, index) => 70_000 + index),
    });
    const field = evidence({
      coreId: "211",
      name: "Tournament Strength",
      owned: false,
      element: "Earth",
      distanceMetres: 1400,
      elapsed: Array.from({ length: 10 }, (_, index) => 75_000 + index),
    });

    const result = screenHorseOneVOneTournamentCandidates({
      evidenceCutoff: "2026-10-18T00:00:00.000Z",
      groups: [
        {
          element: "Earth",
          distanceMetres: 1400,
          evidence: [candidate, field],
          tournamentFieldOpponentCoreIds: ["211"],
          topTenPercentOpponentCoreIds: ["211"],
          opponentPoolStatus: "confirmed",
        },
      ],
    });

    expect(result.candidates[0]).toMatchObject({
      status: "review_required",
      disposition: "inferred_candidate",
      expectedFieldPWinMillionths: null,
      topTenPercentStressPWinMillionths: null,
      projectedFieldOutperformanceMillionths: 1_000_000,
      projectedTopTenPercentOutperformanceMillionths: 1_000_000,
      candidateSampleCount: 12,
      candidateDirectOneVOneSampleCount: 0,
      evidenceBasis: "same_mode_exact_distance_all_accepted_races",
      formatTransferStatus: "inference_only",
      provenOneVOneSpecialist: false,
      analyticalStatus: "experimental",
      decisionUseAllowed: false,
    });
    expect(result.candidates[0]!.reasons).toEqual(
      expect.arrayContaining([
        "DIRECT_1V1_INSUFFICIENT_CANDIDATE_SAMPLE",
        "DIRECT_1V1_INSUFFICIENT_OPPONENT_SAMPLE",
      ]),
    );
  });

  it("fails closed for an unconfirmed pool or insufficient exact-context samples", () => {
    const candidate = evidence({
      coreId: "301",
      name: "Candidate",
      owned: true,
      element: "Water",
      distanceMetres: 2200,
      elapsed: [100_000],
    });
    const opponent = evidence({
      coreId: "401",
      name: "Opponent",
      owned: false,
      element: "Water",
      distanceMetres: 2200,
      elapsed: [101_000],
    });
    const result = screenHorseOneVOneTournamentCandidates({
      evidenceCutoff: "2026-10-18T00:00:00.000Z",
      groups: [
        {
          element: "Water",
          distanceMetres: 2200,
          evidence: [candidate, opponent],
          tournamentFieldOpponentCoreIds: ["401"],
          topTenPercentOpponentCoreIds: ["401"],
          opponentPoolStatus: "review_required",
        },
      ],
    });

    expect(result.candidates[0]).toMatchObject({
      status: "unavailable",
      disposition: "evidence_unavailable",
      expectedFieldPWinMillionths: null,
      topTenPercentStressPWinMillionths: null,
    });
    expect(result.candidates[0]!.reasons).toEqual(
      expect.arrayContaining([
        "DISTANCE_TRANSFER_INSUFFICIENT_CANDIDATE_SAMPLE",
        "DISTANCE_TRANSFER_INSUFFICIENT_OPPONENT_SAMPLE",
        "DIRECT_1V1_INSUFFICIENT_CANDIDATE_SAMPLE",
        "DIRECT_1V1_INSUFFICIENT_OPPONENT_SAMPLE",
        "OPPONENT_POOL_REVIEW_REQUIRED",
      ]),
    );
  });

  it("rejects evidence that crosses element or distance groups", () => {
    const mismatched = evidence({
      coreId: "501",
      name: "Wrong distance",
      owned: true,
      element: "Earth",
      distanceMetres: 1400,
      elapsed: Array.from({ length: 10 }, () => 70_000),
    });
    expect(() =>
      screenHorseOneVOneTournamentCandidates({
        evidenceCutoff: "2026-10-18T00:00:00.000Z",
        groups: [
          {
            element: "Earth",
            distanceMetres: 1000,
            evidence: [mismatched],
            tournamentFieldOpponentCoreIds: [],
            topTenPercentOpponentCoreIds: [],
            opponentPoolStatus: "confirmed",
          },
        ],
      }),
    ).toThrow("exact group");
  });

  it("rejects direct 1v1 rows that are not part of the accepted exact-distance evidence", () => {
    const invalid = evidence({
      coreId: "601",
      name: "Invalid subset",
      owned: true,
      element: "Metal",
      distanceMetres: 1000,
      elapsed: Array.from({ length: 10 }, () => 50_000),
    });
    const directOneVOneObservations = [
      {
        eventId: "not-in-distance-evidence",
        eventAt: "2026-09-01T00:00:00.000Z",
        elapsedTimeMilliseconds: 50_000,
      },
    ];

    expect(() =>
      screenHorseOneVOneTournamentCandidates({
        evidenceCutoff: "2026-10-18T00:00:00.000Z",
        groups: [
          {
            element: "Metal",
            distanceMetres: 1000,
            evidence: [{ ...invalid, directOneVOneObservations }],
            tournamentFieldOpponentCoreIds: [],
            topTenPercentOpponentCoreIds: [],
            opponentPoolStatus: "confirmed",
          },
        ],
      }),
    ).toThrow("must be a subset");
  });
});
