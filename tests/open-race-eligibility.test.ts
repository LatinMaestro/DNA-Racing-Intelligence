import { describe, expect, it } from "vitest";

import {
  evaluateOpenRaceEligibility,
  type OpenRaceEligibilityCore,
  type OpenRaceEligibilityInput,
} from "../domain/open-race-eligibility";

function core(
  coreId: string,
  overrides: Partial<OpenRaceEligibilityCore> = {},
): OpenRaceEligibilityCore {
  return {
    coreId,
    activeOwnership: "confirmed",
    availability: "available",
    coreClass: "Morphed",
    element: "Fire",
    fNumber: 8,
    maidenState: "not_eligible",
    attributeEvidence: "complete",
    ...overrides,
  };
}

function input(
  cores: readonly OpenRaceEligibilityCore[],
  overrides: Partial<OpenRaceEligibilityInput> = {},
): OpenRaceEligibilityInput {
  return {
    evaluationId: "eligibility-1",
    evaluatedAt: "2026-07-23T10:00:00Z",
    vaultDataCurrentThrough: "2026-07-22T00:00:00Z",
    freshness: "current",
    rules: {
      ruleSetId: "rules-1",
      evidenceStatus: "confirmed",
      allowedClasses: ["Morphed", "Freak"],
      allowedElements: ["Fire", "Earth"],
      minimumFNumber: 5,
      maximumFNumber: 10,
      maidenRequirement: "not_restricted",
    },
    cores,
    ...overrides,
  };
}

describe("Open Race eligibility", () => {
  it("returns only confirmed owned, available and rule-compliant cores", () => {
    const result = evaluateOpenRaceEligibility(
      input([
        core("eligible"),
        core("wrong-class", { coreClass: "Genesis" }),
        core("wrong-element", { element: "Water" }),
        core("wrong-f", { fNumber: 11 }),
        core("unavailable", { availability: "unavailable" }),
      ]),
    );
    expect(result.eligibleCoreIds).toEqual(["eligible"]);
    expect(result.rankingPerformed).toBe(false);
    expect(result.currentRaceStarsUsed).toBe(false);
  });

  it("keeps unresolved ownership and attributes out of eligibility", () => {
    const result = evaluateOpenRaceEligibility(
      input([
        core("ownership", { activeOwnership: "unresolved" }),
        core("attributes", { element: null, attributeEvidence: "partial" }),
      ]),
    );
    expect(result.eligibleCoreIds).toEqual([]);
    expect(result.cores.map(({ status }) => status)).toEqual([
      "review_required",
      "review_required",
    ]);
  });

  it("applies required and excluded Maiden rules without changing ME", () => {
    const required = evaluateOpenRaceEligibility(
      input([core("me", { maidenState: "eligible" }), core("not-me")], {
        rules: {
          ...input([]).rules,
          maidenRequirement: "required",
        },
      }),
    );
    expect(required.eligibleCoreIds).toEqual(["me"]);

    const excluded = evaluateOpenRaceEligibility(
      input([core("me", { maidenState: "eligible" }), core("not-me")], {
        rules: {
          ...input([]).rules,
          maidenRequirement: "excluded",
        },
      }),
    );
    expect(excluded.eligibleCoreIds).toEqual(["not-me"]);
    expect(excluded.ownershipMutated).toBe(false);
  });

  it("holds all otherwise eligible cores when rules or freshness are uncertain", () => {
    const uncertain = evaluateOpenRaceEligibility(
      input([core("candidate")], {
        freshness: "stale",
        rules: {
          ...input([]).rules,
          evidenceStatus: "uncertain",
        },
      }),
    );
    expect(uncertain.eligibleCoreIds).toEqual([]);
    expect(uncertain.cores[0]?.status).toBe("review_required");

    const uncertainMismatch = evaluateOpenRaceEligibility(
      input([core("possible", { coreClass: "Genesis" })], {
        rules: {
          ...input([]).rules,
          evidenceStatus: "uncertain",
        },
      }),
    );
    expect(uncertainMismatch.cores[0]).toMatchObject({
      status: "review_required",
      reasons: [
        "Eligibility rules or Vault freshness require manual confirmation.",
      ],
    });
  });

  it("rejects malformed rule ranges and duplicate values", () => {
    expect(() =>
      evaluateOpenRaceEligibility(
        input([core("candidate")], {
          rules: {
            ...input([]).rules,
            minimumFNumber: 10,
            maximumFNumber: 5,
          },
        }),
      ),
    ).toThrow("cannot exceed");
    expect(() =>
      evaluateOpenRaceEligibility(
        input([core("candidate")], {
          rules: {
            ...input([]).rules,
            allowedClasses: ["Morphed", "Morphed"],
          },
        }),
      ),
    ).toThrow("must not contain duplicates");
  });

  it("rejects duplicate cores and invalid timestamps", () => {
    expect(() =>
      evaluateOpenRaceEligibility(input([core("same"), core("same")])),
    ).toThrow("Core IDs must not contain duplicates");
    expect(() =>
      evaluateOpenRaceEligibility(
        input([core("time")], {
          evaluatedAt: "2026-07-21T00:00:00Z",
        }),
      ),
    ).toThrow("cannot predate Vault evidence");
  });

  it("rejects hidden current-race star evidence at runtime", () => {
    expect(() =>
      evaluateOpenRaceEligibility(
        input([
          {
            ...core("hidden-star"),
            goldStar: true,
          } as OpenRaceEligibilityCore,
        ]),
      ),
    ).toThrow("cannot contain current-race star evidence");
  });
});
