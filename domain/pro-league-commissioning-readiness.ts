export type ProLeagueCommissioningReadinessCheck = Readonly<{
  code:
    | "ACTIVE_EVIDENCE"
    | "GENERATION_CONSISTENCY"
    | "COMPLIANT_ROSTER"
    | "COMPLETE_MAP_ASSIGNMENT"
    | "MAP_PREPARATION"
    | "CURRENT_CORE_STATE"
    | "DISCOVERY_QUEUE"
    | "OPEN_RACE_LIMITATIONS"
    | "BREEDING_RESEARCH"
    | "SUBSTITUTION_LEDGER"
    | "OPPONENT_EVIDENCE"
    | "READ_ONLY_BOUNDARY"
    | "OWNER_PREVIEW_ACCEPTANCE";
  status: "pass" | "review" | "block";
  requiredForProtectedPreview: boolean;
  detail: string;
}>;

export type ProLeagueCommissioningReadiness = Readonly<{
  status: "blocked" | "ready_for_protected_preview_review";
  checks: readonly ProLeagueCommissioningReadinessCheck[];
  summary: Readonly<{
    passCount: number;
    reviewCount: number;
    blockCount: number;
  }>;
  ownerAcceptanceRequired: true;
  protectedPreviewDeploymentAllowed: false;
  productionActivationAllowed: false;
  rosterOrMapSubmissionAllowed: false;
}>;

export type ProLeagueCommissioningReadinessInput = Readonly<{
  activeEvidence: boolean;
  populationProfileCount: number;
  ownedProfileCount: number;
  ownedCoreWithoutEvidenceCount: number;
  generationCutoffsConsistent: boolean;
  rosterAvailable: boolean;
  rosterCompliant: boolean;
  rosteredCoreCount: number;
  namedRosteredCoreCount: number;
  lineupAvailable: boolean;
  mapCount: number;
  lineCount: number;
  first16LineCount: number;
  mapPreparationAvailable: boolean;
  mapPreparationCount: number;
  currentCoreStateConnected: boolean;
  currentCoreCount: number;
  discoveryQueueAvailable: boolean;
  discoveryExperimentCount: number;
  openRaceStateConnected: boolean;
  exactOpenRaceGapMatchingAvailable: boolean;
  breedingResearchConnected: boolean;
  breedingObjectiveCount: number;
  substitutionLedgerResolved: boolean;
  opponentExactFormatEvidenceAvailable: boolean;
  everyAutomaticOrGameActionDisabled: boolean;
}>;

function boundedInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
    throw new Error(`Pro League commissioning readiness ${label} is invalid.`);
  }
  return value;
}

function check(
  code: ProLeagueCommissioningReadinessCheck["code"],
  status: ProLeagueCommissioningReadinessCheck["status"],
  requiredForProtectedPreview: boolean,
  detail: string,
): ProLeagueCommissioningReadinessCheck {
  return Object.freeze({ code, status, requiredForProtectedPreview, detail });
}

export function assessProLeagueCommissioningReadiness(
  input: ProLeagueCommissioningReadinessInput,
): ProLeagueCommissioningReadiness {
  const populationProfileCount = boundedInteger(
    input.populationProfileCount,
    "population profile count",
  );
  const ownedProfileCount = boundedInteger(
    input.ownedProfileCount,
    "owned profile count",
  );
  const ownedCoreWithoutEvidenceCount = boundedInteger(
    input.ownedCoreWithoutEvidenceCount,
    "owned Core evidence-gap count",
  );
  const rosteredCoreCount = boundedInteger(
    input.rosteredCoreCount,
    "rostered Core count",
  );
  const namedRosteredCoreCount = boundedInteger(
    input.namedRosteredCoreCount,
    "named rostered Core count",
  );
  const mapCount = boundedInteger(input.mapCount, "map count");
  const lineCount = boundedInteger(input.lineCount, "race-line count");
  const first16LineCount = boundedInteger(
    input.first16LineCount,
    "first-16 race-line count",
  );
  const mapPreparationCount = boundedInteger(
    input.mapPreparationCount,
    "map-preparation count",
  );
  const currentCoreCount = boundedInteger(
    input.currentCoreCount,
    "current Core count",
  );
  const discoveryExperimentCount = boundedInteger(
    input.discoveryExperimentCount,
    "Discovery experiment count",
  );
  const breedingObjectiveCount = boundedInteger(
    input.breedingObjectiveCount,
    "breeding objective count",
  );
  const activeEvidenceReady =
    input.activeEvidence && populationProfileCount > 0 && ownedProfileCount > 0;
  const rosterReady =
    input.rosterAvailable &&
    input.rosterCompliant &&
    rosteredCoreCount >= 12 &&
    rosteredCoreCount <= 25 &&
    namedRosteredCoreCount === rosteredCoreCount;
  const lineupReady =
    input.lineupAvailable &&
    mapCount === 4 &&
    lineCount === 168 &&
    first16LineCount === 64;
  const mapPreparationReady =
    input.mapPreparationAvailable && mapPreparationCount === 4;
  const currentCoreReady =
    input.currentCoreStateConnected &&
    rosterReady &&
    currentCoreCount === rosteredCoreCount;

  const checks = Object.freeze([
    check(
      "ACTIVE_EVIDENCE",
      activeEvidenceReady ? "pass" : "block",
      true,
      activeEvidenceReady
        ? `${populationProfileCount} population profiles and ${ownedProfileCount} owned profiles are available from one verified active generation; ${ownedCoreWithoutEvidenceCount} owned Cores currently lack exact-format evidence.`
        : "A complete active evidence generation with owned and population profiles is required.",
    ),
    check(
      "GENERATION_CONSISTENCY",
      input.generationCutoffsConsistent ? "pass" : "block",
      true,
      input.generationCutoffsConsistent
        ? "Roster, mapping, map preparation, Discovery and breeding objectives share the active evidence cutoff."
        : "Commissioning sections do not share one evidence cutoff and must remain hidden.",
    ),
    check(
      "COMPLIANT_ROSTER",
      rosterReady ? "pass" : "block",
      true,
      rosterReady
        ? `${rosteredCoreCount} named Cores form a rules-compliant quality-first draft roster.`
        : "A named, rules-compliant 12–25 Core draft roster is required.",
    ),
    check(
      "COMPLETE_MAP_ASSIGNMENT",
      lineupReady ? "pass" : "block",
      true,
      lineupReady
        ? "All four published maps are covered by 168 race lines, including the 64 first-16 lines."
        : "The four-map assignment must contain exactly 168 verified race lines.",
    ),
    check(
      "MAP_PREPARATION",
      mapPreparationReady ? "pass" : "block",
      true,
      mapPreparationReady
        ? "Home preference and weakest-first defensive preparation cover all four maps."
        : "A complete four-map preparation order is required.",
    ),
    check(
      "CURRENT_CORE_STATE",
      currentCoreReady ? "pass" : "block",
      true,
      currentCoreReady
        ? `Current API state is complete for all ${currentCoreCount} rostered Cores.`
        : "Current API state must be complete for every rostered Core.",
    ),
    check(
      "DISCOVERY_QUEUE",
      input.discoveryQueueAvailable ? "pass" : "block",
      true,
      input.discoveryQueueAvailable
        ? `${discoveryExperimentCount} bounded pre-roster Discovery experiments are available.`
        : "The bounded Pro League Discovery queue is unavailable.",
    ),
    check(
      "OPEN_RACE_LIMITATIONS",
      input.openRaceStateConnected && input.exactOpenRaceGapMatchingAvailable
        ? "pass"
        : "review",
      false,
      input.openRaceStateConnected
        ? input.exactOpenRaceGapMatchingAvailable
          ? "Open races can be matched to exact Pro League gaps using authoritative type and distance evidence."
          : "Open races are readable, but exact gap matching remains held until the API supplies authoritative distance and Pro League race type."
        : "Open-race evidence is not connected; last-good roster and map guidance remain available.",
    ),
    check(
      "BREEDING_RESEARCH",
      input.breedingResearchConnected ? "pass" : "review",
      false,
      input.breedingResearchConnected
        ? `${breedingObjectiveCount} held breeding objectives are available as research only; official pair checks remain mandatory.`
        : "Breeding research remains held without an active accepted research generation.",
    ),
    check(
      "SUBSTITUTION_LEDGER",
      input.substitutionLedgerResolved ? "pass" : "review",
      false,
      input.substitutionLedgerResolved
        ? "The annual substitution ledger and initial-roster counting rule are available."
        : "The initial-roster counting rule is unresolved, so all ten annual substitutions remain reserved.",
    ),
    check(
      "OPPONENT_EVIDENCE",
      input.opponentExactFormatEvidenceAvailable ? "pass" : "review",
      false,
      input.opponentExactFormatEvidenceAvailable
        ? "Authoritative opponent exact-format evidence is available for match review."
        : "Opponent-specific denial and head-to-head advice remain held; missing opposition evidence is not favourable.",
    ),
    check(
      "READ_ONLY_BOUNDARY",
      input.everyAutomaticOrGameActionDisabled ? "pass" : "block",
      true,
      input.everyAutomaticOrGameActionDisabled
        ? "Automatic race entry, roster mutation, map submission, pair recommendation and breeding execution are disabled."
        : "A write or game-action path is enabled and protected Preview review must stop.",
    ),
    check(
      "OWNER_PREVIEW_ACCEPTANCE",
      "review",
      false,
      "Owner acceptance has not been performed. Any protected Preview deployment remains a separate deliberate approval decision.",
    ),
  ]);
  const summary = Object.freeze({
    passCount: checks.filter(({ status }) => status === "pass").length,
    reviewCount: checks.filter(({ status }) => status === "review").length,
    blockCount: checks.filter(({ status }) => status === "block").length,
  });
  const requiredBlocked = checks.some(
    ({ requiredForProtectedPreview, status }) =>
      requiredForProtectedPreview && status === "block",
  );
  return Object.freeze({
    status: requiredBlocked ? "blocked" : "ready_for_protected_preview_review",
    checks,
    summary,
    ownerAcceptanceRequired: true,
    protectedPreviewDeploymentAllowed: false,
    productionActivationAllowed: false,
    rosterOrMapSubmissionAllowed: false,
  });
}
