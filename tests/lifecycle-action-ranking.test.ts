import { describe, expect, it } from "vitest";

import {
  rankLifecycleActions,
  type LifecycleAction,
  type LifecycleActionCoreInput,
  type LifecycleActionRankingInput,
} from "../domain/lifecycle-action-ranking";

const actions: readonly LifecycleAction[] = [
  "race",
  "discover",
  "reserve_maiden",
  "breed",
  "hold",
  "sell",
  "burn",
];

function core(
  coreId: string,
  scores: Partial<Record<LifecycleAction, number>> = {},
  overrides: Partial<LifecycleActionCoreInput> = {},
): LifecycleActionCoreInput {
  return {
    coreId,
    coreClass: "Morphed",
    activeOwnership: true,
    protectionStatus: "clear",
    evidenceCoverage: "complete",
    maidenState: "not_eligible",
    discoveryState: "complete",
    marketEvidence: "confirmed",
    nonStarNegativeEvidencePresent: true,
    actionEvidence: actions.map((action) => ({
      action,
      supportStatus: "supported",
      scoreBasisPoints: scores[action] ?? 1000,
      evidenceReasons: [`Audited ${action} evidence.`],
    })),
    ...overrides,
  };
}

function input(
  cores: readonly LifecycleActionCoreInput[],
  overrides: Partial<LifecycleActionRankingInput> = {},
): LifecycleActionRankingInput {
  return {
    rankingId: "lifecycle-1",
    evaluatedAt: "2026-07-23T08:00:00Z",
    dataCurrentThrough: "2026-07-21T00:00:00Z",
    lastImported: "2026-07-22T00:00:00Z",
    freshness: "current",
    cores,
    ...overrides,
  };
}

describe("lifecycle action ranking", () => {
  it("ranks supported alternatives transparently and preserves evidence", () => {
    const result = rankLifecycleActions(
      input([
        core("racer", {
          race: 9000,
          breed: 7000,
          hold: 6000,
          sell: 3000,
          burn: 1000,
        }),
      ]),
    );
    expect(result.cores[0]?.leadingAction).toBe("race");
    expect(result.cores[0]?.rankedActions[0]).toEqual({
      rank: 1,
      action: "race",
      scoreBasisPoints: 9000,
      evidenceReasons: ["Audited race evidence."],
      strategicReviewOnly: false,
    });
  });

  it("preserves tied ranks and refuses an arbitrary leading action", () => {
    const result = rankLifecycleActions(
      input([core("tie", { race: 9000, breed: 9000 })]),
    );
    expect(
      result.cores[0]?.rankedActions.slice(0, 2).map(({ rank }) => rank),
    ).toEqual([1, 1]);
    expect(result.cores[0]?.leadingAction).toBe("insufficient_evidence");
    expect(result.cores[0]?.reviewReasons).toContain(
      "Leading lifecycle actions are tied.",
    );
  });

  it("holds all actions when evidence is stale, partial or protected", () => {
    const stale = rankLifecycleActions(
      input([core("stale", { race: 9000 })], { freshness: "stale" }),
    );
    expect(stale.cores[0]).toMatchObject({
      leadingAction: "insufficient_evidence",
      rankedActions: [],
    });

    const protectedCore = rankLifecycleActions(
      input([
        core(
          "protected",
          { breed: 9000 },
          { protectionStatus: "review_required", evidenceCoverage: "partial" },
        ),
      ]),
    );
    expect(protectedCore.cores[0]?.heldActions).toHaveLength(7);
  });

  it("requires exact action-specific evidence for Maiden, Discovery and sale", () => {
    const result = rankLifecycleActions(
      input([
        core(
          "gated",
          { reserve_maiden: 9000, discover: 8000, sell: 7000, hold: 6000 },
          {
            maidenState: "unknown",
            discoveryState: "exhausted",
            marketEvidence: "unresolved",
          },
        ),
      ]),
    );
    expect(result.cores[0]?.heldActions.map(({ action }) => action)).toEqual([
      "discover",
      "reserve_maiden",
      "sell",
    ]);
    expect(result.cores[0]?.leadingAction).toBe("hold");
  });

  it("forbids Genesis burn and rejects burn based only on star evidence", () => {
    const genesis = rankLifecycleActions(
      input([
        core("genesis", { burn: 10_000, hold: 5000 }, { coreClass: "Genesis" }),
      ]),
    );
    expect(
      genesis.cores[0]?.heldActions.find(({ action }) => action === "burn")
        ?.reasons,
    ).toContain("Genesis cores cannot be burned.");

    const starsOnly = rankLifecycleActions(
      input([
        core(
          "stars-only",
          { burn: 10_000, hold: 5000 },
          { nonStarNegativeEvidencePresent: false },
        ),
      ]),
    );
    expect(starsOnly.cores[0]?.leadingAction).toBe("hold");
    expect(starsOnly.noStarEvidenceCanCauseBurn).toBe(false);
  });

  it("keeps sell and burn strategic, non-executable and separate from BGC", () => {
    const result = rankLifecycleActions(
      input([core("sell", { sell: 9000, burn: 8000, hold: 7000 })]),
    );
    expect(result.cores[0]).toMatchObject({
      leadingAction: "sell",
      finalRecommendationAllowed: false,
      saleExecutionAllowed: false,
      burnExecutionAllowed: false,
      ledgerMutationAllowed: false,
      burnCreditUsedInRanking: false,
    });
    expect(
      result.cores[0]?.rankedActions.find(({ action }) => action === "sell")
        ?.strategicReviewOnly,
    ).toBe(true);
  });

  it("requires all seven actions exactly once", () => {
    const missing = core("missing");
    expect(() =>
      rankLifecycleActions(
        input([
          {
            ...missing,
            actionEvidence: missing.actionEvidence.slice(0, 6),
          },
        ]),
      ),
    ).toThrow("Every lifecycle action is required");

    const duplicate = core("duplicate");
    expect(() =>
      rankLifecycleActions(
        input([
          {
            ...duplicate,
            actionEvidence: [
              ...duplicate.actionEvidence.slice(0, 6),
              duplicate.actionEvidence[0]!,
            ],
          },
        ]),
      ),
    ).toThrow("must be unique");
  });

  it("rejects invalid scores, identity duplication and reversed timestamps", () => {
    const invalid = core("invalid");
    expect(() =>
      rankLifecycleActions(
        input([
          {
            ...invalid,
            actionEvidence: invalid.actionEvidence.map((evidence) =>
              evidence.action === "race"
                ? { ...evidence, scoreBasisPoints: 10_001 }
                : evidence,
            ),
          },
        ]),
      ),
    ).toThrow("integer from 0 to 10000");
    expect(() =>
      rankLifecycleActions(input([core("same"), core("same")])),
    ).toThrow("Core IDs must be unique");
    expect(() =>
      rankLifecycleActions(
        input([core("time")], {
          evaluatedAt: "2026-07-21T00:00:00Z",
        }),
      ),
    ).toThrow("cannot predate imported evidence");
  });
});
