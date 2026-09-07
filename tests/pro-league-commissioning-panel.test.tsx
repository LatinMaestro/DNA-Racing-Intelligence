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
      currentState: {
        status: "connected",
        latestObservedAt: "2026-09-07T01:02:00.000Z",
        cores: [
          {
            displayName: "Silver Comet",
            latestObservedAt: "2026-09-07T01:02:00.000Z",
            bikePower: {
              powerSourceValue: 82,
              adjustedOddsSourceValue: 1.9,
              varianceSourceValue: 0.11,
              raceCount: 12,
            },
            stamina: { current: 4, maximum: 10, nextRefillAt: null },
            listing: {},
            bikeSkinAttached: true,
            trailsAttached: false,
            racingStatsObserved: true,
            ownerObserved: true,
            splicingObserved: true,
          },
        ],
      },
      raceOpportunities: {
        status: "connected",
        observedAt: "2026-09-07T01:03:00.000Z",
        scannedRaceCount: 5,
        qualifyingRaceCount: 1,
        priorityGapCount: 1,
        exactGapMatchingAvailable: false,
        directRaceLinkAvailable: false,
        raceEntryAllowed: false,
        opportunities: [
          {
            sourceRaceId: "private-race-456",
            displayName: "Half-full Bike Race",
            status: "filling",
            observedAt: "2026-09-07T01:03:00.000Z",
            gateCount: 6,
            filledGateCount: 3,
            availableGateCount: 3,
            fillPercentage: 50,
            formatSourceValue: "normal",
            raceClassSourceValue: 3,
            entryFeeUsd: 2.5,
            paymentAsset: "DEZ",
            fixedFeesByAsset: { DEZ: 0.25 },
            startAt: null,
            entrantCount: 3,
            gapMatchStatus: "exact_type_and_distance_unavailable",
          },
        ],
      },
      discoveryQueue: {
        authority: "active_verified_exact_format_generation",
        evidenceCutoffAt: "2026-09-01T00:00:00.000Z",
        exactDistanceMinimumRaceCount: 10,
        diagnostics: {
          priorityGapCount: 1,
          eligibleExperimentCount: 1,
          truncatedExperimentCount: 0,
          stoppedWeakPathCount: 1,
          conflictingEvidenceCount: 0,
          unresolvedCandidateCellCount: 0,
        },
        substitutionBudget: {
          maximumPerYear: 10,
          usedCount: null,
          remainingCount: null,
          initialRosterCountingPolicy: "unresolved",
          guidance: "Preserve the annual budget.",
        },
        automaticRaceEntryAllowed: false,
        automaticRosterMutationAllowed: false,
        experiments: [
          {
            coreId: privateCoreId,
            displayName: "Silver Comet",
            raceType: "1v1",
            distanceMetres: 1000,
            mapIds: ["map-1"],
            raceLineCount: 4,
            gapPriority: "high",
            gapStatus: "unproven",
            rosterImpact: "prove_provisional_member_before_lock",
            hypothesisSource: "exact_distance_sample",
            sourceDistanceMetres: 1000,
            benchmarkSignal: "top_three_range",
            directRaceCount: 7,
            observationsToMinimum: 3,
            recommendedNextRaceCount: 3,
            decision: "complete_exact_minimum",
            evidenceCurrentThrough: "2026-09-01T00:00:00.000Z",
            warnings: ["EXPERIMENTAL_SMALL_SAMPLE"],
            automaticRaceEntryAllowed: false,
            automaticRosterMutationAllowed: false,
          },
        ],
      },
      breedingObjectives: {
        status: "connected",
        evidenceCutoffAt: "2026-09-01T00:00:00.000Z",
        performanceDataCurrentThrough: "2026-09-01T00:00:00.000Z",
        arenaDataCurrentThrough: null,
        diagnostics: {
          priorityGapCount: 1,
          researchCandidateCount: 1,
          waitingObjectiveCount: 0,
          staleOrUnknownRankingCount: 0,
          nonBikePairRowCount: 0,
        },
        decisionSupportOnly: true,
        recommendationAllowed: false,
        automaticPairValidationAllowed: false,
        spliceExecutionAllowed: false,
        objectives: [
          {
            objectiveId: "1v1:1000",
            raceType: "1v1",
            distanceMetres: 1000,
            mapIds: ["map-1"],
            raceLineCount: 4,
            gapPriority: "high",
            gapStatus: "unproven",
            status: "research_candidates",
            warnings: ["GATE_E_NOT_PASSED"],
            candidates: [
              {
                candidateNumber: 1,
                source: "owned_owned",
                evidenceConfidence: "high",
                predictedOffspringClass: "Freak",
                predictedOffspringElement: "Earth",
                predictedOffspringFNumber: 18,
                exceptionalUpsideBasisPoints: 2000,
                strongerOrExceptionalBasisPoints: 6000,
                vaultFitBasisPoints: 8000,
                researchRoles: ["vault_gap", "elite_upside"],
                performanceEvidenceScope: "bike_exact_distance_only",
                proLeagueRaceTypeEvidence: "unavailable",
                officialPairValidation: "required_at_decision_time",
                officialPairInfo: "required_at_decision_time",
                recommendationAllowed: false,
                spliceExecutionAllowed: false,
                pairId: "private-pair-id",
                parentCoreIds: ["private-parent-a", "private-parent-b"],
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
    expect(markup).toContain("Current API dimensions");
    expect(markup).toContain("Adjusted odds");
    expect(markup).toContain("Open Bike race opportunities");
    expect(markup).toContain("Pro League Discovery experiments");
    expect(markup).toContain("Pro League breeding research");
    expect(markup).toContain("Research pair 1");
    expect(markup).toContain("Race-type pair evidence unavailable");
    expect(markup).toContain("7/10 exact-distance races");
    expect(markup).toContain("Half-full Bike Race");
    expect(markup).toContain("cannot yet be matched");
    expect(markup).toContain("82");
    expect(markup).not.toContain("private-wallet");
    expect(markup).not.toContain(privateCoreId);
    expect(markup).not.toContain("private-pair-id");
    expect(markup).not.toContain("private-parent");
    expect(markup).not.toContain("private-race-456");
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
