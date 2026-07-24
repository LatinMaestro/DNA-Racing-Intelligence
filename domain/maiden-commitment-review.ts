export const maidenCommitmentModes = ["bike", "car", "horse"] as const;
export type MaidenCommitmentMode = (typeof maidenCommitmentModes)[number];

export type MaidenCommitmentReviewInput = Readonly<{
  coreId: string;
  tournamentId: string;
  bracketId: string;
  mode: MaidenCommitmentMode;
  lifecycleState:
    | "eligible"
    | "planned"
    | "committed"
    | "consumed"
    | "not_eligible"
    | "unknown"
    | "invalid";
  lifecycleTournamentId: string | null;
  crossModeDisposition: "strongest_mode" | "weaker_mode" | "unresolved";
  bracketDisposition:
    | "review_candidate"
    | "preserve_me"
    | "hold"
    | "ineligible"
    | "committed_elsewhere"
    | "already_consumed"
    | "closed";
  tournamentAvailability: "upcoming" | "qualifying" | "closed";
  tournamentStructureStatus: "complete" | "partial" | "unknown";
  eligibilityEvidence: "complete" | "partial" | "unknown";
  evidenceConfidence: "high" | "moderate" | "low" | "unknown";
  dataCurrentThrough: string | null;
  lastImported: string | null;
  freshness: "current" | "ageing" | "stale" | "unknown";
}>;

export type MaidenCommitmentWarning =
  | "SINGLE_USE_ENTITLEMENT"
  | "COMMITMENT_DOES_NOT_CONSUME_ENTITLEMENT"
  | "GATE_C_NOT_PASSED"
  | "GATE_D_NOT_PASSED"
  | "PRESERVE_ME"
  | "STRONGEST_MODE_UNRESOLVED"
  | "BRACKET_NOT_READY"
  | "TOURNAMENT_STRUCTURE_INCOMPLETE"
  | "ELIGIBILITY_EVIDENCE_INCOMPLETE"
  | "LOW_EVIDENCE_CONFIDENCE"
  | "MAIDEN_STATE_UNRESOLVED"
  | "PLANNED_FOR_THIS_TOURNAMENT"
  | "COMMITTED_TO_THIS_TOURNAMENT"
  | "COMMITTED_ELSEWHERE"
  | "ENTITLEMENT_CONSUMED"
  | "TOURNAMENT_CLOSED"
  | "DATA_CUTOFF_UNKNOWN"
  | "LAST_IMPORTED_UNKNOWN"
  | "IMPORTED_DATA_AGEING"
  | "IMPORTED_DATA_STALE";

export type MaidenCommitmentReview = Readonly<{
  coreId: string;
  tournamentId: string;
  bracketId: string;
  mode: MaidenCommitmentMode;
  disposition:
    | "commitment_review"
    | "preserve_me"
    | "hold"
    | "already_planned"
    | "already_committed"
    | "committed_elsewhere"
    | "already_consumed"
    | "ineligible"
    | "closed";
  warnings: readonly MaidenCommitmentWarning[];
  acknowledgementRequired: true;
  acknowledgementText: string;
  entitlementConsumedByThisReview: false;
  lifecycleMutationPerformed: false;
  dataCurrentThrough: string | null;
  lastImported: string | null;
  freshness: MaidenCommitmentReviewInput["freshness"];
  importedHistoricalSnapshot: true;
  actionableRecommendationAllowed: false;
  maidenCommitmentAllowed: false;
  automaticEntryAllowed: false;
}>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function timestamp(value: string | null, label: string): string | null {
  if (value === null) return null;
  const parsed = Date.parse(required(value, label));
  if (Number.isNaN(parsed)) throw new Error(`${label} must be valid.`);
  return new Date(parsed).toISOString();
}

export function reviewMaidenCommitment(
  input: MaidenCommitmentReviewInput,
): MaidenCommitmentReview {
  const coreId = required(input.coreId, "Core ID");
  const tournamentId = required(input.tournamentId, "Tournament ID");
  const bracketId = required(input.bracketId, "Bracket ID");
  if (!maidenCommitmentModes.includes(input.mode)) {
    throw new Error("Maiden commitment mode is invalid.");
  }
  if (
    ![
      "eligible",
      "planned",
      "committed",
      "consumed",
      "not_eligible",
      "unknown",
      "invalid",
    ].includes(input.lifecycleState)
  ) {
    throw new Error("Maiden lifecycle state is invalid.");
  }
  if (
    !["strongest_mode", "weaker_mode", "unresolved"].includes(
      input.crossModeDisposition,
    )
  ) {
    throw new Error("Cross-mode disposition is invalid.");
  }
  if (
    ![
      "review_candidate",
      "preserve_me",
      "hold",
      "ineligible",
      "committed_elsewhere",
      "already_consumed",
      "closed",
    ].includes(input.bracketDisposition)
  ) {
    throw new Error("Bracket disposition is invalid.");
  }
  if (
    !["upcoming", "qualifying", "closed"].includes(input.tournamentAvailability)
  ) {
    throw new Error("Tournament availability is invalid.");
  }
  if (
    !["complete", "partial", "unknown"].includes(
      input.tournamentStructureStatus,
    )
  ) {
    throw new Error("Tournament structure status is invalid.");
  }
  if (!["complete", "partial", "unknown"].includes(input.eligibilityEvidence)) {
    throw new Error("Eligibility evidence status is invalid.");
  }
  if (
    !["high", "moderate", "low", "unknown"].includes(input.evidenceConfidence)
  ) {
    throw new Error("Evidence confidence is invalid.");
  }
  if (!["current", "ageing", "stale", "unknown"].includes(input.freshness)) {
    throw new Error("Freshness is invalid.");
  }

  const lifecycleTournamentId =
    input.lifecycleTournamentId === null
      ? null
      : required(input.lifecycleTournamentId, "Lifecycle tournament ID");
  if (
    ["planned", "committed", "consumed"].includes(input.lifecycleState) !==
    (lifecycleTournamentId !== null)
  ) {
    throw new Error(
      "Planned, committed and consumed states require one lifecycle tournament.",
    );
  }

  const dataCurrentThrough = timestamp(
    input.dataCurrentThrough,
    "Data current through",
  );
  const lastImported = timestamp(input.lastImported, "Last imported");
  if (
    dataCurrentThrough !== null &&
    lastImported !== null &&
    Date.parse(lastImported) < Date.parse(dataCurrentThrough)
  ) {
    throw new Error("Last imported cannot precede data current through.");
  }

  const warnings = new Set<MaidenCommitmentWarning>([
    "SINGLE_USE_ENTITLEMENT",
    "COMMITMENT_DOES_NOT_CONSUME_ENTITLEMENT",
    "GATE_C_NOT_PASSED",
    "GATE_D_NOT_PASSED",
  ]);
  if (
    input.crossModeDisposition === "weaker_mode" ||
    input.bracketDisposition === "preserve_me"
  ) {
    warnings.add("PRESERVE_ME");
  }
  if (input.crossModeDisposition === "unresolved") {
    warnings.add("STRONGEST_MODE_UNRESOLVED");
  }
  if (input.bracketDisposition !== "review_candidate") {
    warnings.add("BRACKET_NOT_READY");
  }
  if (input.tournamentStructureStatus !== "complete") {
    warnings.add("TOURNAMENT_STRUCTURE_INCOMPLETE");
  }
  if (input.eligibilityEvidence !== "complete") {
    warnings.add("ELIGIBILITY_EVIDENCE_INCOMPLETE");
  }
  if (["low", "unknown"].includes(input.evidenceConfidence)) {
    warnings.add("LOW_EVIDENCE_CONFIDENCE");
  }
  if (["unknown", "invalid"].includes(input.lifecycleState)) {
    warnings.add("MAIDEN_STATE_UNRESOLVED");
  }
  if (input.tournamentAvailability === "closed") {
    warnings.add("TOURNAMENT_CLOSED");
  }
  if (dataCurrentThrough === null || input.freshness === "unknown") {
    warnings.add("DATA_CUTOFF_UNKNOWN");
  }
  if (lastImported === null) warnings.add("LAST_IMPORTED_UNKNOWN");
  if (input.freshness === "ageing") warnings.add("IMPORTED_DATA_AGEING");
  if (input.freshness === "stale") warnings.add("IMPORTED_DATA_STALE");

  const sameLifecycleTournament = lifecycleTournamentId === tournamentId;
  if (input.lifecycleState === "planned" && sameLifecycleTournament) {
    warnings.add("PLANNED_FOR_THIS_TOURNAMENT");
  }
  if (input.lifecycleState === "committed" && sameLifecycleTournament) {
    warnings.add("COMMITTED_TO_THIS_TOURNAMENT");
  }
  if (
    ["planned", "committed"].includes(input.lifecycleState) &&
    !sameLifecycleTournament
  ) {
    warnings.add("COMMITTED_ELSEWHERE");
  }
  if (input.lifecycleState === "consumed") {
    warnings.add("ENTITLEMENT_CONSUMED");
  }

  const ready =
    input.lifecycleState === "eligible" &&
    input.crossModeDisposition === "strongest_mode" &&
    input.bracketDisposition === "review_candidate" &&
    input.tournamentAvailability !== "closed" &&
    input.tournamentStructureStatus === "complete" &&
    input.eligibilityEvidence === "complete" &&
    ["high", "moderate"].includes(input.evidenceConfidence) &&
    dataCurrentThrough !== null &&
    lastImported !== null &&
    ["current", "ageing"].includes(input.freshness);

  let disposition: MaidenCommitmentReview["disposition"];
  if (input.lifecycleState === "consumed") {
    disposition = "already_consumed";
  } else if (
    input.lifecycleState === "not_eligible" ||
    input.bracketDisposition === "ineligible"
  ) {
    disposition = "ineligible";
  } else if (
    ["planned", "committed"].includes(input.lifecycleState) &&
    !sameLifecycleTournament
  ) {
    disposition = "committed_elsewhere";
  } else if (input.lifecycleState === "committed" && sameLifecycleTournament) {
    disposition = "already_committed";
  } else if (input.lifecycleState === "planned" && sameLifecycleTournament) {
    disposition = "already_planned";
  } else if (
    input.tournamentAvailability === "closed" ||
    input.bracketDisposition === "closed"
  ) {
    disposition = "closed";
  } else if (
    input.crossModeDisposition === "weaker_mode" ||
    input.bracketDisposition === "preserve_me"
  ) {
    disposition = "preserve_me";
  } else if (ready) {
    disposition = "commitment_review";
  } else {
    disposition = "hold";
  }

  return {
    coreId,
    tournamentId,
    bracketId,
    mode: input.mode,
    disposition,
    warnings: [...warnings],
    acknowledgementRequired: true,
    acknowledgementText:
      "Committing reserves this core's single-use Maiden entitlement for this tournament. Consumption is recorded only after authoritative participation evidence.",
    entitlementConsumedByThisReview: false,
    lifecycleMutationPerformed: false,
    dataCurrentThrough,
    lastImported,
    freshness: input.freshness,
    importedHistoricalSnapshot: true,
    actionableRecommendationAllowed: false,
    maidenCommitmentAllowed: false,
    automaticEntryAllowed: false,
  };
}
