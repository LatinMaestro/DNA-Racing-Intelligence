import {
  rankOpenRacePreEntry,
  type OpenRacePreEntryRankingInput,
  type OpenRacePreEntryRankingResult,
} from "@/domain/open-race-pre-entry-ranking";

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
  mode: "bike" | "car" | "horse";
  distanceMetres: number;
  format: string;
  raceClassSourceValue: string | number;
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
      mode: race.mode,
      distanceMetres: race.distanceMetres,
      format: race.format,
      raceClassSourceValue: segment.raceClassSourceValue,
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

export type PaidTournamentOpponentEvaluation = Readonly<{
  raceId: string;
  selectedCoreId: string;
  decision: "provisional_candidate" | "avoid" | "unavailable";
  strongestOpponentCoreId: string | null;
  selectedCoreMarginToStrongestOpponentMs: number | null;
  ranking: OpenRacePreEntryRankingResult;
  explanations: readonly string[];
  queueAllowed: false;
  gameEntryAllowed: false;
}>;

/**
 * Reuses the approved Open Race time-led pre-entry ranking for one already
 * screened paid-tournament opportunity. No new score or probability is added.
 * The result remains provisional and cannot queue or execute a game action.
 */
export function evaluatePaidTournamentOpponentField(
  input: Readonly<{
    opportunity: PaidTournamentOpportunity;
    ranking: OpenRacePreEntryRankingInput;
  }>,
): PaidTournamentOpponentEvaluation {
  const { opportunity, ranking } = input;
  if (
    ranking.mode !== opportunity.mode ||
    ranking.distanceMeters !== opportunity.distanceMetres
  ) {
    throw new Error(
      "Paid tournament ranking does not match the screened mode and exact distance.",
    );
  }
  if (
    ranking.candidates.length !== 1 ||
    ranking.candidates[0]?.coreId !== opportunity.selectedCoreId
  ) {
    throw new Error(
      "Paid tournament ranking must contain only the owner-selected Core.",
    );
  }
  const expectedOpponents = [...opportunity.enteredOpponentCoreIds].sort();
  const rankedOpponents = ranking.opponents.map(({ coreId }) => coreId).sort();
  if (
    expectedOpponents.length !== rankedOpponents.length ||
    expectedOpponents.some((coreId, index) => rankedOpponents[index] !== coreId)
  ) {
    throw new Error(
      "Paid tournament ranking opponents do not match the screened live field.",
    );
  }

  const result = rankOpenRacePreEntry(ranking);
  const selected = result.rankedCandidates.find(
    ({ coreId }) => coreId === opportunity.selectedCoreId,
  );
  if (selected === undefined) {
    throw new Error("Paid tournament selected Core ranking is unavailable.");
  }

  let decision: PaidTournamentOpponentEvaluation["decision"];
  const explanations = [...result.reviewReasons, ...result.warnings];
  if (result.status !== "provisional") {
    decision = "unavailable";
  } else if (result.avoidSignal) {
    decision = "avoid";
    explanations.push(
      "The selected Core is slower than the strongest entered opponent across the supported time ranges.",
    );
  } else if (
    result.provisionalRecommendedCoreId === opportunity.selectedCoreId
  ) {
    decision = "provisional_candidate";
    explanations.push(
      "The owner-selected Core is the sole provisional time-led candidate for this verified field.",
    );
  } else {
    decision = "unavailable";
    explanations.push(
      "The existing ranking method did not produce one supported provisional leader.",
    );
  }

  return {
    raceId: opportunity.raceId,
    selectedCoreId: opportunity.selectedCoreId,
    decision,
    strongestOpponentCoreId: result.strongestOpponentCoreId,
    selectedCoreMarginToStrongestOpponentMs:
      selected.marginToStrongestOpponentMs,
    ranking: result,
    explanations,
    queueAllowed: false,
    gameEntryAllowed: false,
  };
}

export type PaidTournamentDryRunBlocker =
  | "evaluation_not_favourable"
  | "owner_control_not_current"
  | "globally_paused"
  | "kill_switch_engaged"
  | "segment_guard_not_current"
  | "owner_consent_stale_or_invalid"
  | "race_recheck_stale_or_invalid"
  | "race_not_open_or_vacant"
  | "field_changed"
  | "owned_core_already_entered"
  | "duplicate_entry_risk"
  | "prior_attempt_unreconciled"
  | "fee_not_authoritative_hlx"
  | "financial_state_stale_or_invalid"
  | "insufficient_hlx_balance"
  | "max_unsettled_entries_reached"
  | "max_unsettled_exposure_reached"
  | "segment_spend_ceiling_reached"
  | "tournament_spend_ceiling_reached"
  | "global_session_spend_ceiling_reached"
  | "realised_stop_loss_triggered";

type ExactHlx = Readonly<{
  scaled: bigint;
  text: string;
}>;

const hlxScale = 1_000_000_000_000_000_000n;

function parseExactHlx(
  value: string,
  field: string,
  allowNegative: boolean,
): ExactHlx {
  const pattern = allowNegative
    ? /^-?(?:0|[1-9]\d{0,19})(?:\.\d{1,18})?$/u
    : /^(?:0|[1-9]\d{0,19})(?:\.\d{1,18})?$/u;
  if (!pattern.test(value)) {
    throw new Error(`Paid tournament ${field} must be an exact HLX decimal.`);
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const scaled =
    BigInt(whole) * hlxScale + BigInt(fraction.padEnd(18, "0") || "0");
  return {
    scaled: negative ? -scaled : scaled,
    text: formatExactHlx(negative ? -scaled : scaled),
  };
}

function formatExactHlx(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / hlxScale;
  const fraction = (absolute % hlxScale)
    .toString()
    .padStart(18, "0")
    .replace(/0+$/u, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function currentAuthorityTime(
  value: string,
  evaluatedAt: number,
  maximumAgeMilliseconds: number,
): boolean {
  const parsed = Date.parse(value);
  return (
    Number.isFinite(parsed) &&
    parsed <= evaluatedAt &&
    evaluatedAt - parsed <= maximumAgeMilliseconds
  );
}

/**
 * Final development-only safety check before a local executor dry run.
 *
 * It rechecks the field, owner consent, duplicate/reconciliation state and all
 * exact-HLX hard controls. A successful result permits only request-shape dry
 * running; game submission remains impossible.
 */
export function evaluatePaidTournamentLocalDryRunGate(
  input: Readonly<{
    evaluatedAt: string;
    maximumAgeMinutes: number;
    evaluation: PaidTournamentOpponentEvaluation;
    currentRace: Readonly<{
      raceId: string;
      status: string;
      gateCount: number;
      filledGateCount: number;
      entrantCoreIds: readonly string[];
      observedAt: string;
    }>;
    currentOwnedCoreIds: readonly string[];
    ownerControl: Readonly<{
      authorityStatus: "current" | "stale";
      globallyPaused: boolean;
      killSwitchEngaged: boolean;
      liveExecutionEnabled: false;
    }>;
    segmentGuard: Readonly<{
      authorityStatus: "current" | "stale";
      selectedCoreId: string;
      asset: "HLX";
      maxUnsettledEntries: number;
      maxUnsettledExposureHlx: string;
      segmentSpendCeilingHlx: string;
      tournamentSpendCeilingHlx: string;
      globalSessionSpendCeilingHlx: string;
      realisedStopLossHlx: string;
      liveExecutionEnabled: false;
    }>;
    ownerConsentAt: string;
    duplicateEntryStatus: "clear" | "detected" | "unknown";
    priorAttemptStatus: "none" | "reconciled_failed" | "unreconciled";
    fee: Readonly<
      | { status: "authoritative"; asset: "HLX"; amountHlx: string }
      | { status: "unavailable" | "unknown"; asset: string | null }
    >;
    financialState: Readonly<{
      observedAt: string;
      availableBalanceHlx: string;
      unsettledEntries: number;
      unsettledExposureHlx: string;
      segmentSpentHlx: string;
      tournamentSpentHlx: string;
      globalSessionSpentHlx: string;
      realisedQualificationPnlHlx: string;
    }>;
  }>,
): Readonly<{
  status: "dry_run_ready" | "blocked";
  blockers: readonly PaidTournamentDryRunBlocker[];
  projected: Readonly<{
    unsettledEntries: number;
    unsettledExposureHlx: string;
    segmentSpentHlx: string;
    tournamentSpentHlx: string;
    globalSessionSpentHlx: string;
  }> | null;
  localDryRunAllowed: boolean;
  gameEntryAllowed: false;
}> {
  const evaluatedAt = Date.parse(input.evaluatedAt);
  if (
    !Number.isFinite(evaluatedAt) ||
    !Number.isSafeInteger(input.maximumAgeMinutes) ||
    input.maximumAgeMinutes < 1 ||
    input.maximumAgeMinutes > 15
  ) {
    throw new Error("Paid tournament dry-run freshness limit is invalid.");
  }
  const maxAgeMilliseconds = input.maximumAgeMinutes * 60_000;
  const blockers: PaidTournamentDryRunBlocker[] = [];
  const block = (value: PaidTournamentDryRunBlocker) => {
    if (!blockers.includes(value)) blockers.push(value);
  };

  if (input.evaluation.decision !== "provisional_candidate") {
    block("evaluation_not_favourable");
  }
  if (input.ownerControl.authorityStatus !== "current") {
    block("owner_control_not_current");
  }
  if (input.ownerControl.globallyPaused) block("globally_paused");
  if (input.ownerControl.killSwitchEngaged) block("kill_switch_engaged");
  if (input.segmentGuard.authorityStatus !== "current") {
    block("segment_guard_not_current");
  }
  if (input.segmentGuard.selectedCoreId !== input.evaluation.selectedCoreId) {
    block("segment_guard_not_current");
  }
  if (
    !currentAuthorityTime(input.ownerConsentAt, evaluatedAt, maxAgeMilliseconds)
  ) {
    block("owner_consent_stale_or_invalid");
  }
  if (input.duplicateEntryStatus !== "clear") {
    block("duplicate_entry_risk");
  }
  if (input.priorAttemptStatus === "unreconciled") {
    block("prior_attempt_unreconciled");
  }

  const owned = paidTournamentCoreIds(
    input.currentOwnedCoreIds,
    "dry-run owned Core selection",
  );
  const currentRace = input.currentRace;
  if (
    currentRace.raceId !== input.evaluation.raceId ||
    !currentAuthorityTime(
      currentRace.observedAt,
      evaluatedAt,
      maxAgeMilliseconds,
    )
  ) {
    block("race_recheck_stale_or_invalid");
  }
  if (
    !["open", "filling"].includes(currentRace.status.toLowerCase()) ||
    !Number.isSafeInteger(currentRace.gateCount) ||
    !Number.isSafeInteger(currentRace.filledGateCount) ||
    currentRace.gateCount < 2 ||
    currentRace.filledGateCount < 0 ||
    currentRace.filledGateCount >= currentRace.gateCount ||
    currentRace.entrantCoreIds.length !== currentRace.filledGateCount
  ) {
    block("race_not_open_or_vacant");
  }
  if (
    new Set(currentRace.entrantCoreIds).size !==
      currentRace.entrantCoreIds.length ||
    currentRace.entrantCoreIds.some((coreId) => !/^[1-9]\d*$/u.test(coreId))
  ) {
    block("field_changed");
  } else {
    const frozenOpponents = input.evaluation.ranking.opponents
      .map(({ coreId }) => coreId)
      .sort();
    const currentOpponents = [...currentRace.entrantCoreIds].sort();
    if (
      frozenOpponents.length !== currentOpponents.length ||
      frozenOpponents.some(
        (coreId, index) => currentOpponents[index] !== coreId,
      )
    ) {
      block("field_changed");
    }
  }
  if (currentRace.entrantCoreIds.some((coreId) => owned.has(coreId))) {
    block("owned_core_already_entered");
  }

  if (
    !currentAuthorityTime(
      input.financialState.observedAt,
      evaluatedAt,
      maxAgeMilliseconds,
    )
  ) {
    block("financial_state_stale_or_invalid");
  }
  if (
    !Number.isSafeInteger(input.financialState.unsettledEntries) ||
    input.financialState.unsettledEntries < 0 ||
    !Number.isSafeInteger(input.segmentGuard.maxUnsettledEntries) ||
    input.segmentGuard.maxUnsettledEntries < 0
  ) {
    throw new Error("Paid tournament unsettled entry count is invalid.");
  }

  const balance = parseExactHlx(
    input.financialState.availableBalanceHlx,
    "available balance",
    false,
  );
  const unsettled = parseExactHlx(
    input.financialState.unsettledExposureHlx,
    "unsettled exposure",
    false,
  );
  const segmentSpent = parseExactHlx(
    input.financialState.segmentSpentHlx,
    "segment spend",
    false,
  );
  const tournamentSpent = parseExactHlx(
    input.financialState.tournamentSpentHlx,
    "tournament spend",
    false,
  );
  const globalSpent = parseExactHlx(
    input.financialState.globalSessionSpentHlx,
    "global session spend",
    false,
  );
  const realisedPnl = parseExactHlx(
    input.financialState.realisedQualificationPnlHlx,
    "realised qualification P/L",
    true,
  );
  const maxExposure = parseExactHlx(
    input.segmentGuard.maxUnsettledExposureHlx,
    "maximum unsettled exposure",
    false,
  );
  const segmentCeiling = parseExactHlx(
    input.segmentGuard.segmentSpendCeilingHlx,
    "segment spend ceiling",
    false,
  );
  const tournamentCeiling = parseExactHlx(
    input.segmentGuard.tournamentSpendCeilingHlx,
    "tournament spend ceiling",
    false,
  );
  const globalCeiling = parseExactHlx(
    input.segmentGuard.globalSessionSpendCeilingHlx,
    "global session spend ceiling",
    false,
  );
  const stopLoss = parseExactHlx(
    input.segmentGuard.realisedStopLossHlx,
    "realised stop-loss",
    true,
  );
  if (stopLoss.scaled > 0n) {
    throw new Error("Paid tournament realised stop-loss must not be positive.");
  }

  let projected: {
    unsettledEntries: number;
    unsettledExposureHlx: string;
    segmentSpentHlx: string;
    tournamentSpentHlx: string;
    globalSessionSpentHlx: string;
  } | null = null;
  if (input.fee.status !== "authoritative" || input.fee.asset !== "HLX") {
    block("fee_not_authoritative_hlx");
  } else {
    const fee = parseExactHlx(input.fee.amountHlx, "entry fee", false);
    const nextEntries = input.financialState.unsettledEntries + 1;
    const nextUnsettled = unsettled.scaled + fee.scaled;
    const nextSegment = segmentSpent.scaled + fee.scaled;
    const nextTournament = tournamentSpent.scaled + fee.scaled;
    const nextGlobal = globalSpent.scaled + fee.scaled;
    projected = {
      unsettledEntries: nextEntries,
      unsettledExposureHlx: formatExactHlx(nextUnsettled),
      segmentSpentHlx: formatExactHlx(nextSegment),
      tournamentSpentHlx: formatExactHlx(nextTournament),
      globalSessionSpentHlx: formatExactHlx(nextGlobal),
    };
    if (balance.scaled < fee.scaled) block("insufficient_hlx_balance");
    if (nextEntries > input.segmentGuard.maxUnsettledEntries) {
      block("max_unsettled_entries_reached");
    }
    if (nextUnsettled > maxExposure.scaled) {
      block("max_unsettled_exposure_reached");
    }
    if (nextSegment > segmentCeiling.scaled) {
      block("segment_spend_ceiling_reached");
    }
    if (nextTournament > tournamentCeiling.scaled) {
      block("tournament_spend_ceiling_reached");
    }
    if (nextGlobal > globalCeiling.scaled) {
      block("global_session_spend_ceiling_reached");
    }
  }
  if (realisedPnl.scaled <= stopLoss.scaled) {
    block("realised_stop_loss_triggered");
  }

  const localDryRunAllowed = blockers.length === 0;
  return {
    status: localDryRunAllowed ? "dry_run_ready" : "blocked",
    blockers,
    projected,
    localDryRunAllowed,
    gameEntryAllowed: false,
  };
}
