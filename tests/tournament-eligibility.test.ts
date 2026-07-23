import { describe, expect, it } from "vitest";

import {
  evaluateTournamentEligibility,
  type TournamentEligibilityCoreInput,
  type TournamentEligibilityRuleInput,
} from "@/domain/tournament-eligibility";

function rule(
  overrides: Partial<TournamentEligibilityRuleInput> = {},
): TournamentEligibilityRuleInput {
  return {
    bracketId: "horse-maiden",
    classes: [],
    elements: [],
    fNumbers: [],
    maidenRequirement: "maiden_eligible",
    leaderboardGroups: [
      {
        groupId: "metal-fire",
        label: "Metal + Fire",
        classes: [],
        elements: ["Metal", "Fire"],
        fNumbers: [],
      },
      {
        groupId: "earth-water",
        label: "Earth + Water",
        classes: [],
        elements: ["Earth", "Water"],
        fNumbers: [],
      },
    ],
    ...overrides,
  };
}

function core(
  overrides: Partial<TournamentEligibilityCoreInput> = {},
): TournamentEligibilityCoreInput {
  return {
    coreId: "core-a",
    coreClass: "Morphed",
    element: "Fire",
    fNumber: 12,
    activeOwned: true,
    identityResolved: true,
    maidenState: "eligible",
    availability: "available",
    dataCurrentThrough: "2026-07-20T00:00:00Z",
    lastImported: "2026-07-21T00:00:00Z",
    freshness: "current",
    ...overrides,
  };
}

describe("tournament eligibility", () => {
  it("maps eligible cores into combined leaderboard groups", () => {
    const result = evaluateTournamentEligibility(rule(), core());

    expect(result).toEqual(
      expect.objectContaining({
        status: "eligible",
        leaderboardGroupId: "metal-fire",
        reasons: [],
        warnings: [],
        performanceEvidenceUsed: false,
        starEvidenceUsed: false,
        automaticEntryAllowed: false,
      }),
    );
  });

  it("keeps inactive or unavailable cores ineligible", () => {
    expect(
      evaluateTournamentEligibility(rule(), core({ activeOwned: false })),
    ).toEqual(
      expect.objectContaining({
        status: "ineligible",
        reasons: ["NOT_ACTIVE_OWNED"],
      }),
    );
    expect(
      evaluateTournamentEligibility(
        rule(),
        core({ availability: "unavailable" }),
      ),
    ).toEqual(
      expect.objectContaining({
        status: "ineligible",
        reasons: ["CORE_UNAVAILABLE"],
      }),
    );
  });

  it("enforces class, element and F-number eligibility independently", () => {
    const restricted = rule({
      classes: ["Genesis"],
      elements: ["Water"],
      fNumbers: [{ minimum: 1, maximum: 8 }],
      leaderboardGroups: [],
    });
    const result = evaluateTournamentEligibility(restricted, core());

    expect(result.status).toBe("ineligible");
    expect(result.reasons).toEqual([
      "CLASS_INELIGIBLE",
      "ELEMENT_INELIGIBLE",
      "F_NUMBER_INELIGIBLE",
    ]);
  });

  it("enforces Maiden-only and non-Maiden rules", () => {
    expect(
      evaluateTournamentEligibility(
        rule({ leaderboardGroups: [] }),
        core({ maidenState: "not_eligible" }),
      ).reasons,
    ).toEqual(["MAIDEN_REQUIRED"]);
    expect(
      evaluateTournamentEligibility(
        rule({
          maidenRequirement: "not_maiden_eligible",
          leaderboardGroups: [],
        }),
        core(),
      ).reasons,
    ).toEqual(["MAIDEN_NOT_PERMITTED"]);
  });

  it("holds unresolved identity, attributes, Maiden state and availability", () => {
    const result = evaluateTournamentEligibility(
      rule({
        classes: ["Morphed"],
        elements: ["Fire"],
        fNumbers: [{ minimum: 1, maximum: 20 }],
        leaderboardGroups: [],
      }),
      core({
        coreClass: null,
        element: null,
        fNumber: null,
        identityResolved: false,
        maidenState: "unknown",
        availability: "unknown",
      }),
    );

    expect(result.status).toBe("review_required");
    expect(result.warnings).toEqual([
      "AVAILABILITY_UNKNOWN",
      "CORE_ATTRIBUTE_INCOMPLETE",
      "IDENTITY_UNRESOLVED",
      "MAIDEN_STATE_UNRESOLVED",
    ]);
  });

  it("does not require attributes or Maiden state that an open rule does not use", () => {
    const result = evaluateTournamentEligibility(
      rule({
        classes: [],
        elements: [],
        fNumbers: [],
        maidenRequirement: "any",
        leaderboardGroups: [],
      }),
      core({
        coreClass: null,
        element: null,
        fNumber: null,
        maidenState: "unknown",
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: "eligible",
        warnings: [],
      }),
    );
  });

  it("holds cores that match no leaderboard group", () => {
    const result = evaluateTournamentEligibility(
      rule({
        leaderboardGroups: [
          {
            groupId: "water",
            label: "Water",
            classes: [],
            elements: ["Water"],
            fNumbers: [],
          },
        ],
      }),
      core(),
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: "review_required",
        leaderboardGroupId: null,
        warnings: ["LEADERBOARD_GROUP_UNRESOLVED"],
      }),
    );
  });

  it("holds ambiguous overlapping leaderboard groups", () => {
    const result = evaluateTournamentEligibility(
      rule({
        leaderboardGroups: [
          {
            groupId: "fire",
            label: "Fire",
            classes: [],
            elements: ["Fire"],
            fNumbers: [],
          },
          {
            groupId: "spliced",
            label: "Spliced",
            classes: ["Morphed", "Freak", "X-Class"],
            elements: [],
            fNumbers: [],
          },
        ],
      }),
      core(),
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: "review_required",
        leaderboardGroupId: null,
        warnings: ["LEADERBOARD_GROUP_AMBIGUOUS"],
      }),
    );
  });

  it("surfaces imported snapshot age without pretending ownership is live", () => {
    expect(
      evaluateTournamentEligibility(rule(), core({ freshness: "ageing" })),
    ).toEqual(
      expect.objectContaining({
        status: "review_required",
        warnings: ["IMPORTED_DATA_AGEING"],
      }),
    );
    expect(
      evaluateTournamentEligibility(
        rule(),
        core({ freshness: "stale", dataCurrentThrough: null }),
      ),
    ).toEqual(
      expect.objectContaining({
        status: "review_required",
        warnings: ["DATA_CUTOFF_UNKNOWN", "IMPORTED_DATA_STALE"],
      }),
    );
  });

  it("tracks import completion separately and rejects impossible timestamp order", () => {
    expect(
      evaluateTournamentEligibility(rule(), core({ lastImported: null })),
    ).toEqual(
      expect.objectContaining({
        status: "review_required",
        warnings: ["LAST_IMPORTED_UNKNOWN"],
      }),
    );
    expect(() =>
      evaluateTournamentEligibility(
        rule(),
        core({
          dataCurrentThrough: "2026-07-21T00:00:00Z",
          lastImported: "2026-07-20T00:00:00Z",
        }),
      ),
    ).toThrow("cannot precede");
  });

  it("rejects malformed and overlapping rule ranges", () => {
    expect(() =>
      evaluateTournamentEligibility(
        rule({
          fNumbers: [
            { minimum: 1, maximum: 8 },
            { minimum: 8, maximum: 12 },
          ],
        }),
        core(),
      ),
    ).toThrow("must not overlap");
  });

  it("rejects empty and duplicate leaderboard definitions", () => {
    expect(() =>
      evaluateTournamentEligibility(
        rule({
          leaderboardGroups: [
            {
              groupId: "empty",
              label: "Empty",
              classes: [],
              elements: [],
              fNumbers: [],
            },
          ],
        }),
        core(),
      ),
    ).toThrow("at least one eligibility criterion");
    expect(() =>
      evaluateTournamentEligibility(
        rule({
          leaderboardGroups: [
            {
              groupId: "same",
              label: "One",
              classes: [],
              elements: ["Fire"],
              fNumbers: [],
            },
            {
              groupId: "same",
              label: "Two",
              classes: [],
              elements: ["Water"],
              fNumbers: [],
            },
          ],
        }),
        core(),
      ),
    ).toThrow("IDs must be unique");
  });
});
