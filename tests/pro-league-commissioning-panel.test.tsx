import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProLeagueCommissioningPanel } from "@/components/pro-league-commissioning-panel";
import type { ProLeagueDraftCommissioningState } from "@/lib/pro-league-draft-commissioning-service";

describe("Pro League commissioning panel", () => {
  it("fails closed when no active generation is available", () => {
    const markup = renderToStaticMarkup(
      <ProLeagueCommissioningPanel
        state={{
          connectionStatus: "active_generation_unavailable",
          evidence: null,
          roster: null,
          lineup: null,
        }}
      />,
    );

    expect(markup).toContain("No active Pro League evidence generation");
    expect(markup).not.toContain("Roster recommendation");
  });

  it("shows the compact final roster, map strategy and full-gate mapping", () => {
    const privateIds = ["private-core-1", "private-core-2", "private-core-3"];
    const state = {
      connectionStatus: "read_model_connected",
      evidence: null,
      roster: null,
      lineup: null,
      ownerPlan: {
        planId: "owner-final-roster/full-gate-win-first/2026-09-20",
        roster: [
          {
            coreId: privateIds[0],
            displayName: "Solar Surge",
            element: "Metal",
            fNumber: 3,
            sex: "female",
            primaryDistances: [1000, 1200],
          },
          {
            coreId: privateIds[1],
            displayName: "Frost Rocket",
            element: "Earth",
            fNumber: 15,
            sex: "female",
            primaryDistances: [1000, 1200],
          },
          {
            coreId: privateIds[2],
            displayName: "Scarlet Panther",
            element: "Fire",
            fNumber: 8,
            sex: "female",
            primaryDistances: [1000, 1200, 1400],
          },
        ],
        mapStrategy: {
          homePick: "Anchor",
          homeDeny: "Miracles",
          awayPriority: ["Anchor", "Measure", "Glory", "Miracles"],
          contingencyMap: "Miracles",
        },
        maps: [
          {
            mapId: "map-1",
            name: "Anchor",
            requiredCoreEntries: 3,
            assignedCoreEntries: 3,
            allSlotsFilled: true,
            lines: [
              {
                raceNumber: 2,
                first16: true,
                raceType: "6 gate madness",
                distanceMetres: 1000,
                totalGateEntries: 6,
                ourSlots: 3,
                coreIds: privateIds,
                coreNames: ["Solar Surge", "Frost Rocket", "Scarlet Panther"],
                evidenceBackedCount: 2,
                allSlotsFilled: true,
              },
            ],
          },
        ],
        requiredCoreEntries: 3,
        assignedCoreEntries: 3,
        allSlotsFilled: true,
      },
    } as unknown as ProLeagueDraftCommissioningState;

    const markup = renderToStaticMarkup(
      <ProLeagueCommissioningPanel state={state} />,
    );

    expect(markup).toContain("Roster recommendation");
    expect(markup).toContain("Map selection &amp; deny preference");
    expect(markup).toContain("Race mapping");
    expect(markup).toContain("Anchor");
    expect(markup).toContain("Miracles");
    expect(markup).toContain("Anchor → Measure → Glory → Miracles");
    expect(markup).toContain("3/3 gate entries");
    expect(markup).toContain("Solar Surge");
    expect(markup).toContain("Frost Rocket");
    expect(markup).toContain("Scarlet Panther");
    expect(markup).toContain("3/3");
    for (const privateId of privateIds) {
      expect(markup).not.toContain(privateId);
    }
    expect(markup).not.toContain("API refresh safety");
    expect(markup).not.toContain("Breeding");
    expect(markup).not.toContain("Discovery");
  });
});
