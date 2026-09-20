export const raceEntryBotExecutionPurposes = Object.freeze([
  "paid_tournament",
  "free_discovery",
] as const);

export type RaceEntryBotExecutionPurpose =
  (typeof raceEntryBotExecutionPurposes)[number];

export const raceEntryBotDevelopmentContract = Object.freeze({
  contractVersion: "race-entry-bot/v1" as const,
  architecture: "cloud_planner_plus_owner_authorized_local_executor" as const,
  cloudRaceEntryAllowed: false as const,
  executionPurposes: Object.freeze({
    paidTournament: Object.freeze({
      purpose: "paid_tournament" as const,
      preferredExecutor: "local_single_race_entry" as const,
      fallbackExecutor: "dna_native_auto_entry" as const,
      maximumOwnedCoresPerRace: 1 as const,
      livePerformanceStopRule: "realised_profit_loss_only" as const,
      spendAndExposureControlsRequired: true as const,
      exactAuditRequired: true as const,
    }),
    freeDiscovery: Object.freeze({
      purpose: "free_discovery" as const,
      preferredExecutor: "dna_native_auto_entry" as const,
      fallbackExecutor: "local_single_race_entry" as const,
      freeRaceOnly: true as const,
      maximumOwnedCoresPerRace: 2 as const,
      twoOwnedCorePolicy:
        "challenger_plus_proven_same_mode_exact_distance_benchmark_only" as const,
      exactCampaignSelectorRequired: true as const,
      campaignTargetIsHardMaximum: true as const,
      completionAuthority:
        "authoritative_reconciled_finished_race" as const,
      automaticPerformanceStopAllowed: false as const,
      automaticBurnDecisionAllowed: false as const,
      resultsFeedDiscoveryReview: true as const,
      exactAuditRequired: true as const,
    }),
  }),
});

export type RaceEntryBotDevelopmentContract =
  typeof raceEntryBotDevelopmentContract;
