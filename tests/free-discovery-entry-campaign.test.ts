import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildPendingFreeDiscoveryEntryIntents,
  freeDiscoveryEntryCellKey,
  validateFreeDiscoveryEntryCampaign,
} from "@/domain/free-discovery-entry-campaign";
import {
  buildHorseBurnGradePendingEntryIntents,
  horseBurnGradeFreeDiscoveryEntryCampaign,
} from "@/lib/horse-free-discovery-entry-campaign";

const campaignPath =
  "campaigns/horse-burn-grade-discovery-2026-09-20.json";

function loadCampaign() {
  return validateFreeDiscoveryEntryCampaign(
    JSON.parse(readFileSync(campaignPath, "utf8")) as unknown,
  );
}

describe("Horse burn-grade Free Discovery entry campaign", () => {
  it("keeps Free Discovery separate from the paid-tournament one-Core guard", async () => {
    const { raceEntryBotDevelopmentContract } = await import(
      "@/domain/race-entry-bot"
    );

    expect(
      raceEntryBotDevelopmentContract.executionPurposes.paidTournament
        .maximumOwnedCoresPerRace,
    ).toBe(1);
    expect(
      raceEntryBotDevelopmentContract.executionPurposes.freeDiscovery
        .maximumOwnedCoresPerRace,
    ).toBe(2);
    expect(
      raceEntryBotDevelopmentContract.executionPurposes.freeDiscovery
        .twoOwnedCorePolicy,
    ).toBe(
      "challenger_plus_proven_same_mode_exact_distance_benchmark_only",
    );
  });


  it("loads the owner-approved 515-cell / 2575-race Horse campaign", () => {
    const campaign = loadCampaign();

    expect(campaign).toMatchObject({
      campaignId: "horse-burn-grade-discovery-2026-09-20",
      mode: "horse",
      raceSelector: {
        raceNameToken: "Free",
        raceClass: 90,
        gateCount: 4,
        sourceFormat: "normal",
        exactDistanceRequired: true,
      },
      execution: {
        preferredExecutor: "dna_native_auto_entry",
        fallbackExecutor: "owner_authorized_local_entry_agent",
        plannedNewRacesPerCell: 5,
        maximumOwnedCoresPerRace: 2,
        twoOwnedCorePolicy:
          "challenger_plus_proven_same_mode_exact_distance_benchmark_only",
        cloudRaceEntryAllowed: false,
        localExecutorCommissioned: false,
        ownerAuthorizedPlanConsumption: true,
        automaticBurnDecisionAllowed: false,
        automaticStopFromNoStarAllowed: false,
      },
      summary: {
        ownedCoreAuditCount: 214,
        coreDistanceCellCount: 515,
        plannedRaceCount: 2_575,
        distanceCellCounts: {
          "1000": 91,
          "1200": 118,
          "1400": 47,
          "1600": 27,
          "1800": 52,
          "2000": 96,
          "2200": 84,
        },
      },
    });

    expect(
      Object.values(campaign.distanceQueues).reduce(
        (sum, coreIds) => sum + coreIds.length,
        0,
      ),
    ).toBe(515);
  });

  it("is directly consumable by the local/native Auto-Entry planner", () => {
    expect(horseBurnGradeFreeDiscoveryEntryCampaign.summary).toMatchObject({
      coreDistanceCellCount: 515,
      plannedRaceCount: 2_575,
    });
    expect(buildHorseBurnGradePendingEntryIntents()).toHaveLength(2_575);
  });

  it("expands each Core-distance cell to five idempotent entry intents", () => {
    const campaign = loadCampaign();
    const intents = buildPendingFreeDiscoveryEntryIntents(campaign);

    expect(intents).toHaveLength(2_575);
    expect(new Set(intents.map(({ idempotencyKey }) => idempotencyKey)).size).toBe(
      2_575,
    );
    expect(intents.every(({ selector }) => selector.raceNameToken === "Free")).toBe(
      true,
    );
    expect(
      intents.every(
        ({ maximumOwnedCoresPerRace, twoOwnedCorePolicy }) =>
          maximumOwnedCoresPerRace === 2 &&
          twoOwnedCorePolicy ===
            "challenger_plus_proven_same_mode_exact_distance_benchmark_only",
      ),
    ).toBe(true);
  });

  it("does not recreate already reconciled races for a cell", () => {
    const campaign = loadCampaign();
    const firstCore = campaign.distanceQueues["1000"]![0]!;
    const cellKey = freeDiscoveryEntryCellKey(firstCore, 1_000);

    const intents = buildPendingFreeDiscoveryEntryIntents(campaign, {
      [cellKey]: 3,
    });
    const remainingForFirstCell = intents.filter(
      ({ coreId, distanceMetres }) =>
        coreId === firstCore && distanceMetres === 1_000,
    );

    expect(remainingForFirstCell.map(({ raceOrdinal }) => raceOrdinal)).toEqual([
      4, 5,
    ]);
    expect(intents).toHaveLength(2_573);
  });

  it("keeps cloud execution and automatic burn/no-star stops disabled", () => {
    const campaign = loadCampaign();

    expect(campaign.execution.cloudRaceEntryAllowed).toBe(false);
    expect(campaign.execution.localExecutorCommissioned).toBe(false);
    expect(campaign.execution.automaticBurnDecisionAllowed).toBe(false);
    expect(campaign.execution.automaticStopFromNoStarAllowed).toBe(false);
    expect(campaign.progress.completionAuthority).toBe(
      "authoritative_reconciled_finished_race",
    );
  });

  it("rejects wrong-distance summaries and duplicate Core cells", () => {
    const raw = JSON.parse(readFileSync(campaignPath, "utf8")) as {
      summary: { distanceCellCounts: Record<string, number> };
      distanceQueues: Record<string, string[]>;
    };

    const wrongCount = structuredClone(raw);
    wrongCount.summary.distanceCellCounts["1000"] = 90;
    expect(() => validateFreeDiscoveryEntryCampaign(wrongCount)).toThrow(
      "Distance 1000 summary count is inconsistent",
    );

    const duplicate = structuredClone(raw);
    duplicate.distanceQueues["1000"]![1] = duplicate.distanceQueues["1000"]![0]!;
    expect(() => validateFreeDiscoveryEntryCampaign(duplicate)).toThrow(
      "Duplicate campaign cell",
    );
  });
});
