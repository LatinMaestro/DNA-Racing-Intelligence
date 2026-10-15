import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProLeagueMapCoverage } from "@/components/pro-league-map-coverage";
import type { ProLeagueOwnerMapMapping } from "@/domain/pro-league-owner-commissioning-plan";

describe("Pro League map evidence coverage", () => {
  it("separates exact segments and counts repeated mapped starts without inventing competitive strength", () => {
    const line = {
      raceNumber: 1,
      first16: true,
      raceType: "1v1",
      distanceMetres: 1000,
      totalGateEntries: 2,
      ourSlots: 1,
      coreIds: ["synthetic-core"],
      coreNames: ["Synthetic"],
      evidenceBackedCount: 0,
      allSlotsFilled: true,
    };
    const maps: readonly ProLeagueOwnerMapMapping[] = [
      {
        mapId: "map-1",
        name: "Anchor",
        requiredCoreEntries: 3,
        assignedCoreEntries: 2,
        allSlotsFilled: false,
        lines: [
          line,
          { ...line, raceNumber: 2 },
          {
            ...line,
            raceNumber: 3,
            distanceMetres: 1200,
            coreIds: [],
            coreNames: [],
            allSlotsFilled: false,
          },
        ],
      },
      {
        mapId: "map-2",
        name: "Glory",
        requiredCoreEntries: 0,
        assignedCoreEntries: 0,
        allSlotsFilled: true,
        lines: [],
      },
    ];
    const before = JSON.stringify(maps);
    const html = renderToStaticMarkup(<ProLeagueMapCoverage maps={maps} />);
    expect(html).toContain("2/2 mapped");
    expect(html).toContain("0/1 mapped");
    expect(html).toContain("0 evidence-backed");
    expect(html).toContain("Evidence gap");
    expect(html).toContain("Unfilled gates");
    expect(html).toContain('aria-label="Not on this map"');
    expect(html).toContain('href="#mapping-map-1"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("not independent historical samples");
    expect(html).not.toContain("50%");
    expect(html).not.toContain("Winning range");
    expect(JSON.stringify(maps)).toBe(before);
  });
  it("does not manufacture an empty map result", () => {
    const html = renderToStaticMarkup(<ProLeagueMapCoverage maps={[]} />);
    expect(html).toContain("No accepted map mappings available");
    expect(html).not.toContain("<table");
  });
});
