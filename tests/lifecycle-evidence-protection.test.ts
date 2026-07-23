import { describe, expect, it } from "vitest";

import {
  protectLifecycleEvidence,
  type LifecycleProtectionCoreInput,
  type LifecycleProtectionInput,
} from "../domain/lifecycle-evidence-protection";

function core(
  coreId: string,
  overrides: Partial<LifecycleProtectionCoreInput> = {},
): LifecycleProtectionCoreInput {
  return {
    coreId,
    coreClass: "Morphed",
    activeOwnership: true,
    maidenState: "not_eligible",
    discoveryState: "exhausted",
    racingValue: "not_supported",
    breedingValue: "not_supported",
    lineageValue: "common",
    evidenceCoverage: "complete",
    negativeEvidenceSources: ["weak_time", "low_vault_fit"],
    ...overrides,
  };
}

function input(
  cores: readonly LifecycleProtectionCoreInput[],
  overrides: Partial<LifecycleProtectionInput> = {},
): LifecycleProtectionInput {
  return {
    reviewId: "review-1",
    evaluatedAt: "2026-07-23T08:00:00Z",
    dataCurrentThrough: "2026-07-21T00:00:00Z",
    lastImported: "2026-07-22T00:00:00Z",
    freshness: "current",
    cores,
    ...overrides,
  };
}

describe("lifecycle evidence protection", () => {
  it("permanently forbids Genesis burn while retaining review-only output", () => {
    const result = protectLifecycleEvidence(
      input([core("genesis", { coreClass: "Genesis" })]),
    );
    expect(result.cores[0]).toMatchObject({
      burnEligibility: "forbidden",
      reviewStatus: "ready",
      protectedFromSale: false,
      finalRecommendationAllowed: false,
    });
    expect(result.cores[0]?.protectionReasons).toContain(
      "Genesis cores cannot be burned.",
    );
  });

  it("protects available and unresolved Maiden opportunity", () => {
    const result = protectLifecycleEvidence(
      input([
        core("eligible", { maidenState: "eligible" }),
        core("unknown", { maidenState: "unknown" }),
        core("invalid", { maidenState: "invalid" }),
      ]),
    );
    expect(
      result.cores.every(({ protectedFromSale }) => protectedFromSale),
    ).toBe(true);
    expect(
      result.cores.every(
        ({ burnEligibility }) => burnEligibility === "review_required",
      ),
    ).toBe(true);
  });

  it("protects promising discovery and supported strategic value", () => {
    const result = protectLifecycleEvidence(
      input([
        core("discover", { discoveryState: "promising" }),
        core("race", { racingValue: "supported" }),
        core("breed", { breedingValue: "supported" }),
        core("lineage", { lineageValue: "distinctive" }),
      ]),
    );
    expect(
      result.cores.every(
        ({ reviewStatus }) => reviewStatus === "review_required",
      ),
    ).toBe(true);
  });

  it("holds stale and incomplete evidence fail closed", () => {
    const stale = protectLifecycleEvidence(
      input([core("stale")], { freshness: "stale" }),
    );
    expect(stale.cores[0]?.protectionReasons[0]).toContain("stale");

    const partial = protectLifecycleEvidence(
      input([core("partial", { evidenceCoverage: "partial" })]),
    );
    expect(partial.cores[0]?.protectedFromSale).toBe(true);
  });

  it("never allows star-only negative evidence to support disposal", () => {
    const result = protectLifecycleEvidence(
      input([
        core("stars-only", {
          negativeEvidenceSources: [
            "eligible_no_star",
            "gold_ineligible_absence",
          ],
        }),
      ]),
    );
    expect(result.cores[0]).toMatchObject({
      burnEligibility: "review_required",
      nonStarNegativeEvidencePresent: false,
      noStarEvidenceCanCauseBurn: false,
    });
    expect(result.cores[0]?.protectionReasons.join(" ")).toContain(
      "cannot support disposal alone",
    );
  });

  it("permits only a later review when complete non-star evidence has no protector", () => {
    const result = protectLifecycleEvidence(input([core("reviewable")]));
    expect(result.cores[0]).toMatchObject({
      reviewStatus: "ready",
      protectedFromSale: false,
      burnEligibility: "eligible_for_review",
      finalRecommendationAllowed: false,
    });
  });

  it("keeps inactive cores historical and cannot mutate source or ledger facts", () => {
    const result = protectLifecycleEvidence(
      input([core("inactive", { activeOwnership: false })]),
    );
    expect(result.cores[0]).toMatchObject({
      reviewStatus: "historical_only",
      burnEligibility: "forbidden",
    });
    expect(result).toMatchObject({
      sourceFactsMutated: false,
      ledgerMutationAllowed: false,
      actualBurnCreditConsidered: false,
    });
  });

  it("rejects duplicate identity, unsupported runtime values and timestamp reversal", () => {
    expect(() =>
      protectLifecycleEvidence(input([core("same"), core("same")])),
    ).toThrow("Core IDs must be unique");
    expect(() =>
      protectLifecycleEvidence(
        input([
          core("bad", {
            coreClass: "Hybrid" as LifecycleProtectionCoreInput["coreClass"],
          }),
        ]),
      ),
    ).toThrow("Core class is invalid");
    expect(() =>
      protectLifecycleEvidence(
        input([core("time")], {
          lastImported: "2026-07-20T00:00:00Z",
        }),
      ),
    ).toThrow("cannot precede data current through");
  });
});
