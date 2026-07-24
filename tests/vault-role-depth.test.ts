import { describe, expect, it } from "vitest";

import {
  analyseVaultRoleDepth,
  type VaultRoleCoreInput,
  type VaultRoleDepthInput,
  type VaultRoleEvidenceInput,
} from "../domain/vault-role-depth";

function role(
  overrides: Partial<VaultRoleEvidenceInput> = {},
): VaultRoleEvidenceInput {
  return {
    role: "racing_specialist",
    mode: "Car",
    exactDistanceM: 1000,
    evidenceStatus: "supported",
    strengthBasisPoints: 8000,
    exceptionalUpsideBasisPoints: 1000,
    ...overrides,
  };
}

function core(
  coreId: string,
  roles: readonly VaultRoleEvidenceInput[],
  activeOwnership = true,
): VaultRoleCoreInput {
  return { coreId, roles, activeOwnership };
}

function input(
  cores: readonly VaultRoleCoreInput[],
  overrides: Partial<VaultRoleDepthInput> = {},
): VaultRoleDepthInput {
  return {
    analysisId: "depth-1",
    evaluatedAt: "2026-07-23T08:00:00Z",
    credibleStrengthThresholdBasisPoints: 7000,
    exceptionalUpsideThresholdBasisPoints: 8500,
    minimumAlternativeCount: 2,
    cores,
    ...overrides,
  };
}

describe("vault role depth", () => {
  it("groups exact mode-distance roles without merging modes or distances", () => {
    const result = analyseVaultRoleDepth(
      input([
        core("car-1000", [role()]),
        core("car-1200", [role({ exactDistanceM: 1200 })]),
        core("horse-1000", [role({ mode: "Horse" })]),
      ]),
    );
    expect(result.groups.map(({ roleKey }) => roleKey)).toEqual([
      "racing_specialist:Car:1000",
      "racing_specialist:Car:1200",
      "racing_specialist:Horse:1000",
    ]);
    expect(
      result.groups.every(({ depthStatus }) => depthStatus === "single"),
    ).toBe(true);
  });

  it("counts only supported credible alternatives as depth", () => {
    const result = analyseVaultRoleDepth(
      input([
        core("strong", [role()]),
        core("weak", [role({ strengthBasisPoints: 6000 })]),
        core("uncertain", [role({ evidenceStatus: "review_required" })]),
      ]),
    );
    expect(result.groups[0]).toMatchObject({
      credibleDepth: 1,
      depthStatus: "single",
      reviewRequiredCoreIds: ["uncertain"],
    });
  });

  it("identifies redundancy review only where every role has enough alternatives", () => {
    const shared = role();
    const result = analyseVaultRoleDepth(
      input([
        core("one", [shared]),
        core("two", [shared]),
        core("three", [shared]),
      ]),
    );
    expect(
      result.coreReviews.map(
        ({ redundancyReviewStatus }) => redundancyReviewStatus,
      ),
    ).toEqual([
      "eligible_for_review",
      "eligible_for_review",
      "eligible_for_review",
    ]);
    expect(result.duplicateCoverageIsDisposalEvidence).toBe(false);
    expect(result.recommendationAllowed).toBe(false);
  });

  it("protects a core that supplies any unique role", () => {
    const result = analyseVaultRoleDepth(
      input([
        core("mixed", [
          role(),
          role({
            role: "breeding_parent",
            mode: null,
            exactDistanceM: null,
          }),
        ]),
        core("two", [role()]),
        core("three", [role()]),
      ]),
    );
    expect(
      result.coreReviews.find(({ coreId }) => coreId === "mixed"),
    ).toMatchObject({
      redundancyReviewStatus: "protected",
      uniqueRoleKeys: ["breeding_parent:all_modes:all_distances"],
    });
  });

  it("never suppresses exceptional upside because a role is saturated", () => {
    const result = analyseVaultRoleDepth(
      input([
        core("rare", [role({ exceptionalUpsideBasisPoints: 9000 })]),
        core("two", [role()]),
        core("three", [role()]),
      ]),
    );
    expect(
      result.coreReviews.find(({ coreId }) => coreId === "rare"),
    ).toMatchObject({
      redundancyReviewStatus: "protected",
      exceptionalRoleKeys: ["racing_specialist:Car:1000"],
    });
    expect(result.exceptionalUpsideSuppressedBySaturation).toBe(false);
  });

  it("protects Maiden reserve, lineage and unresolved roles", () => {
    const result = analyseVaultRoleDepth(
      input([
        core("maiden", [
          role({ role: "maiden_reserve", mode: "Car", exactDistanceM: 1000 }),
        ]),
        core("lineage", [
          role({
            role: "lineage_anchor",
            mode: null,
            exactDistanceM: null,
          }),
        ]),
        core("unresolved", [role({ evidenceStatus: "review_required" })]),
      ]),
    );
    expect(
      result.coreReviews.every(
        ({ redundancyReviewStatus }) => redundancyReviewStatus === "protected",
      ),
    ).toBe(true);
  });

  it("excludes inactive cores from active depth", () => {
    const result = analyseVaultRoleDepth(
      input([core("active", [role()]), core("historical", [role()], false)]),
    );
    expect(result.groups[0]?.supportedCoreIds).toEqual(["active"]);
    expect(
      result.coreReviews.find(({ coreId }) => coreId === "historical"),
    ).toMatchObject({
      redundancyReviewStatus: "not_applicable",
    });
  });

  it("fails closed on malformed role structure and duplicate identities", () => {
    expect(() =>
      analyseVaultRoleDepth(
        input([
          core("bad", [
            role({
              role: "breeding_parent",
              mode: "Car",
              exactDistanceM: 1000,
            }),
          ]),
        ]),
      ),
    ).toThrow("whole-core role");
    expect(() =>
      analyseVaultRoleDepth(
        input([core("same", [role()]), core("same", [role()])]),
      ),
    ).toThrow("Core IDs must be unique");
  });
});
