import { describe, expect, it } from "vitest";

import { proLeagueMaps } from "@/domain/pro-league-maps";
import {
  normalizeProLeagueOwnerCoreName,
  proLeagueOwnerDistanceDepth,
  proLeagueOwnerFinalRosterPlan,
  proLeagueOwnerMapStrategy,
} from "@/domain/pro-league-owner-final-plan";

describe("final owner Pro League plan", () => {
  it("locks the final 25, audited distance depth and map strategy", () => {
    expect(proLeagueOwnerFinalRosterPlan).toHaveLength(25);
    expect(
      new Set(
        proLeagueOwnerFinalRosterPlan.map(({ displayName }) =>
          normalizeProLeagueOwnerCoreName(displayName),
        ),
      ).size,
    ).toBe(25);

    for (const distance of [1000, 1200, 1400, 1600, 1800, 2000, 2200]) {
      expect(proLeagueOwnerDistanceDepth[distance]).toHaveLength(12);
      expect(
        new Set(
          proLeagueOwnerDistanceDepth[distance].map(
            normalizeProLeagueOwnerCoreName,
          ),
        ).size,
      ).toBe(12);
    }

    const requiredOwnedGateEntries = proLeagueMaps
      .flatMap(({ races }) => races)
      .reduce((sum, race) => sum + race.gateEntriesPerVault, 0);
    expect(requiredOwnedGateEntries).toBe(1_021);

    expect(proLeagueOwnerMapStrategy).toMatchObject({
      homePick: "map-1",
      homeDeny: "map-4",
      awayPriority: ["map-1", "map-3", "map-2", "map-4"],
      rosterDrivingMaps: ["map-1", "map-3", "map-2"],
      contingencyMap: "map-4",
      first16Priority: true,
    });
  });

  it("normalizes apostrophes so the final roster matches live Core names safely", () => {
    expect(normalizeProLeagueOwnerCoreName("She’s Extreme")).toBe(
      normalizeProLeagueOwnerCoreName("She's Extreme"),
    );
  });
});
