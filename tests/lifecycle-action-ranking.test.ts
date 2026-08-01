import { describe, expect, it } from "vitest";
import { rankLifecycleActions } from "@/domain/lifecycle-action-ranking";
import { core, ranking, versions } from "./lifecycle-fixture";

describe("lifecycle action ranking", () => {
  it("ranks complete supported evidence while keeping every boundary non-actionable", () => {
    const result = rankLifecycleActions(ranking());
    expect(result.cores[0]).toMatchObject({
      leadingAction: "race",
      finalRecommendationAllowed: false,
      saleExecutionAllowed: false,
      burnExecutionAllowed: false,
      ledgerMutationAllowed: false,
      burnCreditUsedInRanking: false,
      saleProfitUsedInRanking: false,
    });
    expect(result).toMatchObject({
      noStarEvidenceCanCauseBurn: false,
      sourceFactsMutated: false,
    });
  });

  it("preserves tied ranks without selecting an arbitrary leader", () => {
    const result = rankLifecycleActions(
      ranking({ cores: [core("tie", { race: 9_000, breed: 9_000 })] }),
    );
    expect(
      result.cores[0]?.rankedActions.slice(0, 2).map(({ rank }) => rank),
    ).toEqual([1, 1]);
    expect(result.cores[0]?.leadingAction).toBe("insufficient_evidence");
  });

  it.each([
    ["racingState", "unresolved", "Racing value is unresolved."],
    ["discoveryState", "unresolved", "Discovery value is unresolved."],
    ["maidenState", "unknown", "Maiden value is unresolved."],
    ["breedingState", "unresolved", "Breeding value is unresolved."],
    ["lineageState", "unresolved", "Lineage value is unresolved."],
    ["marketEvidence", "unresolved", "Market value is unresolved."],
  ] as const)(
    "holds every action when %s is unresolved",
    (field, value, reason) => {
      const result = rankLifecycleActions(
        ranking({ cores: [core("held", {}, { [field]: value })] }),
      );
      expect(result.cores[0]?.rankedActions).toEqual([]);
      expect(result.cores[0]?.heldActions).toHaveLength(7);
      expect(result.cores[0]?.reviewReasons).toContain(reason);
    },
  );

  it("forbids Genesis burn through the confirmed game rule", () => {
    const result = rankLifecycleActions(
      ranking({
        cores: [
          core(
            "genesis",
            { burn: 10_000, hold: 5_000 },
            {
              coreClass: "Genesis",
              racingState: "weak",
              breedingState: "not_supported",
              lineageState: "not_supported",
              nonStarNegativeEvidencePresent: true,
            },
          ),
        ],
      }),
    );
    expect(
      result.cores[0]?.heldActions.find(({ action }) => action === "burn")
        ?.reasons,
    ).toContain("Genesis cores cannot be burned.");
    expect(result.cores[0]?.leadingAction).toBe("hold");
  });

  it.each(["eligible_no_star", "gold_ineligible"] as const)(
    "does not permit %s evidence to create burn",
    (starEvidenceState) => {
      const result = rankLifecycleActions(
        ranking({
          cores: [
            core(
              "stars",
              { burn: 10_000, hold: 5_000 },
              {
                starEvidenceState,
                nonStarNegativeEvidencePresent: false,
                racingState: "credible",
              },
            ),
          ],
        }),
      );
      expect(
        result.cores[0]?.heldActions.find(({ action }) => action === "burn")
          ?.reasons,
      ).toContain(
        "Burn review requires explicit independent non-star negative evidence.",
      );
      expect(result.cores[0]?.leadingAction).toBe("hold");
    },
  );

  it("allows burn only into strategic review with explicit independent non-star negatives", () => {
    const result = rankLifecycleActions(
      ranking({
        cores: [
          core(
            "review",
            { burn: 10_000, hold: 5_000 },
            {
              racingState: "weak",
              breedingState: "not_supported",
              lineageState: "not_supported",
              nonStarNegativeEvidencePresent: true,
              starEvidenceState: "unavailable",
            },
          ),
        ],
      }),
    );
    expect(result.cores[0]?.leadingAction).toBe("burn");
    expect(result.cores[0]?.rankedActions[0]).toMatchObject({
      action: "burn",
      strategicReviewOnly: true,
    });
    expect(result.cores[0]?.burnExecutionAllowed).toBe(false);
  });

  it("surfaces missing cost basis without inventing sale profit", () => {
    const result = rankLifecycleActions(
      ranking({
        cores: [core("sale", { sell: 9_000 }, { costBasisStatus: "missing" })],
      }),
    );
    expect(result.cores[0]?.leadingAction).toBe("sell");
    expect(result.cores[0]?.accountingWarnings).toContain(
      "Cost basis is unavailable; sale proceeds cannot be described as profit.",
    );
    expect(result.cores[0]?.saleProfitUsedInRanking).toBe(false);
  });

  it("holds version drift and rejects burn-credit inputs", () => {
    const drift = rankLifecycleActions(
      ranking({
        cores: [
          core(
            "drift",
            {},
            {
              evidenceVersions: {
                ...versions,
                lineageSnapshotVersion: "other",
              },
            },
          ),
        ],
      }),
    );
    expect(drift.cores[0]?.rankedActions).toEqual([]);
    expect(() =>
      rankLifecycleActions(
        ranking({
          cores: [{ ...core("credit"), predictedBurnCredit: 12 } as never],
        }),
      ),
    ).toThrow("Burn-credit evidence is forbidden");
  });

  it("requires canonical timestamps, unique cores and all actions exactly once", () => {
    expect(() =>
      rankLifecycleActions(ranking({ evaluatedAt: "2026-07-28T00:00:00Z" })),
    ).toThrow("canonical UTC");
    expect(() =>
      rankLifecycleActions(ranking({ cores: [core("same"), core("same")] })),
    ).toThrow("unique");
    const incomplete = core("incomplete");
    expect(() =>
      rankLifecycleActions(
        ranking({
          cores: [
            {
              ...incomplete,
              actionEvidence: incomplete.actionEvidence.slice(0, 6),
            },
          ],
        }),
      ),
    ).toThrow("Every lifecycle action");
  });
});
