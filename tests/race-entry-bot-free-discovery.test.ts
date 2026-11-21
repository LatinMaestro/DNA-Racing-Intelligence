import { describe, expect, it } from "vitest";

import {
  screenFreeDiscoveryOpportunities,
  type FreeDiscoveryCampaignCell,
  type FreeDiscoveryRaceCandidate,
} from "@/domain/race-entry-bot";

const time = "2026-11-21T03:00:00.000Z";

const campaign: FreeDiscoveryCampaignCell = {
  campaignId: "horse-discovery-2026-09-20",
  cellId: "core-10457-horse-1600",
  selectedCoreId: "10457",
  mode: "horse",
  distanceMetres: 1600,
  raceClassSourceValue: 90,
  gateCount: 4,
  format: "normal",
  targetNewRaces: 5,
  reconciledCompletedNewRaces: 2,
  reservedOrSubmittedNewRaces: 1,
  pairing: { status: "single_core" },
};

const race: FreeDiscoveryRaceCandidate = {
  raceId: "free-race-1",
  status: "open",
  raceTypeSourceValue: "Free",
  mode: "horse",
  distanceMetres: 1600,
  raceClassSourceValue: 90,
  gateCount: 4,
  filledGateCount: 1,
  format: "normal",
  entrantCoreIds: ["9001"],
  observedAt: "2026-11-21T02:59:00.000Z",
};

function screen(
  overrides: Partial<
    Parameters<typeof screenFreeDiscoveryOpportunities>[0]
  > = {},
) {
  return screenFreeDiscoveryOpportunities({
    evaluatedAt: time,
    maximumAgeMinutes: 5,
    campaign,
    currentOwnedCoreIds: ["10457", "42", "500"],
    races: [race],
    ...overrides,
  });
}

describe("shared race-entry bot Free Discovery opportunity screen", () => {
  it("accepts an exact standalone Free race without applying the advisory half-filled rule", () => {
    expect(screen()).toEqual({
      opportunities: [
        {
          campaignId: campaign.campaignId,
          cellId: campaign.cellId,
          raceId: race.raceId,
          plannedOwnedCoreIds: ["10457"],
          mode: "horse",
          distanceMetres: 1600,
          raceClassSourceValue: 90,
          gateCount: 4,
          format: "normal",
          enteredOpponentCoreIds: ["9001"],
          vacantGates: 3,
          raceTypeSourceValue: "Free",
          evaluationStatus: "needs_field_evaluation",
          queueStatus: "not_queued",
          automaticPerformanceStopAllowed: false,
          automaticBurnDecisionAllowed: false,
          gameEntryAllowed: false,
        },
      ],
      excluded: [],
      newRaceBudgetRemaining: 2,
      queueAllowed: false,
      gameEntryAllowed: false,
    });
  });

  it("allows two planned owned Cores only for an exact verified four-gate benchmark pair", () => {
    const result = screen({
      campaign: {
        ...campaign,
        pairing: {
          status: "verified_benchmark_pair",
          benchmarkCoreId: "42",
          verifiedMode: "horse",
          verifiedDistanceMetres: 1600,
        },
      },
    });
    expect(result.opportunities[0]?.plannedOwnedCoreIds).toEqual([
      "10457",
      "42",
    ]);

    expect(() =>
      screen({
        campaign: {
          ...campaign,
          pairing: {
            status: "verified_benchmark_pair",
            benchmarkCoreId: "42",
            verifiedMode: "horse",
            verifiedDistanceMetres: 1800,
          },
        },
      }),
    ).toThrow("not verified for the exact campaign context");
  });

  it("requires enough vacant gates for the verified pair", () => {
    const result = screen({
      campaign: {
        ...campaign,
        pairing: {
          status: "verified_benchmark_pair",
          benchmarkCoreId: "42",
          verifiedMode: "horse",
          verifiedDistanceMetres: 1600,
        },
      },
      races: [
        {
          ...race,
          filledGateCount: 3,
          entrantCoreIds: ["9001", "9002", "9003"],
        },
      ],
    });
    expect(result.excluded[0]?.reason).toBe("insufficient_vacancies_for_pair");
  });

  it("fails closed on non-Free, selector-mismatched, stale and owned-Core fields", () => {
    expect(
      screen({
        races: [{ ...race, raceTypeSourceValue: null }],
      }).excluded[0]?.reason,
    ).toBe("not_authoritative_standalone_free");
    expect(
      screen({
        races: [{ ...race, distanceMetres: 1800 }],
      }).excluded[0]?.reason,
    ).toBe("campaign_selector_mismatch");
    expect(
      screen({
        races: [{ ...race, observedAt: "2026-11-21T02:50:00.000Z" }],
      }).excluded[0]?.reason,
    ).toBe("stale_or_invalid_evidence");
    expect(
      screen({
        races: [
          {
            ...race,
            filledGateCount: 2,
            entrantCoreIds: ["9001", "42"],
          },
        ],
      }).excluded[0]?.reason,
    ).toBe("owned_core_already_entered");
  });

  it("closes the cell when reconciled completions and current reservations consume the budget", () => {
    const result = screen({
      campaign: {
        ...campaign,
        reconciledCompletedNewRaces: 4,
        reservedOrSubmittedNewRaces: 1,
      },
    });
    expect(result.newRaceBudgetRemaining).toBe(0);
    expect(result.opportunities).toEqual([]);
    expect(result.excluded).toEqual([
      {
        raceId: race.raceId,
        reason: "campaign_budget_exhausted",
      },
    ]);
  });

  it("rejects over-allocated counters instead of silently exceeding the campaign", () => {
    expect(() =>
      screen({
        campaign: {
          ...campaign,
          reconciledCompletedNewRaces: 5,
          reservedOrSubmittedNewRaces: 1,
        },
      }),
    ).toThrow("campaign cell is invalid");
  });

  it("requires the challenger and benchmark to remain currently owned", () => {
    expect(() => screen({ currentOwnedCoreIds: ["42", "500"] })).toThrow(
      "selected Core is not currently owned",
    );
    expect(() =>
      screen({
        campaign: {
          ...campaign,
          pairing: {
            status: "verified_benchmark_pair",
            benchmarkCoreId: "9000",
            verifiedMode: "horse",
            verifiedDistanceMetres: 1600,
          },
        },
      }),
    ).toThrow("not verified for the exact campaign context");
  });

  it("never queues, enters, stops from performance or makes a burn decision", () => {
    const opportunity = screen().opportunities[0]!;
    expect(opportunity.queueStatus).toBe("not_queued");
    expect(opportunity.automaticPerformanceStopAllowed).toBe(false);
    expect(opportunity.automaticBurnDecisionAllowed).toBe(false);
    expect(opportunity.gameEntryAllowed).toBe(false);
    expect(screen().queueAllowed).toBe(false);
    expect(screen().gameEntryAllowed).toBe(false);
  });
});
