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
  evaluatedOpponentCoreIds: readonly string[];
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
    evaluatedOpponentCoreIds: [...opportunity.enteredOpponentCoreIds],
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
  | "selected_core_not_currently_owned"
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
  if (!owned.has(input.evaluation.selectedCoreId)) {
    block("selected_core_not_currently_owned");
  }
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
    const frozenOpponents = [
      ...input.evaluation.evaluatedOpponentCoreIds,
    ].sort();
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

export const localExecutorHeartbeatProtocolVersion =
  "race-entry-executor-control/v1" as const;

export type LocalExecutorHeartbeat = Readonly<{
  protocolVersion: typeof localExecutorHeartbeatProtocolVersion;
  executorId: string;
  observedAt: string;
  runtime: "brave_chromium_owner_profile";
  sessionStatus: "authenticated" | "expired" | "unknown";
  sessionMaterialLocation: "local_only";
  nativeContractStatus: "unobserved" | "observed_current" | "drifted";
  executionMode: "disabled" | "dry_run_only";
  supportedExecutionPurposes: readonly RaceEntryBotExecutionPurpose[];
  lastAppliedControlVersion: number;
  walletSigningEnabled: false;
  gameSubmissionEnabled: false;
}>;

export type LocalExecutorControlBlocker =
  | "owner_control_not_current"
  | "globally_paused"
  | "kill_switch_engaged"
  | "executor_identity_mismatch"
  | "heartbeat_stale_or_invalid"
  | "executor_control_version_stale"
  | "session_not_authenticated"
  | "native_contract_unobserved"
  | "native_contract_drifted"
  | "execution_mode_not_dry_run_only"
  | "execution_purpose_unsupported";

export type LocalExecutorControlDirective =
  | "kill"
  | "pause"
  | "refresh_control"
  | "reauthenticate"
  | "contract_review_required"
  | "observe_native_contract"
  | "unsupported_purpose"
  | "dry_run_only";

const localExecutorHeartbeatKeys = Object.freeze([
  "protocolVersion",
  "executorId",
  "observedAt",
  "runtime",
  "sessionStatus",
  "sessionMaterialLocation",
  "nativeContractStatus",
  "executionMode",
  "supportedExecutionPurposes",
  "lastAppliedControlVersion",
  "walletSigningEnabled",
  "gameSubmissionEnabled",
] as const);

function localExecutorIdentifier(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u.test(value)
  ) {
    throw new Error(`Local executor ${field} is invalid.`);
  }
  return value;
}

/**
 * Parses the complete cloud-visible heartbeat allowlist.
 *
 * Unknown fields are rejected so cookies, authorization headers, session
 * tokens and future native request fields cannot silently cross the local
 * executor trust boundary.
 */
export function parseLocalExecutorHeartbeat(
  payload: unknown,
): LocalExecutorHeartbeat {
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new Error("Local executor heartbeat must be an object.");
  }
  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const allowed = [...localExecutorHeartbeatKeys].sort();
  if (
    keys.length !== allowed.length ||
    keys.some((key, index) => key !== allowed[index])
  ) {
    throw new Error("Local executor heartbeat contains an unapproved field.");
  }
  if (record.protocolVersion !== localExecutorHeartbeatProtocolVersion) {
    throw new Error(
      "Local executor heartbeat protocol version is unsupported.",
    );
  }
  const executorId = localExecutorIdentifier(record.executorId, "identity");
  if (
    typeof record.observedAt !== "string" ||
    !Number.isFinite(Date.parse(record.observedAt))
  ) {
    throw new Error("Local executor heartbeat observation time is invalid.");
  }
  if (record.runtime !== "brave_chromium_owner_profile") {
    throw new Error("Local executor runtime is unsupported.");
  }
  if (
    !["authenticated", "expired", "unknown"].includes(
      record.sessionStatus as string,
    )
  ) {
    throw new Error("Local executor session status is invalid.");
  }
  if (record.sessionMaterialLocation !== "local_only") {
    throw new Error("Local executor session material must remain local.");
  }
  if (
    !["unobserved", "observed_current", "drifted"].includes(
      record.nativeContractStatus as string,
    )
  ) {
    throw new Error("Local executor native contract status is invalid.");
  }
  if (!["disabled", "dry_run_only"].includes(record.executionMode as string)) {
    throw new Error("Local executor execution mode is invalid.");
  }
  if (
    !Array.isArray(record.supportedExecutionPurposes) ||
    record.supportedExecutionPurposes.length < 1 ||
    record.supportedExecutionPurposes.length >
      raceEntryBotExecutionPurposes.length ||
    new Set(record.supportedExecutionPurposes).size !==
      record.supportedExecutionPurposes.length ||
    record.supportedExecutionPurposes.some(
      (purpose) =>
        typeof purpose !== "string" ||
        !raceEntryBotExecutionPurposes.includes(
          purpose as RaceEntryBotExecutionPurpose,
        ),
    )
  ) {
    throw new Error("Local executor supported execution purposes are invalid.");
  }
  if (
    !Number.isSafeInteger(record.lastAppliedControlVersion) ||
    (record.lastAppliedControlVersion as number) < 0
  ) {
    throw new Error("Local executor control version is invalid.");
  }
  if (
    record.walletSigningEnabled !== false ||
    record.gameSubmissionEnabled !== false
  ) {
    throw new Error(
      "Local executor heartbeat cannot enable signing or game submission.",
    );
  }

  return {
    protocolVersion: localExecutorHeartbeatProtocolVersion,
    executorId,
    observedAt: record.observedAt,
    runtime: "brave_chromium_owner_profile",
    sessionStatus:
      record.sessionStatus as LocalExecutorHeartbeat["sessionStatus"],
    sessionMaterialLocation: "local_only",
    nativeContractStatus:
      record.nativeContractStatus as LocalExecutorHeartbeat["nativeContractStatus"],
    executionMode:
      record.executionMode as LocalExecutorHeartbeat["executionMode"],
    supportedExecutionPurposes:
      record.supportedExecutionPurposes as RaceEntryBotExecutionPurpose[],
    lastAppliedControlVersion: record.lastAppliedControlVersion as number,
    walletSigningEnabled: false,
    gameSubmissionEnabled: false,
  };
}

/**
 * Evaluates one sanitized local heartbeat against current owner controls.
 *
 * This protocol carries health and pause/kill state only. It never carries a
 * native entry URL, request body, credential or submission authority.
 */
export function evaluateLocalExecutorHeartbeatControl(
  input: Readonly<{
    evaluatedAt: string;
    maximumHeartbeatAgeSeconds: number;
    expectedExecutorId: string;
    minimumControlVersion: number;
    requestedPurpose: RaceEntryBotExecutionPurpose;
    ownerControl: Readonly<{
      authorityStatus: "current" | "stale";
      globallyPaused: boolean;
      killSwitchEngaged: boolean;
    }>;
    heartbeat: unknown;
  }>,
): Readonly<{
  healthStatus: "healthy" | "blocked";
  directive: LocalExecutorControlDirective;
  blockers: readonly LocalExecutorControlBlocker[];
  localDryRunAllowed: boolean;
  requestContractIncluded: false;
  cloudCredentialStorageAllowed: false;
  gameEntryAllowed: false;
}> {
  const evaluatedAt = Date.parse(input.evaluatedAt);
  if (
    !Number.isFinite(evaluatedAt) ||
    !Number.isSafeInteger(input.maximumHeartbeatAgeSeconds) ||
    input.maximumHeartbeatAgeSeconds < 1 ||
    input.maximumHeartbeatAgeSeconds > 300 ||
    !Number.isSafeInteger(input.minimumControlVersion) ||
    input.minimumControlVersion < 0 ||
    !raceEntryBotExecutionPurposes.includes(input.requestedPurpose)
  ) {
    throw new Error("Local executor control evaluation is invalid.");
  }
  const expectedExecutorId = localExecutorIdentifier(
    input.expectedExecutorId,
    "expected identity",
  );
  const heartbeat = parseLocalExecutorHeartbeat(input.heartbeat);
  const blockers: LocalExecutorControlBlocker[] = [];
  const block = (value: LocalExecutorControlBlocker) => {
    if (!blockers.includes(value)) blockers.push(value);
  };

  if (input.ownerControl.authorityStatus !== "current") {
    block("owner_control_not_current");
  }
  if (input.ownerControl.globallyPaused) block("globally_paused");
  if (input.ownerControl.killSwitchEngaged) block("kill_switch_engaged");
  if (heartbeat.executorId !== expectedExecutorId) {
    block("executor_identity_mismatch");
  }
  const observedAt = Date.parse(heartbeat.observedAt);
  if (
    observedAt > evaluatedAt ||
    evaluatedAt - observedAt > input.maximumHeartbeatAgeSeconds * 1_000
  ) {
    block("heartbeat_stale_or_invalid");
  }
  if (heartbeat.lastAppliedControlVersion < input.minimumControlVersion) {
    block("executor_control_version_stale");
  }
  if (heartbeat.sessionStatus !== "authenticated") {
    block("session_not_authenticated");
  }
  if (heartbeat.nativeContractStatus === "unobserved") {
    block("native_contract_unobserved");
  }
  if (heartbeat.nativeContractStatus === "drifted") {
    block("native_contract_drifted");
  }
  if (heartbeat.executionMode !== "dry_run_only") {
    block("execution_mode_not_dry_run_only");
  }
  if (!heartbeat.supportedExecutionPurposes.includes(input.requestedPurpose)) {
    block("execution_purpose_unsupported");
  }

  let directive: LocalExecutorControlDirective;
  if (input.ownerControl.killSwitchEngaged) {
    directive = "kill";
  } else if (
    input.ownerControl.globallyPaused ||
    input.ownerControl.authorityStatus !== "current"
  ) {
    directive = "pause";
  } else if (
    blockers.includes("executor_identity_mismatch") ||
    blockers.includes("heartbeat_stale_or_invalid") ||
    blockers.includes("executor_control_version_stale")
  ) {
    directive = "refresh_control";
  } else if (blockers.includes("session_not_authenticated")) {
    directive = "reauthenticate";
  } else if (blockers.includes("native_contract_drifted")) {
    directive = "contract_review_required";
  } else if (blockers.includes("native_contract_unobserved")) {
    directive = "observe_native_contract";
  } else if (blockers.includes("execution_purpose_unsupported")) {
    directive = "unsupported_purpose";
  } else if (blockers.includes("execution_mode_not_dry_run_only")) {
    directive = "pause";
  } else {
    directive = "dry_run_only";
  }

  const localDryRunAllowed =
    blockers.length === 0 && directive === "dry_run_only";
  return {
    healthStatus: localDryRunAllowed ? "healthy" : "blocked",
    directive,
    blockers,
    localDryRunAllowed,
    requestContractIncluded: false,
    cloudCredentialStorageAllowed: false,
    gameEntryAllowed: false,
  };
}

export type FreeDiscoveryCampaignCell = Readonly<{
  campaignId: string;
  cellId: string;
  selectedCoreId: string;
  mode: "bike" | "car" | "horse";
  distanceMetres: number;
  raceClassSourceValue: string | number;
  gateCount: number;
  format: string;
  targetNewRaces: number;
  reconciledCompletedNewRaces: number;
  reservedOrSubmittedNewRaces: number;
  pairing:
    | Readonly<{ status: "single_core" }>
    | Readonly<{
        status: "verified_benchmark_pair";
        benchmarkCoreId: string;
        verifiedMode: "bike" | "car" | "horse";
        verifiedDistanceMetres: number;
      }>;
}>;

export type FreeDiscoveryRaceCandidate = Readonly<{
  raceId: string;
  status: string;
  raceTypeSourceValue: string | null;
  mode: "bike" | "car" | "horse";
  distanceMetres: number;
  raceClassSourceValue: string | number | null;
  gateCount: number;
  filledGateCount: number;
  format: string;
  entrantCoreIds: readonly string[];
  observedAt: string;
}>;

export type FreeDiscoveryOpportunityExclusion =
  | "campaign_budget_exhausted"
  | "not_open"
  | "stale_or_invalid_evidence"
  | "not_authoritative_standalone_free"
  | "campaign_selector_mismatch"
  | "field_full_or_invalid"
  | "owned_core_already_entered"
  | "insufficient_vacancies_for_pair";

export type FreeDiscoveryOpportunity = Readonly<{
  campaignId: string;
  cellId: string;
  raceId: string;
  plannedOwnedCoreIds: readonly string[];
  mode: "bike" | "car" | "horse";
  distanceMetres: number;
  raceClassSourceValue: string | number;
  gateCount: number;
  format: string;
  enteredOpponentCoreIds: readonly string[];
  vacantGates: number;
  raceTypeSourceValue: "Free";
  evaluationStatus: "needs_field_evaluation";
  queueStatus: "not_queued";
  automaticPerformanceStopAllowed: false;
  automaticBurnDecisionAllowed: false;
  gameEntryAllowed: false;
}>;

function freeDiscoveryRequiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 256) {
    throw new Error(`Free Discovery ${field} is invalid.`);
  }
  return normalized;
}

function freeDiscoveryCoreIds(
  values: readonly string[],
  field: string,
): Set<string> {
  const ids = new Set(values);
  if (
    ids.size !== values.length ||
    values.some((value) => !/^[1-9]\d*$/u.test(value))
  ) {
    throw new Error(`Free Discovery ${field} is invalid.`);
  }
  return ids;
}

/**
 * Read-only Free Discovery lane of the shared race-entry bot.
 *
 * It applies the exact campaign selector and authoritative reconciled new-race
 * budget before later field evaluation. It does not apply the ordinary Open
 * Race half-filled advisory rule, queue work, submit game actions, stop from
 * performance/no-star evidence or make a burn decision.
 */
export function screenFreeDiscoveryOpportunities(
  input: Readonly<{
    evaluatedAt: string;
    maximumAgeMinutes: number;
    campaign: FreeDiscoveryCampaignCell;
    currentOwnedCoreIds: readonly string[];
    races: readonly FreeDiscoveryRaceCandidate[];
  }>,
): Readonly<{
  opportunities: readonly FreeDiscoveryOpportunity[];
  excluded: readonly Readonly<{
    raceId: string;
    reason: FreeDiscoveryOpportunityExclusion;
  }>[];
  newRaceBudgetRemaining: number;
  queueAllowed: false;
  gameEntryAllowed: false;
}> {
  const evaluatedAt = Date.parse(input.evaluatedAt);
  if (
    !Number.isFinite(evaluatedAt) ||
    !Number.isSafeInteger(input.maximumAgeMinutes) ||
    input.maximumAgeMinutes < 1 ||
    input.maximumAgeMinutes > 60
  ) {
    throw new Error("Free Discovery freshness limit is invalid.");
  }
  const campaign = input.campaign;
  const campaignId = freeDiscoveryRequiredText(
    campaign.campaignId,
    "campaign identity",
  );
  const cellId = freeDiscoveryRequiredText(campaign.cellId, "cell identity");
  freeDiscoveryRequiredText(campaign.format, "format");
  if (
    !Number.isSafeInteger(campaign.distanceMetres) ||
    campaign.distanceMetres <= 0 ||
    !Number.isSafeInteger(campaign.gateCount) ||
    campaign.gateCount < 2 ||
    !Number.isSafeInteger(campaign.targetNewRaces) ||
    campaign.targetNewRaces < 1 ||
    !Number.isSafeInteger(campaign.reconciledCompletedNewRaces) ||
    campaign.reconciledCompletedNewRaces < 0 ||
    !Number.isSafeInteger(campaign.reservedOrSubmittedNewRaces) ||
    campaign.reservedOrSubmittedNewRaces < 0 ||
    campaign.reconciledCompletedNewRaces +
      campaign.reservedOrSubmittedNewRaces >
      campaign.targetNewRaces
  ) {
    throw new Error("Free Discovery campaign cell is invalid.");
  }
  const owned = freeDiscoveryCoreIds(
    input.currentOwnedCoreIds,
    "owned Core selection",
  );
  if (!owned.has(campaign.selectedCoreId)) {
    throw new Error("Free Discovery selected Core is not currently owned.");
  }

  const plannedOwnedCoreIds = [campaign.selectedCoreId];
  if (campaign.pairing.status === "verified_benchmark_pair") {
    if (
      campaign.gateCount !== 4 ||
      campaign.pairing.benchmarkCoreId === campaign.selectedCoreId ||
      !owned.has(campaign.pairing.benchmarkCoreId) ||
      campaign.pairing.verifiedMode !== campaign.mode ||
      campaign.pairing.verifiedDistanceMetres !== campaign.distanceMetres
    ) {
      throw new Error(
        "Free Discovery benchmark pair is not verified for the exact campaign context.",
      );
    }
    plannedOwnedCoreIds.push(campaign.pairing.benchmarkCoreId);
  }

  const newRaceBudgetRemaining =
    campaign.targetNewRaces -
    campaign.reconciledCompletedNewRaces -
    campaign.reservedOrSubmittedNewRaces;
  const opportunities: FreeDiscoveryOpportunity[] = [];
  const excluded: {
    raceId: string;
    reason: FreeDiscoveryOpportunityExclusion;
  }[] = [];
  const raceIds = new Set<string>();
  const maximumAgeMilliseconds = input.maximumAgeMinutes * 60_000;

  for (const race of input.races) {
    const raceId = freeDiscoveryRequiredText(race.raceId, "race identity");
    if (raceIds.has(raceId)) {
      throw new Error("Free Discovery race identity is duplicated.");
    }
    raceIds.add(raceId);
    const exclude = (reason: FreeDiscoveryOpportunityExclusion) => {
      excluded.push({ raceId, reason });
    };
    if (newRaceBudgetRemaining === 0) {
      exclude("campaign_budget_exhausted");
      continue;
    }
    if (!["open", "filling"].includes(race.status.toLowerCase())) {
      exclude("not_open");
      continue;
    }
    const observedAt = Date.parse(race.observedAt);
    if (
      !Number.isFinite(observedAt) ||
      observedAt > evaluatedAt ||
      evaluatedAt - observedAt > maximumAgeMilliseconds
    ) {
      exclude("stale_or_invalid_evidence");
      continue;
    }
    if (race.raceTypeSourceValue !== "Free") {
      exclude("not_authoritative_standalone_free");
      continue;
    }
    if (
      race.mode !== campaign.mode ||
      race.distanceMetres !== campaign.distanceMetres ||
      race.raceClassSourceValue !== campaign.raceClassSourceValue ||
      race.gateCount !== campaign.gateCount ||
      race.format !== campaign.format
    ) {
      exclude("campaign_selector_mismatch");
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
      race.entrantCoreIds.some((coreId) => !/^[1-9]\d*$/u.test(coreId))
    ) {
      exclude("field_full_or_invalid");
      continue;
    }
    if (race.entrantCoreIds.some((coreId) => owned.has(coreId))) {
      exclude("owned_core_already_entered");
      continue;
    }
    const vacantGates = race.gateCount - race.filledGateCount;
    if (vacantGates < plannedOwnedCoreIds.length) {
      exclude("insufficient_vacancies_for_pair");
      continue;
    }
    opportunities.push({
      campaignId,
      cellId,
      raceId,
      plannedOwnedCoreIds: [...plannedOwnedCoreIds],
      mode: race.mode,
      distanceMetres: race.distanceMetres,
      raceClassSourceValue: campaign.raceClassSourceValue,
      gateCount: race.gateCount,
      format: race.format,
      enteredOpponentCoreIds: [...race.entrantCoreIds],
      vacantGates,
      raceTypeSourceValue: "Free",
      evaluationStatus: "needs_field_evaluation",
      queueStatus: "not_queued",
      automaticPerformanceStopAllowed: false,
      automaticBurnDecisionAllowed: false,
      gameEntryAllowed: false,
    });
  }

  return {
    opportunities,
    excluded,
    newRaceBudgetRemaining,
    queueAllowed: false,
    gameEntryAllowed: false,
  };
}
