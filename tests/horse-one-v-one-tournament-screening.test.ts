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
}): HorseOneVOneCoreEvidence {
  return {
    ...input,
    observations: input.elapsed.map((elapsedTimeMilliseconds, index) => ({
      eventId: `${input.coreId}-${index}`,
      eventAt: `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      elapsedTimeMilliseconds,
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
    });
    const slow = evidence({
      coreId: "102",
      name: "Slow Horse",
      owned: true,
      element: "Fire",
      distanceMetres: 1000,
      elapsed: Array.from({ length: 10 }, (_, index) => 60_000 + index),
    });
    const field = evidence({
      coreId: "201",
      name: "Field Horse",
      owned: false,
      element: "Fire",
      distanceMetres: 1000,
      elapsed: Array.from({ length: 10 }, (_, index) => 55_000 + index),
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
      economicStatus: "unavailable",
    });
    expect(result.candidates[1]).toMatchObject({
      disposition: "best_shot",
      expectedFieldPWinMillionths: 0,
      topTenPercentStressPWinMillionths: 0,
    });
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
        "INSUFFICIENT_CANDIDATE_SAMPLE",
        "INSUFFICIENT_OPPONENT_SAMPLE",
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
});
