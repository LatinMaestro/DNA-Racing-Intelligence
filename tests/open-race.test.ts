import { describe, expect, it } from "vitest";
import { openRaceStarBoundary } from "@/domain/open-race";

describe("Open Race timing boundary", () => {
  it("has no current-race stars during pre-entry selection", () => {
    expect(openRaceStarBoundary("selection", 8)).toMatchObject({
      currentStarsAvailable: false,
      observationOnly: false,
    });
  });

  it("makes post-lock capture observation-only and forbids switching", () => {
    expect(openRaceStarBoundary("locked_observation", 8)).toMatchObject({
      currentStarsAvailable: true,
      observationOnly: true,
      replacementRecommendationAllowed: false,
      goldApplicable: true,
    });
  });

  it("shows Gold as not applicable in a locked three-gate race", () => {
    expect(openRaceStarBoundary("locked_observation", 3).goldApplicable).toBe(
      false,
    );
  });
});
