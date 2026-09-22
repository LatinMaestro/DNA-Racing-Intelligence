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
    const privateIds = [
      "private-core-1",
      "private-core-2",
      "private-core-3",
      "private-core-4",
    ];
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
      substitutionLedger: {
        status: "connected",
        seasonYear: 2026,
        maximumSubstitutions: 10,
        usedCount: 2,
        remainingCount: 8,
        substitutions: [],
      },
      substitutionWatch: {
        methodology: {
          primaryEvidence: "same_bike_race_type_and_exact_distance",
          metrics: "time_speed_consistency_sample_freshness",
          populationBoundary: "required_but_currently_gated",
          first16Priority: true,
          primaryMaps: ["Anchor", "Measure", "Glory"],
          contingencyMap: "Miracles",
          maximumAdjacentDistanceSteps: 1,
          winRateRole: "supporting_only",
          automaticRosterMutationAllowed: false,
        },
        candidates: [
          {
            coreId: privateIds[3],
            displayName: "Rapid Echo",
            element: "Fire",
            fNumber: 18,
            sex: "male",
            selectionStatus: "top_three_range",
            strongestDistances: [1200, 1400],
            exactFormatCellCount: 2,
            acceptedRaceCount: 24,
            watchReason: "performance_or_map_upgrade",
            recommendedScenario: {
              incomingCoreId: privateIds[3],
              incomingCoreName: "Rapid Echo",
              outgoingCoreId: privateIds[1],
              outgoingCoreName: "Frost Rocket",
              rosterCompliant: true,
              assignedCoreEntries: 1021,
              requiredCoreEntries: 1021,
              allSlotsFilled: true,
              changedLineCount: 1,
              changedFirst16LineCount: 1,
              strongerLineCount: 1,
              weakerLineCount: 0,
              strongerFirst16LineCount: 1,
              weakerFirst16LineCount: 0,
              netFirst16Direction: 1,
              netAllLineDirection: 1,
              qualityRankDelta: 3,
              changedLines: [
                {
                  mapId: "map-1",
                  mapName: "Anchor",
                  raceNumber: 2,
                  first16: true,
                  raceType: "6 gate madness",
                  distanceMetres: 1200,
                  removedCoreNames: ["Frost Rocket"],
                  addedCoreNames: ["Rapid Echo"],
                  strengthDirection: "stronger",
                },
              ],
            },
          },
        ],
        ageingWatch: {
          status: "authority_pending",
          detail:
            "Current authoritative Pro League ageing increments and cap mechanics remain unresolved. The watch list must not invent a cap.",
        },
      },
    } as unknown as ProLeagueDraftCommissioningState;

    const markup = renderToStaticMarkup(
      <ProLeagueCommissioningPanel state={state} />,
    );

    expect(markup).toContain("Roster recommendation");
    expect(markup).toContain("Roster health");
    expect(markup).toContain("2/10 used");
    expect(markup).toContain("Substitution watch");
    expect(markup).toContain("Rapid Echo");
    expect(markup).toContain("Analyse Rapid Echo");
    expect(markup).toContain("Frost Rocket");
    expect(markup).toContain("1,021/1,021 gates");
    expect(markup).toContain("full remap simulation");
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
