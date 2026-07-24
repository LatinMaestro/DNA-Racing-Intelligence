export type PrivateChronologicalValidationInput = Readonly<{
  evidenceId: string;
  exactHeadSha: string;
  sourceRows: number;
  uniqueRows: number;
  duplicateRowsIgnored: number;
  uniqueEvents: number;
  completeEvents: number;
  partialEvents: number;
  partialEventsExcludedFromOutcomeScoring: boolean;
  externallyChronologicallyOrdered: boolean;
  featureCutoffStrictlyBeforeEvent: boolean;
  sameEventHistoryUpdatedAfterPrediction: boolean;
  baselinePartitions: Readonly<{
    mode: boolean;
    exactDistanceMetres: boolean;
    gateCount: boolean;
  }>;
  pairedHoldoutCases: number;
  directHistoryBrierImprovementMillionths: number;
  historicalStarBrierImprovementMillionths: number;
  lineageProxyCases: number;
  lineageProxyBrierImprovementMillionths: number;
  breedingTimestampCoverageAvailable: boolean;
  pointInTimeMaidenEntitlementAvailable: boolean;
  eraReviewCandidateCount: number;
  algorithmChangeClaimed: boolean;
  capacity: Readonly<{
    evidenceSource: "synthetic" | "sanitized_representative" | "private_hosted";
    repetitions: number;
    peakMemoryMegabytes: number;
    memoryBudgetMegabytes: number;
    runsOffRequestPath: boolean;
    routineRequestP95Measured: boolean;
  }>;
  economics: Readonly<{
    historicalBgcRows: number;
    raceLedgerTransactionsFromHistoricalBgc: number;
    unknownRaceAssetRows: number;
  }>;
}>;

export type PrivateChronologicalValidationAssessment = Readonly<{
  status: "blocked" | "review_required";
  chronologyStatus: "valid" | "invalid";
  directHistoryStatus:
    "review_candidate" | "not_supported" | "insufficient_evidence";
  historicalStarStatus:
    "review_candidate" | "not_supported" | "insufficient_evidence";
  lineageProxyStatus:
    "review_candidate" | "not_supported" | "insufficient_evidence";
  breedingStatus: "blocked_missing_timestamps" | "evidence_only";
  maidenStatus: "blocked_missing_point_in_time_entitlement" | "evidence_only";
  eraStatus: "review_candidates_present" | "no_review_candidates";
  capacityStatus: "representative_background_only" | "incomplete";
  economicsStatus: "bgc_exception_verified" | "invalid";
  warnings: readonly (
    | "CHRONOLOGICAL_ORDER_INVALID"
    | "PARTIAL_EVENTS_INCLUDED_IN_OUTCOMES"
    | "BASELINE_CONTEXT_INCOMPLETE"
    | "DIRECT_HISTORY_NOT_SUPPORTED"
    | "HISTORICAL_STAR_FEATURE_NOT_SUPPORTED"
    | "LINEAGE_PROXY_NOT_SUPPORTED"
    | "BREEDING_TIMESTAMPS_UNAVAILABLE"
    | "POINT_IN_TIME_ME_UNAVAILABLE"
    | "ALGORITHM_CHANGE_CAUSALITY_NOT_ESTABLISHED"
    | "ROUTINE_REQUEST_CAPACITY_NOT_MEASURED"
    | "BGC_EXCEPTION_INVALID"
  )[];
  gateCStatus: "not_accepted";
  gateEStatus: "not_accepted";
  recommendationActivationAllowed: false;
  productionMutationAllowed: false;
}>;

function nonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite.`);
  }
}

export function assessPrivateChronologicalValidation(
  input: PrivateChronologicalValidationInput,
): PrivateChronologicalValidationAssessment {
  if (input.evidenceId.trim() === "") {
    throw new Error("Evidence ID is required.");
  }
  if (!/^[0-9a-f]{40}$/i.test(input.exactHeadSha)) {
    throw new Error("Exact-head SHA must contain 40 hexadecimal characters.");
  }
  for (const [value, label] of [
    [input.sourceRows, "Source rows"],
    [input.uniqueRows, "Unique rows"],
    [input.duplicateRowsIgnored, "Duplicate rows"],
    [input.uniqueEvents, "Unique events"],
    [input.completeEvents, "Complete events"],
    [input.partialEvents, "Partial events"],
    [input.pairedHoldoutCases, "Paired holdout cases"],
    [input.lineageProxyCases, "Lineage proxy cases"],
    [input.eraReviewCandidateCount, "Era review candidates"],
    [input.capacity.repetitions, "Capacity repetitions"],
    [input.economics.historicalBgcRows, "Historical BGC rows"],
    [
      input.economics.raceLedgerTransactionsFromHistoricalBgc,
      "Historical BGC ledger transactions",
    ],
    [input.economics.unknownRaceAssetRows, "Unknown race-asset rows"],
  ] as const) {
    nonNegativeInteger(value, label);
  }
  for (const [value, label] of [
    [
      input.directHistoryBrierImprovementMillionths,
      "Direct-history Brier improvement",
    ],
    [
      input.historicalStarBrierImprovementMillionths,
      "Historical-star Brier improvement",
    ],
    [
      input.lineageProxyBrierImprovementMillionths,
      "Lineage-proxy Brier improvement",
    ],
    [input.capacity.peakMemoryMegabytes, "Peak memory"],
    [input.capacity.memoryBudgetMegabytes, "Memory budget"],
  ] as const) {
    finite(value, label);
  }
  if (
    input.uniqueRows + input.duplicateRowsIgnored !== input.sourceRows ||
    input.completeEvents + input.partialEvents !== input.uniqueEvents
  ) {
    throw new Error("Source and event coverage counts must reconcile.");
  }
  if (
    input.capacity.peakMemoryMegabytes <= 0 ||
    input.capacity.memoryBudgetMegabytes <= 0
  ) {
    throw new Error("Capacity memory values must be positive.");
  }
  if (
    !["synthetic", "sanitized_representative", "private_hosted"].includes(
      input.capacity.evidenceSource,
    )
  ) {
    throw new Error("Capacity evidence source is invalid.");
  }

  const warnings: PrivateChronologicalValidationAssessment["warnings"][number][] =
    [];
  const chronologyValid =
    input.externallyChronologicallyOrdered &&
    input.featureCutoffStrictlyBeforeEvent &&
    input.sameEventHistoryUpdatedAfterPrediction;
  if (!chronologyValid) warnings.push("CHRONOLOGICAL_ORDER_INVALID");
  if (!input.partialEventsExcludedFromOutcomeScoring) {
    warnings.push("PARTIAL_EVENTS_INCLUDED_IN_OUTCOMES");
  }
  const baselineComplete = Object.values(input.baselinePartitions).every(
    Boolean,
  );
  if (!baselineComplete) warnings.push("BASELINE_CONTEXT_INCOMPLETE");

  const evidenceUsable =
    chronologyValid &&
    input.partialEventsExcludedFromOutcomeScoring &&
    baselineComplete;
  const directHistoryStatus =
    !evidenceUsable || input.pairedHoldoutCases === 0
      ? "insufficient_evidence"
      : input.directHistoryBrierImprovementMillionths > 0
        ? "review_candidate"
        : "not_supported";
  if (directHistoryStatus === "not_supported") {
    warnings.push("DIRECT_HISTORY_NOT_SUPPORTED");
  }
  const historicalStarStatus =
    !evidenceUsable || input.pairedHoldoutCases === 0
      ? "insufficient_evidence"
      : input.historicalStarBrierImprovementMillionths > 0
        ? "review_candidate"
        : "not_supported";
  if (historicalStarStatus === "not_supported") {
    warnings.push("HISTORICAL_STAR_FEATURE_NOT_SUPPORTED");
  }
  const lineageProxyStatus =
    !evidenceUsable || input.lineageProxyCases === 0
      ? "insufficient_evidence"
      : input.lineageProxyBrierImprovementMillionths > 0
        ? "review_candidate"
        : "not_supported";
  if (lineageProxyStatus === "not_supported") {
    warnings.push("LINEAGE_PROXY_NOT_SUPPORTED");
  }

  const breedingStatus = input.breedingTimestampCoverageAvailable
    ? "evidence_only"
    : "blocked_missing_timestamps";
  if (!input.breedingTimestampCoverageAvailable) {
    warnings.push("BREEDING_TIMESTAMPS_UNAVAILABLE");
  }
  const maidenStatus = input.pointInTimeMaidenEntitlementAvailable
    ? "evidence_only"
    : "blocked_missing_point_in_time_entitlement";
  if (!input.pointInTimeMaidenEntitlementAvailable) {
    warnings.push("POINT_IN_TIME_ME_UNAVAILABLE");
  }
  if (input.algorithmChangeClaimed || input.eraReviewCandidateCount > 0) {
    warnings.push("ALGORITHM_CHANGE_CAUSALITY_NOT_ESTABLISHED");
  }

  const representativeCapacity =
    input.capacity.evidenceSource !== "synthetic" &&
    input.uniqueRows >= 2_000_000 &&
    input.capacity.repetitions >= 3 &&
    input.capacity.peakMemoryMegabytes <=
      input.capacity.memoryBudgetMegabytes &&
    input.capacity.runsOffRequestPath;
  const capacityStatus = representativeCapacity
    ? "representative_background_only"
    : "incomplete";
  if (!input.capacity.routineRequestP95Measured) {
    warnings.push("ROUTINE_REQUEST_CAPACITY_NOT_MEASURED");
  }

  const bgcExceptionValid =
    input.economics.historicalBgcRows > 0 &&
    input.economics.raceLedgerTransactionsFromHistoricalBgc === 0 &&
    input.economics.unknownRaceAssetRows === 0;
  if (!bgcExceptionValid) warnings.push("BGC_EXCEPTION_INVALID");

  const blocked =
    !evidenceUsable ||
    breedingStatus === "blocked_missing_timestamps" ||
    maidenStatus === "blocked_missing_point_in_time_entitlement" ||
    !bgcExceptionValid;
  return {
    status: blocked ? "blocked" : "review_required",
    chronologyStatus: chronologyValid ? "valid" : "invalid",
    directHistoryStatus,
    historicalStarStatus,
    lineageProxyStatus,
    breedingStatus,
    maidenStatus,
    eraStatus:
      input.eraReviewCandidateCount > 0
        ? "review_candidates_present"
        : "no_review_candidates",
    capacityStatus,
    economicsStatus: bgcExceptionValid ? "bgc_exception_verified" : "invalid",
    warnings,
    gateCStatus: "not_accepted",
    gateEStatus: "not_accepted",
    recommendationActivationAllowed: false,
    productionMutationAllowed: false,
  };
}
