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
      completionAuthority: "authoritative_reconciled_finished_race" as const,
      automaticPerformanceStopAllowed: false as const,
      automaticBurnDecisionAllowed: false as const,
      resultsFeedDiscoveryReview: true as const,
      exactAuditRequired: true as const,
    }),
  }),
});

export type RaceEntryBotDevelopmentContract =
  typeof raceEntryBotDevelopmentContract;


export type PaidTournamentSegmentSelection = Readonly<{
  tournamentId: string;
  segmentId: string;
  rulesetVersion: string;
  selectedCoreId: string;
  allowedCoreIds: readonly string[];
  mode: "bike" | "car" | "horse";
  distanceMetres: number;
  format: string;
  raceClassSourceValue: string | number;
}>;

export type PaidTournamentRaceCandidate = Readonly<{
  raceId: string;
  status: string;
  mode: "bike" | "car" | "horse";
  distanceMetres: number;
  format: string;
  raceClassSourceValue: string | number | null;
  gateCount: number;
  filledGateCount: number;
  entrantCoreIds: readonly string[];
  observedAt: string;
  segmentEligibility: Readonly<{
    tournamentId: string;
    segmentId: string;
    rulesetVersion: string;
    status: "verified_eligible" | "verified_ineligible" | "unknown";
  }>;
}>;

export type PaidTournamentOpportunityExclusion =
  | "not_open"
  | "stale_or_invalid_evidence"
  | "field_full_or_invalid"
  | "segment_not_verified_eligible"
  | "segment_context_mismatch"
  | "owned_core_already_entered";

export type PaidTournamentOpportunity = Readonly<{
  raceId: string;
  selectedCoreId: string;
  enteredOpponentCoreIds: readonly string[];
  filledGateCount: number;
  vacantGates: number;
  evaluationStatus: "needs_opponent_comparison";
  queueStatus: "not_queued";
  gameEntryAllowed: false;
}>;

function paidTournamentCoreIds(
  values: readonly string[],
  field: string,
): Set<string> {
  const ids = new Set(values);
  if (
    ids.size !== values.length ||
    values.some((value) => !/^[1-9]\d*$/u.test(value))
  ) {
    throw new Error(`Paid tournament ${field} is invalid.`);
  }
  return ids;
}

function paidTournamentRequiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 256) {
    throw new Error(`Paid tournament ${field} is invalid.`);
  }
  return normalized;
}

/**
 * Read-only paid-tournament lane of the shared race-entry bot.
 *
 * This applies owner-selected Core and exact segment authority before later
 * opponent comparison. Unlike ordinary Open Race advisory scanning, it never
 * requires a half-filled field. It does not rank, queue, reserve, submit or
 * spend, and every output keeps game execution disabled.
 */
export function screenPaidTournamentQualificationOpportunities(
  input: Readonly<{
    evaluatedAt: string;
    maximumAgeMinutes: number;
    segment: PaidTournamentSegmentSelection;
    currentOwnedCoreIds: readonly string[];
    races: readonly PaidTournamentRaceCandidate[];
  }>,
): Readonly<{
  opportunities: readonly PaidTournamentOpportunity[];
  excluded: readonly Readonly<{
    raceId: string;
    reason: PaidTournamentOpportunityExclusion;
  }>[];
  gameEntryAllowed: false;
}> {
  const evaluatedAt = Date.parse(input.evaluatedAt);
  if (
    !Number.isFinite(evaluatedAt) ||
    !Number.isSafeInteger(input.maximumAgeMinutes) ||
    input.maximumAgeMinutes < 1 ||
    input.maximumAgeMinutes > 60
  ) {
    throw new Error("Paid tournament freshness limit is invalid.");
  }
  const segment = input.segment;
  paidTournamentRequiredText(segment.tournamentId, "tournament identity");
  paidTournamentRequiredText(segment.segmentId, "segment identity");
  paidTournamentRequiredText(segment.rulesetVersion, "ruleset version");
  paidTournamentRequiredText(segment.format, "format");
  if (
    !Number.isSafeInteger(segment.distanceMetres) ||
    segment.distanceMetres <= 0
  ) {
    throw new Error("Paid tournament distance is invalid.");
  }
  const allowed = paidTournamentCoreIds(
    segment.allowedCoreIds,
    "allowed Core selection",
  );
  const owned = paidTournamentCoreIds(
    input.currentOwnedCoreIds,
    "owned Core selection",
  );
  if (
    !allowed.has(segment.selectedCoreId) ||
    !owned.has(segment.selectedCoreId)
  ) {
    throw new Error(
      "Paid tournament selected Core is not both owner-selected and currently owned.",
    );
  }
  const raceIds = new Set<string>();
  const opportunities: PaidTournamentOpportunity[] = [];
  const excluded: {
    raceId: string;
    reason: PaidTournamentOpportunityExclusion;
  }[] = [];
  const maxAgeMilliseconds = input.maximumAgeMinutes * 60_000;

  for (const race of input.races) {
    const raceId = paidTournamentRequiredText(race.raceId, "race identity");
    if (raceIds.has(raceId)) {
      throw new Error("Paid tournament race identity is duplicated.");
    }
    raceIds.add(raceId);
    const exclude = (reason: PaidTournamentOpportunityExclusion) => {
      excluded.push({ raceId, reason });
    };
    if (!["open", "filling"].includes(race.status.toLowerCase())) {
      exclude("not_open");
      continue;
    }
    const observedAt = Date.parse(race.observedAt);
    if (
      !Number.isFinite(observedAt) ||
      observedAt > evaluatedAt ||
      evaluatedAt - observedAt > maxAgeMilliseconds
    ) {
      exclude("stale_or_invalid_evidence");
      continue;
    }
    if (
      !Number.isSafeInteger(race.gateCount) ||
      !Number.isSafeInteger(race.filledGateCount) ||
      race.gateCount < 2 ||
      race.filledGateCount < 0 ||
      race.filledGateCount >= race.gateCount ||
      race.entrantCoreIds.length !== race.filledGateCount ||
      new Set(race.entrantCoreIds).size !== race.entrantCoreIds.length ||
      race.entrantCoreIds.some((id) => !/^[1-9]\d*$/u.test(id))
    ) {
      exclude("field_full_or_invalid");
      continue;
    }
    const eligibility = race.segmentEligibility;
    if (
      eligibility.status !== "verified_eligible" ||
      eligibility.tournamentId !== segment.tournamentId ||
      eligibility.segmentId !== segment.segmentId ||
      eligibility.rulesetVersion !== segment.rulesetVersion
    ) {
      exclude("segment_not_verified_eligible");
      continue;
    }
    if (
      race.mode !== segment.mode ||
      race.distanceMetres !== segment.distanceMetres ||
      race.format !== segment.format ||
      race.raceClassSourceValue !== segment.raceClassSourceValue
    ) {
      exclude("segment_context_mismatch");
      continue;
    }
    if (race.entrantCoreIds.some((coreId) => owned.has(coreId))) {
      exclude("owned_core_already_entered");
      continue;
    }
    opportunities.push({
      raceId,
      selectedCoreId: segment.selectedCoreId,
      enteredOpponentCoreIds: [...race.entrantCoreIds],
      filledGateCount: race.filledGateCount,
      vacantGates: race.gateCount - race.filledGateCount,
      evaluationStatus: "needs_opponent_comparison",
      queueStatus: "not_queued",
      gameEntryAllowed: false,
    });
  }

  return { opportunities, excluded, gameEntryAllowed: false };
}
