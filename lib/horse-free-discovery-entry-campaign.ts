import campaignJson from "@/campaigns/horse-burn-grade-discovery-2026-09-20.json";
import {
  buildPendingFreeDiscoveryEntryIntents,
  validateFreeDiscoveryEntryCampaign,
} from "@/domain/free-discovery-entry-campaign";

export const horseBurnGradeFreeDiscoveryEntryCampaign =
  validateFreeDiscoveryEntryCampaign(campaignJson);

export function buildHorseBurnGradePendingEntryIntents(
  completedRaceCounts: Readonly<Record<string, number>> = {},
) {
  return buildPendingFreeDiscoveryEntryIntents(
    horseBurnGradeFreeDiscoveryEntryCampaign,
    completedRaceCounts,
  );
}
