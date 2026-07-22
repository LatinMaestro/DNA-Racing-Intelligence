import { describe, expect, it } from "vitest";
import { isGoldStarEligible } from "@/domain/game-rules";
import {
  isNegativeGoldOpportunity,
  normalizeStarValue,
  validateEventStars,
} from "@/domain/star-signals";

describe("Gold and Blue signal foundations", () => {
  it.each([1, 2, 3])("marks %i gates as Gold-ineligible", (gateCount) => {
    expect(isGoldStarEligible(gateCount)).toBe(false);
  });

  it("marks more than three gates as Gold-eligible", () => {
    expect(isGoldStarEligible(4)).toBe(true);
  });

  it("keeps false distinct from missing and invalid source values", () => {
    expect(normalizeStarValue("FALSE")).toMatchObject({
      value: false,
      status: "complete",
    });
    expect(normalizeStarValue("")).toMatchObject({
      value: null,
      status: "missing",
    });
    expect(normalizeStarValue("not-known")).toMatchObject({
      value: null,
      status: "invalid",
    });
  });

  it("retains and flags a source Gold assignment in an ineligible event", () => {
    expect(
      validateEventStars(3, [
        { coreId: "synthetic-1", goldStar: true, blueStar: false },
      ]),
    ).toContain("GOLD_INELIGIBLE_ASSIGNMENT");
  });

  it("surfaces multiple assignments and supports the same core receiving both", () => {
    expect(
      validateEventStars(6, [
        { coreId: "synthetic-1", goldStar: true, blueStar: true },
      ]),
    ).toEqual([]);
    expect(
      validateEventStars(6, [
        { coreId: "synthetic-1", goldStar: true, blueStar: false },
        { coreId: "synthetic-2", goldStar: true, blueStar: true },
      ]),
    ).toContain("MULTIPLE_GOLD_ASSIGNMENTS");
  });

  it("never treats an ineligible or unassigned event as negative Gold evidence", () => {
    expect(
      isNegativeGoldOpportunity({
        gateCount: 3,
        eventAssignedGold: true,
        entryGoldStar: false,
      }),
    ).toBe(false);
    expect(
      isNegativeGoldOpportunity({
        gateCount: 6,
        eventAssignedGold: false,
        entryGoldStar: false,
      }),
    ).toBe(false);
    expect(
      isNegativeGoldOpportunity({
        gateCount: 6,
        eventAssignedGold: true,
        entryGoldStar: false,
      }),
    ).toBe(true);
  });
});
