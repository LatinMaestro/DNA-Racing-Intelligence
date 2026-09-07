import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProLeagueCommissioningPanel } from "@/components/pro-league-commissioning-panel";
import type { ProLeagueDraftCommissioningState } from "@/lib/pro-league-draft-commissioning-service";

describe("Pro League commissioning panel", () => {
  it("fails closed visibly when no active generation is available", () => {
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
    expect(markup).toContain("No verified active recommendation generation");
    expect(markup).toContain(
      "hidden until a complete verified generation is active",
    );
  });

  it("renders names and exact-format assignments without exposing Core IDs", () => {
    const privateCoreId = "private-core-123";
    const state = {
      connectionStatus: "read_model_connected",
      evidence: {
        generationId: "84000000-0000-4000-8000-000000000301",
        evidenceCutoffAt: "2026-09-07T01:00:00.000Z",
        publishedAt: "2026-09-07T01:01:00.000Z",
        populationProfileCount: 1200,
        ownedProfileCount: 22,
        unownedProfileCount: 1178,
        ownedCoreWithoutEvidenceCount: 1,
      },
      roster: {
        candidates: [
          {
            core: {
              coreId: privateCoreId,
              displayName: "Silver Comet",
              element: "Metal",
              coreClass: "Pacer",
              sex: "female",
              fNumber: 18,
            },
          },
        ],
        draftRoster: {
          members: [
            {
              disposition: "rostered",
              position: 1,
              role: "nucleus",
              reason: "Winning-range exact-format coverage.",
              core: {
                coreId: privateCoreId,
                displayName: "Silver Comet",
                element: "Metal",
                coreClass: "Pacer",
                sex: "female",
                fNumber: 18,
              },
            },
          ],
        },
        coverageGaps: [
          {
            raceType: "1v1",
            distanceMetres: 1000,
            raceLineCount: 4,
            status: "best_available_but_weak",
            discoveryPriority: "high",
            guidance: "Collect stronger exact-format evidence.",
            bestAvailableCoreIds: [privateCoreId],
          },
        ],
        search: { status: "constructed" },
        operationalWarnings: [
          "Initial-roster substitution counting remains unresolved.",
        ],
      },
      lineup: {
        totals: {
          lineCount: 168,
          provisionalLineCount: 12,
          noExactEvidenceLineCount: 2,
        },
        maps: [
          {
            mapId: "anchor",
            name: "Anchor",
            lineCount: 42,
            provisionalLineCount: 3,
            lines: [
              {
                raceNumber: 1,
                raceType: "1v1",
                distanceMetres: 1000,
                coreId: privateCoreId,
                evidenceStatus: "winning_range",
                provisional: false,
              },
            ],
          },
        ],
      },
    } as unknown as ProLeagueDraftCommissioningState;

    const markup = renderToStaticMarkup(
      <ProLeagueCommissioningPanel state={state} />,
    );
    expect(markup).toContain("Current exact-format recommendation");
    expect(markup).toContain("Silver Comet");
    expect(markup).toContain("Four-map assignment");
    expect(markup).toContain("168 race lines");
    expect(markup).toContain("Population coverage gaps");
    expect(markup).not.toContain(privateCoreId);
    expect(markup).not.toContain(state.evidence!.generationId);
  });

  it("shows evidence while withholding an unavailable draft", () => {
    const state = {
      connectionStatus: "draft_unavailable",
      evidence: {
        generationId: "84000000-0000-4000-8000-000000000301",
        evidenceCutoffAt: "2026-09-07T01:00:00.000Z",
        publishedAt: "2026-09-07T01:01:00.000Z",
        populationProfileCount: 100,
        ownedProfileCount: 3,
        unownedProfileCount: 97,
        ownedCoreWithoutEvidenceCount: 2,
      },
      roster: {
        candidates: [],
        draftRoster: null,
        coverageGaps: [],
        search: { status: "insufficient_owned_pool" },
        operationalWarnings: [],
      },
      lineup: null,
    } as unknown as ProLeagueDraftCommissioningState;
    const markup = renderToStaticMarkup(
      <ProLeagueCommissioningPanel state={state} />,
    );
    expect(markup).toContain("A compliant draft is not available");
    expect(markup).toContain("Insufficient Owned Pool");
    expect(markup).not.toContain("Four-map assignment");
  });
});
