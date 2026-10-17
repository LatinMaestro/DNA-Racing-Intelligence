import { describe, expect, it } from "vitest";
import {
  evaluateOpenRaceCandidateScenarios,
  type OpenRaceCandidateScenarioInput,
} from "../domain/open-race-candidate-scenarios";

function observations(prefix: string, startMilliseconds: number, count = 10) {
  return Array.from({ length: count }, (_, index) => ({
    eventId: `${prefix}-${index}`,
    eventAt: `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
    elapsedTimeMilliseconds: startMilliseconds + index,
  }));
}

function input(
  overrides: Partial<OpenRaceCandidateScenarioInput> = {},
): OpenRaceCandidateScenarioInput {
  return {
    scenarioId: "scenario-1",
    modelVersion: "pairwise-v1",
    evaluatedAt: "2026-10-17T12:00:00Z",
    evidenceCutoff: "2026-10-17T11:00:00Z",
    context: {
      mode: "bike",
      distanceMeters: 1_400,
      competition: "normal",
      format: "4 gate WTA",
      gateCount: 4,
      element: { status: "known", value: "Metal" },
    },
    field: {
      fieldVersion: "field-v3",
      fieldCapturedAt: "2026-10-17T11:30:00Z",
      stage: "forming",
      enteredOpponents: [
        {
          entryId: "gate-1",
          identityStatus: "confirmed",
          coreId: "slower-opponent",
          observations: observations("slower", 12_000),
        },
        {
          entryId: "gate-2",
          identityStatus: "confirmed",
          coreId: "faster-opponent",
          observations: observations("faster", 8_000),
        },
      ],
    },
    candidates: [
      {
        coreId: "candidate-a",
        eligibilityStatus: "eligible",
        observations: observations("candidate", 10_000),
      },
    ],
    ...overrides,
  };
}

describe("Open Race candidate-versus-entered-field scenarios", () => {
  it("evaluates every confirmed opponent independently without inventing a combined probability", () => {
    const result = evaluateOpenRaceCandidateScenarios(input());

    expect(result).toMatchObject({
      scenarioId: "scenario-1",
      status: "available",
      field: {
        fieldVersion: "field-v3",
        enteredOpponentCount: 2,
        emptyGateCount: 2,
        unresolvedOpponentCount: 0,
      },
      probabilityBasis: "per_opponent_empirical_pairwise_only",
      combinedFieldProbabilityStatus: "not_calculated_unapproved_combination",
      currentRaceStarsUsed: false,
      fairExOddsUsed: false,
      raceEntryAllowed: false,
      gameActionAllowed: false,
    });
    expect(result.candidates[0]).toMatchObject({
      coreId: "candidate-a",
      status: "available",
      enteredOpponentCount: 2,
      comparableOpponentCount: 2,
      availableComparisonCount: 2,
      combinedFieldWinProbabilityMillionths: null,
      recommendationAllowed: false,
    });
    expect(
      result.candidates[0]?.comparisons.map(
        ({ probability }) => probability.pWinMillionths,
      ),
    ).toEqual([1_000_000, 0]);
    expect(
      result.candidates[0]?.comparisons.every(
        ({ probability }) =>
          JSON.stringify(probability.context) ===
            JSON.stringify(result.context) &&
          probability.decisionUseAllowed === false &&
          probability.economicUseAllowed === false,
      ),
    ).toBe(true);
  });

  it("keeps unresolved identities explicit and does not fabricate their history", () => {
    const base = input();
    const result = evaluateOpenRaceCandidateScenarios(
      input({
        field: {
          ...base.field,
          enteredOpponents: [
            base.field.enteredOpponents[0]!,
            {
              entryId: "gate-2",
              identityStatus: "unresolved",
              coreId: null,
              observations: null,
            },
          ],
        },
      }),
    );

    expect(result.status).toBe("review_required");
    expect(result.field.unresolvedOpponentCount).toBe(1);
    expect(result.candidates[0]).toMatchObject({
      status: "review_required",
      enteredOpponentCount: 2,
      comparableOpponentCount: 1,
      reasons: ["UNRESOLVED_OPPONENT_IDENTITY"],
    });
  });

  it("preserves pairwise sample and tie failures instead of issuing a recommendation", () => {
    const base = input();
    const tied = observations("tied", 10_000);
    const result = evaluateOpenRaceCandidateScenarios(
      input({
        field: {
          ...base.field,
          enteredOpponents: [
            {
              entryId: "gate-1",
              identityStatus: "confirmed",
              coreId: "tied-opponent",
              observations: tied,
            },
          ],
        },
        candidates: [
          {
            coreId: "candidate-a",
            eligibilityStatus: "eligible",
            observations: tied,
          },
          {
            coreId: "candidate-b",
            eligibilityStatus: "eligible",
            observations: observations("short", 9_000, 9),
          },
        ],
      }),
    );

    expect(result.status).toBe("review_required");
    expect(result.candidates[0]).toMatchObject({
      status: "review_required",
      reviewRequiredComparisonCount: 1,
      reasons: ["TIE_POLICY_UNRESOLVED"],
    });
    expect(result.candidates[1]).toMatchObject({
      status: "unavailable",
      unavailableComparisonCount: 1,
      reasons: ["INSUFFICIENT_CANDIDATE_SAMPLE"],
      combinedFieldWinProbabilityMillionths: null,
      recommendationAllowed: false,
    });
  });

  it("discloses an empty entered field as unavailable", () => {
    const base = input();
    const result = evaluateOpenRaceCandidateScenarios(
      input({ field: { ...base.field, enteredOpponents: [] } }),
    );
    expect(result).toMatchObject({
      status: "unavailable",
      field: { enteredOpponentCount: 0, emptyGateCount: 4 },
    });
    expect(result.candidates[0]).toMatchObject({
      status: "unavailable",
      reasons: ["NO_ENTERED_OPPONENTS"],
    });
  });

  it("rejects full fields, chronology drift, duplicate identities and assumed unresolved evidence", () => {
    const base = input();
    const opponent = base.field.enteredOpponents[0]!;
    expect(() =>
      evaluateOpenRaceCandidateScenarios(
        input({
          field: {
            ...base.field,
            enteredOpponents: [opponent, opponent, opponent, opponent],
          },
        }),
      ),
    ).toThrow("at least one empty gate");
    expect(() =>
      evaluateOpenRaceCandidateScenarios(
        input({ evidenceCutoff: "2026-10-17T12:00:01Z" }),
      ),
    ).toThrow("Evidence cutoff cannot follow evaluation time");
    expect(() =>
      evaluateOpenRaceCandidateScenarios(
        input({
          candidates: [base.candidates[0]!, base.candidates[0]!],
        }),
      ),
    ).toThrow("Candidate Core IDs must be unique");
    expect(() =>
      evaluateOpenRaceCandidateScenarios(
        input({
          field: {
            ...base.field,
            enteredOpponents: [
              {
                entryId: "gate-1",
                identityStatus: "unresolved",
                coreId: "guessed-core",
                observations: observations("guessed", 9_000),
              },
            ],
          },
        }),
      ),
    ).toThrow("cannot carry an assumed Core ID or history");
  });

  it("rejects same-event leakage, current stars, odds and an already-entered candidate", () => {
    const base = input();
    expect(() =>
      evaluateOpenRaceCandidateScenarios(
        input({
          candidates: [
            {
              ...base.candidates[0]!,
              observations: [
                {
                  eventId: "same-event",
                  eventAt: base.evidenceCutoff,
                  elapsedTimeMilliseconds: 10_000,
                },
              ],
            },
          ],
        }),
      ),
    ).toThrow("evidence must predate the evidence cutoff");
    expect(() =>
      evaluateOpenRaceCandidateScenarios({
        ...input(),
        fairExOdds: 2.1,
      } as OpenRaceCandidateScenarioInput),
    ).toThrow("cannot contain current-race results, stars, odds or economics");
    expect(() =>
      evaluateOpenRaceCandidateScenarios(
        input({
          candidates: [
            {
              coreId: "slower-opponent",
              eligibilityStatus: "eligible",
              observations: observations("entered", 10_000),
            },
          ],
        }),
      ),
    ).toThrow("cannot already be entered");
  });
});
