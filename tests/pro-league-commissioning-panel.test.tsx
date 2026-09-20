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

  it("shows structural Core totals without ranking or mapping them", () => {
    const markup = renderToStaticMarkup(
      <ProLeagueCommissioningPanel
        state={{
          connectionStatus: "structural_pool_connected",
          structuralPool: {
            authority: "complete_daily_generation_owned_core_metadata_only",
            generationId: "84000000-0000-4000-8000-000000000501",
            dataCurrentThrough: "2026-09-07T00:00:00.000Z",
            latestObservedAt: "2026-09-07T00:03:00.000Z",
            freshness: "current",
            coreCount: 203,
            namedCoreCount: 203,
            femaleCount: 88,
            aboveF15Count: 40,
            f5OrBelowCount: 12,
            f10OrBelowCount: 53,
            elements: [
              { element: "Metal", coreCount: 50, genesisCount: 2 },
              { element: "Fire", coreCount: 51, genesisCount: 2 },
              { element: "Earth", coreCount: 52, genesisCount: 2 },
              { element: "Water", coreCount: 50, genesisCount: 2 },
            ],
            performanceSelectionStatus:
              "held_without_exact_format_elapsed_time_evidence",
            rosterPublished: false,
            mapAssignmentsPublished: false,
            automaticActionAllowed: false,
          },
          evidence: null,
          roster: null,
          lineup: null,
        }}
      />,
    );

    expect(markup).toContain("Complete private Core list connected");
    expect(markup).toContain("203");
    expect(markup).toContain("Performance selection");
    expect(markup).toContain("No Core has been ranked or selected");
    expect(markup).not.toContain("Recommended roster");
    expect(markup).not.toContain("Four-map assignment");
    expect(markup).not.toContain("84000000-0000-4000-8000-000000000501");
  });

  it("renders names and exact-format assignments without exposing Core IDs", () => {
    const privateCoreId = "private-core-123";
    const state = {
      connectionStatus: "read_model_connected",
      evidence: {
        generationId: "84000000-0000-4000-8000-000000000301",
        evidenceCutoffAt: "2026-09-07T01:00:00.000Z",
        publishedAt: "2026-09-07T01:01:00.000Z",
        freshness: "current",
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
          audit: { readiness: "compliant" },
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
        operationalWarnings: ["Initial registration uses zero substitutions."],
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
      mapPreparation: {
        authority: "verified_owned_exact_format_lineup_only",
        generationId: "private-generation-id",
        evidenceCutoffAt: "2026-09-07T01:00:00.000Z",
        homePreferenceOrder: ["map-1", "map-2", "map-3", "map-4"],
        defensivePreparationOrder: ["map-4", "map-3", "map-2", "map-1"],
        assessments: [
          {
            mapId: "map-1",
            name: "Anchor",
            readiness: "supported",
            first16: {
              winningRangeLineCount: 12,
              topThreeRangeLineCount: 4,
              provisionalLineCount: 0,
              noExactEvidenceLineCount: 0,
            },
            fullMap: {
              winningRangeLineCount: 30,
              topThreeRangeLineCount: 12,
              provisionalLineCount: 0,
              noExactEvidenceLineCount: 0,
            },
          },
          ...["map-2", "map-3", "map-4"].map((mapId, index) => ({
            mapId,
            name: ["Glory", "Measure", "Miracles"][index],
            readiness: "provisional",
            first16: {
              winningRangeLineCount: 8,
              topThreeRangeLineCount: 4,
              provisionalLineCount: 4,
              noExactEvidenceLineCount: 0,
            },
            fullMap: {
              winningRangeLineCount: 24,
              topThreeRangeLineCount: 10,
              provisionalLineCount: 8,
              noExactEvidenceLineCount: 0,
            },
          })),
        ],
        opponentDenialStatus: "held_without_opponent_exact_format_evidence",
        headToHeadStatus: "unavailable",
        matchActionAllowed: false,
        selectionMethod: {
          primaryWindow: "first_16_race_points",
          secondaryWindow: "complete_42_line_map",
          order:
            "fewest_evidence_gaps_then_fewest_provisional_then_most_population_supported",
          resultEvidenceRole: "not_used",
          missingOppositionQuality: "unknown_never_favourable",
        },
        warnings: [],
      },
      currentState: {
        status: "connected",
        latestObservedAt: "2026-09-07T01:02:00.000Z",
        dataCurrentThrough: "2026-09-06T23:00:00.000Z",
        freshness: "current",
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
        freshness: "current",
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
          initialRosterCountingPolicy: "does_not_count",
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
            benchmarkScreen: {
              evidenceClass: "normal_free",
              opponentStrategy: "proven_same_mode_exact_distance_core",
              initialRaceCount: 2,
              maximumRaceCount: 5,
              primarySmallSampleSignal: "yellow_blue_stars",
              finishAndTimeUse: "secondary_context",
              externalStarHolderReviewRequired: true,
            },
            benchmarkCore: {
              coreId: "benchmark-core",
              displayName: "Proven Benchmark",
              distanceMetres: 1000,
              benchmarkSignal: "winning_range",
              directRaceCount: 18,
            },
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
        performanceFreshness: "stale",
        arenaFreshness: "unknown",
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
      readiness: {
        status: "ready_for_protected_preview_review",
        checks: [
          {
            code: "ACTIVE_EVIDENCE",
            status: "pass",
            requiredForProtectedPreview: true,
            detail: "Verified evidence is active.",
          },
          {
            code: "OWNER_PREVIEW_ACCEPTANCE",
            status: "review",
            requiredForProtectedPreview: false,
            detail: "Owner acceptance has not been performed.",
          },
        ],
        summary: { passCount: 1, reviewCount: 1, blockCount: 0 },
        ownerAcceptanceRequired: true,
        protectedPreviewDeploymentAllowed: false,
        productionActivationAllowed: false,
        rosterOrMapSubmissionAllowed: false,
      },
      syncRatePolicy: {
        connectionStatus: "connected",
        expectedVersion: 1,
        policy: {
          requestedRequestsPerMinute: 30,
          effectiveRequestsPerMinute: 30,
          elevatedUntil: null,
          fallbackReason: null,
          consecutiveRateLimits: 0,
          lastRateLimitedAt: null,
          lastProviderLimit: 150,
          version: 1,
          updatedAt: "2026-09-07T01:04:00.000Z",
        },
      },
      syncHealth: {
        connectionStatus: "connected",
        syncStatus: "paused",
        catchUpRequired: true,
        lastAttemptAt: "2026-09-07T01:05:00.000Z",
        lastInterruption: {
          reason: "rate_limited",
          at: "2026-09-07T01:05:00.000Z",
          retryAfterSeconds: 60,
        },
        lastCatchUpCompletedAt: null,
        lastGood: {
          versionFingerprint: "1a2b3c4d5e6f",
          dataCurrentThrough: "2026-09-07T01:00:00.000Z",
          publishedAt: "2026-09-07T01:01:00.000Z",
          indexedAt: "2026-09-07T01:00:30.000Z",
          receiptCount: 17,
        },
        families: [
          {
            family: "race_activity",
            dataCurrentThrough: "2026-09-07T00:59:00.000Z",
            lastCompletedAt: "2026-09-07T01:00:00.000Z",
            receiptCount: 2,
          },
          {
            family: "token_prices",
            dataCurrentThrough: "2026-09-07T00:58:00.000Z",
            lastCompletedAt: "2026-09-07T00:58:00.000Z",
            receiptCount: 1,
          },
        ],
        readOnly: true,
        refreshTriggered: false,
      },
      historyCoverage: {
        connectionStatus: "connected",
        baselineStatus: "complete",
        dataCurrentThrough: "2026-09-02T00:11:55.961Z",
        versionFingerprint: "abcdef123456",
        sourceRecordUpperBound: 1_137_586,
        receiptCount: 17_464,
        finishedRaceReceiptCount: 17_369,
        retainedR2Bytes: 874_370_990,
        omittedIdentityObservationCount: 1,
        incrementalRefreshStatus: "not_connected",
        readOnly: true,
        refreshTriggered: false,
      },
    } as unknown as ProLeagueDraftCommissioningState;

    const markup = renderToStaticMarkup(
      <ProLeagueCommissioningPanel state={state} />,
    );
    expect(markup).toContain("Current exact-format recommendation");
    expect(markup).toContain("Owner readiness at a glance");
    expect(markup).toContain("Historical evidence: Current");
    expect(markup).toContain("Serving complete version 1a2b3c4d5e6f");
    expect(markup).toContain("Roster compliant");
    expect(markup).toContain("1/4 maps · 168/168 lines");
    expect(markup).toContain("12 provisional · 2 without exact evidence");
    expect(markup).toContain("1 bounded test");
    expect(markup).toContain("1 research objective · held");
    expect(markup).toContain("Initial roster uses 0 · later use unavailable");
    expect(markup).toContain(
      "No protected Preview blockers; owner review is still required",
    );
    expect(markup).toContain("This page cannot connect a wallet");
    expect(markup).toContain("Protected Preview readiness");
    expect(markup).toContain("ready for a protected owner review");
    expect(markup).toContain("API refresh safety");
    expect(markup).toContain("30 aggregate rpm");
    expect(markup).toContain("does not claim that a refresh is running");
    expect(markup).toContain("API refresh status");
    expect(markup).toContain("verified last-good version 1a2b3c4d5e6f");
    expect(markup).toContain("Race Activity");
    expect(markup).toContain("Token Prices");
    expect(markup).toContain("Last interruption: Rate Limited");
    expect(markup).toContain("cannot start a refresh");
    expect(markup).toContain("Historical race archive");
    expect(markup).toContain(
      "one-time private baseline is complete as version abcdef123456",
    );
    expect(markup).toContain("17,464");
    expect(markup).toContain("17,369");
    expect(markup).toContain("874.4 MB");
    expect(markup).toContain(
      "This baseline is not a recurring history refresh",
    );
    expect(markup).toContain("1,137,586");
    expect(markup).toContain(
      "Owner acceptance remains a separate deliberate step",
    );
    expect(markup).toContain("Silver Comet");
    expect(markup).toContain("Four-map assignment");
    expect(markup).toContain("Map preparation order");
    expect(markup).toContain(
      "Home preference: Anchor → Glory → Measure → Miracles",
    );
    expect(markup).toContain("Opponent-specific denial");
    expect(markup).toContain("168 race lines");
    expect(markup).toContain("Population coverage gaps");
    expect(markup).toContain("Current API dimensions");
    expect(markup).toContain("Historical evidence freshness: Current");
    expect(markup).toContain("Snapshot freshness: Current");
    expect(markup).toContain("Performance evidence: Stale");
    expect(markup).toContain("Arena evidence: Unknown");
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
    expect(markup).not.toContain(state.mapPreparation!.generationId);
  });

  it("shows evidence while withholding an unavailable draft", () => {
    const state = {
      connectionStatus: "draft_unavailable",
      evidence: {
        generationId: "84000000-0000-4000-8000-000000000301",
        evidenceCutoffAt: "2026-09-07T01:00:00.000Z",
        publishedAt: "2026-09-07T01:01:00.000Z",
        freshness: "current",
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
